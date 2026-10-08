// SPDX-License-Identifier: MIT
// POST /v1/cache/clear filter honesty (the port of tests/test_cache_clear_filters.py;
// wiring-audit W1): age + scope are honored by RenderCache.clear; identity filters belong to
// DELETE /v1/generations. The three endpoint tests wait for api/cache_api.js + app.js.
import { utimesSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { RenderCache } from "../src/cache.js";
import { tmpPath } from "./helpers.js";

function backdate(p, days) {
  const ts = Date.now() / 1000 - days * 86400.0;
  utimesSync(p, ts, ts);
}

const buf = (s) => Buffer.from(s);

// ── RenderCache.clear unit semantics ──────────────────────────────────

test("clear_older_than_removes_only_old_entries", () => {
  const cache = new RenderCache(path.join(tmpPath(), "cache"));
  cache.put("scene-1", "k-old", buf("old"));
  cache.put("scene-1", "k-new", buf("new"));
  cache.put("scene-2", "k-old2", buf("old2"));
  backdate(cache._path("scene-1", "k-old"), 40);
  backdate(cache._path("scene-2", "k-old2"), 40);

  const removed = cache.clear(null, 30);

  expect(removed).toBe(2);
  expect(cache.get("scene-1", "k-old")).toBeNull();
  expect(cache.get("scene-2", "k-old2")).toBeNull();
  expect(cache.get("scene-1", "k-new")).toEqual(buf("new"));
});

test("clear_older_than_scoped", () => {
  const cache = new RenderCache(path.join(tmpPath(), "cache"));
  cache.put("scene-1", "k1", buf("a"));
  cache.put("scene-2", "k2", buf("b"));
  backdate(cache._path("scene-1", "k1"), 40);
  backdate(cache._path("scene-2", "k2"), 40);

  const removed = cache.clear("scene-1", 30);

  expect(removed).toBe(1);
  expect(cache.get("scene-1", "k1")).toBeNull();
  expect(cache.get("scene-2", "k2")).toEqual(buf("b"));
});

test("clear_evicts_memory_for_removed_files", () => {
  const cache = new RenderCache(path.join(tmpPath(), "cache"));
  cache.put("scene-1", "k1", buf("a")); // in memory AND on disk
  backdate(cache._path("scene-1", "k1"), 40);

  cache.clear(null, 30);

  // The hot tier must not resurrect a pruned entry.
  expect(cache.get("scene-1", "k1")).toBeNull();
});

test("clear_unfiltered_still_wipes_all", () => {
  const cache = new RenderCache(path.join(tmpPath(), "cache"));
  cache.put("scene-1", "k1", buf("a"));
  cache.put("scene-2", "k2", buf("b"));

  expect(cache.clear()).toBe(2);
  expect(cache.stats().total_entries_on_disk).toBe(0);
});

test("memory_tier_evicts_lru_past_cap", () => {
  // Past max_memory_entries the least-recently-used entry is dropped, but its disk copy
  // survives (put() writes disk first) so a later get() re-reads it.
  const cache = new RenderCache(path.join(tmpPath(), "cache"), 2);
  cache.put("s", "a", buf("a"));
  cache.put("s", "b", buf("b"));
  cache.get("s", "a"); // touch a → b becomes the LRU entry
  cache.put("s", "c", buf("c")); // inserting c evicts b from the hot tier

  expect(cache.stats().memory_entries).toBe(2);
  // b fell out of memory but is still on disk → get() repopulates and returns.
  expect(cache.get("s", "b")).toEqual(buf("b"));
});

// ── Endpoint behavior ─────────────────────────────────────────────────

test.todo("endpoint_rejects_identity_filters_and_destroys_nothing — waits for api/cache_api.js + app.js");
test.todo("endpoint_honors_older_than_days — waits for api/cache_api.js + app.js");
test.todo("endpoint_scope_clear_unchanged — waits for api/cache_api.js + app.js");
