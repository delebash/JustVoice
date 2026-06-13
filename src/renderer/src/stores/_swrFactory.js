// SPDX-License-Identifier: GPL-3.0-or-later
//
// SWR Pinia store factory. Used by per-resource caches
// (projectsCache, voicesCache, enginesCache, personasCache,
// lexiconsCache, …) so we get one consistent set of semantics:
//
//   - Constructor reads the last visit's snapshot from localStorage
//     so cold paint is instant.
//   - `refreshIfStale(maxAgeMs = 10_000)` — onMounted's default. If a
//     fetch landed in the last 10s, skip; otherwise fetch silently
//     in the background while the cached value keeps rendering.
//   - `refresh()` — force fetch, used after mutations.
//   - `showLoading` getter — TRUE only when (a) a fetch is in flight,
//     (b) there's nothing cached to render yet (still on the empty
//     fallback), AND (c) the fetch has been pending ≥ the flash
//     delay (default 250ms). Once `initialized` flips on the first
//     success the indicator is permanently silenced for this session.
//
// User catch (2026-06-13): "this app is slow it keeps checking for
// things, every time i switch to project view i see loading msg for
// 1 sec even when no projects". Fixed root cause: `onMounted(refresh)`
// on every view with no in-memory cache + a loading flag that flipped
// true on every cold fetch (including empty-result responses).

import { defineStore } from "pinia";

import { readSnapshot, writeSnapshot } from "../services/snapshot.js";

const LOADING_FLASH_DELAY_MS = 250;
const STALE_WINDOW_MS = 10_000;

/**
 * Create a Pinia SWR store.
 *
 * @param {object}   opts
 * @param {string}   opts.id            Pinia store id (must be unique).
 * @param {string}   opts.snapshotKey   localStorage key for instant paint.
 * @param {Function} opts.fetcher       async () => fresh value.
 * @param {*}        opts.emptyValue    Value to render when nothing's cached
 *                                       (typically [] or {}).
 * @param {number}   [opts.staleWindowMs]      Override SWR window (default 10s).
 * @param {number}   [opts.loadingFlashDelayMs] Override loading delay (default 250ms).
 * @returns {Function} A Pinia store hook.
 */
export function defineSwrStore({
  id,
  snapshotKey,
  fetcher,
  emptyValue,
  staleWindowMs = STALE_WINDOW_MS,
  loadingFlashDelayMs = LOADING_FLASH_DELAY_MS,
}) {
  const emptyFactory = () =>
    Array.isArray(emptyValue) ? [...emptyValue] : { ...emptyValue };

  return defineStore(id, {
    state: () => ({
      // Painted from snapshot on first construction; replaced by the
      // latest fetch result. Views consume this directly.
      data: readSnapshot(snapshotKey) || emptyFactory(),
      // True the moment the first fetch (success OR empty result) lands.
      // Used to gate the "Loading…" indicator forever after.
      initialized: false,
      pending: false,
      lastFetchedAt: 0,
      _flashTimer: null,
      _flashArmed: false,
    }),
    getters: {
      // Only true when a fetch is in flight AND there's nothing
      // cached AND the fetch has been pending past the flash delay.
      // Sub-perceptual flashes are worse than no indicator.
      showLoading: (s) => {
        const empty =
          Array.isArray(s.data) ? s.data.length === 0 : !Object.keys(s.data || {}).length;
        return s.pending && empty && !s.initialized && s._flashArmed;
      },
    },
    actions: {
      async refreshIfStale(maxAgeMs = staleWindowMs) {
        if (this.pending) return;
        if (this.initialized && Date.now() - this.lastFetchedAt < maxAgeMs) return;
        await this._fetch();
      },
      async refresh() {
        // Bypass the SWR window. Mutations call this.
        if (this.pending) return;
        await this._fetch();
      },
      invalidate() {
        this.lastFetchedAt = 0;
      },
      async _fetch() {
        this.pending = true;
        this._flashArmed = false;
        const empty =
          Array.isArray(this.data)
            ? this.data.length === 0
            : !Object.keys(this.data || {}).length;
        if (empty && !this.initialized) {
          this._flashTimer = setTimeout(() => {
            this._flashArmed = true;
          }, loadingFlashDelayMs);
        }
        try {
          const result = await fetcher();
          this.data = result ?? emptyFactory();
          writeSnapshot(snapshotKey, this.data);
          this.initialized = true;
          this.lastFetchedAt = Date.now();
        } catch (e) {
          // Don't blow away the cached value on a transient failure —
          // the previous snapshot is more useful than an empty screen.
          // eslint-disable-next-line no-console
          console.warn(`${id}: refresh failed`, e);
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
}
