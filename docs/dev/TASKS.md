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

## APPROVED 2026-08-07 — CAPS: NOTHING NEW, REMOVE WHAT WAS SEEDED. Ends
## the 2026-08-06 caps discussion. The user: "no incident of needing cap
## anywhere ... we need nothing new leave it as is ... no formulate no
## numbers in max cap on any features, remove what you have seeded" —
## approved point by point ("1 yes 2 yes and no migration again rule, i
## just reset app, 3 yes, 4 yes original reason budget token field that
## we have been using all along 5 fine 6 yes").

**The decision — as presented and approved (with the user's amendments):**
1. The three code formulas are deleted — attribution's max(800, 12n)
   including the temporary +1536, smart assign's max(400, 80n), persona
   rewrite's max(300, len//2+200). No computed caps anywhere.
2. The three seeded numbers go — classify 200, compose 300, refine 2048:
   removed from the seeds. NO migration (the user's amendment: "no
   migration again rule, i just reset app").
3. The Max tok field itself stays everywhere, empty by default. Empty =
   nothing sent = uncapped, exactly JW's model. It remains there for
   anyone who ever wants a ceiling (cloud cost), and if set, it's
   honestly applied.
4. The original Reasoned problem dies at the root — no cap means nothing
   for thinking tokens to collide with; the reasoning budget stays as
   the dedicated think-loop guard (the user: "original reason budget
   token field that we have been using all along").
5. Footnote, acknowledged "fine": the Anthropic adapter always sends
   4096 when nothing is set because that API requires the field on the
   wire — pre-existing adapter plumbing, unchanged by this; the single
   place "empty" isn't literally uncapped.
6. Same change carries: the tests that assert the old formulas, the docs
   (ai-features.md's Max tok passages become "empty unless you set
   one"), and this TASKS block closes with the ruling.

**The evidence the ruling rests on (the closed discussion's receipts —
full verified inventory in this block's git history):** zero incidents
ever needing a cap in JW (uncapped everywhere), docgen (uncapped, incl.
unattended batches) or JV; one own-goal (the Reasoned 800 truncation,
caused BY a cap); the reasoning budget is the guard with real saves; the
caps were inherited old-JV code carried forward unquestioned.

**Status:** BUILT + verified 2026-08-07 — pytest 407 passed (full suite);
not committed. SURFACED the same run, needs its own ruling: the documented
`ruff check .` gate is red on ~500 PRE-EXISTING findings, none from this
change — the dev pin floats (`ruff>=0.7`) and now resolves ruff 0.16.0,
whose defaults enable far more rule families; 6 errors exist even under
the classic E4/E7/E9/F defaults, in files this change never touched
(voices_api.py E402 ×5, shared_venv.py F401). Options when ruled: pin the
ruff version · set an explicit `[tool.ruff.lint] select` · fix the
findings. Awaiting the user's QC.

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

## APPROVED 2026-08-07 — THE TIER-DEBRIS CLEANUP: REASONED DIES,
## THINKING-IN-MODEL DIES EVERYWHERE, AUTO ROUTES BY SIZE ONLY. The go,
## given after the full interrogation (dead-code proof, the JW-invisible
## verification, the floors-are-params reading): "ok you have a go
## cleanup the code your recs". Closes the flag ruling, the size-only
## lean, and the MoE word.

**The decision — the recs as presented and interrogated:**
1. The Reasoned route dies completely: the card, the
   speaker_attribution.reasoned prompt row, the p_reason preset, its
   preset-map entry, the reasoned value in the API (loud 422, no silent
   alias), every dead branch in pick_route/route_model, the Auto page's
   mention, the Lab adapter's reasoned action, its test-data entries.
   The Guided and Direct ROUTES (two cards, genuinely different prompts)
   stay. Testing thinking = check think on a card's Lab column like any
   feature, promote with Use in production.
2. The thinking field dies as data, not just UI: the kit catalog column,
   its schema-evolution entry, the seed heuristic
   (_can_reason/_REASONING_ARCHS), the row-editor checkbox, the Thinks
   tag, useCatalogMeta's thinkingById. model_thinks()/capability.py die
   whole.
3. The tier subsystem is swept family-wide (it was ALREADY REPLACED —
   presets own routing+thinking, hardware tunes own launch, Auto owns
   the route pick; what remained was debris with zero effect, verified):
   kit tiers.py deleted; dispatch's never-fires think fallback and
   resolve_tier deleted (no explicit think = off — behavior-preserving,
   no production caller passes None, verified all three apps); the
   caller-less /v1/llm-providers/classify-tier endpoint deleted; the
   inert tier fields leave FeaturePinConfig/ProductionConfig and the
   resolve_pin/resolve_route plumbing; JW's dead chain deleted
   (modelMeta.js, ai.js modelTiers state/getters/action, its test, the
   stale doc sections — zero UI callers, nothing visible changes).
4. The confidence floors (guided 0.7 · direct 0.5) move to a JV-local
   route table beside the routes they describe — same code-constant
   nature as today; whether the DEFAULTS become a stored setting is
   surfaced as its own open question, not built.
5. Auto = size only: ≥ direct_min_b (editable, default 14) → Direct;
   smaller or unknown → Guided; MoE counts TOTAL params (the gemma
   evidence: Direct matched Reasoned at 3-4s vs 27-64s on all three).
6. JV's analyze API renames tier → route (the "route words, never tier"
   QC ruling extended to the API; the routes-listing endpoint renames
   with it).
7. Every preset ships think-off — p_reason's death removes the family's
   last exception; thinking is always a deliberate per-preset act.
8. The one-time attribution migrations that create/touch the Reasoned
   row are removed or neutralized (reviewed one by one); NO new
   migrations (the reset rule). Docs rewritten properly in the same
   change (JV ai-features/CONCEPTS/providers; the stale JW/kit doc
   lines). The method: the receipted grep sweep — every reasoned /
   p_reason / thinking-flag / tier hit dies or is justified by name in
   the build report. NOT touched: the preset thinking control and its
   machinery (thinkingControl, reasoning budgets, per-call think,
   _strip_thinking), the attribution cards' prompts, the floors' values.

**Status:** BUILT + verified 2026-08-07, not committed. Gates: JV pytest
404 · kit pytest 769 (the 1 failure = the KNOWN pre-existing Linux-only
lspci test) · JW vitest 566 (exactly the 5 deleted classifier tests
fewer) · JV vitest 13 · biome clean on all three JS surfaces · vite
build · Playwright smoke on the REAL data dir, zero JS errors. One
consequence of the no-migration rule, stated plainly: the user's CURRENT
real DB still carries the old Reasoned row + p_reason preset (seeds are
insert-if-missing) — the next factory reset lands the clean two-route
state; until then a stale third card shows, harmless. Sweep leftovers,
all justified: decision/history text in the trackers, comments that NAME
the death, the 422 test's dead-value probe, docs/plans + docs/research
archives (history), JW ai-providers.md's hardware-tier wizard prose (a
different "tier", pre-existing docs debt, out of scope). Awaiting the
user's QC.

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
## AMENDED 2026-08-07 (the tier-debris cleanup, above): the thinking rule,
## the Thinks tag and the MoE deferral are superseded — Auto is SIZE-ONLY
## and the pane text was rewritten; the quote below is the 2026-08-06
## record.

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
- Studio meta/toast unchanged ("Route: X — Auto's pick / forced"). Docs +
  tests + migrations ride. (The Thinks-tag and MoE-deferral bullets closed
  2026-08-07 — both resolved by the tier-debris cleanup.)

## BUILT 2026-08-06 (the autonomous run, user's go: "the whole task list
## up to F4, do not stop coding") — AWAITING YOUR QC WALK + three words.
## Everything below in THIS block is built, tested and smoke-verified
## against your real data dir; the decision texts it executed lived here
## and are deleted per close = delete (git keeps them).

**What was built (eyeball on your next walk):**
- Set-as-default fills every preset that was never hand-configured (the
  writer skipped presets born after Quick Setup as "hand-picked"); fixed
  in the kit, and your real DB was stamped through the app's own writer.
- Auto judges the model that would actually run (your judge-what-runs
  ruling) — since the tier-debris cleanup it judges that model's SIZE.
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
  (The reasoned-headroom line closed: the +1536 died with the caps ruling
  and the route itself died with the tier-debris cleanup, both 2026-08-07.)

**Two things that need your word** (the MoE item closed 2026-08-07 — the
tier-debris cleanup ruled TOTAL params):
1. Part 2 of the Lab plan left "hide vs make real" open — I made the
   controls REAL (pass-through), on the drop-in principle. Ratify or
   reverse.
2. Task #22's "piece rows go compact" was ambiguous — I built the
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
## AMENDED 2026-08-07: the Reasoned card + its preset died in the
## tier-debris cleanup — Guided/Direct + the Auto row are what stands.
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
  [CLOSED 2026-08-06 — user: JV's tab stays as is, JW keeps its own styling;
  the JV+docgen shared appearance panel stays tracked in docgen's TASKS] ·
  the I6 tail — each item's ledger section MUST be
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
  rewritten to truth. The dictate/MCP rows: CLOSED 2026-08-06 (user, after
  the tray was verified against the family standard) — they stay as
  documented placeholders; `system-tray.md` marks both "not wired yet".)*
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
- **I6 — the JV tail beyond F1–F5** — ledger §I6.

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
