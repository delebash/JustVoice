# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/cache/clear filter honesty (wiring-audit W1).

Before 2026-06-13 the endpoint read ONLY `scope`; the UI's filtered
prunes (older_than_days / voice_id / engine / favorited) were silently
dropped, so "prune by voice" wiped the entire cache. Now: age + scope
are honored, identity filters are rejected loudly (they belong to
DELETE /v1/generations — see test_bulk_delete_filters.py).
"""

from __future__ import annotations

import os
import time

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.app_state import get_state
from justvoice.cache import RenderCache


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _backdate(path, days: float) -> None:
    ts = time.time() - days * 86400.0
    os.utime(path, (ts, ts))


# ── RenderCache.clear unit semantics ──────────────────────────────────


def test_clear_older_than_removes_only_old_entries(tmp_path):
    cache = RenderCache(tmp_path / "cache")
    cache.put("scene-1", "k-old", b"old")
    cache.put("scene-1", "k-new", b"new")
    cache.put("scene-2", "k-old2", b"old2")
    _backdate(cache._path("scene-1", "k-old"), days=40)
    _backdate(cache._path("scene-2", "k-old2"), days=40)

    removed = cache.clear(older_than_days=30)

    assert removed == 2
    assert cache.get("scene-1", "k-old") is None
    assert cache.get("scene-2", "k-old2") is None
    assert cache.get("scene-1", "k-new") == b"new"


def test_clear_older_than_scoped(tmp_path):
    cache = RenderCache(tmp_path / "cache")
    cache.put("scene-1", "k1", b"a")
    cache.put("scene-2", "k2", b"b")
    _backdate(cache._path("scene-1", "k1"), days=40)
    _backdate(cache._path("scene-2", "k2"), days=40)

    removed = cache.clear("scene-1", older_than_days=30)

    assert removed == 1
    assert cache.get("scene-1", "k1") is None
    assert cache.get("scene-2", "k2") == b"b"


def test_clear_evicts_memory_for_removed_files(tmp_path):
    cache = RenderCache(tmp_path / "cache")
    cache.put("scene-1", "k1", b"a")  # in memory AND on disk
    _backdate(cache._path("scene-1", "k1"), days=40)

    cache.clear(older_than_days=30)

    # The hot tier must not resurrect a pruned entry.
    assert cache.get("scene-1", "k1") is None


def test_clear_unfiltered_still_wipes_all(tmp_path):
    cache = RenderCache(tmp_path / "cache")
    cache.put("scene-1", "k1", b"a")
    cache.put("scene-2", "k2", b"b")

    removed = cache.clear()

    assert removed == 2
    assert cache.stats().total_entries_on_disk == 0


def test_memory_tier_evicts_lru_past_cap(tmp_path):
    """The in-memory hot tier is bounded: past max_memory_entries the
    least-recently-used entry is dropped, but its disk copy survives (put()
    writes disk first) so a later get() re-reads it."""
    cache = RenderCache(tmp_path / "cache", max_memory_entries=2)
    cache.put("s", "a", b"a")
    cache.put("s", "b", b"b")
    cache.get("s", "a")  # touch a → b becomes the LRU entry
    cache.put("s", "c", b"c")  # inserting c evicts b from the hot tier

    assert cache.stats().memory_entries == 2
    # b fell out of memory but is still on disk → get() repopulates and returns.
    assert cache.get("s", "b") == b"b"


# ── Endpoint behavior ─────────────────────────────────────────────────


def test_endpoint_rejects_identity_filters_and_destroys_nothing(client):
    cache = get_state()._render_cache
    cache.put("scene-1", "k1", b"a")

    for params in ("voice_id=v1", "engine=kokoro", "favorited=false"):
        r = client.post(f"/v1/cache/clear?{params}")
        assert r.status_code == 400, params
        assert "/v1/generations" in r.json()["detail"]

    # The 2026-06-12 failure mode: filtered prune must NOT have wiped.
    assert cache.stats().total_entries_on_disk == 1


def test_endpoint_honors_older_than_days(client):
    cache = get_state()._render_cache
    cache.put("scene-1", "k-old", b"old")
    cache.put("scene-1", "k-new", b"new")
    _backdate(cache._path("scene-1", "k-old"), days=40)

    r = client.post("/v1/cache/clear?older_than_days=30")

    assert r.status_code == 200
    assert r.json()["removed"] == 1
    assert cache.stats().total_entries_on_disk == 1


def test_endpoint_scope_clear_unchanged(client):
    cache = get_state()._render_cache
    cache.put("scene-1", "k1", b"a")
    cache.put("scene-2", "k2", b"b")

    r = client.post("/v1/cache/clear?scope=scene-1")

    assert r.status_code == 200
    assert cache.get("scene-2", "k2") == b"b"
    assert cache.get("scene-1", "k1") is None
