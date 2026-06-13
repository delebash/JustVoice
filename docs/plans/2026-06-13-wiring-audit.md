# Wiring audit — GUI ↔ API honesty pass (method + seed list)

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Recorded 2026-06-13. A defect class the GUI conformance sweeps do NOT
cover: whether every affordance is BACKED — button → handler → request
→ registered route → server code that actually honors the params. The
project's own hard rule (lifted-but-not-wired) applied to the API
surface. Findings land in this doc first; fixes on the user's go, one
item per commit with tests.

## Method

1. **Forward trace** — every GUI affordance to its route: dead buttons
   (no handler / handler hits nothing), 404 targets, stale paths
   (e.g. `/v1/profiles/*` leftovers post-persona-rename in
   services/projects.js).
2. **Param honesty** — for every request the UI sends, verify the
   server READS each param (grep the endpoint body, then live-test):
   silently-ignored params are worse than missing features (a filtered
   action that ignores its filter destroys data — the cache-prune
   class).
3. **Reverse trace** — routes with no UI consumer (record, don't
   delete) and routers written but never `include_router`-ed in
   app.py; duplicate includes.
4. **Live verification** — each finding reproduced against a running
   server before it's recorded; each fix verified the same way plus a
   pytest.

## Seed list — claims from the stale-session plan (2026-06-13, made
against 199-commit-old main; EACH must be re-verified on current code
before believing it)

- CacheView filtered prune (by-voice / by-engine / unfavorited /
  >30 days): do the params reach /v1/cache/clear and does it honor
  them (older_than_days mtime support)?
- SettingsView: /v1/system vs /v1/system/info (GPU card silently never
  loads?) · API-reference table accuracy (/v1/chapters/render vs
  /v1/render_chapter; GET /v1/profiles vs /v1/personas) · log download
  via requestBlob.
- OverviewView: /v1/generations/recent vs existing /v1/takes/recent.
- services/projects.js: /v1/profiles/{id}/channels vs
  /v1/personas/{id}/channels.
- POST /v1/voices/{id}/preview — does VoicesView's preview 404?
- Routers: stories/captures/logs all registered? (captures verified
  registered 2026-06-13; check the other two + duplicate
  projects_api include.)
- Unused components (AddProviderModal.vue?) — verify unreferenced
  before deleting.

## Findings ledger — 2026-06-13, verified on main @ 133c827

Method actually run: route table dumped from the app factory (197
routes) · every `/v1/` string literal in the renderer extracted and
normalized (300 literals, incl. `${serverUrl}`-prefixed) · diffed both
directions · every suspected-dead target curl-verified against a live
headless server · param-honesty read on the destructive/filtered
endpoints, worst one reproduced live. NO fixes applied — findings only.

### W1 — CacheView filtered prunes DELETE THE ENTIRE CACHE (worst)

`/v1/cache/clear` (cache_api.py:33) reads ONLY `scope`. CacheView sends
`older_than_days` (CacheView.vue:90), `voice_id` (:114), `engine`
(:136), `favorited=false` (:152) — all silently dropped, so every
"filtered" prune falls through to `scope=None` = full wipe.
**Live-reproduced**: seeded 2 cache entries in 2 scopes, POSTed
`/v1/cache/clear?voice_id=nonexistent`, stats went 2 → 0. The
seed-list suspicion was exactly right, and it's the destroys-data
variant: prune-by-voice with zero matches still destroys everything.
(`cache.clear(scope)` in cache.py:133 has no mtime / per-key filtering
at all — `older_than_days` support does not exist server-side.)
Contrast: `DELETE /v1/generations` (bulk_delete_api.py) is the HONEST
pattern — filters actually applied, dry-run by default, requires
confirm + ≥1 filter. The cache UI just doesn't use anything like it.

### W2 — services/projects.js 3-arg `request()` class: 15 broken methods

`useApi().request(path, opts)` takes the path FIRST (stores/api.js:24).
Fifteen service methods call it `request("PATCH"|"PUT"|"DELETE", path,
body)`, producing the URL `http://…:17494PATCH` — **unparseable, so
fetch throws client-side before any request leaves** (reproduced in
node against the live server: `Failed to parse URL`). Every affected
affordance fails instantly with an error toast.

Broken methods WITH live consumers (= dead buttons today):
- `projectsService.update` / `.remove` → **BooksView project rename
  (:260) + delete (:294)**
- `webhooksService.remove` → **WebhooksView delete (:73)**
- `channelsService.update` / `.remove` → **AudioChannelsView edit
  save (:45) + delete (:74)**
- `takesService.update` / `.remove` → **takes store relabelTake
  (takes.js:108) + removeTake (:96)** → ChapterView take ✕ / relabel

Broken methods with NO consumer (dead code — views that need these
verbs call `api.request(path, {method})` directly, correctly, which is
why past live verifications passed):
`updateBlock`, `removeBlock`, `removeFromCast`,
`renderPresetsService.update`/`.remove`, `channelsService.
getProfileChannels`/`setProfileChannels` (ALSO stale-pathed, see W6),
`mcpBindingsService.remove`, `bulkDeleteService.generations`.

Note: `requestBlob("GET", path)` call sites are CORRECT — that helper
genuinely takes method-first. Only `.request("VERB", …)` is broken.

### W3 — StoriesView is entirely unbacked (podcast Timeline surface)

