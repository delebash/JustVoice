# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the voice-preview LRU semantics — 20-cap, 10-min TTL, eviction."""

from __future__ import annotations

import asyncio
import time

import pytest

from justvoice.api import voice_preview_api as vp


@pytest.mark.asyncio
async def test_lru_eviction_at_cap():
    """When more than 20 previews are stored, the oldest is evicted."""
    # Clear the module-level LRU between tests (otherwise leaks across runs).
    vp._PREVIEW_LRU.clear()
    ids: list[str] = []
    for i in range(25):
        entry = vp._PreviewEntry("cloned", {"i": i}, b"wav-bytes")
        pid = await vp._store_preview(entry)
        ids.append(pid)
    # First 5 should be evicted; only last 20 remain.
    assert len(vp._PREVIEW_LRU) == 20
    for early in ids[:5]:
        assert early not in vp._PREVIEW_LRU
    for late in ids[5:]:
        assert late in vp._PREVIEW_LRU


@pytest.mark.asyncio
async def test_get_moves_to_end_for_lru_semantics():
    """Reading a preview makes it most-recently-used."""
    vp._PREVIEW_LRU.clear()
    pids: list[str] = []
    for i in range(20):
        e = vp._PreviewEntry("cloned", {"i": i}, b"x")
        pids.append(await vp._store_preview(e))
    # Touch the first one — now adding a 21st should evict the SECOND, not first.
    await vp._get_preview(pids[0])
    new_pid = await vp._store_preview(vp._PreviewEntry("cloned", {"i": 99}, b"x"))
    assert pids[0] in vp._PREVIEW_LRU
    assert pids[1] not in vp._PREVIEW_LRU
    assert new_pid in vp._PREVIEW_LRU


@pytest.mark.asyncio
async def test_ttl_expiry():
    """Expired entries are pruned on access."""
    vp._PREVIEW_LRU.clear()
    e = vp._PreviewEntry("cloned", {"i": 0}, b"x")
    e.expires_at = time.time() - 1  # already expired
    pid = await vp._store_preview(e)
    fetched = await vp._get_preview(pid)
    assert fetched is None
