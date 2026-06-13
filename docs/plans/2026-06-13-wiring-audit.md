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
