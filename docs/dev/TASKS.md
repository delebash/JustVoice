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

## OPEN — THE CAPS DISCUSSION (2026-08-06 late, MID-DISCUSSION at
## compaction — nothing here is ruled; the verified facts are recorded so
## the next session needs zero re-verification archaeology).

**The user's frame (their words): caps look worth having — "it makes
failures faster and that is critical"; the questions are when to set
them, per feature or per model, whether tests are needed, and how to
calculate them.**

**The verified inventory (every line code-verified 2026-08-06):**
- JV seeded fixed caps: suggest + gender guess 200 (p_classify), compose
  300, cleanup 2048 — the AI's guesses, surfaced by the conversion.
- JV computed caps, still invisible in any UI: attribution max(800,
  12×dialogue) · smart-assign max(400, 80×characters) · rewrite max(300,
  half the text + 200).
- JV uncapped: show notes, Find new speakers.
- JustWrite: uncapped everywhere (seeds + client both verified).
- Docgen: uncapped everywhere, including its unattended batches.
- Every adapter omits the cap when unset — EXCEPT Anthropic, which fills
  a hardcoded 4096 (anthropic.py:173) and ALREADY raises the cap to at
  least the thinking budget + 2048 (anthropic.py:140) — the coordination
  rule the local path lacks, hardcoded in one adapter.
- pipeline.py still carries the TEMPORARY reasoned +1536 headroom — it
  violates the no-hardcode law and dies under ANY ruling here.

**The doctrine as discussed (leans, not rulings):**
- A cap is a fail-fast watchdog on sick runs + a cost ceiling on paid
  cloud; it never speeds a healthy run (measured), never enforces format.
- Sized per FEATURE (answer type); the model enters only as "+ the
  resolved thinking budget when thinking is on" (the collision fix).
- Calibration is cheap now: the Lab shows real token spend — one real
  chapter per feature gives measured multipliers.
- The ledger: the reasoning budget has real saves; outer caps have zero
  saves and one own-goal (the Reasoned truncation).

**Open sub-questions for the ruling:** defaults vs empty-by-default ·
the per-feature values and whether calibration runs happen · generalize
Anthropic's coordination rule to all providers · surface Anthropic's
4096/2048 constants · replace the +1536.

**Also discussed to a lean, NOT ruled (tangled with the flag ruling
above): size-only Auto (drop the thinking rule; Reasoned becomes a
hand-run/API route) · whether the Thinks tag / catalog thinking checkbox
stay visible.**

## APPROVED 2026-08-06 (late) — THE CAPABILITY GATE IS REMOVED. The user's
## ruling ("i thib this whole gate is bad idea, i think we should leave it
## as it was and just let user know the error from provider how it works,
## no fancy magic" · "i agree continue"). Supersedes BOTH the family-wide
## gate ruling (earlier same day) and the "one-source thinking" option 1.

**The decision — as presented and agreed (verbatim):**
- One source, one behavior, real errors: the preset is the only thinking
  control, every request goes out exactly as set, and when a provider
  refuses, the user reads the provider's own words and fixes the setting
  themselves.
- The one addition — the honest version of "let the user know how it
  works," not magic: when the provider's rejection comes back on a run
  that carried the thinking parameter, the error the user sees is the
  provider's message plus one plain sentence naming the fix — "this
  usually means the model can't think: turn thinking off on this
  feature's preset, or pick another model."
- What stays untouched: the catalog Thinking flag and its Thinks tag keep
  their JustVoice job — Auto's routing — where a wrong reading costs a
  visible route choice, never the user's ask. Auto doesn't change at all.
- Scope: the kit deletes the send-time veto and the "thinking on —
  inactive" machinery (dispatch, the chip/Lab mirror, their tests —
  family-wide, so JustWrite also returns to honest errors), the error
  message gains the fix pointer, and the thinking docs section is
  rewritten to the simpler truth. Nothing else rides along.

## OPEN RULING — what may drive off the catalog Thinking flag (2026-08-06,
## the user, mid-build: "i think the thinking in model catalgo is good to
## have but not drive anhthing off it yet" then "ataull maybe not we need
## to think on this some more"). NOTHING built on it — parked for the
## user's thinking. Today's shipped truth, until ruled otherwise: the
## flag's ONE job is Auto's route pick in JV (thinking → Reasoned); it
## never touches a run's ask anywhere (the gate removal, same day).

## OPEN — JW RIDER of the docs sweep (needs its own word): the thinking
## section for JustWrite's help docs, in JW's words — JW shares the
## machinery (one control on the preset, honest provider errors since the
## gate removal 2026-08-06) but its docs live in its own repo.
## (The JV docs sweep itself is DONE 2026-08-06 — every surface written to
## the bar with worked examples in docs/ai-features.md; the checklist this
## block carried is deleted per close = delete.)

