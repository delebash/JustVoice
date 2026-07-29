# SPDX-License-Identifier: MIT
"""GET /v1/render/cache-stats — the Studio Render cache banner.

Probes each block's render-cache key without rendering. Uses the same
SessionLocal-patch + fake-state pattern as test_render_chapter_scene_mode.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from justvoice.api import render_chapter_api
from justvoice.database.models import Block, Project, Scene
from justvoice.errors import ApiError
from justvoice.models import Persona

from tests.conftest_db import tmp_db  # noqa: F401


def _persona(pid: str, voice_id: str = "voice-1") -> Persona:
    now = datetime.now(timezone.utc)
    return Persona(
        id=pid, name=f"P {pid}", voice_id=voice_id,
        default_delivery={}, created_at=now, updated_at=now,
    )


def _state(personas: dict[str, Persona]):
    class _Personas:
        def get(self, pid):
            return personas.get(pid)
    return SimpleNamespace(personas=_Personas())


def _seed(db, n_blocks: int = 3):
    proj = Project(id="proj-1", name="P", project_type="audiobook")
    db.add(proj)
    db.flush()
    scene = Scene(id="scene-1", project_id=proj.id, position=0, title="Ch 1")
    db.add(scene)
    db.flush()
    for i in range(n_blocks):
        db.add(Block(scene_id=scene.id, position=i, text=f"line {i}", persona_id="p1"))
    db.flush()
    db.commit()


def test_cache_stats_counts_uncached_lines(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed(db, n_blocks=3)
    db.close()

    state = _state({"p1": _persona("p1")})
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: state)
    # Voice can't resolve to an engine in this barebones state → probe
    # returns None per line; the endpoint must count them as not-cached
    # rather than crash.
    monkeypatch.setattr(
        render_chapter_api, "probe_line_cached", lambda *a, **k: False
    )

    r = asyncio.run(render_chapter_api.render_cache_stats("proj-1"))
    assert r.total == 3
    assert r.cached == 0
    assert r.scenes[0].scene_id == "scene-1"
    assert r.scenes[0].total == 3


def test_cache_stats_counts_cached_lines(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed(db, n_blocks=4)
    db.close()

    state = _state({"p1": _persona("p1")})
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: state)
    hits = iter([True, True, True, False])
    monkeypatch.setattr(
        render_chapter_api, "probe_line_cached", lambda *a, **k: next(hits)
    )

    r = asyncio.run(render_chapter_api.render_cache_stats("proj-1"))
    assert r.total == 4
    assert r.cached == 3


def test_cache_stats_unknown_project_404s(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    with pytest.raises(ApiError):
        asyncio.run(render_chapter_api.render_cache_stats("nope"))
