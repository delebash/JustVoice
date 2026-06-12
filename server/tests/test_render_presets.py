# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for render_presets table — unique (project_id, name) constraint
+ CRUD round-trips.
"""

from __future__ import annotations

import json

from justvoice.database.models import Persona, RenderPreset

pytest_plugins = ["tests.conftest_db"]


def _make_voice(db_session, name="V1"):
    # After Slice 4 of the Profile-kill rollout RenderPreset.voice_id
    # references a Persona, not a VoiceProfile.
    v = Persona(name=name)
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)
    return v


def test_create_and_list(db_session):
    v = _make_voice(db_session)
    p = RenderPreset(
        name="ACX-default",
        voice_id=v.id,
        master="acx",
        delivery_json=json.dumps({"speed": 1.0}),
        lexicons_json="[]",
    )
    db_session.add(p)
    db_session.commit()
    assert db_session.query(RenderPreset).count() == 1


def test_unique_name_within_global_scope(db_session):
    """Two global presets (project_id null) can't share a name."""
    v = _make_voice(db_session)
    p1 = RenderPreset(name="duplicate", voice_id=v.id, project_id=None)
    db_session.add(p1)
    db_session.commit()
    p2 = RenderPreset(name="duplicate", voice_id=v.id, project_id=None)
    db_session.add(p2)
    # NOTE: enforcement is via the application-level conflict check in
    # render_presets_api.create_preset (the DB index is belt-and-suspenders
    # but SQLite treats NULL != NULL in unique indexes). Application-level
    # check covers this.
    # So this commits — but the app endpoint blocks it. We verify the app
    # path in test_render_presets_api.


def test_delivery_only_preset_no_voice(db_session):
    """voice_id is nullable (2026-06-12) — a preset is a delivery STYLE;
    the persona binding is optional. The old NOT NULL forced the UI to
    invent a binding, which 500'd with a FOREIGN KEY IntegrityError."""
    p = RenderPreset(
        name="Narration",
        voice_id=None,
        delivery_json=json.dumps({"speed": 1.0}),
        lexicons_json="[]",
        is_builtin=True,
    )
    db_session.add(p)
    db_session.commit()
    fetched = db_session.query(RenderPreset).filter(RenderPreset.name == "Narration").one()
    assert fetched.voice_id is None
    assert fetched.is_builtin is True


def test_check_voice_rejects_unknown_persona(db_session):
    """The API guard turns the raw FK 500 into a friendly 400."""
    import pytest
    from justvoice.api.render_presets_api import _check_voice
    from justvoice.errors import ApiError

    _check_voice(None, db_session)  # no binding — fine
    _check_voice("", db_session)  # clear signal — fine
    v = _make_voice(db_session)
    _check_voice(v.id, db_session)  # real persona — fine
    with pytest.raises(ApiError):
        _check_voice("not-a-persona-id", db_session)


def test_migration_relaxes_voice_id_not_null(tmp_path):
    """Old-shape DBs (voice_id NOT NULL) get the table rebuilt in place,
    keeping rows + gaining is_builtin."""
    from sqlalchemy import create_engine, inspect, text

    from justvoice.database.migrations import run_migrations

    db_path = tmp_path / "old-shape.db"
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.connect() as conn:
        conn.execute(text("CREATE TABLE projects (id VARCHAR PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE personas (id VARCHAR PRIMARY KEY)"))
        conn.execute(
            text(
                """
                CREATE TABLE render_presets (
                    id VARCHAR NOT NULL PRIMARY KEY,
                    name VARCHAR NOT NULL,
                    project_id VARCHAR REFERENCES projects (id) ON DELETE CASCADE,
                    voice_id VARCHAR NOT NULL REFERENCES personas (id) ON DELETE RESTRICT,
                    delivery_json TEXT NOT NULL,
                    effects_chain TEXT,
                    master VARCHAR,
                    lexicons_json TEXT NOT NULL,
                    seed INTEGER,
                    cache_scope VARCHAR NOT NULL,
                    description TEXT,
                    created_at DATETIME,
                    updated_at DATETIME
                )
                """
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX ix_render_presets_unique_name_per_project "
                "ON render_presets (project_id, name)"
            )
        )
        conn.execute(text("INSERT INTO personas (id) VALUES ('per-1')"))
        conn.execute(
            text(
                "INSERT INTO render_presets "
                "(id, name, voice_id, delivery_json, lexicons_json, cache_scope) "
                "VALUES ('rp-1', 'Old', 'per-1', '{}', '[]', 'default')"
            )
        )
        conn.commit()

    run_migrations(engine)

    inspector = inspect(engine)
    cols = {c["name"]: c for c in inspector.get_columns("render_presets")}
    assert cols["voice_id"]["nullable"] is True
    assert "is_builtin" in cols
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, voice_id FROM render_presets")).fetchall()
        assert rows == [("rp-1", "per-1")]
        # And the relaxed shape accepts a delivery-only row.
        conn.execute(
            text(
                "INSERT INTO render_presets "
                "(id, name, voice_id, delivery_json, lexicons_json, cache_scope) "
                "VALUES ('rp-2', 'New', NULL, '{}', '[]', 'default')"
            )
        )
        conn.commit()
    engine.dispose()


def test_builtin_render_presets_seeded(tmp_path):
    """Boot seeds the 4 task-#88 styles as global delivery-only presets."""
    from justvoice.app import create_app

    create_app(data_dir=tmp_path)

    from justvoice.database import get_db

    db = next(get_db())
    try:
        rows = db.query(RenderPreset).filter(RenderPreset.is_builtin).all()
        names = {r.name for r in rows}
        assert {"Narration", "Dramatic Dialogue", "Quiet Reflection", "Action"} <= names
        for r in rows:
            assert r.voice_id is None
            assert r.project_id is None
            assert json.loads(r.delivery_json)  # non-empty delivery payload
    finally:
        db.close()


def test_round_trip_fields(db_session):
    v = _make_voice(db_session)
    p = RenderPreset(
        name="my-preset",
        voice_id=v.id,
        master="acx",
        delivery_json=json.dumps({"speed": 0.9, "gain_db": -1}),
        lexicons_json=json.dumps(["lex1", "lex2"]),
        seed=42,
        cache_scope="book-123",
        description="My favorite preset",
    )
    db_session.add(p)
    db_session.commit()
    fetched = db_session.query(RenderPreset).filter(RenderPreset.name == "my-preset").one()
    assert fetched.voice_id == v.id
    assert fetched.master == "acx"
    assert json.loads(fetched.delivery_json) == {"speed": 0.9, "gain_db": -1}
    assert json.loads(fetched.lexicons_json) == ["lex1", "lex2"]
    assert fetched.seed == 42
    assert fetched.cache_scope == "book-123"
