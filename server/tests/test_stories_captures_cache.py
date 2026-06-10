# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the endpoints added in the 2026-06-10 dead-wiring sweep:

- /v1/stories CRUD (StoriesView previously errored on every load)
- /v1/captures list/delete (CapturesView previously errored on every load)
- /v1/cache/recent + per-entry delete + the older_than_days prune guard
  (the prune buttons used to fall through to a FULL cache purge)
- PATCH/DELETE /v1/generations/{id} (Generate History ★ / ✕ actions)
"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from justvoice.api import captures_api, stories_api, takes_api
from justvoice.database import get_db
from justvoice.database.models import Capture, Generation
from justvoice.errors import ApiError, api_exception_handler, http_exception_handler

pytest_plugins = ["tests.conftest_db"]


@pytest.fixture
def api_client(tmp_db) -> Generator[tuple[TestClient, object], None, None]:
    SessionFactory, _ = tmp_db

    def _override_get_db():
        db = SessionFactory()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(stories_api.router)
    app.include_router(captures_api.router)
    app.include_router(takes_api.router)
    app.add_exception_handler(ApiError, api_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app, raise_server_exceptions=False) as client:
        seed = SessionFactory()
        try:
            yield client, seed
        finally:
            seed.close()


# ── stories ──────────────────────────────────────────────────────────────────


def test_stories_list_empty(api_client):
    client, _ = api_client
    r = client.get("/v1/stories")
    assert r.status_code == 200
    assert r.json() == {"stories": []}


def test_story_create_get_delete(api_client):
    client, _ = api_client
    r = client.post("/v1/stories", json={"name": "Episode 1"})
    assert r.status_code == 200
    story = r.json()
    assert story["name"] == "Episode 1"
    assert story["items"] == []

    r = client.get(f"/v1/stories/{story['id']}")
    assert r.status_code == 200

    r = client.delete(f"/v1/stories/{story['id']}")
    assert r.status_code == 200
    assert client.get(f"/v1/stories/{story['id']}").status_code == 404


def test_story_create_requires_name(api_client):
    client, _ = api_client
    assert client.post("/v1/stories", json={}).status_code == 422


# ── captures ─────────────────────────────────────────────────────────────────


def test_captures_list_empty(api_client):
    client, _ = api_client
    r = client.get("/v1/captures")
    assert r.status_code == 200
    assert r.json() == {"captures": [], "total": 0}


def test_captures_list_and_delete(api_client):
    client, seed = api_client
    cap = Capture(audio_path="/tmp/x.wav", source="mic", transcript="hello world")
    seed.add(cap)
    seed.commit()

    r = client.get("/v1/captures")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["captures"][0]["transcript"] == "hello world"

    assert client.delete(f"/v1/captures/{cap.id}").status_code == 200
    assert client.get("/v1/captures").json()["total"] == 0


# ── generations patch/delete ─────────────────────────────────────────────────


def _seed_generation(seed, tmp_path: Path | None = None) -> Generation:
    gen = Generation(text="hi", engine="kokoro", status="completed")
    if tmp_path is not None:
        wav = tmp_path / "g.wav"
        wav.write_bytes(b"RIFF0000WAVE")
        gen.audio_path = str(wav)
    seed.add(gen)
    seed.commit()
    return gen


def test_generation_favorite_toggle(api_client):
    client, seed = api_client
    gen = _seed_generation(seed)
    r = client.patch(f"/v1/generations/{gen.id}", json={"is_favorited": True})
    assert r.status_code == 200
    assert r.json()["is_favorited"] is True
    r = client.patch(f"/v1/generations/{gen.id}", json={"is_favorited": False})
    assert r.json()["is_favorited"] is False


def test_generation_delete_removes_audio(api_client, tmp_path):
    client, seed = api_client
    gen = _seed_generation(seed, tmp_path)
    audio = Path(gen.audio_path)
    assert audio.exists()
    r = client.delete(f"/v1/generations/{gen.id}")
    assert r.status_code == 200
    assert not audio.exists()
    assert client.delete(f"/v1/generations/{gen.id}").status_code == 404


# ── cache recent / entry delete / prune guard ────────────────────────────────


def test_cache_entries_and_prune(tmp_path):
    from justvoice.cache import RenderCache

    cache = RenderCache(tmp_path)
    cache.put("kokoro", "aaa", b"x" * 10)
    cache.put("kokoro", "bbb", b"y" * 20)

    entries = cache.entries()
    assert {e["key"] for e in entries} == {"aaa", "bbb"}
    assert all(e["scope"] == "kokoro" for e in entries)

    assert cache.delete_entry("kokoro", "aaa") is True
    assert cache.delete_entry("kokoro", "aaa") is False
    assert {e["key"] for e in cache.entries()} == {"bbb"}

    # Nothing is older than 1 day — prune removes 0, keeps the entry.
    assert cache.prune_older_than(1) == 0
    assert len(cache.entries()) == 1
    # Everything is older than -1 days (future cutoff) — removes it.
    assert cache.prune_older_than(-1) == 1
    assert cache.entries() == []


def test_cache_clear_rejects_unsupported_filters(tmp_path, monkeypatch):
    """The old behaviour silently purged EVERYTHING when the UI passed
    voice_id / engine / favorited. Now it must 400."""
    import asyncio

    from justvoice.api import cache_api
    from justvoice.app_state import AppState, set_state
    from justvoice.errors import ApiError

    state = AppState(tmp_path)
    set_state(state)
    state._render_cache.put("kokoro", "ccc", b"z")

    with pytest.raises(ApiError):
        asyncio.get_event_loop().run_until_complete(
            cache_api.clear_cache(voice_id="af_bella")
        )
    # Entry survived the rejected call.
    assert len(state._render_cache.entries()) == 1
