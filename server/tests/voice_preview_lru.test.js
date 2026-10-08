// SPDX-License-Identifier: MIT
// The voice-preview LRU — 20-cap, 10-min TTL, eviction (the port of
// tests/test_voice_preview_lru.py). The cache is `cfg._PREVIEW_LRU` (cachetools' TTLCache
// ported as `TTLCache`); a test replaces it as Python monkeypatched the module global.
import { afterEach, beforeEach, expect, test } from "vitest";
import * as vp from "../src/api/voice_preview_api.js";

let saved;
beforeEach(() => {
  saved = vp.cfg._PREVIEW_LRU;
  // Clear the module-level LRU between tests (otherwise it leaks across them).
  vp.cfg._PREVIEW_LRU.clear();
});
afterEach(() => {
  vp.cfg._PREVIEW_LRU = saved;
});

test("lru_eviction_at_cap", async () => {
  // When more than 20 previews are stored, the oldest is evicted.
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push(await vp._storePreview(new vp._PreviewEntry("cloned", { i }, Buffer.from("wav-bytes"))));
  // The first 5 are evicted; only the last 20 remain.
  expect(vp.cfg._PREVIEW_LRU.size).toBe(20);
  for (const early of ids.slice(0, 5)) expect(vp.cfg._PREVIEW_LRU.has(early)).toBe(false);
  for (const late of ids.slice(5)) expect(vp.cfg._PREVIEW_LRU.has(late)).toBe(true);
});

test("get_moves_to_end_for_lru_semantics", async () => {
  // Reading a preview makes it most-recently-used.
  const pids = [];
  for (let i = 0; i < 20; i++) pids.push(await vp._storePreview(new vp._PreviewEntry("cloned", { i }, Buffer.from("x"))));
  // Touch the first one — now adding a 21st should evict the SECOND, not the first.
  await vp._getPreview(pids[0]);
  const newPid = await vp._storePreview(new vp._PreviewEntry("cloned", { i: 99 }, Buffer.from("x")));
  expect(vp.cfg._PREVIEW_LRU.has(pids[0])).toBe(true);
  expect(vp.cfg._PREVIEW_LRU.has(pids[1])).toBe(false);
  expect(vp.cfg._PREVIEW_LRU.has(newPid)).toBe(true);
});

test("store_then_get_hit", async () => {
  // A freshly stored preview reads back by id (hit/miss + key semantics).
  const e = new vp._PreviewEntry("cloned", { i: 0 }, Buffer.from("wav"));
  const pid = await vp._storePreview(e);
  expect(await vp._getPreview(pid)).toBe(e);
  expect(await vp._getPreview("does-not-exist")).toBeNull();
});

test("ttl_expiry", async () => {
  // Expired entries read back as null (→ 404). Expiry is driven by the cache's own TTL timer
  // (set at insert), not the entry's advisory .expiresAt, so exercise a short-lived cache.
  vp.cfg._PREVIEW_LRU = new vp.TTLCache(vp._LRU_CAP, 0.05);
  const pid = await vp._storePreview(new vp._PreviewEntry("cloned", { i: 0 }, Buffer.from("x")));
  expect(await vp._getPreview(pid)).not.toBeNull(); // live immediately
  await new Promise((r) => setTimeout(r, 120));
  expect(await vp._getPreview(pid)).toBeNull(); // lapsed past TTL
});
