# Data-layer rebuild — shared stores as source of truth (2026-06-13)

## Why

The app's data-loading layer was left at the naive default: every view
keeps a **private copy** of shared data (`const projects = ref([])`)
and fetches it itself in `onMounted`. Verified consumer matrix:

| Resource | list consumers | mutators |
|---|---|---|
| projects | 12 views | 6 |
| voices | 9 | 1 (VoicesView) |
| personas | 10 | 2 (Personas, Settings) |
| lexicons | 3 | 1 (Lexicons) |
| engines | 10 sites | Engines (load/unload) |

Twelve independent copies of the project list. When one view mutates
(import a book), the other eleven copies never hear about it. KeepAlive
(added 1e846bd) made it acute by freezing each copy so even a re-mount
wouldn't refetch.

**Reproduced empirically** (Playwright + headless Chromium against the
real server, /tmp/repro.mjs): create a project on a fresh DB, navigate
Projects→Chapters, the project does NOT appear; full browser reload and
it DOES. Screenshot: /tmp/shot-repro.png. This is the verified "before".

## Design — stores own the data, views project from them

Five plain Pinia setup stores: `projects`, `voices`, `personas`,
`lexicons`, `engines`. Each:

```js
const items = ref([]);          // canonical list — THE source of truth
const loaded = ref(false);
async function reload() { items.value = (await fetch).list; loaded.value = true; }
async function ensureLoaded() { if (loaded) return; /* dedupe inflight */ return reload(); }
function byId(id) { ... }
return { items, loaded, reload, ensureLoaded, byId };   // refs returned DIRECTLY
```

Critical correctness rules (these are exactly where the prior attempt
failed):
1. **Return refs directly.** Pinia auto-unwraps at access sites. NO
   `computed(() => ref.value)` wrapper — that layer didn't propagate
   updates and was the root of "import doesn't show up" last time.
2. **NO Suspense, NO async setup, NO Transition.** First-load is handled
   by `ensureLoaded()` in `onMounted` + reactive re-render. Those three
   Vue features caused the stuck-blank renders last time. Not used.
3. **KeepAlive stays.** Views read `store.items` reactively, so a cached
   instance updates when the store changes. KeepAlive now only preserves
   ephemeral UI state (scroll, selection) — it no longer affects data
   freshness. The two concerns are decoupled.
4. **Reads from store; writes via API then `store.reload()`.** Mutations
   stay as direct API calls in the views (minimal churn), but each
   mutation site calls `store.reload()` instead of a local refresh.
   Single canonical list, always refreshed after a write. (Standard
   invalidate-and-refetch; the sub-10ms server makes reload free.)
5. **Auto-selection via `watch(items, fn, { immediate: true })`.** Fires
   for the already-loaded value AND for later arrival — sidesteps the
   setup-vs-onMounted ordering trap.
6. **engines + voices reload on `jv:health-refresh`** (engine load/unload
   brings preset voices online). Listener attached once in the store.

## Fetch policy

Lazy via `ensureLoaded()` — first view to need a resource loads it once;
everyone after reads cache. No forced boot preload (respects "load on
demand"). In practice Overview (landing) needs all five, so they warm at
boot naturally. Cold deep-link to a sub-view loads just its resources
(~5ms). FOUC on that path will be MEASURED on the harness; snapshot-on-
init added only if observed necessary — not preemptively.

## Execution (one view, verified, before any spread)

- **P1** Build the 5 stores.
- **P2** Convert ChapterView only (projects/personas/voices → stores).
- **P3** VERIFY: re-run /tmp/repro.mjs. Create project → nav → must
  appear without reload. Gate: if it doesn't work, STOP and diagnose.
- **P4** Convert remaining consumers one per commit, each verified:
  BooksView, PersonasView, LexiconsView, VoicesView, StudioView,
  GenerateView, OverviewView, LinesView, CompareView, SpeakerLab,
  RenderLab, RenderPresets, Cache, Settings, + components.
- **P5** Full regression: ruff · pytest · vite build · harness sweep of
  every view for JS errors + data presence.

## Verification harness (established this session)

- Playwright 1.60 installed; CDN blocked, but a usable Chromium exists at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Server serves the SPA at `/`; renderer uses `window.location.origin`
  for the API, so same-origin works.
- Launch: `chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })`.
- Reusable scripts: /tmp/harness.mjs (load+errors+shot), /tmp/repro.mjs
  (the staleness reproduction). Will be promoted to scripts/ if kept.