No `/v1/stories` endpoints exist anywhere server-side (no stories
router; live 404). StoriesView (387 lines) GETs on every refresh
(:104 → error toast every visit) and POSTs on create (:121). Second
latent bug in the same call: the create passes `body: {name}`
un-stringified through raw `request()` (no JSON header, object body) —
would break even with a route. DB has the `story_items` table but the
API layer was never written. The Episodes/Timeline parity rows judged
🟡 earlier were judged against a view that cannot load data.

### W4 — SettingsView dead targets (2)

- GPU card fetches `/v1/system` (:1055) — 404; real route is
  `/v1/system/info` (used correctly by RecommendCard.vue:34 and
  SettingsView:778's other card). Seed item confirmed.
- Log download fetches `/v1/logs/download?hours=24` (:1069) — route
  does not exist (only `/v1/logs/tail`). Also uses `api.request`, not
  `requestBlob`, so even with a route it would return text, not a file.

### W5 — API-reference table documents two nonexistent endpoints

SettingsView API table: `POST /v1/chapters/render` (:1219) — real
route is `POST /v1/render_chapter`; `GET /v1/profiles` (:1221) — gone
post-persona-rename, real route `GET /v1/personas`. Seed item
confirmed on current code.

### W6 — Stale `/v1/profiles/{id}/channels` paths (post-persona-rename)

channelsService.getProfileChannels (:136) and setProfileChannels
(:139) hit `/v1/profiles/{id}/channels` — live 404. Real route
`/v1/personas/{id}/channels` (GET,PUT) exists and works (live 200) and
currently has ZERO UI consumers. setProfileChannels is double-broken
(W2 signature + stale path). Persona↔channel binding has no working UI
path at all.

### W7 — Duplicate projects_api include

`app.include_router(projects_api.router)` at app.py:183 AND app.py:195
— all 24 projects routes registered twice. Harmless at runtime
(FastAPI matches the first), pollutes OpenAPI. Seed item confirmed.

### W8 — Routes with no UI consumer (record, don't delete)

`/v1/captures/{id}/audio`, `/v1/captures/{id}/refine`,
`/v1/captures/{id}/retranscribe`, `/v1/transcribe`,
`/v1/personas/{id}/channels` (see W6), `/v1/engines/setup` (GET+POST),
`/v1/models/progress/{id}`. Some are MCP-/dictation-facing by design
(transcribe, captures audio); engines/setup and models/progress look
superseded by `/v1/engines/{id}/install` + `/v1/jobs/{id}` (QuickSetup
uses those). Decide keep-vs-retire per item at fix time.

### W9 — pushToast title/description silently swallowed app-wide
(found 2026-06-13 while fixing W1 — CacheView's prune feedback never
displayed)

`pushToast({ message, … })` (toastBridge.js) bailed on `!message`, but
~80 call sites across 16 views pass `{ title, description }` — every
one of those toasts (success AND error feedback for deletes, imports,
saves, prunes, factory reset…) silently never rendered. Fixed at the
bridge with W1 (accept `title` as the text + pass `description` through
to sonner) — one change makes all 80 sites work; no call-site edits.

### W10 — scripts/e2e.mjs step 2 is stale (pre-existing, not fixed)

The CSV-import step times out waiting for the ImportModal's footer
"Import" button — reproduced identically on an unmodified HEAD build,
so it pre-dates the wiring fixes. The modal flow evolved after the
script's last update (ba0974a; split-on selector + review flow landed
in cda44bb and later). Step 1 (20 views, zero JS errors) still passes
and was used as the regression gate. Update the script when the GUI
sweep settles the import flow.

### Seed items closed clean (re-verified on current code)

- `POST /v1/voices/{id}/preview` — route EXISTS; VoicesView preview
  does not 404. Stale claim.
- OverviewView — already uses `/v1/takes/recent`; the
  `/v1/generations/recent` claim was stale.
- Captures + logs routers registered (logs router lives in
  admin_api.py). Stories router: see W3 — never existed.
- AddProviderModal.vue — already deleted from the tree; only the
  superseded-note in old recap bands mentions it. Nothing to do.
- All 40 api modules' routers ARE include_router-ed (reverse trace
  clean except the W7 duplicate).

### Coverage limits (honest)

- Wire-level verification only for W2 (node repro of the exact fetch
  semantics + live server) — a click-through Playwright pass was not
  run (chromium install failed in this container; the failure mode is
  deterministic client-side URL parse, so click-level confirmation is
  cosmetic).
- Param-honesty was read+live-tested for the destructive class (cache
  clear, bulk delete, factory reset loop, restore) — NOT yet for all
  300 call sites; the generate/render param surfaces are unaudited.
- MCP tool handlers and the JustWrite-facing CONTRACT surface were not
  traced (different consumer, same method applies later).

### Proposed fix order (queue for go — not started)

1. W1 cache prune (data loss; port the bulk_delete honesty pattern or
   add real filters to cache.clear)
2. W2 signature class (one mechanical fix in projects.js; decide
   whether unconsumed methods get fixed or deleted)
3. W6 persona-channels path (ride along with W2 — same file)
4. W4 SettingsView two dead targets
5. W5 API-table copy fix
6. W3 stories: decision needed — build the missing /v1/stories API or
   gate/hide the view until the Timeline plan lands (it's the known
   biggest parity gap; building it is its own plan, not a wiring fix)
7. W7 duplicate include (one-line)
8. W8 keep-vs-retire decisions
