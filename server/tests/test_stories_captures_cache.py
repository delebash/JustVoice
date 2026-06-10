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
        asyncio.run(cache_api.clear_cache(voice_id="af_bella"))
    # Entry survived the rejected call.
    assert len(state._render_cache.entries()) == 1


# ── story items (timeline clips) ─────────────────────────────────────


def _seed_gen(seed, text="clip", duration=2.5):
    g = Generation(text=text, engine="kokoro", status="completed", duration_sec=duration,
                   audio_path="/tmp/fake.wav")
    seed.add(g)
    seed.commit()
    return g


def test_story_item_add_auto_placement(api_client):
    client, seed = api_client
    story = client.post("/v1/stories", json={"name": "Ep"}).json()
    g1 = _seed_gen(seed, "first", 2.0)
    g2 = _seed_gen(seed, "second", 1.0)

    r1 = client.post(f"/v1/stories/{story['id']}/items", json={"generation_id": g1.id})
    assert r1.status_code == 200
    item1 = r1.json()["items"][0]
    assert item1["start_time_ms"] == 0
    assert item1["duration"] == 2.0
    assert item1["audio_url"] == f"/v1/generations/{g1.id}/audio"

    # Second clip on the same track lands 200 ms after the first ends.
    r2 = client.post(f"/v1/stories/{story['id']}/items", json={"generation_id": g2.id})
    items = r2.json()["items"]
    assert len(items) == 2
    assert items[1]["start_time_ms"] == 2200

    # Explicit placement wins.
    g3 = _seed_gen(seed, "third", 1.0)
    r3 = client.post(
        f"/v1/stories/{story['id']}/items",
        json={"generation_id": g3.id, "track": 1, "start_time_ms": 500},
    )
    placed = [i for i in r3.json()["items"] if i["generation_id"] == g3.id][0]
    assert placed["track"] == 1 and placed["start_time_ms"] == 500


def test_story_item_patch_and_delete(api_client):
    client, seed = api_client
    story = client.post("/v1/stories", json={"name": "Ep2"}).json()
    g = _seed_gen(seed)
    item = client.post(f"/v1/stories/{story['id']}/items", json={"generation_id": g.id}).json()["items"][0]

    r = client.patch(
        f"/v1/stories/{story['id']}/items/{item['id']}",
        json={"start_time_ms": 1234, "volume": 0.5, "track": 2},
    )
    updated = r.json()["items"][0]
    assert updated["start_time_ms"] == 1234
    assert updated["volume"] == 0.5
    assert updated["track"] == 2

    # Volume outside 0..2 rejected.
    assert client.patch(
        f"/v1/stories/{story['id']}/items/{item['id']}", json={"volume": 3.0}
    ).status_code == 422

    r = client.delete(f"/v1/stories/{story['id']}/items/{item['id']}")
    assert r.json()["items"] == []
    assert client.delete(f"/v1/stories/{story['id']}/items/{item['id']}").status_code == 404
