# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/admin/factory-reset — must survive a DB whose tables drifted
from the ORM metadata (user-hit 2026-06-12: legacy voice_profiles is in
Base.metadata but not in real databases → the wipe 500'd)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from sqlalchemy import text

from justvoice.api import admin_api
from justvoice.database.models import Project
from justvoice.models import Settings

from tests.conftest_db import tmp_db  # noqa: F401


class _SettingsStore:
    def __init__(self):
        self._s = Settings()

    def get(self):
        return self._s.model_copy(deep=True)

    def set(self, new):
        self._s = new
        return new


def test_factory_reset_survives_missing_table(tmp_db, monkeypatch):  # noqa: F811
    session_factory, engine = tmp_db
    # Simulate metadata/DB drift: drop a table the ORM still declares.
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS webhooks"))

    db = session_factory()
    db.add(Project(id="p1", name="P", project_type="audiobook"))
    db.commit()
    db.close()

    monkeypatch.setattr(admin_api.db_session, "SessionLocal", session_factory)
    # Force the drop-tables fallback — the file-delete path targets the
    # module's real DB, which other tests may have initialized.
    monkeypatch.setattr(admin_api.db_session, "_db_path", None)
    monkeypatch.setattr(admin_api.db_session, "engine", None)
    state = SimpleNamespace(settings=_SettingsStore())
    monkeypatch.setattr(admin_api, "get_state", lambda: state)

    r = asyncio.run(admin_api.factory_reset())
    assert r.reset is True
    assert r.tables_cleared > 0

    db = session_factory()
    try:
        assert db.query(Project).count() == 0
    finally:
        db.close()


def test_factory_reset_preserves_server_section(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(admin_api.db_session, "SessionLocal", session_factory)
    monkeypatch.setattr(admin_api.db_session, "_db_path", None)
    monkeypatch.setattr(admin_api.db_session, "engine", None)
    store = _SettingsStore()
    s = store.get()
    s.server.port = 4242
    s.logging.level = "debug"
    store.set(s)
    monkeypatch.setattr(admin_api, "get_state", lambda: SimpleNamespace(settings=store))

    asyncio.run(admin_api.factory_reset())
    after = store.get()
    assert after.server.port == 4242          # reachability survives
    assert after.logging.level == "info"      # everything else defaults


def test_factory_reset_clears_file_stores(tmp_db, tmp_path, monkeypatch):  # noqa: F811
    """Personas (and the other file-backed stores) must not survive a
    reset — user-hit 2026-06-12: the DB wipe left the persona JSON files
    + in-memory cache alive, so 'reset' brought every character back."""
    from justvoice.storage.personas import PersonaStore

    session_factory, _engine = tmp_db
    monkeypatch.setattr(admin_api.db_session, "SessionLocal", session_factory)
    monkeypatch.setattr(admin_api.db_session, "_db_path", None)
    monkeypatch.setattr(admin_api.db_session, "engine", None)

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    personas = PersonaStore(data_dir)
    personas.create("Mara", voice_id=None)
    assert len(personas.list()) == 1

    state = SimpleNamespace(settings=_SettingsStore(), data_dir=data_dir, personas=personas)
    monkeypatch.setattr(admin_api, "get_state", lambda: state)

    asyncio.run(admin_api.factory_reset())

    # In-memory store was re-instantiated empty AND the files are gone.
    assert state.personas.list() == []
    assert not list((data_dir / "personas").glob("*.json"))


def test_factory_reset_unloads_engines(tmp_db, monkeypatch):  # noqa: F811
    """A fresh install has no engine resident — reset must unload the
    managed slots and drop runtime-registered external providers
    (user-hit 2026-06-12: engine still showed loaded after reset)."""
    from justvoice.engines import manager as manager_mod
    from justvoice.engines.registry import EngineRegistry

    session_factory, _engine = tmp_db
    monkeypatch.setattr(admin_api.db_session, "SessionLocal", session_factory)
    monkeypatch.setattr(admin_api.db_session, "_db_path", None)
    monkeypatch.setattr(admin_api.db_session, "engine", None)

    unloaded = []

    class _StubManager:
        def unload(self, kind=None):
            unloaded.append(kind)
            return {"previous_engine": "kokoro"}

    monkeypatch.setattr(manager_mod, "get_manager", lambda: _StubManager())

    class _FakeBackend:
        meta = SimpleNamespace(engine_id="ext-tts", display_name="Ext", backend="openai")
        unload_called = False

        def ready(self):
            return True

        def unload(self):
            self.unload_called = True

    backend = _FakeBackend()
    registry = EngineRegistry()
    registry.register(backend)
    registry.set_current("ext-tts")

    state = SimpleNamespace(settings=_SettingsStore(), engines=registry)
    monkeypatch.setattr(admin_api, "get_state", lambda: state)

    asyncio.run(admin_api.factory_reset())

    assert unloaded == [None]  # all managed slots unloaded
    assert backend.unload_called
    assert state.engines is not registry  # fresh, empty registry
    assert state.engines.registered_ids() == []
    assert state.engines.current() is None
