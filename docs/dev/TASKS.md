# TASKS — open work (JustVoice)

> **This is JustVoice's live tracker.** One item per piece of open work, written
> so it can be read cold. **Close = delete** — git keeps the history, so nothing
> finished stays on this page. **An item lives where the code that closes it
> lives** — JustVoice work here; shared-kit and shared-server work in
> `../just-llm-runner/docs/dev/TASKS.md`; JustWrite work in
> `../justwrite-app/docs/dev/TASKS.md`. Unscheduled ideas go in `IDEAS.md`;
> adding an idea is never starting it.
>
> **THE FORMAT (user ruling, 2026-08-08).** Twice this file has failed: once as
> long prose that restated code and went stale, once as stubs that dropped the
> decision and made a later session re-derive it from a transcript. The rule that
> fixes both: **an item holds what code cannot tell you; everything else is a
> cite.** If the code can answer it, cite `file:line` — never retype it. If only
> the conversation can answer it, it is written here, verbatim, in the same reply
> the decision is made. Six fields, 25 lines max; longer means either code
> restatement (cut it) or a real plan (one line here, pointing at the plan doc):
>
> ```
> ### <the outcome, one line>
> STATE:  DECIDED <date> — "<your words>"  |  OPEN — your call  |  FINDING — code-verified <date>
> WHY:    <why this beat the alternative — 1-2 lines>
> NOT:    <what was rejected, one line each, so it stays rejected>
> BUILT:  <file:line>        OPEN: <the exact remaining change, one sentence>
> GO:     given <date> | needed
> ```
>
> **Never record a decision anywhere but here.** The session task tool is scratch
> and dies with the session — that is how the dictation-cleanup proposal was lost
> and had to be excavated from a 30 MB transcript on 2026-08-08.
>
> **A line here is a claim, not evidence — verify against the code before acting
> on it.** Every item below was re-verified against the code on 2026-08-08 **with
> two exceptions, each of which says so on its own line**: the contract-doc rows
> (they live under `docs/plans/archive/`, out of scope by the no-archives ruling)
> and whether `design-decisions.md` already covers the five rationales. The sweep
> deleted the lint-gate item (fixed), the ratified Lab-tunables item, the
> duplicate cleanup-card item, and one false claim about a missing npm script.
>
> **Nothing points into an archive.** If an item needs detail, that detail is
> either written here or lives in a live doc named on the item's own line.
>
> **The order of work (the user's ruling, 2026-07-26):** *"completely finish JW
> and all AI stuff, then we will work on JV."* Everything here is parked behind
> that unless the user says otherwise, and every item needs its own go.
>
> **GitHub Actions stay off (user ruling, re-issued 2026-08-05: "i asked you to
> turn off github actions when yo commit jv you ignored this fix it").** All
> three workflows — `CI`, `CodeQL`, `release.yml` — are `disabled_manually` on
> the remote. That is a repo setting (`gh workflow disable <file>`), not a file
> edit, and it is reversible with `gh workflow enable <file>`. It was ignored
> once and three pushes each triggered failing runs. **Before pushing JustVoice,
> confirm `gh workflow list --all` still shows all three disabled.** The workflow
> YAML is deliberately left untouched so turning CI back on is one command.

## Waiting on your decision

### Settings → Capture is a localStorage mock — its controls never reach the server

STATE: FINDING — code-verified 2026-08-08 (found wiring the cleanup redesign's
live toggles).
WHY it matters: `SettingsView.vue:585-599` says it itself — "Persisted via
PATCH /v1/settings when wired; for now uses localStorage"
(`justvoice:capture_settings`). Every control on the card (STT model,
refinement mode, language, auto-paste, playback voice) writes only
localStorage; the SERVER's `captures.*` settings — the ones production reads —
never change. Worse, "Refinement mode" is a single-choice select over what the
server stores as THREE independent booleans (`smart_cleanup` /
`self_correction` / `preserve_technical`) — the control cannot even express
the real state. The cleanup card's pane toggles (2026-08-08) write the real
flags, so the two surfaces can now visibly disagree. Violates the
no-renderer-store law (the 2026-06-19 storage rewrite).
NOT: fixed as a rider on the redesign build — un-go'd scope, recorded instead.
OPEN: wire the card to PATCH `/v1/settings` (deep-merge proven), replace the
mode select with the three real toggles, delete the localStorage shim — or
strip the card to what's real.
GO: needed.

### Seed a pronunciation lexicon from the imported book's proper nouns

STATE: OPEN — your call. Raised and deliberately PULLED OUT of the 2026-08-08
JustWrite-zip build ("outside what you asked for, plus one unverified risk").
WHY: a book's proper nouns are the pronunciation problem, and "pronunciation
discipline" is a named audiobook differentiator (CLAUDE.md). JW hands over every
character, location and object name for free in `book.json`; import could
create the project lexicon pre-filled with them, pronunciation blank, as a
worklist.
NOT: folded into the zip build as a rider — un-go'd scope.
OPEN: first verify what an empty-pronunciation entry does at RENDER time —
`_materialize_lexicon` writes `pronunciation=""` (`projects_api.py:750-758`), and
if the render path applies that literally it would blank the word instead of
leaving it alone. If it is inert, seed the roster; if not, seed only entries the
user has filled.
GO: needed.

### A scene break could carry a real pause instead of a glyph

STATE: OPEN — your call. Noted 2026-08-08 during the JustWrite-zip build.
WHY: JW's `* * *` is display-only, but the boundary it marks is real structured
data (scene rows). In audio the equivalent is a longer silence, and
`StandardLine.pause_after_ms` already exists (`standard_schema.py:51`).
NOT: hardcoded in the adapter — that is exactly the "no hardcoded
operator-tunable values" law.
OPEN: add a settings knob (default scene-break pause, ms) and have the importer
stamp it on each scene's last line.
GO: needed.

### Script tab: two project kinds can never finish a chapter

STATE: OPEN — your call. Surfaced 2026-08-09 by the post-build sweeps of
`docs/plans/2026-08-08-script-tab-restore.md` (§12); the build itself is done
and committed in `3a5a23d`.
WHY: narration binds to the project's Narrator (restore decision 4), and a
block with no persona now REFUSES to render (decision 5) instead of being
dropped in silence. Two kinds have no Narrator to bind to, so their narration
is permanently unplaceable and the bulk "assign to Narrator" button has no
target: **custom projects** (`_NARRATOR_KINDS` is audiobook+podcast, but
`visibleTabs` gives Script to every non-game kind) and **any project imported
before 2026-08-09**, because `_ensure_narrator` runs at create/import only and
never backfills. The button now disables itself and says why rather than
failing on click — that is the whole mitigation.
NOT: adding "custom" to `_NARRATOR_KINDS` on my own — `test_builtin_narrator`
pins the opposite as a deliberate decision ("no single prose voice"), and
reversing it is not mine to do.
OPEN: pick one — give custom projects a Narrator · hide Script from them ·
let the bulk action target any cast persona. Separately: whether an
already-imported project should get a Narrator on demand, or whether your data
reset covers it.
GO: needed.

### Script tab: split / merge / reorder a block was deferred, not dropped

STATE: DEFERRED by your ruling in the restore's decision 6 ("Defer split,
merge and reorder"), and then lost — the tracker item was deleted whole when
the build closed, so the deferral survived only inside the plan doc.
WHY it still matters: it is the only way to fix a mis-cut line, and §8 names
manual split as the workaround for the biggest attribution failure there is —
a UK-punctuated manuscript segments to ZERO dialogue
(`extraction/segmentation.py:8-10`, also in IDEAS).
NOT: built in the first pass — all three change the block count, which is
exactly the operation that destroys takes through `Take.block_id`'s CASCADE
(`database/models.py:305`). They need their own confirm-before-destroying
design.
OPEN: that design, then the build.
GO: needed.

## The next build

**Deferred by your word (2026-08-06):** the real-webview test harness and the
deep exhaustive audit — *"for now we are not doing jv harness or deep audit i
want to finish all features and complete the jv llm runner conversion."*

### VRAM: STOP AND THINK before any arbiter wiring

STATE: the 2026-07-04 decision stands (one shared VRAM budget family-wide; an
LLM **or** a TTS engine on the GPU, never both) — but the user ORDERED A STOP
first, 2026-08-08: *"once done with those tasks we need to stop and think about
vram, has that already been planned? some tts engines can run direclyt on cpu
and dont need vram, same with some of our modles so we need to take that into
consideration as well as the fact that we dont autoload the lmm model so how
does a user know what they can and cannot load if llm model is not even
selected or loaded, as we have it load on demand"*.
WHY: the old item assumed the wiring was the remaining work; the user names two
unplanned dimensions — CPU-resident engines/models that need NO budget, and the
load-on-demand LLM meaning the budget's biggest consumer is invisible until it
runs.
BUILT: the arbiter itself, in the runner (`runner/arbiter.py`); JustVoice's
`EngineManager.load()` neither reserves nor releases ("arbiter" appears nowhere
in `server/`, verified 2026-08-08). The engines are OS subprocesses, not
in-process (design-doc correction rides along).
OPEN: the THINK is DELIVERED, then twice hardened by ordered adversarial
passes — `docs/plans/2026-08-08-vram-think.md`. Pass 2 found the budgeted
policy ALREADY RUNS in JV's process for the LLM (`lifecycle.py:491`), reversing
Q1 to budgeted-from-the-start and cutting two overbuilt pieces. Pass 3 found
the decisive structural fact: naive TTS reservations would CORRUPT the runner's
`_admit` (it would "evict" a foreign key via router_unload no-op + release —
the ledger lies, overcommit returns), so the wiring's PREREQUISITE is the
kit-side eviction-executor seam (reservation kind + evict_fn + a shared
make_room; `_admit` refactored onto it). Pass 3 also disproved pass 2's
self-shrink assumption (the load fits against the FULL card and EVICTS —
`lifecycle.py:1937` + `_admit`) and found the shipped in-runner precedent for
Q2's policy shape (the #274 embed placement). The workflow pass (the user's
"how does the flow work" question) added §4 + two more calls: Q6 — Quick Setup
UNCHANGED (family-canon charter; TTS has no default-model concept, voices are
the unit and engines follow them), but the 2026-08-05 warm-boot stopgap
("TTS owns the GPU until F4's arbiter", main.js:208-214) comes back — rec:
flip LLM warm-boot ON as the wiring's last step; Q7 — mixed-GPU-engine casts
thrash full model loads per engine crossing (one-slot-per-kind +
per-line auto-load, verified) — rec: chapter render synthesizes grouped by
engine. Pass 4 verified the newest pieces in code: Q7's premise holds (the
chapter render is collect-then-assemble, `render_chapter_api.py:250-264`, so
grouping is just iteration order); Q6's mechanics corrected (warm is a per-DB
SETTING — kit default ON, JV's `llm_bootstrap.py:34-36` seeds it 0; the flip
reaches fresh DBs only, seeds-only rule); and Q8 found the deeper limiter —
`synth()` is slot-coupled (`manager.py:1415-1417`), so CPU-kokoro + GPU-engine
can never co-reside; multi-resident engines recorded as the later refactor,
NOT built. make_room's busy protection also closes the pre-existing same-kind
hole (loading LLM B could evict busy LLM A). Pass 5 produced ZERO design
reversals and four wiring corrections (§5 of the doc — convergence): whisper
IS the third kind and AUTO-LOADS today (`captures_api.py:48-60`, stt slot,
1500 MB cuda-only manifest) so dictation's resident set is stt+llm at once;
there are TWO engine-load doors and `render_core.render_line`'s direct
`engine.load` would BYPASS arbitration — door unification onto
`EngineManager.load()` is wiring prerequisite #2; `models_max`'s count cap
must be kind-scoped or a TTS resident eats a llama.cpp child slot; TTS
admission reuses the existing `safety_margin_mb` knob; and the claim line's
two sources are verified (measurements record `vram_total_mb`; `compute_fit`
prices an on-disk gguf). llm-busy lands in the KIT dispatch layer (JW inherits
the protection free); tts/stt-busy at the manager chokes. Your calls on Q1–Q8
are the gate. NO code before those decisions.
DECIDED (2026-08-08, round 1 — user words verbatim: *"q1 your rec, q2 how does
this work are you adding gui it sound good but how does it really work dont
likme stuff that is hidden or hardocded, q3 your rec, q4 your rec, q5 i dont
understnad your rec, q6 your rec, q7 this was suppored to already be done the
grouping so that anything synthized by engine got grouped together, that is not
just chapters but if you runn multople chapters it need to take wahter is being
run or queed to be run and gourp it effectiantly, you need to think on this
again and show me what you find, q8 your rec, no coding yet"*):
**Q1 ✓** budgeted + never-evict-busy · **Q3 ✓** claim line + event-driven
eviction toasts, no predictive warnings · **Q4 ✓** one budget strip on the
Speech-engines tab, one endpoint · **Q6 ✓** warm-boot flip as the wiring's
last step, seeds-only · **Q8 ✓** multi-resident engines recorded, NOT built.
**Q2 OPEN** — mechanics re-explained (engine FACTS in manifests: cpu_adequate
beside vram_min_mb/gpu_runtimes; the operator PREFERENCE is a real setting
`engines.engine_overrides[id].device` auto|cuda|cpu with a Device select on
each Speech-engines card; resolution in the ONE load door; resolved device +
reservation always shown on card/strip/toast; today's hidden torch greedy-cuda
is the thing being REMOVED) — DECIDED round 2, user: *"q2 ok"*.
**Q5 OPEN** — re-explained (the admission's "how much does this engine need"
number comes from the manifest's declared vram_min_mb; it is a first guess —
the spawn OOM back-off is the real safety net; the NVML measure-after-load
subsystem stays cut, parked in IDEAS) — DECIDED round 2, user: *"q5 your rec"*.
**Q7 REOPENED and SWEPT** (go round 2: *"i did not mean to sotp that sweep …
go and finis anwwering quesitns"*) — full findings + design in §7 of the plan
doc. The short truth: NOTHING groups anywhere (all five multi-line producers
verified sequential — scene render, M4B assembly, voiceline ZIP, the Lines
CLIENT loop, singles; every one funnels through per-line
`engine.load("auto")`); the user's "supposed to already be done" memory is
RIGHT twice over — the design freeze shipped `RenderJob`/`RenderJobBlock`
tables (`database/models.py:330-364`, DESIGN_FREEZE §3.7) with NO orchestrator
ever built (exports-only, dead in every DB), and Decision 13 of the 2026-06-20
shared-ai-stack plan promised job-level render/batch settings (parallel
workers, sub-batching, batch seed) that have ZERO code hits; engine-grouping
itself was never planned before this doc. Bonus debt found: Generation's
active-status machine (queued|loading_model|generating) is set by NOBODY —
both creators write "completed" directly, `active_tasks_api.py:51` filters on
states that never occur. REC (awaits the word): Option B in §7 — ONE
synthesis scheduler, engine-major across the whole pending pool; Stage 1 the
in-process scheduler core replacing wiring step 7 (producers submit sets and
wait; interactive singles jump at line boundaries); Stage 2 resurrect
RenderJob as the persistent face (retry-failed, resume, Lines client loop
retires). Sub-batching stays distinct (within-engine perf, IDEAS).
PASS 2 (*"think on the desing again"*, same day — §7b of the plan doc): found
a LIVE defect — the synth endpoints are async-def with sync bodies over sync
httpx (`manager.py:999`), so a chapter render blocks the ENTIRE server (even
accepting an Analyze; §4's mid-render story is impossible today — the
scheduler is what makes it real); found the big simplification — the render
cache is the hand-off (all producers verified `use_cache=True`, disk tier
never auto-evicts, `cache.py:96-135`), so the scheduler is a WARM PASS with
no result plumbing and assembly code unchanged; M4B needs WHOLE-submission
grouping (per-chapter was insufficient even single-producer); drain policy
concretized (oldest-pending-line engine first + pool-wide free-riding +
interactive jumps at line boundaries, no knobs); and the freed loop FORCES
all synthesis through the scheduler (the accidental serialization is the only
thing preventing load-terminates-engine-mid-synth today; previews are a sixth
synth door, `voice_preview_api.py:168`). Shape unchanged: Option B, two
stages. One pass-1 claim corrected: cross-producer line-level interleave
exists only between per-line-request flows; whole-request producers serialize
accidentally by blocking the loop.
PASS 3 (*"think on it again"*, same day — §7c): NO reversals. Three
corrections: Stage 1 is INDEPENDENT of the VRAM wiring and REC'd to ship
FIRST (the wiring's admission/busy plug into the scheduler's switch points
afterward); the Lines re-render stays UNgrouped until Stage 2 (per-line
requests = one-line sets — the named gap that makes Stage 2 debt, not
polish); the synth funnel covers MANAGED engines only (external/remote-API
singles stay direct — nothing to kill, nothing to group). Two alternatives
rejected on record: the `def`-endpoints one-keyword freeze fix (creates the
mid-synth kill race it cannot manage) and a manager synth/load lock (prevents
the kill, buys no cooperation).
PROCESS RULE (2026-08-08, mid-turn, verbatim): *"never do anycoding unless i
give you exact word 'go' never do anyting research unless i give go"* — both
gates are the literal word.
Q7 DECIDED round 3, user verbatim: *"your rec go"* (2026-08-08, after pass 3)
— Option B, scheduler-FIRST order. The go covers STAGE 1: the SynthScheduler
(pool + worker thread + engine-major drain per §7b P2-4 + submit-and-wait +
interactive jump), the managed-synth funnel (§7c P3-3 scope), and the manager
per-kind guard as safety back-stop. Stage 2 (RenderJob resurrection) and the
VRAM wiring each still need their own go.
BUILD-PREP DISCOVERY (§7d of the plan doc): `render_line` has NO local-engine
door — the registry it drives holds ONLY external cloud providers
(`app.py:438`; managed adapters were never re-registered when engines became
plugins), so chapter/M4B/QC/ZIP/Lines/take-re-roll 404 for EVERY local voice
and only ever worked with cloud voices; the new-voice preview door breaks the
same way (`voice_preview_api.py:134`); tests never caught it (fakes occupy
the registry slot production leaves empty). Stage 1 opens with the managed
bridge in render_core (= wiring step 2's render_core half, landing early).
STAGE 1 BUILT 2026-08-08, gates green (ruff clean · 453 pytest, all passing):
the managed bridge — `render_core.py` render_line/probe_line_cached route
managed engines via the manager (registry branch stays first: external
providers + test fakes untouched), tag-strip from manifest CAPABILITIES,
cloned-voice reference WAV via `resolve_audio_prompt_for_stored` (moved to
render_core, generate_api wraps it) · the scheduler — `synth_scheduler.py`
(SynthScheduler + SetHandle + warm_lines/warm_specs, engine-major oldest-first
free-riding drain, interactive jump, abort-on-first-error, cancel-withdraws) ·
the guard — `engines/manager.py` per-kind `_activity` locks around
synth/clone/transcribe and load/unload terminates (`_unload_kind` refactor) ·
the conversions — render_chapter + QC + M4B (`collect_project_line_kwargs`,
strict-mirroring, aborts warm if any scene refuses) + voiceline ZIP
(`collect_block_specs`, [] on first unvoiced block) warm sets;
render_block / generate-managed / managed new-voice preview are interactive
singles through the one synth door; all five endpoints now await instead of
blocking the event loop · tests — `test_synth_scheduler.py` (9),
`test_render_managed_bridge.py` (7), `test_engine_activity_guard.py` (2).
NOTE: built alongside the parallel Script-tab-restore session's work in the
same tree (its strict=True refusal composes with the warm; the book-warm
mirrors it). COMMITTED with Stage 2 + the Script-tab restore in `3a5a23d`
(2026-08-09, user word "commit and push all").
STAGE 2 GO GIVEN 2026-08-08, user verbatim: *"go"* (immediately after the
Stage-1 report listing Stage 2 first among the open gos — the decided
scheduler-first order's next step). Scope per §7 Finding 3 + §7c P3-2:
resurrect `RenderJob`/`RenderJobBlock` as the persistent face — job API
(create/status/cancel/resume), runner submits every block as its OWN
one-item set so the pool groups engine-major while failures isolate
per-block, per-block Generation+Take persistence identical to the single
door, boot sweep marks interrupted jobs paused, resume re-runs
failed+pending only, and the LinesView client loop retires onto one job
POST + poll with real n/m on the kit task.
STAGE 2 BUILT 2026-08-09, gates green (ruff · biome · 48 vitest · vite build ·
smoke 15/15 zero JS errors · pytest FULL SUITE 469 passed, zero failures —
both sessions' work green together): `render_jobs.py` (create_job
scope project|scene|blocks · `persist_block_take` = THE one block-persistence
shape, takes_api refactored onto it · runner submits each block as its own
one-item set — engine-major grouping pool-wide, per-block failure isolation ·
counters recomputed from rows so resume never lies · cancel withdraws pending
at the line boundary via live handles · `sweep_stale_jobs` boot sweep wired in
`app.py` after init) · `api/render_jobs_api.py` (POST create / GET
?include_blocks / cancel / resume) · `LinesView.vue` re-render = one job POST
+ 1s poll with real n/m, Cancel → job cancel, partial-failure toast, button
disabled-not-spinning · `docs/lines.md` updated · `tests/test_render_jobs.py`
(8: complete+persist, failure isolation, resume-only-unfinished,
cancel-withdraws, boot sweep, empty scope, API roundtrip, unknown-ids).
Composed live with the parallel Script-tab session's moving edits: warm
mirrors QC's skip_unrenderable/strict split (collector grew the flag); their
render_scene_to_wav strict= signature landed mid-build (two test stubs
updated to `**kw`, their session then evolved the same tests further).
COMMITTED + PUSHED as `3a5a23d` (2026-08-09, both sessions' work, final
gates green on the settled tree; workflows verified disabled before/after).
GO: Stages 1+2 BUILT · a job-list / resume UI surface beyond the Lines button
was NOT ordered and is not built.
DECIDED + GO 2026-08-13, user words verbatim: *"your rec go and go for the
full vram phase"* — after the ordered re-think ("think on the design again
including the new fit") and its adversarial cross-verification (Fable → Opus →
Fable, every claim run in code). The rec approved, THE ONE-POOL RULING: **on
one-pool boxes the ledger tracks POOL OCCUPANCY, not device placement.** Kit
half: `process.py`'s one-pool booking clamp — whose own comment and whose own
test (`test_arch_arm_one_pool_booking_never_exceeds_ledger`) both said "until
Phase 4 makes the ledger arch-aware", a debt Phase 4 then never collected —
changes ceiling from `max_vram_mb` (the iGPU carve-out: bookings of 0–128 MB,
admission dead, claim line reading 0, `__overhead__` calibration poisoned) to
`budget_total_mb` (the pool), the two carve-out-era test pins re-pinned to
pool truth + a new real-booking pin. JV half: on one-pool boxes a managed
engine load books its declared `vram_min_mb` WHICHEVER device it resolves
(CPU and GPU are the same physical bytes there); discrete keeps
cpu-resolves-books-nothing. "The full vram phase" = wiring steps 3–6 of
`docs/plans/2026-08-08-vram-think.md` §6 as amended by the re-think: step 1
(kit seam) and step 4's llm-busy half verified ALREADY BUILT during the fit
redesign; the claim line comes from the kit's `preview_fit` four-arm resolver,
never hand-rolled (P5-5's ladder is superseded); `declared_claim_fn` is DEAD
plumbing (assigned once, read nowhere, and `preview_fit` can't resolve
non-catalog ids anyway) — NOT used, left untouched, recorded as a gap; JV
prices its engines from its OWN manifests; tts-busy lives at the scheduler
worker (idle→active transitions), stt-busy at the manager's transcribe;
`cpu_adequate: true` lands on kokoro (certain), luxtts stays UNFLAGGED until
its real-time-on-CPU claim is verified, whisper stays cuda-declared (P5-1's
per-variant refinement recorded, not built); warm-boot flip is the LAST step,
seeds-only.
BUILT 2026-08-13, same session as the go — full stamp in
`docs/plans/2026-08-08-vram-think.md` §6 (STATUS STAMP 2). The pieces:
KIT — the one-pool clamp fix (`process.py` ceiling → `budget_total_mb`) +
two re-pins + the physics-equality pin (suite 847; steps 1 + 4-llm were
already built there during the fit redesign). JV server — device policy /
admission / declared reservation / release-on-every-exit in
`engines/manager.py` (`_resolve_device` · `_books_memory` one-pool ruling ·
`_admit_memory` no-locks-held (lock-order inversion avoided; a refused
admission leaves the world untouched) · `_reserve_engine` source="declared"
kind-mapped tts|stt · `_evict_for_arbiter` occupant-checked) + `cpu_adequate`
on kokoro + `EngineOverrides.device` (models.py) + tts-busy at the scheduler
worker's idle↔active transitions (`synth_scheduler.py`) + stt-busy at
`transcribe` + `GET /v1/engines/vram` (`engines_api.py`: snapshot + the
routed-default claim — routing store + production configs, NOT
resolve_feature; preview_fit's four arms do the pricing; claim_reason
distinguishes cloud-routed from not-configured) + `resolved_device` on
EngineInfo. JV UI — the budget strip (VRAM/Memory label off mem_arch,
provenance tooltip, busy chips), eviction-toast poller (4s, primed silently
on mount), Device select per card (read-modify-write PATCH), resolved-device
on the loaded badge, the client-guessed "est. VRAM" total replaced by ledger
truth. Warm-boot: `apply_jv_warm_default` DELETED (seed.py + reseed path),
`test_warm_default.py` re-pinned warm-ON-fresh / stored-choice-survives.
Docs: `docs/gpu.md` "The shared memory budget" (real section) +
`docs/engines.md` loading rewrite. Tests: `test_engine_vram_wiring.py` (17:
device policy · booking both arches · slot-replacement release · honest
refusal · idle-LLM eviction + event feed · never-evict-busy · evictor
occupant check · scheduler/transcribe busy · the endpoint incl. the claim).
GATES: kit ruff+847 · JV ruff+485 + vitest 48 + build + smoke 15 views zero
JS errors · JW 128 + build · check-family 0 violations · verify-model-pick
48. HONEST LIMITS, recorded: eviction toasts surface only while the
Speech-engines tab polls (no app-global poller was ordered); a crashed
engine's reservation lingers until its slot next loads/unloads
(conservative, over-counts); clone singles are protected by the activity
lock, not a busy flag (an evictor waits, then terminates); GPU-less
CPU-only boxes still book 0 (recorded gap, serving-design.md).
GO: BUILT — the item is closed when you've seen the strip live; the
laptops walk (kit checkpoint) now also shows real one-pool numbers.

### Speech-engines model management converges on the kit's download/load GUI + machinery

STATE: ORDERED 2026-08-08, user words verbatim: *"the model download load
unload for speech engines should be same gui desing and llm runner a download
button thre dot menue, and all the other feature such as model loaded unloaded
ect, can we resues any llm stuff i think that was in plane to resue the
progress downloadeder since llm has download manager, think or resues instead
of rewrite and wwe can consolidate, both speech engines nad llm runner
download load and unload models we should be able to use same mechanisms"*.
Think delivered same day: the 2026-06-20 cutover boundary DECIDED TTS/STT
sections stay native while LLM went to llm-ui
(`docs/plans/archive/2026-06-20-engines-llmui-cutover-boundary.md:234-235`) —
this order revisits that boundary. Reuse has three layers: (1) GUI
vocabulary — the kit card grammar (download button, three-dot overflow menu,
loaded/unloaded state chip, inline progress row) applied to the
Speech-engines cards; pure renderer, highest value, kit pieces that exist:
`LuModelCatalog` (model rows with download/load/unload/state),
`LuModelPicker`, `LuEngineInstallButton`/`LuEngineUpdateButton`,
`LuRunnerBinaries`; (2) client task machinery — ALREADY shared since
2026-08-08 (withAiTask + `setProgress(done,total,text)` + AiTaskStrip + the
`bridgeJobProgress` install bridge in `SpeechEnginesTab.vue`); (3) the server
download manager — a REAL open design question: the kit downloads
ggufs/runner binaries with its own progress machinery, JV downloads HF
snapshots + builds venvs via its own `/v1/engines/*` job system; whether one
download manager can own both needs its own pass, no claim made.
WHY: two model-management surfaces in one app answering the same verbs
(download/load/unload/delete/progress) with different control vocabularies is
exactly the divergence class the family convention exists to kill; reuse
instead of rewrite is the standing law.
NOT: moving TTS engines INTO the kit's runner/catalog (they are not llama.cpp
children — the pool stays JV's); claiming the server halves are one system
today (they are not).
BUILT: nothing — think only.
OPEN: the design pass — inventory `SpeechEnginesTab.vue`'s current controls
against `LuModelCatalog`'s grammar; decide per piece import-as-is vs promote
a shared kit primitive; then the server-half reuse question as its own
decision.
GO: needed — think recorded; design + build wait on the word.

## Features the docs promise and the code does not do

### The effects chain never runs on a chapter or batch render

STATE: FINDING — code-verified 2026-08-08.
WHY it matters: a user builds an effects chain, hears it on a one-off generate,
and loses it on the render that matters.
BUILT: `apply_effects_chain` on single-line paths only — `generate_api.py:276,
296, 371, 388`. `render_core.py` contains **zero** effects code.
OPEN: wire it into the render path AND put the chain's hash in the render cache
key — today editing the chain does not invalidate the cache, so a naive wiring
would serve stale audio.
GO: needed — needs its own plan.

### Nothing is mastered by project kind, and the UI says otherwise

STATE: FINDING — code-verified 2026-08-08.
WHY it matters: Studio renders a pill reading "ACX target · −20 LUFS · peak −3 dB
· noise floor −60 dB" with the tooltip "Applied on render — set per project in
Projects" (`StudioView.vue:841-846`, `:1430`), and `renderScene()` sends
`{scene_id, preset_id}` with **no master field** (`:779-782`), so the server
returns raw WAV (`render_chapter_api.py:259`). The ACX QC column therefore grades
unmastered audio and can pass a file that fails on delivery.
BUILT: the per-project picker (`ProjectsView.vue:562`); `acx` is assigned in
exactly one place, audiobook import (`projects_api.py:643`). The podcast −16 LUFS
default the docs describe exists nowhere.
OPEN: wire real per-kind defaults + a mastered render + a QC path over the
mastered file — or cut the promise from the docs and the pill.
GO: needed.

### `chapter.md` documents a page that doesn't exist and audio that isn't mastered

STATE: FINDING — code-verified 2026-08-08.
BUILT: nothing to keep — `chapter.md:5` links `stories.md` (absent), `:32` and
`:81` link `profiles.md` (absent), `:3` claims "render the whole chapter as a
single mastered WAV" (the item above shows it is not true).
OPEN: the rewrite, which waits on the mastering decision. `docs/export.md`'s
"Chapter render → mastered WAV" section is the same suspect class and is still
unverified.
GO: needed, after the mastering call.

## Docs and repo debt

### The Stories tab advertises a feature that isn't built

STATE: OPEN — your call: reword the lede, or hide the tab until the timeline is
real.
WHY it matters: app copy is code. `App.vue:43` sells "Multi-track timeline editor.
For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement."
BUILT: nothing behind it — `StoriesView.vue` has been deliberately inert since
2026-06-13, and the live server's `openapi.json` has **no `/v1/stories*` route at
all** (verified 2026-08-08). The tab's ? button also 404s: `App.vue:143` maps it
to help slug `stories`, and `docs/stories.md` does not exist.
OPEN: the copy decision, then either write `docs/stories.md` + restore its
`toc.json` entry, or remove the tab and leave both out.
GO: needed. (User docs were corrected 2026-08-04 to stop sending podcasters there.)

### Design rationale that exists only as code comments

STATE: FINDING — the comments verified present 2026-08-08; whether
`design-decisions.md` already covers each one is **not** verified.
WHY: a comment does not survive the next refactor of the file it sits in.
OPEN: write these into `design-decisions.md` — why Stories is gated
(`StoriesView.vue:3-15`, belongs in §5) · the backup schema-v1 / 4 GB design ·
why settings folded from JSON into SQLite (`storage/settings_store.py:4-8`) · the
"no hardcoded operator-tunable values" law and how engine source overrides
implement it · corrections used as few-shot examples.
GO: needed.

### The `screenshots` npm script is broken two independent ways

STATE: FINDING — hit live 2026-08-08 (left unfixed: no go was given to edit it).
BUILT: nothing. `scripts/smoke_gui.js` hardcodes `127.0.0.1:17497` and ignores
`JV_BASE` (CLAUDE.md's "JV_BASE overrides the base URL" is true of `smoke.js`
only), and even on the right port it times out waiting for a
`getByRole('button', { name: 'Engines' })` that no longer resolves.
OPEN: fix the port to honor `JV_BASE` and update the stale selectors — or
retire the script into the deferred harness decision (it is browser-driven,
the banned acceptance class).
GO: needed.

### §3 wording tension: "speaker attribution = JW" vs "JV does its own casting"

STATE: OPEN — observed 2026-08-08 during the contract-rows work, **unverified**
which reading is right.
WHY it matters: `design-decisions.md:105` lists speaker attribution under JW's
data ownership, while CLAUDE.md says "JW hands over the prose, JV does its own
casting and narration" and JV's extraction pipeline computes attribution.
Possibly ownership-of-data vs where-computation-runs — but the two sentences
read as contradicting each other and one page should say which.
OPEN: reconcile the §3 wording (one look at what JW actually exports).
GO: needed.

### The JW→JV book-format contract has no lock on the JustWrite side

STATE: OPEN — your call, and the concrete successor to the "book-zip import
format" item §3 records as a future decision. Became real 2026-08-08 when the
`justwrite` adapter started parsing JW's actual `book.json`.
WHY: JV's own fixture test catches JV regressions but cannot catch JW CHANGING
the shape — a rename of `scenes[].body` or a re-nesting of `parts[].chapters[]`
would break JV silently, and the two repos share no code by design (see the
zip-import item's NOT list).
OPEN: a shape-lock test in JW's suite asserting `book_io.assemble()` still emits
the exact key paths JV reads, naming JustVoice in its failure message. Lives in
`../justwrite-app/docs/dev/TASKS.md` once you take it — JW work belongs there.
GO: needed.

### ElevenLabs import: build it or drop it — the research says it is small

STATE: OPEN — your call. Its picker row was removed 2026-08-08 (a 501 in a menu),
but the module's own docstring is WRONG about why it was never built.
WHY: `imports/adapters/elevenlabs.py` claimed the mapping needs "an account-side
voice manifest" or a hand-mapping step and is "out of scope". JustVoice's own
research doc contradicts it — `docs/dev/external-import-formats.md` says the
Studio export is a ZIP of `manifest.json` (name, `voice_assignments`, chapters) +
per-chapter HTML with `<span data-speaker>` turns, maps "directly to Project /
Scene / Block", and rates the importer effort **Small**. The same doc surveys
Resemble, Speechify, Murf, Coqui and OpenVoice the same way.
OPEN: build it from the research doc (it also unlocks the four other tools), or
decide the whole external-tool import family is not wanted and retire the
research doc's claim. Either way the stub is gone — git holds it.
GO: needed.

## Known deviations, recorded so they aren't re-litigated

- **No real-webview end-to-end harness** — deferred by your word above. When it
  is picked up, docgen's harness is the donor, and `scripts/shots.js`,
  `scripts/verify_all.js` and `scripts/e2e.js` retire or get replaced with it:
  they are browser-driven, which was banned as an acceptance surface on
  2026-08-02.
- **`capture.llm_model` is a dormant settings field** — decided KEEP. Its UI
  picker is gone but the field stays (`models.py:330`).

## VRAM wiring DEPENDENCY (2026-08-09): the fit redesign lands first

The family fit redesign (`../just-llm-runner/docs/plans/2026-08-09-fit-redesign.md`)
is the wiring's prerequisite: it fixes BOTH of the claim line's verified sources —
the computed arm (compute_fit physics) and the measured arm (which does not exist
today: `model_measurements.vram_total_mb` is the CARD total, not a footprint; the
true-up dies in-memory — the redesign persists it as `vram_model_mb` + adds the
claim resolver the strip consumes). Q1-Q8 rulings STAND untouched; the
eviction-executor seam remains this repo's own prerequisite (disjoint functions,
same lifecycle.py). Resume the wiring after the redesign's Phase 5.
2026-08-13 consensus update (plan §13): claims carry `{vram_mb, ram_mb}` + a
provenance source (measured|declared|computed — a manifest-priced TTS reservation
must never read as live truth on the strip); RAM co-residency on DISCRETE boxes is
priced but unbudgeted — DECIDED (plan §8.18): the strip DISPLAYS the RAM sum,
never enforces it in v1 (mmap'd weights make a summed ledger over-count; enforcement
only on evidence, mlock/no_mmap-keyed), and the display half is THIS repo's wiring
work, not the kit's. CPU-adequate engines confirmed first-class (claim follows the
resolved device → CPU = 0 VRAM).
STATE STAMP 2026-08-13 (late): the redesign's BUILD PHASES ARE COMPLETE —
Phases 0–7 BUILT + pushed (6 = the joint MoE solve + ncmoe-first shed; 7 =
the uncurated-path gate + evidence-keyed ranking + the one-authority dev-doc
story, now standing in the kit's `docs/dev/serving-design.md` fit section —
read THAT for the current fit architecture, the plan for history) — THIS
ITEM IS UNBLOCKED with no kit prerequisite left. What Phase 5 delivered for the wiring (full record in the kit
tracker's fit item): the claim resolver lives in `preview_fit` (four arms:
resident-live with §13.1 provenance on the arbiter snapshot → persisted-
measured median over fingerprint-matched source='load' rows → physics computed
with learned per-backend overhead → declared); claims are {vramMb, ramMb,
source, matches} (RAM display-only §8.18); the arbiter snapshot is arch-aware
(mem_arch, one-pool pools counted once — Phase 4) and each reservation row
carries its source. CORRECTED 2026-08-13 (the re-think's code verification):
`configure_service(declared_claim_fn=…)` is DEAD plumbing — assigned once,
read nowhere, and `preview_fit` resolves catalog ids only, so it can never
answer a foreign kind. JV does NOT register it; JV prices its engines from
its OWN manifests (vram_min_mb · cpu_adequate · gpu_runtimes — Q2's facts)
and the strip reads the resident snapshot + `preview_fit` claims for the LLM.
GO GIVEN 2026-08-13 (see the VRAM item above for the decision record).
