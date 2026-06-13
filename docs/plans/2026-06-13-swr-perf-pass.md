# SWR perf pass — 2026-06-13

**Status:** Phase 1 shipped on `claude/dreamy-rubin-91lsr3` (commits
ba406d3 → f447fd4). Phase 2 audit complete, fixes pending.

## Why

User catch, 2026-06-13: *"this app is slow it keeps checking for
things, every time i switch to project view i see loading msg for 1
sec even when no projects."*

Root cause: every list-view did `onMounted(refresh)` with no
in-memory cache, and the loading flag flipped true on every cold
fetch — including empty-result responses, so the user saw the worst
possible UX (a "Loading…" skeleton that appears and disappears under
a second).

## Phase 1 — SHIPPED

Three commits:

- **dd49c06** — Revert `071a65c` (which re-fetched `/v1/health` on
  every view switch as overcorrection for a stale-lede edge case).
  Health stays one boot fetch + the existing `jv:health-refresh`
  pub/sub. On-demand checks (preview voice → 409 → ask-to-load
  dialog) already gate everything that matters.
- **c93cc1f** — New `stores/projectsCache.js` (SWR for `/v1/projects`).
  BooksView migrated.
- **f447fd4** — Extracted the SWR pattern into `stores/_swrFactory.js`.
  Refactored `projectsCache` onto it. New caches for **voices**,
  **engines**, **personas**, **lexicons**. VoicesView, PersonasView,
  LexiconsView migrated.

### SWR semantics (factory contract)

`defineSwrStore({ id, snapshotKey, fetcher, emptyValue })` returns a
Pinia store hook with:

- Cold paint from `sessionStorage[snapshotKey]` — no blank screen on
  remount.
- `refreshIfStale(maxAgeMs = 10_000)` — onMounted's default. Skips if
  a fetch landed in the SWR window; otherwise fetches in the
  background while the cached value keeps rendering.
- `refresh()` — force fetch, used after mutations.
- `invalidate()` — drops `lastFetchedAt` so the next `refreshIfStale`
  re-fetches.
- `showLoading` getter — true ONLY when (a) a fetch is in flight,
  (b) data is empty, (c) the fetch has been pending ≥250ms, AND (d)
  the store hasn't been initialized yet this session. Empty-after-
  fetch is a cached state — switching back doesn't re-fetch.

### Verified Phase 1 gates

- `ruff check server/` — clean.
- `pytest server/tests/` — 247 passed (up from 238 on the prior
  audit-recap commit; new SWR work added no python tests but didn't
  break any).
- `npm run build:vite` — clean (only the pre-existing vueuse
  `INVALID_ANNOTATION` warnings, unrelated to SWR).
- Live `curl` against `justvoice-server serve` on all five SWR
  endpoints — `/v1/projects`, `/v1/voices`, `/v1/engines`,
  `/v1/personas`, `/v1/lexicons` — all return the documented
  `{key: array}` envelope the fetchers expect.
- Playwright DOM smoke — NOT RUN. Network policy blocks the
  Chromium download (`npx playwright install chromium` fails).
  Verification limited to build + curl + import-graph.

## Phase 2 — AUDIT FINDINGS (not yet migrated)

Strong SWR candidates from a grep of `onMounted` against the five
cached endpoints + the projects list. Listed by view, with the
endpoints they re-fetch every mount. All would dedupe against the
existing caches with zero new fetcher code — just swap
`api.safeRequest(...)` for `cache.refreshIfStale(); cache.data`.

| View | Endpoints currently fetched on every mount | Notes |
|---|---|---|
| **OverviewView** | engines · voices · personas · projects · lexicons · captures?limit=1 · cache/stats · takes/recent?limit=4 · engines/current | **Biggest win.** Home/Overview is the most-revisited view; ALL five caches plus three uncached. Pair with new caches for `cache/stats` and `takes/recent` later. |
| **StudioView** | projects · personas · voices · engines | Plus project-scoped `cast` (not cacheable). |
| **GenerateView** | voices · personas · engines/current · engines/capabilities · takes/recent | First-time-Generate is one of the slowest cold mounts. |
| **ChapterView** | projects · personas · voices | Plus project-scoped data. |
| **SettingsView** | projects · personas · engines | Danger-zone counts; provider list. |
| **SpeakerLabView** | projects | Plus scenes (project-scoped). |
| **CompareView** | projects | Plus per-project scenes. |
| **LinesView** | projects | Plus per-project lines. |
| **RenderLabView** | voices | Trivial swap. |
| **RenderPresetsView** | personas | Trivial swap. |
| **CacheView** | voices · engines | Read-only inputs to scope dropdowns. |

### Views intentionally NOT migrated

- **EnginesView** — owns the status-polling loop (install / load
  progress). The cache exists for the OTHER views; EnginesView itself
  remains the source of truth and dispatches `jv:health-refresh`
  after mutations. Documented in `enginesCache.js`.
- **CapturesView, WebhooksView, AudioChannelsView, EffectsView,
  TrainView, LabsView, ImportReviewView** — own unique resources not
  in the five-cache set, OR shell-only views.

### Phase 2 execution plan

Per RULE #2 (one item, full read, verify, commit; don't batch):

1. **OverviewView** — biggest payoff, hits all five caches at once.
   Also seed two new caches (`cacheStatsCache`,
   `recentTakesCache`) that GenerateView and Home both want.
2. **StudioView** — second-most-used.
3. **GenerateView** — first-time-Generate cold-mount latency.
4. **ChapterView** — high-frequency view.
5. **SettingsView** — once per session, but cheap.
6. The four single-endpoint views in one commit each
   (SpeakerLab, Compare, Lines, RenderLab, RenderPresets, CacheView).

Each migration must also force-refresh through the cache on the
view's own mutation paths (delete, rename, etc.) — same pattern
already used in BooksView / VoicesView / PersonasView / LexiconsView.

### Post-mutation cross-cache invalidation (Phase 2 caveat)

Phase 1 caches each handle their OWN mutations. Phase 2 views often
mutate one resource and care about another (Studio assigns a voice
to a persona; Generate composes a new persona). Decide per view
whether to call `otherCache.invalidate()` or `otherCache.refresh()`
after the mutation. Default: `invalidate()` — the next visit to that
resource's view re-fetches on its own.
