# TASKS — the live open-work tracker (JustVoice)

> **THIS is JustVoice's live tracker** — created 2026-08-04 by the family docs
> campaign (`just_ai_i18n_docgen/docs/plans/2026-08-04-docs-cleanup-campaign.md`),
> per the convention in `just-llm-runner/docs/app-structure.md` §13. One line per
> open item + a pointer to its detail doc. **Close = delete** — git and the plan
> docs keep history. **An item lives where the code that closes it lives** — JV
> work HERE; kit/shared-server → `../just-llm-runner/docs/dev/TASKS.md`; JW →
> `../justwrite-app/docs/dev/TASKS.md`. A tracker line is a claim, not evidence;
> lines are marked **[verified]** (code-checked 2026-08-04) or **[attributed]**
> (a plan doc's claim, not re-verified).
>
> **THE STANDING SEQUENCE (the user's roadmap ruling, 2026-07-26):** *"completely
> finish JW and all AI stuff, then we will work on JV."* Everything here is parked
> behind that unless the user says otherwise; every item needs its own go.
>
> **GITHUB ACTIONS STAY OFF (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote (set via `gh workflow disable <file>`; a repo SETTING, no file
> edit, reversible with `gh workflow enable <file>`). This was ignored once and
> three pushes each triggered FAILING runs (CI red; `release.yml` firing twice
> per push and dying in 0 s). **Before pushing JV, confirm
> `gh workflow list --all` still shows all three disabled.** The workflow YAML
> is left untouched on purpose so re-enabling is one command when the CI
> pipeline is actually wanted again.

## APPROVED 2026-08-06 (QC walk rulings) — BUILT same day, awaiting the user's QC
## (kit `def5142` gate + `cbdbfff` pieces/panels/cascade · JV `7b6feb1`; text kept
## verbatim below until the walk confirms, then this block collapses)

**The Routing-by-feature rework (JV) + the thinking capability gate (kit).**
The approved text, as presented and confirmed:

- **Features list — one card per feature; piece-rows under their feature
  without routing arrows** (kit seam, default-empty → JW pixel-identical):
  - Speaker attribution card — description in the user's words: "Extracts who
    says what and what they say." ONE chooser (its preset, JW-style). On the
    card, the visible dial: **Reading style: Auto · Guided · Direct**, where
    Auto SHOWS its decision + reason ("Auto — currently Guided (your model is
    small)"). Auto default = the original behavior. Under it, the two texts
    as piece-rows: "Guided — for small models · examples included" /
    "Direct — for big models · rules only" — editable + Lab-testable, no
    routing of their own (floors 0.7/0.5 ride the style).
  - Dictation cleanup card ("Cleans your dictated text in one pass — what it
    fixes follows your Capture toggles") + its four texts as piece-rows.
  - Find new speakers — its own card with its own routing.
  - **Reasoned dies as a concept**: attribution stops forcing think and obeys
    the preset's think setting like every feature; tier registry = guided/
    direct; attribution's preset seeds think=ON (the gate below handles
    capability). APPROVED knowingly: small thinking models now think on
    attribution too (the old system only forced think at 14B+/reasoning
    families) — "a model that thinks, thinks"; the visible off-switch is the
    preset's think box.
  - Lab column: saved-setups row DELETED (standard Save-as-preset only);
    anchors toggle label back to **"Anchor propagation"** (tooltip carries
    the 'Tom said' explanation); tier chips Auto/Guided/Direct.
  - Production reading-style setting persists server-side; Studio Analyze
    honors it; /v1/extraction/config serves the current auto pick + reason
    for the dial. Per-call override (Lab) still wins.
- **The thinking capability gate (KIT, family-wide — JW included, approved):**
  effective thinking = the preset's think (the task's tested want) AND the
  model can think. `model_thinks` resolver, server-side, three layers:
  catalog row's thinking flag (trusted, editable) → name heuristic (JV's
  retiring tier classifier donates the knowledge) → **unknown = permit
  (today's behavior — the gate never makes anything worse)**. REQUIRED: the
  chip AND Lab show "thinking on — inactive: this model doesn't think" when
  gated (rides the chip↔Lab parity test); the checkbox's meaning = "ask for
  thinking where the model offers the choice" (always-thinkers like o1-class
  cannot be gated off — worded, not pretended). BUILD ITEM: verify the
  catalog UI can edit the thinking flag; add the control if missing.
  Necessity proven: think-on to a non-reasoning cloud model sends
  reasoning_effort → API error (prompts.py:415-417) — without the gate the
  attribution collapse breaks on mainstream cloud routes.
- Sequencing: kit gate slice FIRST (JW full suite as its gate), then the JV
  rework. Docs ride each slice.

## QC finds 2026-08-06 (user's eyes, added on sight)

- **JV adopts the family TitleBar** (user ruling: "same back buttons, same
  title bar type as the other apps"). §11 canon = JW's TitleBar (back/forward
  · title · mode · status chip); JV still runs its own topbar. Adopt it with
  JV's own chips (project/kind · engine state · AiStatusButton) as the app's
  slot content. (The user's related nav question was ruled the OTHER way:
  sidebars stay per-app for now — dropped, not deferred.)
- **Topbar chip "No engine" → "No voice engine"** (user ruling: two engine
  kinds make the bare words ambiguous — it reads "no AI at all" when it means
  no TTS engine loaded; ruling-6's naming class). Verify the loaded state
  names the kind too.
- **Add Gemma 4 12B (QAT) + Gemma 4 E4B (QAT) back to the model catalog**
  (user ask 2026-08-06). Both ids sit in `_RETIRED_DEFAULT_CATALOG_IDS`
  (llm_bootstrap.py — the 2026-08-05 one-row-catalog direction removed them).
  Re-adding = seed the two rows in JV's `model_catalog_extra` (pull the
  audited row facts + any measured class tunes from JW's library), take the
  ids OUT of the retirement list (it's marker-guarded one-time, but a fresh
  install must keep them), and re-run the seed-facts audit for the rows.
- **Sidebar: AI tasks · Labs · Settings sit OUTSIDE the scroll area** while the
  nav lanes scroll — the pinned-bottom group (`.jv-sidebar__bottom`, App.vue)
  holds them; the user flags the split as wrong ("outside scroll for some
  reason"). Decide: fold them into the scrolling lanes, or keep a pinned
  bottom deliberately — surface options first, then fix.

## QC finds 2026-08-05 (user's eyes, added on sight)


## THE FAMILY PARITY BATCH — SHIPPED 2026-08-06 (all twelve slices)
- The master plan + its BUILD LOG (deviations, guard-caught bugs, end-gate
  results): `../justwrite-app/docs/plans/2026-08-05-family-parity-batch.md`.
  What remains open is the after-batch order recorded there: JV UiTable
  convergence → JV e2e harness → THE deep exhaustive audit → product calls,
  plus the user's QC walk with the acceptance checklists. QC note: the
  once-ever AI setup offer WILL pop once at first project-open — that's it
  working. (The sidebar-clipping QC find closed with slice 10 — the rail
  sizes from content now, no hardcoded widths.)

## Found by the 2026-08-05 family audit [verified by hand] — parked per the
## standing sequence, but the first one is REAL user-facing breakage
## (the keep-running param bug was fixed off-sequence 2026-08-05, Batch 1:
## SettingsView now drives useServerStore — one persistence, default false,
## correct `keepRunning` param, boot re-apply in App.vue)

- *(Tray fixed off-sequence 2026-08-05, Batch 4: icon set, Quit kills the
  sidecar, copy shows the window first, Open log file opens the logs folder
  Rust-side, and App.vue carries the `tray:*` listeners for
  settings/about/copy — the generic entries WORK now. `system-tray.md`
  rewritten to truth. Still JV's own: dictate/MCP entries remain unwired
  (parked with the standing sequence).)*
- **Server `ruff check` FAILS with 492 errors** (re-measured 2026-08-06; 267
  auto-fixable; top: UP045, B008, BLE001, I001) while JV's CLAUDE.md says ruff
  must pass before commit — pre-existing baseline debt, deliberately left out
  of the parity batch (its slice-11 gates are biome + vitest + pytest; a JV
  ruff config + baseline burn-down is its own pass).

## The convergence arc (moved from JW's whole-system tracker 2026-08-04)

- **F1 — convergence onto the current shared stack — DONE** (executed across
  the 2026-08-05 sessions; the 2026-08-06 family parity batch finished the
  chrome: SettingsShell/Backups/Updates, the ONE AI console with the speech
  tabs, the Speaker Lab reunified into the kit Lab via the labAdapters seam,
  the 13 approved row texts, guards + npm scripts). The full execution record
  this entry replaces is in git history (this file, pre-2026-08-06) and the
  batch BUILD LOG lives in
  `../justwrite-app/docs/plans/2026-08-05-family-parity-batch.md`.
  Ledger history: `just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md` §F1.
  **Surviving residue (still open, extracted from the record):**
  - Console-script module path deviation (grandfathered-class): `justvoice.cli`
    not `<snake>.serve` — same class as JW’s recorded exception.
  - JV has no real-webview e2e harness (§10) — the after-batch item (docgen’s
    harness is the donor); `scripts/shots.js` + `verify_all.js` + `scripts/e2e.js`
    are BROWSER-driven (banned as an acceptance surface, 2026-08-02 ruling):
    retire-or-replace rides the harness item.
  - `capture.llm_model` settings field is dormant residue — decided KEEP
    (not in the drop list; the UI picker is gone).
- **F2 — `speaker_attribution` task scaffolding** (a JV need; JW bans speaker
  analysis) — after F1. Ledger §F2.
- **F4 — `EngineManager.load()` → shared VRAM-arbiter hook** — the decision was
  made 2026-07-04 and the arbiter is BUILT in the runner; only the JV-side wiring
  remains. After F1. Ledger §F4.
- **F5 — Appearance knob-set gap** — JV exposes Theme/size/accent/language while
  the shared engine supports the full JW set. Independent of F1. Ledger §F5.
  (Related: the user's 2026-08-04 ruling that the appearance SURFACE should be
  shared JV + i18n-docgen — tracked in docgen's TASKS.)
- **F3 — audiobook converters + speaker-attribution deep research** — PARKED by
  the user's word 2026-06-27 (`docs/plans/archive/2026-06-27-audiobook-tools-research-todo.md`).
- **I6 — the JV tail beyond F1–F5** — ledger §I6.

## Product decisions still open — extracted from the archived DESIGN_FREEZE §10

The freeze said "code resumes on user's answer"; these were never answered and had
no tracker line until the docs campaign. All yours:

- **Brand-name clearance** — USPTO TESS + Google check (the old "task #58"), then
  the rename PR (the `justvoice`/`justvoice-server` console-script split survives
  any rename — the Windows spawn-loop guard).
- **Code signing** — Windows-only EV cert ($200-400/yr) at v1.0 vs all platforms
  day 1 (±4-6 weeks of launch timeline).
- **Audio-channels UI** in v1 (gated toggle) vs v1.1 — REFRAMED by code: bindings
  are persona-level now, so the question is about the persona-channels surface.
- **External provider per-character** in v1 vs v1.1.
- **Tab discovery order** — the freeze's 13-tab question is moot (14 routes +
  Labs/Settings collapse today); the underlying "does discovery order match
  intent?" question stands for the current nav.
- **Loading-message tone** (playful pro-tool vs too playful) · **v1 scope check** —
  anything in the deferred list (IDEAS) that belongs in v1.0.

## Repo hygiene (found by the 2026-08-04 campaign)

- **The Stories nav lede SELLS an inert view [verified]** — the tab's own copy
  reads "Multi-track timeline editor. For podcasting…" (`App.vue:44`) while
  `StoriesView.vue` is a gated placeholder. Reword the lede or hide the tab until
  it's built; app copy is code, so this is your call. (User docs were corrected
  2026-08-04 to stop routing podcasters there.)
- **Dev-doc gaps from the coverage audit [attributed]** — record when convenient:
  the Stories gating why (lives only in `StoriesView.vue:4-14`) → design-decisions
  §5 · the backup schema-v1/4 GB design → a decisions record · the settings→SQLite
  fold comment (`settings_store.py:31-64`) → `docs/decisions/` · the
  engine-source-overrides "no hardcoded operator values" law · corrections-as-
  few-shot · the feature-pin catalog vs SettingsView row divergence
  (`SettingsView.vue:570-574`).

- **F1's concrete artifact: `server/pyproject.toml:44` pins a June commit SHA** of
  the shared stack [verified by the recap; the pin is the stale-snapshot mechanism
  F1 removes].
- **Hardware-gated runner work** [attributed: the recap]: the built-in runner's
  P1.5b auto-spawn + P1.6 benchmark + working-config cache need building/verifying
  on the user's GPU box.
- **Layer C anti-divergence guard + parity sweep** [attributed: the convergence
  outcomes, `docs/dev/design-decisions.md` §4]: a lint/CI check that fails on a new
  hand-rolled fetch / forked primitive / second `init_db` copy · the server-basics
  parity sweep (camelCase responses, health/settings shape).
- **CI contract enforcement is CLAIMED but not found** [verified]: the archived
  CONTRACT cites `server/justvoice/openapi.json` + `tests/test_contract.py` —
  neither exists. Build it or strike the claim.
- **Missing user docs** [verified vs toc.json]: stories (tracked above) · backup/
  restore · render presets · a settings reference · troubleshooting · run-modes
  (desktop vs headless). The archived FEATURES.md §s name the content to lift.

- **Family-contract gaps [verified against `app-structure.md` §1/§2]:** no
  `scripts/py.js` (the `server` script calls bare `python`); no `lint` /
  `test:server` / `test` / `screenshots` npm scripts; no e2e harness. Port is
  17494 (the standard's registry was wrong until 2026-08-04, not this app).
- **`docs/stories.md` is missing while `toc.json` listed a `stories` slug
  [verified]** — the entry was removed from the TOC 2026-08-04 (it 404'd in-app);
  write the doc for `StoriesView` and restore the entry.
- **Root strays need your classification:** `DESIGN_FREEZE.md` (940 lines,
  ⏳-pending legend, touched Aug 1) · `CONTRACT.md` (JV↔JW boundary, last revised
  2026-06-09) · `FEATURES.md` (911-line user guide overlapping `docs/*`). Too
  big/live-looking for the light pass — keep / update / archive is your call.
- **`2026-06-12-justwrite-roundtrip-slice1.md` — "JW side MISSING" [attributed]:**
  the JW half lives in the other repo and no status was ever written back; verify
  in JW's code, then close or queue.
- **`2026-06-20-deep-audit.md` (JV) — a backlog posing as a plan [attributed]:**
  self-described "ordered by value/effort", never triaged; fold what's live into
  this tracker or archive it.
- **June QC queues presumed complete [attributed]:** `2026-06-12-qc-round-2-queue`,
  `2026-06-13-qc-batch-1`, `2026-06-14-deep-audit-v2` were banner'd
  "presumed complete" (sibling round-3 is explicitly complete; their own items
  were never marked). If one still bites on your box, it comes back as a line here.
- **VOICEBOX_PARITY G1–G5 gap list [attributed]** — the live residue of the
  archived 2026-06-11 parity audit; re-verify against today's app before acting.
