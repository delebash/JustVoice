# Slowness root-cause pass — 2026-06-13

**Status:** SUPERSEDES the SWR work from earlier in the day. Phase A
(real root-cause fixes) shipped on `claude/dreamy-rubin-91lsr3`;
Phase B (delete the SWR infrastructure) shipped in the same series.

## Why this exists

User catch: *"this app is slow it keeps checking for things, every time
i switch to project view i see loading msg for 1 sec even when no
projects."*

A first pass treated this as a stale-data problem and shipped an SWR
cache layer (`_swrFactory.js` + 5 per-resource caches, with 4 views
migrated). The user pushed back: *"I am worried we are putting in a
fix that masks the real problem of the slowness, can you do a deep
dive on the slowness everything should be responsive without special
cache."*

The deep dive proved them right.

## Measurement

`justvoice-server serve` on a fresh boot, empty DB, headless container.
Sub-10ms cold, sub-3ms warm, on every endpoint the user lists hit:

| Endpoint | Cold | Warm |
|---|---|---|
| `/v1/health` | 4.9ms | 1.8ms |
| `/v1/projects` | 8.5ms | 3.5ms |
| `/v1/voices` (75-voice catalog) | 3.0ms | 1.9ms |
| `/v1/engines` (9 engines) | 4.0ms | 2.1ms |
| `/v1/personas` | 4.2ms | 2.0ms |
| `/v1/lexicons` | 3.3ms | 1.7ms |

**The API server is not slow.** The 1-second flash was renderer-side.

## Real root causes

1. **No `<KeepAlive>` on `<component :is>`** (`App.vue:570`). Every nav
   between views fully unmounts the previous component, throwing away
   its local refs. The next visit starts blank, runs `onMounted`, and
   shows "Loading…" until a 3ms fetch resolves. Pre-SWR BooksView even
   set `loading.value = !projects.value.length` — guaranteed true on a
   fresh mount.
2. **Forever 5-second `/v1/health` poll** (`App.vue:424`,
   `setInterval(refresh, 5000)`). Hit the server every 5s for the
   lifetime of the page so the header engine pill stayed live. The
   existing `jv:health-refresh` pub/sub already covered every in-app
   state change.
3. **10Hz reactive tick** (`renderTasks.js:41`,
   `setInterval(() => { now.value = Date.now() }, 100)`). Drove
   elapsed-time UI on running tasks but fired ALWAYS, invalidating
   every computed/watch that touched `now`, even with zero tasks.
4. **Loading-flash UX**. Even after #1, a fast first-visit fetch
   briefly shows "Loading…" and disappears under 100ms — worse UX
   than no spinner. (Genuine, but tiny; see §"What we kept" below.)

## Phase A — root-cause fixes (SHIPPED)

- `App.vue:570` → wrap the view in `<KeepAlive>` with a per-view
  `:key`. Views stay mounted; local `projects = ref([])`, watchers,
  scroll position, all preserved across navigation.
- `App.vue:424` → drop `setInterval(refresh, 5000)`. Add
  `document.addEventListener("visibilitychange", refreshIfVisible)`
  so we refresh ONLY when the tab returns to foreground. The
  `jv:health-refresh` pub/sub stays as the primary path.
- `renderTasks.js:41` → tick now gated on
  `watch(() => running.value.length, n => n>0 ? start : stop)`.
  Zero tasks = zero ticks.

## Phase B — delete the SWR infrastructure (SHIPPED)

Reverted commits `c93cc1f` (projectsCache + BooksView migration) and
`f447fd4` (_swrFactory + 4 more caches + 3 view migrations). With
keep-alive, the views' own local refs survive navigation — no Pinia
caching needed. Deleted files:

- `stores/_swrFactory.js`
- `stores/projectsCache.js`
- `stores/voicesCache.js`
- `stores/enginesCache.js`
- `stores/personasCache.js`
- `stores/lexiconsCache.js`

`BooksView.vue`, `VoicesView.vue`, `PersonasView.vue`,
`LexiconsView.vue` restored to direct `services/api` calls.

## What we kept

The dd49c06 revert of 071a65c (the health-on-every-view-switch
overcorrection) **stays** — it was independent of the SWR work and is
still the right call. Health refresh is now: boot fetch +
`jv:health-refresh` pub/sub + visibilitychange.

## Verification

- `ruff check server/` clean.
- `pytest server/tests/` — 247 passed.
- `npm run build:vite` clean (only pre-existing vueuse `INVALID_ANNOTATION`).
- Live curl on `/v1/health`, `/v1/projects`, `/v1/voices`,
  `/v1/engines`, `/v1/personas`, `/v1/lexicons` — all sub-10ms.
- Playwright DOM smoke NOT run — network policy blocks the Chromium
  download in this container.

## What was NOT done (still pending user QC)

- The Phase 2 audit candidate list (OverviewView, StudioView,
  GenerateView, ChapterView, etc.) is now MOOT — keep-alive solves the
  underlying problem for every view at once. No per-view migration
  needed.
- A 250ms `useDelayedLoading` composable would still help on
  legitimately slow fetches (model warm-up, network hiccup). NOT yet
  added — only worth doing if the user reports a flash on a real-world
  surface after keep-alive ships.
