// SPDX-License-Identifier: GPL-3.0-or-later
//
// projectsCache — Pinia-backed stale-while-revalidate cache for
// /v1/projects. Views consume `projects` directly (already populated
// from the previous visit / from localStorage on cold start) and call
// `refreshIfStale()` on mount; the fetch runs in the BACKGROUND,
// silently swapping in the new list when it lands.
//
// User-hit (2026-06-13): "every time i switch to project view i see
// loading msg for 1 sec even when no projects". Two root causes —
// (a) onMounted(fetch) ran on every nav with no in-memory cache, and
// (b) the loading flag flipped true on every cold-cache fetch even
// when the response was empty, producing a sub-perceptual flash.
//
// SWR semantics:
//   - `projects`        — reactive list, populated from snapshot on
//                          construction, then from the latest fetch.
//   - `initialized`     — true after the first successful fetch this
//                          session. Used to gate the "Loading…"
//                          indicator (we never show it once we know
//                          the answer, even if the answer is []).
//   - `pending`         — a fetch is in flight RIGHT NOW. Views can
//                          still render the cached `projects`.
//   - `showLoading`     — derived: true only when pending AND no
//                          cached data AND ≥250ms have elapsed (kills
//                          the sub-perceptual flash on fast responses).
//   - `refreshIfStale(maxAgeMs = 10_000)` — fetch only if no fetch in
//                          flight AND last fetch is older than the
//                          window. Default 10s.
//   - `invalidate()`    — force the next refresh to re-fetch (used
//                          after create / delete / update).

import { defineStore } from "pinia";

import { projectsService } from "../services/projects.js";
import { readSnapshot, writeSnapshot } from "../services/snapshot.js";

const SNAPSHOT_KEY = "jv.books.snapshot";
const LOADING_FLASH_DELAY_MS = 250;
const STALE_WINDOW_MS = 10_000;

export const useProjectsCache = defineStore("projectsCache", {
  state: () => ({
    projects: readSnapshot(SNAPSHOT_KEY) || [],
    // True the moment the first fetch (success or empty result) lands
    // — flips the "Loading…" gate off permanently for this session.
    initialized: false,
    pending: false,
    lastFetchedAt: 0,
    _flashTimer: null,
    _flashArmed: false,
  }),
  getters: {
    // Only show the loading indicator when (a) a fetch is in flight,
    // (b) the cache has nothing yet (no snapshot + never fetched), and
    // (c) at least LOADING_FLASH_DELAY_MS have passed. Sub-perceptual
    // flashes are worse than no indicator at all.
    showLoading: (s) =>
      s.pending && s.projects.length === 0 && !s.initialized && s._flashArmed,
  },
  actions: {
    async refreshIfStale(maxAgeMs = STALE_WINDOW_MS) {
      if (this.pending) return;
      if (this.initialized && Date.now() - this.lastFetchedAt < maxAgeMs) return;
      await this._fetch();
    },
    async refresh() {
      // Force-refresh — bypass the cache window. Used after mutations.
      if (this.pending) return;
      await this._fetch();
    },
    invalidate() {
      this.lastFetchedAt = 0;
    },
    async _fetch() {
      this.pending = true;
      // Arm the loading-indicator timer only when we have no cached
      // answer yet. If projects.length > 0, the user already sees a
      // list; a spinner on top of that would be noise.
      this._flashArmed = false;
      if (this.projects.length === 0 && !this.initialized) {
        this._flashTimer = setTimeout(() => {
          this._flashArmed = true;
        }, LOADING_FLASH_DELAY_MS);
      }
      try {
        const res = await projectsService.list();
        this.projects = res?.projects ?? [];
        writeSnapshot(SNAPSHOT_KEY, this.projects);
        this.initialized = true;
        this.lastFetchedAt = Date.now();
      } catch (e) {
        // Don't blow away the cached list on a transient failure —
        // the previous snapshot is more useful than an empty screen.
        // eslint-disable-next-line no-console
        console.warn("projectsCache: refresh failed", e);
        throw e;
      } finally {
        if (this._flashTimer) {
          clearTimeout(this._flashTimer);
          this._flashTimer = null;
        }
        this._flashArmed = false;
        this.pending = false;
      }
    },
  },
});