## APPROVED 2026-08-06 (the QC walk's rulings) — THE AUTO SIMPLIFICATION.
## GO: "so go ahead and make your changes so lab works correct, then we will
## run some tests" + two mid-build catches folded in ("you still have verbage
## and stuff in each feture that should not be there Route Auto Guided Direct
## Reasoned" · the examples-location wording). Supersedes, in the block
## below: the force pills, the rules+readout pane, the card description
## tails, and the Lab's per-column route chips.

**The decision — as presented and confirmed (assembled from the chat):**

- **The Auto pane is plain words + ONE control** (user: "the auto just
  explains what it does why it picks features and that you can set param
  size to change it, correct, simple"). The pane text, verbatim:
  > Auto never picks a model. It looks at the model you've already
  > assigned and picks the feature that suits it.
  > If your model can think, **Reasoned** runs. The Thinking flag on the
  > model's row in the catalog decides that — you can edit it there.
  > If it can't think but has at least [ 14 ] billion parameters,
  > **Direct** runs. Smaller models get **Guided**.
  > If JustVoice can't tell how big the model is, it plays it safe and
  > uses **Guided**.
  (Reworded to plain sentences on the user's live QC 2026-08-06 — "state
  it nice and simple, not like a machine"; the catalog sentence kept by
  the user's word the same day.)
  The [14] is the editable size line (settings.extraction.direct_min_b). No
  pills, no RIGHT NOW readout, no model names on the pane. Check order
  confirmed by the user ("ok tht sound right"): thinking first (the
  original's rule), then size. Row note: "Picks which of the three features
  below runs" — feature vocabulary everywhere ("auto does not pick prompt it
  picks what feature to run, feture picks prompt").
- **Production always runs Auto — the persistent force dies** (the
  original's own behavior): `settings.extraction.route` removed, stale
  stored keys (`route`, `reading_style`) ignored on load; the per-run
  override door (a card's Lab run / the API `tier` field) stays and wins.
  [CLI --tier was claimed by the restore text and repeated here — VERIFIED
  FALSE 2026-08-06: justvoice.cli has no analyze command; the Lab and the
  API are the only per-run doors.]
- **Each feature card's pane loses the Route chip row** — the card IS the
  route: its Lab run always forces its own route and its prompt boxes always
  ride ("what you see is what runs"; the route-mismatch guard machinery
  dies with the chips).
- **Card descriptions say only what the card is** — the "Auto runs this
  when…" tails trim off (one-time marker-guarded migration; edited rows
  stay). Examples wording names WHERE examples live (user catch): Guided =
  the system prompt's rules plus worked examples; Direct = the same
  system-prompt rules without them; the user prompt is identical per route.
  Docs keep correction-memory examples (user-prompt injections) distinct.
- **The catalog shows the Thinking flag on the row** (user: "are you adding
  thinking row to catalog? it is not there now") — the kit edit form already
  had the checkbox; a "Thinks" row tag (MTP/Embed pattern) makes it visible
  without opening the form.
- **MoE size reading: DEFERRED to the tests** (user: "i htink we test moe
  and those smaller gemma qat models to see how they work") — today's
  total-params reading stands until the tests rule; the MoE decision
  (active vs total, catalog-edit correction) returns here after them.
- Studio meta/toast unchanged ("Route: X — Auto's pick / forced"). Docs +
  tests + migrations ride. NEXT: the gemma/MoE route tests, run together.

## BUILT 2026-08-06 (the autonomous run, user's go: "the whole task list
## up to F4, do not stop coding") — AWAITING YOUR QC WALK + three words.
## Everything below in THIS block is built, tested and smoke-verified
## against your real data dir; the decision texts it executed lived here
## and are deleted per close = delete (git keeps them).

**What was built (eyeball on your next walk):**
- The Reasoned row shows your model now — the Set-as-default writer
  skipped presets born after Quick Setup as "hand-picked"; fixed in the
  kit, and your real DB was stamped through the app's own writer.
- Auto judges the model that would actually run (your judge-what-runs
  ruling) — on your setup Auto now picks Reasoned, verified live.
- Chapters buttons land on the right Studio tab every time, and the
  project follows — the whole one-shot handoff family was converted
  (Studio tab, Chapters scene, Projects import/create, Settings + Labs
  sub-tabs, Lexicons + Generate prefills, Import review, the #engines
  deep link).
- Lab runs are real tasks (strip + seconds + tokens + cancel), and
  Suggest / gender guess / Compose / Rewrite / Show notes got task rows.
- The attribution Lab wears the original's face again: the cast chip
  editor (no ids), live word counters, Insert-from-chapter/cast pickers,
  the cellar sample word for word, corrections box gone (a project's
  stored corrections ride automatically).
- Reasoning / Max tok / Top-p / samplers on Lab columns are REAL now.
- Smart-assign's Lab result reads as Character → Voice names.
- The cleanup card's pane carries the full Lab over the real composed
  call, and every cleanup Lab run rides production's few-shot history.
- The reasoned route was silently truncating (think tokens ate the 800
  budget — measured live on your gemma); it has thinking headroom now.

**Three things that need your word:**
1. The MoE size ruling (deferred to the tests — they ran): all three
   gemmas carry Thinking=true, so Auto routes them to Reasoned and the
   size rule never decides; sizes read 26B (total) · 12B · 4B ("E4B").
   Evidence: on the cellar passage, Direct matched Reasoned's quality at
   3-4s vs 27-64s on every gemma, and 12B's Reasoned even floored one
   row. My recommendation: keep the total-params reading (it only ever
   decides for non-thinkers), and if you want the gemmas fast, the
   catalog's Thinking flag is the one switch — your call.
2. Part 2 of the Lab plan left "hide vs make real" open — I made the
   controls REAL (pass-through), on the drop-in principle. Ratify or
   reverse.
3. Task #22's "piece rows go compact" was ambiguous — I built the
   composed-prompt pane and left the four piece rows' own panes working
   (did not strip them). Say the word if compact meant less.

## APPROVED 2026-08-06 (late) — SPEAKER ATTRIBUTION: the old functionality,
## split into routed features + the visible Auto row. GO: "lets try your rec
## for the new auto row, go code it and we will see". **BUILT same day** (kit
## + JV; real-DB verified via the live server — 3 routes seeded/ordered,
## "Reasoned extraction" in, "Careful reading" retired, refs per-route,
## identify → its own Find new speakers card). QC-WALKED same day: the Auto
## pane/pills/readout, the card tails and the Lab route chips were REFUTED —
## superseded by the AUTO SIMPLIFICATION block above; the rest stands built.
## Two live-QC additions built in-flight:
## ANALYSIS order puts the single cards FIRST, the SPEAKER ATTRIBUTION-headed
## block LAST (a heading's scope only ends at the next heading — user catch);
## Studio meta/toast say "Route: Guided — Auto's pick / forced" (route words,
## never "tier").
## OPEN from the same walk: Dictation cleanup's presentation (task #22 —
## bare Engine-preset pane + full-size piece cards; proposal awaits go).
## Supersedes the attribution part of the earlier block below (QC refuted it:
## non-routing peer cards, the bare feature-preset pane, the unexplained dial).

**The plan — as presented and approved (verbatim):**

**The screen (Routing by feature, ANALYSIS group):**
- **SPEAKER ATTRIBUTION** — a plain sub-heading, JW's LINE EDITS pattern (the
  kit already renders this; the pieces layer for attribution is deleted).
- **An "Auto" row, first under the heading.** Not a routed card — its line
  reads "Picks which of the three below runs." Click it, and its pane is the
  entire mechanism, visible and editable in one place:
  - **The force pills: Auto · Guided · Direct · Reasoned** — persistent. Leave
    it on Auto and JV picks; set a route and every production run uses that
    route (the Lab's per-run override still wins for tests). The old Speaker
    Lab's "Auto → Direct" pills reborn; this closes the switch question: yes,
    and it lives here.
  - **The two rules Auto uses, written out and editable:** "Reasoned — when
    the model can think" (reads the model's Thinking flag — a model property,
    stays in the catalog where it's already built) · "Direct — when the model
    is at least [14] B; otherwise Guided" — the size line that was hardcoded
    becomes an editable number right here.
  - **A live readout that shows its work**: "Right now: qwen3-32b can think →
    Reasoned runs." Each rule is judged against THAT CARD'S OWN model and the
    readout names the model it checked — day one all three cards share one
    preset (like the original) so behavior is identical to the old system;
    split them later and there's no hidden anchor: every line says which model
    it looked at.
- Under it, three cards, each a real routed feature — own "→ preset ·
  assigned" line, own standard JW pane (prompt · Tune presets · test input ·
  PRESET dropdown · Use in production):
  - **Guided** — "For small models — the rules plus worked examples; small
    models follow better when shown. Below 0.7 confidence a pick becomes
    unknown. Auto runs this when your model is small."
  - **Direct** — "For big models — the same rules without the examples. Below
    0.5 confidence a pick becomes unknown. Auto runs this when your model is
    big."
  - **Reasoned** — "Direct's rules with thinking on — for reasoning models.
    Below 0.5 confidence a pick becomes unknown. Auto runs this when your
    model is a reasoning model." Text seeded as a copy of Direct's; editable
    separately from then on ("yes i know reason was a copy of direct just make
    it a feature seed it with direct prompt and enable reasoning").
- **Routing seeds:** Guided and Direct back to **Structured extraction** (the
  original). Reasoned routes to **"Reasoned extraction"** (name approved) —
  thinking ON. My "Careful reading" preset retires: a one-time migration
  repoints existing DBs to these seeds and removes it if unedited.
- **The mechanism (every run, strict order):** (1) per-run override on the
  request (Lab pills / CLI / API) — wins always; (2) the persistent force
  pills if not Auto; (3) Auto: the two rules above, each card judged by its
  own model. **The run always reports which route ran and why** ("Direct —
  Auto's pick" / "Direct — forced"): Studio meta shows it; the Lab pill shows
  "Auto → X" before running. No silent state.
- **Override restored everywhere:** the Lab's route control gets Reasoned
  back (Auto / Guided / Direct / Reasoned); CLI --tier keeps 3 choices; the
  analyze API accepts reasoned again. The rework's 3-value dial + its panel +
  `reading_style` are replaced by the route setting (migration converts).
- The family thinking gate stays as approved (a model that can't think just
  doesn't, annotated). Untouched: Dictation cleanup (decided: ONE feature,
  ONE call, four texts as sections — not reopened), Find new speakers,
  everything else. Docs and tests ride the change; full suites + a
  conformance read of the rendered screen against this text before reporting
  built.

## APPROVED 2026-08-06 (QC walk rulings) — BUILT same day; the ATTRIBUTION
## part is superseded by the block above; the gate + cleanup pieces + Lab
## fixes below STAND (kit `def5142` gate + `cbdbfff` pieces/panels/cascade ·
## JV `7b6feb1`)

**The Routing-by-feature rework (JV) + the thinking capability gate (kit).**
The approved text, as presented and confirmed (attribution card/dial portion
superseded above):

- **Features list — one card per feature; piece-rows under their feature
  without routing arrows** (kit seam, default-empty → JW pixel-identical):
  - Dictation cleanup card ("Cleans your dictated text in one pass — what it
    fixes follows your Capture toggles") + its four texts as piece-rows.
  - Find new speakers — its own card with its own routing.
  - *(The "Reasoned dies as a concept" and "Production reading-style" bullets
    are superseded by the block above — Reasoned RETURNS as a routed card; the
    dial becomes the Auto row's force pills.)*
  - Lab column: saved-setups row DELETED (standard Save-as-preset only);
    anchors toggle label back to **"Anchor propagation"** (tooltip carries
    the 'Tom said' explanation); tier chips — now Auto/Guided/Direct/Reasoned
    per the block above.
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

## QC finds 2026-08-06 (user's eyes) — ALL BUILT same day
- Sidebar fold + "No voice engine" chip + the family TitleBar adoption:
  `8b7e05a`. Gemma 4 12B/E4B catalog re-add: `f5bb907`. (Close = delete —
  the rulings' text lives in the commits; git keeps everything.)

## QC finds 2026-08-05 (user's eyes, added on sight)


## THE FAMILY PARITY BATCH — SHIPPED 2026-08-06 (all twelve slices)
- The master plan + its BUILD LOG (deviations, guard-caught bugs, end-gate
  results): `../justwrite-app/docs/plans/2026-08-05-family-parity-batch.md`.
  QC note: the once-ever AI setup offer WILL pop once at first project-open —
  that's it working.
- **SEQUENCING AMENDED (user's word, 2026-08-06 late): the JV e2e harness and
  THE deep exhaustive audit are DEFERRED — "for now we are not doing jv
  harness or deep audit i want to finish all features and complete the jv
  llm runner conversion."** The next work = the convergence arc's remaining
  items (F2 attribution task scaffolding [CLOSED 2026-08-06 — superseded:
  its target task-kind taxonomy was deleted from the kit 2026-07-15; the
  intent shipped as the routed-cards restore] · F4 VRAM-arbiter wiring · F5
  appearance knob-set · the I6 tail — each item's ledger section MUST be
  read before its plan:
  `just-llm-runner/docs/plans/archive/2026-07-06-outstanding-master-plan.md`).
  Plan presented in chat first, per item, before any code. UiTable was
  neither named nor excluded — ask when the arc plan is presented.

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

- **Family-contract gaps [re-verified 2026-08-06]:** `scripts/py.js`, `lint`,
  `test:unit`, `test:server` and `test` npm scripts EXIST now (the parity
  batch landed them — the earlier "missing" rows were stale); still missing:
  a `screenshots` script and the real-webview e2e harness (deferred by your
  word). Port is 17494 (the standard's registry was wrong until 2026-08-04,
  not this app).
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
