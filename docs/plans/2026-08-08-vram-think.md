# The VRAM think — decisions owed before any arbiter wiring

> The user's stop order (2026-08-08): *"we need to stop and think about vram,
> has that already been planned? some tts engines can run direclyt on cpu and
> dont need vram, same with some of our modles so we need to take that into
> consideration as well as the fact that we dont autoload the lmm model so how
> does a user know what they can and cannot load."* Every fact below is
> code-verified this session; the questions at the end are the user's calls.
> NO code until they are decided.

## 1 · Has it been planned? Half of it — and the JV half rests on a corrected falsehood

- **The LLM half is planned, built, shipped and tested.** Design
  `just-llm-runner/docs/plans/archive/2026-07-04-serving-vram-manager*.md`;
  implementation `llm_runner/runner/arbiter.py` (197 lines): a thread-safe
  in-process committed-VRAM ledger with pinning, LRU eviction (`min_mb` guard
  so evicting a CPU-placed model is never mistaken for freeing VRAM),
  budget-aware Fit (`remaining_mb` feeds `coarse_fit`), and a
  `GET /v1/llm-runner/resident` snapshot. JustWrite's runner uses all of it.
- **The JV/TTS half was never planned.** It exists as ONE sentence in the
  design ("JV's `engines/manager.py` consults the SAME arbiter") — and that
  sentence rests on a premise the same doc later verifies FALSE (its own §
  correction, implementation doc line 614: "JV TTS runs in-process" — JV
  actually runs every engine as an OS **subprocess**). A subprocess's VRAM
  must be declared or measured from outside; nothing was designed for that.
- So the honest answer to "has that already been planned": the machinery yes,
  JustVoice's use of it no — this document is the missing plan's front door.

## 2 · The facts the two new considerations stand on

**CPU engines are already declarable — the data exists.** Every JV engine
manifest carries `vram_min_mb` + `gpu_runtimes` (verified):

| Engine | vram_min_mb | runtimes |
|---|---|---|
| kokoro | — | cuda, coreml, directml, **cpu** |
| luxtts | 1024 | cuda, **cpu**, mps |
| chatterbox | 4096 | cuda, **cpu** |
| qwen3 | 6000 | cuda only |
| tada | 8000 | cuda (…) |
| dia | 10000 | cuda only |
| moss_tts | 12000 | cuda only |

And the arbiter already has the right semantics for CPU residents: a
reservation records the **GPU-resident** footprint only (a CPU-placed model
reserves ~0), and `pick_evict(min_mb=…)` exists precisely so a CPU resident is
never evicted to "free" VRAM it isn't holding. So "CPU things need no budget"
is a policy the machinery supports today — what's missing is JV deciding the
device per engine (today the load call sends `device: "auto"` and each engine
decides for itself) and telling the ledger which way it went.

**The on-demand LLM is the invisible elephant.** JV's LLM loads lazily on the
first AI run (`_ensure_local_ready_sync` inside `run_action`/`stream_action`).
Before that: committed = 0, a user loading a 10 GB TTS engine sees a full
card — then the first Analyze tries to load the routed LLM into what's left.
The budget's biggest consumer is invisible until it runs. The kit already has
the two ingredients a prediction needs: the **routing default** names the model
before it loads, and `fit`/`model_measurements` can price it in MB.

**One ledger per process still works.** The arbiter is a process-wide
singleton; JV's server process spawns BOTH the TTS engine subprocesses and the
bundled LLM runner's children, so cross-kind budgeting in one in-process ledger
survives the subprocess correction — only the *footprint source* changes
(manifest-declared / measured, not self-reported).

**Out of scope, restated:** cross-APP arbitration (JW and JV on one GPU at
once) was excluded by design §7.2 and stays excluded.

## 2b · The fact the re-think surfaced (2026-08-08, second pass) — the policy is already RUNNING in JustVoice

`llm_runner/runner/lifecycle.py:491`: every `RunnerService` takes the
process-wide arbiter singleton and runs the budgeted policy — reserve on load,
touch on measure, release on unload, LRU-evict under pressure, budget-aware
fit. JustVoice mounts that runner in its own server process (`app.py:21-25`,
the bundled `local-llamacpp`). **So the LLM half of the ledger is live in
JustVoice today.** Only the TTS engines never joined it. Any "policy choice"
that isn't the budgeted one would be new code fighting a policy already
running in the same process.

## 3 · The decisions — your calls (recs REVISED by the adversarial second pass)

**Q1 — Exclusive or budgeted? → BUDGETED, from the start.** The first-pass rec
("exclusivity now, budget later") is WITHDRAWN — it was the easy answer, and it
fails three ways:
1. **It fights the incumbent.** The budgeted policy already runs for the LLM in
   JV's process (§2b). Exclusivity would be NEW cross-kind special-case code
   layered against it — more code, not less.
2. **It thrashes the core loop.** The audiobook workflow alternates LLM and TTS
   per chapter (Analyze → cast → render → next chapter's Analyze). Exclusivity
   charges a double model-load tax every cycle. On the 8 GB reference card the
   budget produces the same swaps only WHEN ACTUALLY NEEDED — and kokoro/CPU
   TTS beside the LLM never swaps at all; on a big card nothing swaps, ever.
3. **It has no answer for a mid-render collision.** An Analyze fired while a
   chapter renders must, under exclusivity, either kill the render or fail the
   analyze. Under the budget + the invariant below, the right behavior exists.
THE INVARIANT the wiring must add (the real design content of Q1): **never
evict a busy resident.** A TTS engine is protected while a render/generate is
in flight; the LLM is protected while a run is in flight (JV owns both call
sites — a simple busy counter each; the arbiter's `pinned`/`among` parameters
already express the exclusion). If an admission cannot fit without evicting a
busy resident, it fails with the honest message ("wait for the render to
finish"), never kills work.

**Q2 — Who decides CPU? (unchanged)** The engine's own `auto` picks the device
(no arbiter-driven silent CPU fallback — a CPU-placed chatterbox is many times
slower, and a silent placement would read as "renders mysteriously became
slow"). The engine subprocess reports the RESOLVED device in its status; only
a `cuda`-resolved load reserves. `gpu_runtimes` already gates what auto may
pick.

**Q3 — Making the on-demand LLM visible. (TRIMMED)** A standing
"AI model (loads on demand): ~X GB" line — the routed default's predicted
footprint from the kit's measurements/fit — wherever VRAM is shown. The
first-pass "warn at TTS load time" is CUT: under the budget it would fire on
loads that never conflict, and predictive nags that are usually wrong train
users to ignore them. Honesty is EVENT-driven instead: when an admission
actually evicts something, the toast names what was evicted and why, both
directions.

**Q4 — Where the user sees it. (unchanged, trimmed edge)** One budget strip on
the Speech-engines tab — total · TTS in use · AI model (on demand) · free —
served by ONE JV endpoint reading the same arbiter snapshot. Unifying this
with the kit AI page's resident view is a later nicety, deliberately not now.

**Q5 — Footprint source for TTS. (TRIMMED)** The manifest's `vram_min_mb`,
full stop. The first-pass NVML measure-after-load system is CUT as
overengineering: admission is a first-guess safety net by the arbiter's own
design (the spawn OOM back-off is the real net), so a declared minimum is
enough to ship. Measured footprints go to IDEAS, not the plan.

## 3b · Third pass (2026-08-08, ordered again) — two corrections that change the wiring

**F1 — Naive TTS reservations would CORRUPT the runner's admission (the pass's
payoff).** The runner's `_admit` loop (`lifecycle.py:2147`) picks the LRU
non-pinned victim and "evicts" it via ITS OWN `_evict_resident` →
`router_unload` + `arbiter.release`. If a TTS key sat in the shared ledger,
`_admit` could pick it, router_unload would no-op (it is not a runner child),
and the RESERVATION WOULD STILL BE RELEASED — the ledger then lies while the
engine holds its VRAM, every later admission overcommits, and the OOM the
arbiter exists to prevent comes back. So "EngineManager just reserves/releases"
— the second pass's closing line — was UNDERSCOPED to the point of being
wrong: cross-kind sharing REQUIRES an eviction-executor seam first.
- **Rec:** reservations carry `kind` + an `evict_fn` (the owner's unloader),
  and a shared `make_room(needed_mb, exclude, protected_kinds)` picks victims
  and calls the owner's evictor; the runner's `_admit` refactors onto it with
  `_evict_resident` as its registered evictor. One policy home, both
  directions work, the ledger can never hold a reservation nobody can execute.
  (The alternative — strict same-kind `among=` restrictions plus hand-rolled
  cross-kind steps in each admission — leaves two half-policies to drift.)

**F2 — The LLM load EVICTS, it does not self-shrink (assumption from pass two,
disproved).** The load's fit computes against the FULL card
(`lifecycle.py:1937` — raw `hardware`, not `remaining`; only the CATALOG view
feeds remaining), then `_admit` evicts LRU until it fits. So the existing
admission ladder is already: fit-to-card → evict idle LRU → nothing evictable →
proceed-with-warning (fit-placed/MoE keep the child's auto-offload net) or
refuse (dense + explicit ngl). Cross-kind wiring EXTENDS that ladder; the TTS
side, having no shrink net, is: fit free → evict idle → honest fail. Busy
protection = busy keys excluded from `make_room`'s candidates (coarse per-KIND
busy flags: an AI run in flight protects llm-kind; a render in flight protects
tts-kind).

**F3 — Q2's shape has a shipped precedent INSIDE the runner.** The embed is
"placed by POLICY (CPU unless the static leftover covers it) BEFORE the fit —
never by the child's default" (`lifecycle.py:1930-1934`, #274). The
cpu-adequate→CPU rule is the same shape one level up; the policy always sends
an EXPLICIT device down (never trusts torch/sherpa auto downstream).

**F4/F5/F6 — smaller:** reservations need the `kind` tag anyway for the strip's
TTS/LLM split (today keys are bare model ids). The claimed-on-demand line is
CONDITIONAL on a production route resolving to the local runner — cloud-routed
features claim nothing. STT (whisper) residency is an open inventory item at
wiring time: if it holds VRAM it joins as a third kind; the design is
kind-generic either way.

Decide Q1–Q5 and the wiring is: the kit's executor seam (F1: kind + evict_fn +
`make_room`, `_admit` refactored onto it) · `EngineManager.load()` resolving
device by policy then reserving cuda-resolved loads · two coarse busy flags ·
the strip + conditional claim line. F1 is the prerequisite; without it,
nothing else is safe to wire.

## 4 · The workflow, end to end (asked 2026-08-08: "how does the flow work?")

**Today's flow, verified at every trigger:**
- **Boot: nothing loads — by a recorded stopgap this work retires.**
  `main.js:208-214`: "JV's warm default is OFF (ruling 2026-08-05: TTS owns the
  GPU until F4's arbiter) … flipping the toggle on is all it takes." So "we
  don't autoload the LLM" is not an accident — it was the interim answer to
  exactly this VRAM tension, parked waiting for the arbiter.
- **The first AI run lazily loads the Quick-Setup LLM** (the ensure inside
  `run_action`/`stream_action`) and it stays resident (the runner's own
  idle-sleep may later free it).
- **Picking voices loads NOTHING.** Voice lists are static — manifests carry
  `static_voices`, so casts browse every engine's voices with zero engines
  running (`render_core.py:48-71` resolves voice→engine from manifests too).
- **The first line rendered auto-loads that voice's engine**
  (`render_core.py:192-197` — `engine.load("auto")`, today's GPU-greedy auto)
  and **one slot per kind**: a new engine of the same kind unloads the prior
  occupant (`manager.py:1055`). Nothing arbitrates against the resident LLM —
  the collision the 2026-08-05 stopgap only half-hid, since the LLM returns
  the moment any AI feature runs mid-session.

**The same flow under the plan:** boot (see Q6) · Analyze → LLM loads,
reserved · cast freely (still loads nothing) · render's first kokoro line →
policy resolves CPU, LLM undisturbed · first GPU-engine line → cuda admission:
fits beside the LLM on a big card; on 8 GB `make_room` evicts the now-IDLE LLM
(toast says so), the engine loads, the render runs protected · Analyze fired
MID-render → the busy engine is untouchable, so the LLM takes the
proceed-with-warning branch (fit-placed, auto-offload — slow but working) ·
render ends → the next Analyze evicts the idle engine and runs full speed.
Every swap is an event-driven toast; the strip shows total · TTS · claimed ·
free the whole time.

**Q6 — Quick Setup: unchanged; the warm-boot toggle comes back instead.**
Quick Setup's charter is family canon ("Sets up the built-in llama.cpp
provider only" — `familyContract.js` quickSetup.bandScope), and TTS has no
"default model" for a wizard to pick: the unit a user chooses is VOICES, per
project, and engines follow voices — the design the user re-affirmed. The one
real TTS default (dictation's voice) is already a setting. What DOES return
after the wiring: the 2026-08-05 warm-boot ruling was explicitly "until F4's
arbiter" — with budgeted arbitration the warm LLM is safe (idle = evictable),
and flipping it on makes the first Analyze instant. REC: turn JV's LLM
warm-boot ON as the wiring's last step, surfaced by the existing BootModelLoad
splash. Your call.
MECHANICS, verified pass 4: warm is a per-DB SETTING, not a constant — the kit
default is ON (`runner_config_api.py:73`) and JV's bootstrap seeds the row to
"0" (`llm_bootstrap.py:34-36`). "Flipping it on" = the bootstrap stops seeding
0 — which, under the seeds-only/no-migrations rule, reaches FRESH databases
only; an existing DB keeps its stored 0 until the user resets or flips the
already-existing engine-config toggle themselves. Honest cost: a session whose
FIRST action is a GPU render pays one eviction of the warm LLM (toasted,
inside a minutes-long render); the boot splash stays skippable; the kit client
already gates warming on "built-in is the routing default + model on disk", so
cloud-routed setups warm nothing.

**Q7 — mixed-engine casts thrash, and that's a render-order fix, not a VRAM
fix.** Verified twice (pass 4 checked the premise in code): the chapter render
is collect-then-assemble — `for line in lines: render_line(...)` into a list,
then ONE `concat_lines(rendered, silence_ms)` at the end
(`render_chapter_api.py:250-264`) — so synthesis order is genuinely free;
grouping is just iteration order with position-indexed results. REC: the
chapter render synthesizes GROUPED BY ENGINE — one engine load per engine per
chapter instead of per crossing. Per-chapter grouping first; grouping across a
multi-chapter batch is the later refinement. Can ride the wiring or follow it
— your call.

**Q8 — the one-slot-per-kind rule is the DEEPER limiter (pass 4's finding);
record it, don't build it.** `manager.synth()` requires the engine to BE the
current slot occupant (`manager.py:1415-1417` → `_require_current`), so
kokoro-on-CPU + chatterbox-on-GPU can never be resident together even though
they share no resource — a mixed cast still swaps at every engine crossing,
which is exactly why Q7's grouping matters (it reduces the cost to once per
engine per chapter). The true zero-swap design is multi-resident engines: N
loaded engines governed by the budget (CPU residents free, GPU residents
through the arbiter), with `synth()` routing to whichever loaded engine owns
the line's voice — a real EngineManager refactor (slots → registry, the
"current engine" concept in the UI changes with it). REC: not now — only
worth its refactor if one-swap-per-engine-per-chapter still hurts in
practice.

**Pass-4 side findings.** Routing every admission through `make_room` also
closes a PRE-EXISTING same-kind hole: loading LLM model B could today evict
model A mid-run (the arbiter's LRU can't see live inference — its own
docstring says so); the coarse llm-busy flag protects A the same way it
protects a rendering engine. And the per-engine device setting's explicit
`cuda` on kokoro is honest-failure territory (the shared venv may lack
onnxruntime-gpu) — a load error surfacing to an explicit override is
acceptable; `auto` never goes there.

## 5 · Pass 5 (2026-08-08, ordered again) — the integration holes under the design

No design reversals this pass — every finding is a WIRING correction. That is
what convergence looks like: the shape holds, the seams sharpen.

**P5-1 — STT is the third kind, and it auto-loads TODAY.** Stopped deferring
it: whisper IS a manager engine in the stt slot (`engines/whisper/`,
`vram_min_mb: 1500`, cuda-only runtimes declared), and the captures flow
auto-loads it on first transcription (`captures_api.py:48-60`,
`mgr.load("whisper", device="auto", …)`). Dictation's resident set is
whisper + the refine LLM SIMULTANEOUSLY — two kinds, both un-arbitrated
today. The design is kind-generic, so stt simply joins: its loads reserve,
transcription sets stt-busy. One nuance for the wiring: CPU-adequacy may need
a per-VARIANT override eventually (whisper-small on CPU is fine, large is
not) — the manifest flag starts per-engine; a variant override field is the
later refinement, not now.

**P5-2 — There are TWO engine-load doors, and one would bypass arbitration.**
`generate_api` drives `get_manager()` directly (five call sites) while
`render_core.render_line` calls `engine.load("auto")` on the engine OBJECT and
then `set_current` — a second door around the manager. Admission wired into
only one of them is a hole by construction. WIRING PREREQUISITE #2 (beside
F1's executor seam): unify the load doors — `EngineManager.load()` becomes the
ONE place engines load (render_core refactors onto it), and the device policy
+ reservation live there. Busy split falls out clean: llm-busy is set at the
KIT's dispatch layer (chat/stream_chat entry/exit — JW inherits the same-kind
protection for free, zero app wiring), tts/stt-busy at the manager's
synth/transcribe choke points.

**P5-3 — `models_max` would be corrupted by foreign kinds.** The runner's
`_admit` checks `count() < models_max`, and `count()` counts EVERY reservation
— a resident TTS engine would eat a slot meant to cap llama.cpp CHILDREN. The
F1 seam spec grows: `count(kind=…)` / kind-scoped caps; the VRAM budget stays
global, count caps are per-owner.

**P5-4 — TTS admission needs the safety margin, and the knob already exists.**
`remaining_mb` is raw by design (the fit functions subtract the margin "in one
place" — for LLM loads). A TTS admission against raw remaining would book to
the last MB and squeeze the driver/display. It subtracts the SAME
`safety_margin_mb` the runner config already stores — one existing knob, no
new hardcoded value, the no-hardcoded-tunables law holds.

**P5-5 — The claim line's sources are now verified, both of them.** The kit's
model measurements RECORD `vram_total_mb` per model+machine
(`model_measurements_api.py`), and `compute_fit` prices an on-disk gguf
without loading it. So the claimed-on-demand number is: measurement if one
exists → fit estimate if the gguf is on disk → no claim (with the honest
"not downloaded" state). The runner catalog's coarse-fit verdict is NOT a
number and is not used for this.

## 6 · The wiring, in order — the complete build plan once Q1–Q8 are decided

Written in full (user order 2026-08-08: "save all in docs in detail … what to
do and why and the research") so a later session builds from THIS page without
re-deriving anything. Each step names its repo, its files, and which Q gates
it. The order is load-bearing: 1 and 2 are prerequisites — nothing after them
is safe to build first.

> **STATUS STAMP 2 (2026-08-13 — THE WIRING IS BUILT).** The go: *"your rec
> go and go for the full vram phase"*, after the ordered re-think + its
> adversarial cross-verification (every claim run in code). Everything below
> is DONE; this doc is history now:
> - **Step 1 + step 4's llm half had ALREADY been built kit-side** during the
>   fit redesign (the 2026-08-09 seam: kind/evict_fn/source reservations,
>   make_room with busy protection, kind-scoped counts, `_admit` refactored,
>   the eviction-event ring, llm-busy at dispatch) — the 2026-08-09 stamp
>   below never learned this.
> - **Step 3 BUILT**: device policy + admission + declared-price reservation
>   in `EngineManager.load()` (manager.py), `cpu_adequate` on kokoro, the
>   `engine_overrides[id].device` setting — PLUS the ONE-POOL RULING the
>   re-think surfaced (pool boxes book whichever device resolves; the kit's
>   one-pool booking clamp fixed to `budget_total_mb` with its two stale test
>   pins re-pinned).
> - **Step 4 BUILT**: tts-busy at the scheduler worker's idle↔active
>   transitions; stt-busy at `manager.transcribe`.
> - **Step 5 BUILT**: `GET /v1/engines/vram` (snapshot + the routed-default
>   claim via the kit's `preview_fit` four-arm resolver — P5-5's ladder is
>   SUPERSEDED, and `declared_claim_fn` turned out DEAD plumbing, unused) +
>   the budget strip / Device select / eviction toasts / resolved-device
>   display on the Speech-engines tab (VRAM-vs-Memory label off mem_arch).
> - **Step 6 BUILT**: the 2026-08-05 warm-OFF stopgap retired
>   (`apply_jv_warm_default` deleted; the family warm-ON seed reaches fresh
>   DBs; existing DBs keep their stored value — seeds-only).
> - Tests: `test_engine_vram_wiring.py` (17) + re-pinned warm/seed tests;
>   gates green across kit (847) · JV (485 + vitest + build + smoke) · JW
>   (128 + build) · check-family.
>
> **STATUS STAMP (2026-08-09, after the scheduler shipped — commit
> `3a5a23d`, Q1–Q8 all decided, scheduler Stages 1+2 BUILT per §7-7d).**
> Read this section THROUGH the stamp; the per-step notes below are the
> law for what remains:
> - **Step 1 (kit executor seam): OPEN, unchanged** — still the first build.
> - **Step 2 (load-door unification): the MANAGED half is DONE** — §7d's
>   bridge routes every managed render through `mgr.load`/`mgr.synth`
>   (render_core.py, landed in `3a5a23d`). The residual object-door calls
>   (`engine.load("auto", None)` in render_core's registry branch,
>   voice_preview's registry branch, generate's in-process branch) are
>   EXTERNAL/remote-API engines only — no local process, no slot, no VRAM;
>   out of arbitration scope. Step 2's original grep check is obsolete;
>   nothing further to build here unless external engines ever grow local
>   residency.
> - **Step 3 (device policy + reservation in `EngineManager.load()`): OPEN,
>   unchanged** — the one load door now genuinely receives every managed
>   load, so this lands cleanly.
> - **Step 4 (busy flags): tts-busy's home MOVED** — it is the scheduler
>   worker ("worker is synthesizing", §7b), not a manager choke; stt-busy
>   stays at `manager.transcribe`. The Stage-1 per-kind ACTIVITY locks
>   (`manager._activity`) are the mechanical seed: admission's
>   `protected_kinds` should derive from scheduler-busy + stt-activity, and
>   llm-busy still lands in the KIT dispatch layer as written.
> - **Steps 5 (visibility) and 6 (warm-boot flip): OPEN, unchanged.**
> - **Step 7 (engine-grouped synthesis): DONE AND SUPERSEDED** — the
>   SynthScheduler (§7b design, built `3a5a23d`) groups pool-wide across
>   every producer, which is strictly more than this step asked for. Skip.
> - Admission's call SITE: `make_room` runs at the scheduler's
>   engine-switch boundaries (once per engine per drain cycle) and inside
>   `EngineManager.load()` for direct loads (Engines-tab button, captures) —
>   both funnel into the same step-3 policy.

**Step 1 — KIT: the eviction-executor seam (gates: Q1; finding F1/P5-3).**
`llm_runner/runner/arbiter.py`: `_Reservation` grows `kind: str` and
`evict_fn: Callable[[], None] | None`; `reserve()` takes both. New
`make_room(needed_mb, *, exclude, protected_kinds, hardware) -> bool`: picks
LRU non-pinned victims whose kind is not protected AND whose `evict_fn`
exists, CALLS the owner's evictor, loops until `needed_mb` fits or no victims
remain (returns False — caller decides proceed-with-warning vs honest fail).
`count(kind=None)` becomes kind-scoped (P5-3: a TTS resident must not eat a
`models_max` llama.cpp child slot). `snapshot()` exposes `kind` per
reservation (F4 — the strip's split needs it). Then
`lifecycle.py::_admit` refactors ONTO `make_room` with `_evict_resident`
registered as the runner's evictor — one policy home; the runner's
`models_max` check switches to `count(kind="llm")`. Tests: arbiter unit tests
for make_room (protected kinds, foreign-kind eviction executes the owner's
fn, kind-scoped count); the existing lifecycle admission tests must stay
green unchanged — that is the no-regression proof.

**Step 2 — JV: unify the engine-load doors (prerequisite #2, finding P5-2).**
`render_core.py:192-197` stops calling `engine.load("auto")` directly and
calls `EngineManager.load()` like every other door (captures already does:
`captures_api.py:57`). After this, `EngineManager.load()` is the ONE place an
engine loads — where policy and reservation live. Verify by grep: no
`\.load("auto"` outside the manager.

**Step 3 — JV: device policy + reservation in `EngineManager.load()` (gates:
Q1, Q2, Q5).** In order inside `load()`:
1. Resolve device: explicit request wins → else the per-engine device SETTING
   (new `settings.engines.engine_overrides[id].device`, values
   auto|cuda|cpu — the settings law home) → else `auto` policy:
   `cpu_adequate` manifest flag → "cpu"; otherwise "cuda" if the kit's
   hardware detect sees a card, else "cpu". ALWAYS pass the resolved device
   down explicitly (precedent: the runner's #274 embed placement,
   `lifecycle.py:1930-1934`) — never let torch/sherpa auto decide again.
2. `cpu`-resolved → load, NO reservation (the ledger never sees it).
3. `cuda`-resolved → admission: needed = manifest `vram_min_mb`; margin =
   the runner config's existing `safety_margin_mb` (P5-4, no new knob);
   if `needed + margin > remaining_mb` → `make_room(needed+margin,
   protected_kinds=busy kinds)`; make_room False → honest 409/400 "won't fit
   — <what is resident and busy>" (TTS/STT have no auto-offload net).
   On successful spawn: `reserve(key=f"{kind}:{engine_id}", vram_mb=needed,
   kind=kind, evict_fn=<manager unload of this engine>)`. `release()` on
   unload/kill/failure — audit every exit path (the F1 lesson: a reservation
   nobody releases is a lying ledger).
4. Manifest edits: add `cpu_adequate: true` to kokoro (certain); judge
   luxtts at wiring by the real-time-on-CPU criterion; whisper per its
   variants (P5-1 — flag is per-engine now, per-variant override is the
   recorded later refinement).

**Step 4 — busy flags (gates: Q1's invariant).** llm-busy lives in the KIT at
the dispatch layer — increment/decrement around `chat`/`stream_chat` bodies
(covers every consumer including JustWrite, which inherits the same-kind
mid-run-eviction fix for free; the arbiter grows
`set_busy(kind)/clear_busy(kind)` or a counter API the dispatch calls).
tts/stt-busy live at the JV manager's synth/transcribe choke points. Admissions
pass the busy set as `protected_kinds`.

**Step 5 — JV: the visibility surfaces (gates: Q3, Q4).**
One JV endpoint (e.g. `GET /v1/engines/vram`) returning the arbiter snapshot
(now kind-tagged) + the CLAIM: resolve the production route; if it resolves to
the local runner → measured `vram_total_mb` for that model+machine if a
measurement exists, else `compute_fit` on the on-disk gguf, else
`{claim: null, reason: "not downloaded"}`; cloud-routed → no claim (P5-5 —
both sources verified). The Speech-engines tab renders the budget strip
(total · TTS/STT in use · AI model on demand · free) from it, and per-engine
cards get the "won't fit next to what's resident" hint from the same numbers.
Eviction toasts: emitted at the eviction sites, naming victim and cause, both
directions (Q3 — event-driven honesty; NO predictive load-time warnings).

**Step 6 — JV: warm-boot flip (gates: Q6).** `llm_bootstrap.py:34-36` stops
seeding `warm_default_on_startup` to "0" (seed "1" or stop seeding — kit
default is ON). Seeds-only rule: reaches FRESH databases; existing DBs keep
their stored value until reset or the user flips the existing engine-config
toggle. Last step on purpose: warm-boot is only safe once admission exists.

**Step 7 — JV: engine-grouped chapter synthesis (gates: Q7; independent of
1-6, can ride or follow).** In the chapter render, iterate the CACHE-MISS
lines grouped by resolved engine (order within a group by position), store
results position-indexed, assemble exactly as today
(`render_chapter_api.py:250-264` is collect-then-assemble, verified). One
engine load per engine per chapter. Batch-across-chapters grouping = later.

**Gates for the whole wiring:** kit pytest (arbiter + lifecycle) · JV pytest
(new admission/policy/endpoint tests + the 426 existing) · JV vitest + smoke ·
JW 573 + smoke (dispatch-layer busy touches the kit) · docgen trio ·
check-family. SCREEN acceptance (the convention's rule): load kokoro → strip
shows CPU, zero VRAM booked; load a GPU engine with the LLM idle-resident →
eviction toast + strip updates; run Analyze mid-render → render survives,
analyze completes (slow ok); the budget strip's four numbers visible on the
Speech-engines tab.

**Explicitly NOT in this wiring (recorded so it stays out):** multi-resident
engines / synth routing (Q8 — only if one-swap-per-engine-per-chapter still
hurts) · NVML measured TTS footprints (IDEAS) · per-variant cpu_adequate ·
batch-level grouping (SUPERSEDED by §7 — Q7 reopened queue-wide) · cross-APP
arbitration (design §7.2 exclusion stands).

## 7 · Q7 reopened — the grouping sweep (2026-08-08, go given)

Decisions round 2 closed Q2 (*"q2 ok"*) and Q5 (*"q5 your rec"*) and REOPENED
Q7 with: *"this was suppored to already be done the grouping so that anything
synthized by engine got grouped together, that is not just chapters but if you
runn multople chapters it need to take wahter is being run or queed to be run
and gourp it effectiantly, you need to think on this again and show me what
you find."* Sweep go given after a mid-turn stop (*"go and finis anwwering
quesitns"*). Everything below is code-verified this session.

**Finding 1 — nothing groups anywhere today.** The complete producer
inventory — every surface that synthesizes more than one line, each verified
strictly sequential in script order, zero grouping:

| Producer | Path | Order |
|---|---|---|
| Studio scene render | `/v1/render_chapter` scene mode, `render_chapter_api.py:249-262` | block position |
| Audiobook M4B assembly | `export_audiobook.py:83-103` → `render_scene_to_wav` per scene | scene → block position |
| Game voiceline ZIP | `export_voicelines.py:53-107`, whole project block-by-block | scene → block position |
| Lines "Re-render N changed" | CLIENT loop `LinesView.vue:113-149` → `POST /v1/blocks/{id}/render` per line (`takes_api.py:281`) | staleLines order |
| Single doors (Generate tab, take re-roll, MCP speak, dictation replay, captures) | one line each | not groupable |

Every producer funnels into `render_core.render_line` →
`engine.load("auto")` per line (`render_core.py:192-197`) + the manager's
one-slot-per-kind rule (`manager.py:1307-1317`) — a mixed-engine cast swaps a
full model load at EVERY engine crossing, and two concurrent producers
interleave at line granularity (the manager RLock serializes slot mutations,
nothing serializes or orders JOBS).

**Finding 2 — the user's memory is right: batch orchestration was promised,
twice, and never built.**
1. **The design freeze shipped the queue's TABLES and never the orchestrator.**
   `RenderJob` + `RenderJobBlock` (`database/models.py:330-364`, born in the
   v1.0 design-freeze commit `de592a7` per DESIGN_FREEZE §3.7 "resumable
   scene/project renders — full-implementation persistence"): scope
   project|scene|blocks, queued/running/paused/… statuses, per-block rows for
   retry-only-failed. Grep truth: referenced ONLY in `database/__init__.py`
   exports — no endpoint creates a job, no worker drains one. Dead tables in
   every DB.
2. **Decision 13 of the 2026-06-20 shared-ai-stack plan promised job-level
   render/batch settings** — "render/batch (device, parallel workers, compile
   codec, sub-batching min/length-ratio/max-items [0=auto-VRAM], batch seed)"
   (`docs/plans/archive/2026-06-20-shared-ai-stack-plan.md:469-476`), repeated
   in the kit's master plans (`2026-06-27-MASTER-PLAN.md:159`,
   `2026-06-28-MASTER-PLAN.md:4635,4921` — "TTS Lab … render/batch +
   merge-timing"). Grep truth: `sub_batch|parallel_workers|batch_seed|
   length_ratio` → zero code hits; the surface existed as a preview mock only
   (commit `9221535`).
3. The 2026-06-24 competitor research recommended sub-batching + context
   preservation; IDEAS records both unbuilt (4 of its 21 ideas ever built).

**Engine-GROUPING itself appears in no plan before this document** (docs grep:
only engine-LIST UI grouping; git log: no grouping commit). So "supposed to
already be done" = the RenderJob orchestrator + the Decision-13 batch
settings — both real recorded debts; queue-wide engine-grouping is their
correct generalization, first designed here. Same debt family, also found:
Generation's active-status machine ("queued|loading_model|generating",
`models.py:269`) is written by NOBODY — both creators write
status="completed" directly (`takes_api.py:305-315`, `mcp/tools.py:210-218`),
so `active_tasks_api.py:51` filters on states that never occur.

**Finding 3 — the design.** The user's words define the requirement:
*"take whatever is being run or queued to be run and group it efficiently"* —
cross-request, queue-aware. Two honest shapes:

- **Option A — per-request sort only.** Each multi-line entry point iterates
  its own cache-miss lines engine-major; the Lines client loop sorts by
  engine. Cheap, no new state — but two concurrent producers still interleave
  and thrash, and it cannot see "whatever is queued". Fails the requirement
  as stated.
- **Option B — one synthesis scheduler (REC).** One server-side worker owns
  ALL multi-line synthesis. Producers submit line-SETS; the drain policy is
  engine-major across the whole pending pool: stay on the loaded engine until
  no pending line anywhere needs it, then switch (LRU/FIFO across engines;
  within a set, position order; results keyed by position so assembly order
  never changes). Two stages:
  - **Stage 1 — the scheduler core.** In-process pending pool + one drain
    worker + engine-major policy. `render_chapter`, M4B assembly and the
    voiceline ZIP submit their sets and WAIT (their synchronous
    request→response contracts don't change). Concurrent producers now
    group globally. Interactive singles (Generate tab, take re-roll,
    dictation) ride the same scheduler with an interactive priority class:
    they jump the queue at the next LINE boundary — if their engine is
    loaded, zero cost; if not, one engine swap is the price of a live user,
    and the batch's group resumes after. This REPLACES wiring step 7 and
    slots after steps 1–4: the worker is where tts-busy naturally lives, and
    admission (make_room) happens at group boundaries — one admission per
    engine per drain cycle instead of per line.
  - **Stage 2 — resurrect RenderJob/RenderJobBlock as the persistent face.**
    Long jobs (Lines re-render, whole-project render) become real queued jobs
    with per-block status — retry-only-failed, survive restart, honest
    cancel/pause — and the LinesView client loop retires (one POST creates a
    job; the kit task strip shows n/m from job polling; per-line failure
    isolation, which the IDEAS game-residue list already demands). Stage 2 is
    the design-freeze debt paid; it can follow Stage 1 as its own task.

Distinct and NOT this: Decision 13's **sub-batching** is within-one-engine
batch-synthesis perf (padding waste), not cross-engine ordering — it stays
unbuilt/IDEAS and must not be conflated with grouping. Q8 (multi-resident
engines) stays parked: grouping cuts swaps to once-per-engine-per-drain-cycle,
which is the cheap 90% of the win.

**Q7 state: findings delivered; the REC (Option B, staged) awaits the user's
word. No code.**

## 7b · Second pass on the scheduler design (2026-08-08, ordered: *"think on the desing again"*)

Every claim verified in code this pass. One pass-1 statement corrected, one
live defect found, one large simplification found, the policy concretized.

**P2-1 — LIVE DEFECT: synthesis endpoints block the ENTIRE server.** The
synth endpoints are `async def` with fully synchronous bodies —
`render_chapter` (`render_chapter_api.py:224`), `render_block`
(`takes_api.py:282`), `generate` (`generate_api.py:118`) — and the engine
call under them is sync HTTP (`EngineProcess.post` returns a sync
`httpx.Response`, `manager.py:999`). An `async def` body runs ON the event
loop, so a chapter render holds the loop for its full duration: every other
request — UI polls, cache-stats, health, even ACCEPTING an Analyze — stalls
until it finishes. Two consequences:
- §4's mid-render-Analyze story is impossible at the transport layer TODAY —
  the render holds the loop, the Analyze request is never accepted. The
  scheduler (P2-5) is what makes §4 real, not just polite.
- Pass 1's "two concurrent producers interleave at line granularity" was
  IMPRECISE: whole-request producers (chapter/M4B/ZIP) monopolize the loop
  and serialize accidentally; only per-line-request producers (the Lines
  client loop, singles) interleave between each other's requests. The thrash
  that provably exists today is WITHIN any sequential mixed-engine flow;
  cross-producer thrash exists only between per-line-request flows.

**P2-2 — SIMPLIFICATION: the render cache is the hand-off; the scheduler
needs NO result plumbing.** All three production render paths go through
`render_line(use_cache=True, cache_scope="scene:<id>")` — the chapter loop
(`render_chapter_api.py:251-262`), the M4B scene renderer
(`render_chapter_api.py:304-318`), and `_render_block_production`
(`export_voicelines.py:135-143`, verified this pass) which serves BOTH the
Lines per-block door and the voiceline ZIP. The cache is a bounded in-memory
hot tier over a durable DISK tier with **no automatic disk eviction**
(`cache.py:96-135` — "Evicting a hot entry has NO side effects: put() writes
disk"; pruning is a user action via `cache_api`). Therefore Stage 1 is a
**warm pass**: the worker renders pending line-specs engine-major INTO the
cache and signals set completion; the producer then runs its existing
assembly loop unchanged and gets cache hits. No bytes cross the scheduler
boundary. If the user prunes mid-flight the assembly loop re-renders misses —
self-healing, merely slower. Duplicate line-specs across concurrent sets are
ALLOWED (the second is a cache hit, or in a race a wasted render — correct
either way; no refcounting machinery).

**P2-3 — the M4B case requires WHOLE-SUBMISSION grouping.** `assemble_project`
renders scene-by-scene (`export_audiobook.py:83-103`); with engines A+B in
the cast, per-SCENE grouping still pays 2 loads × N scenes. The submission
unit must be the whole workload — all scenes' cache-miss lines in ONE set,
grouped pool-wide (2 loads total), with per-scene assembly reading the cache
afterward. The original step-7 rec (per-chapter grouping) was insufficient
even for the single-producer book case — the reopening was right on the
merits, not just on scope.

**P2-4 — the drain policy, concretized (no starvation, no knobs).** At each
engine-switch decision: take the engine of the OLDEST pending line (FIFO —
starvation impossible), drain ALL pending lines pool-wide for that engine
(newer sets free-ride — the grouping win), repeat. Interactive singles jump
at the next line boundary regardless of engine — a live user beats batch;
the cost is one swap, toasted. Recorded risk, accepted without a knob until
practice says otherwise: a user repeatedly previewing takes on a foreign
engine mid-batch causes swap-per-preview by their own hand.

**P2-5 — the transport fix rides Stage 1.** Submit-and-wait endpoints await
an asyncio-wrapped completion future while the worker THREAD synthesizes —
the event loop frees. For the first time: UI stays live during renders,
Analyze can start mid-render (§4 becomes real), and server-side cancel
EXISTS — client disconnect cancels the awaiting coroutine, which withdraws
the set's pending lines at the next line boundary (today a chapter render is
uncancellable and unwatchable).

**P2-6 — the freed loop FORCES the synth-door unification.** Today's
accidental loop serialization is load-bearing: it is the only thing
preventing one request's engine LOAD from terminating the engine subprocess
mid-synth of another request (the manager's one-slot load terminates the
prior occupant, `manager.py:1307-1317`, and nothing else excludes
synth-vs-load). Freeing the loop removes that accident, so EVERY synthesis
must funnel through the scheduler — singles (Generate tab, take re-roll, MCP
speak, dictation replay) become one-line interactive sets, and the inventory
gains a sixth door found this pass: voice previews synthesize directly
(`voice_preview_api.py:168` in-process, `:254` managed path) and must funnel
too. Stage 1 thus mirrors wiring step 2 exactly: step 2 made
`EngineManager.load()` the one LOAD door; Stage 1 makes the scheduler the one
SYNTH door. STT/transcription stays outside (different slot kind, inherently
sequential dictation flow); training is not synthesis and stays out.

**The design after pass 2 (shape unchanged, mechanics sharpened):** one
`SynthScheduler` — a worker thread + a pending pool of line-specs tagged
(set-id, priority, submit-order). Producers submit a set and await its
completion signal; assembly code paths do not change at all (P2-2). Policy
per P2-4. tts-busy = "worker is synthesizing" (step 4 merges here);
admission/`make_room` runs at engine-switch boundaries — once per engine per
drain cycle. Server restart loses in-process sets exactly as it loses
in-flight renders today; persistence is Stage 2's RenderJob resurrection,
unchanged. Not changed by this pass: Option B over A, the two-stage split,
sub-batching stays out (IDEAS), Q8 stays parked.

## 7c · Third pass (2026-08-08, ordered again: *"think on it again"*)

No reversals — the shape holds a second pass running. Three corrections, two
rejected alternatives put on record.

**P3-1 — Stage 1 does NOT depend on the VRAM wiring; it can ship FIRST.**
Earlier passes slotted the scheduler "after wiring steps 1–4". Wrong: the
scheduler core (pool, worker thread, submit-and-wait, engine-major drain)
touches no arbiter machinery — the worker calls today's
`render_line`/auto-load unchanged. The VRAM wiring later plugs admission and
tts-busy INTO the scheduler's engine-switch points (its steps 4 and 7
simplify onto it). Either order works. REC: scheduler first — it removes the
user-facing pain (the server freeze, the swap thrash) and the wiring then
lands on cleaner ground.

**P3-2 — honest gap: the Lines re-render is NOT grouped in Stage 1.** The
client loop fires one REQUEST per line (`LinesView.vue:113-149`); each
arrives as a one-line set, so the pool never sees the batch. A cheap bridge
(batch endpoint + progress polling) would rebuild half of Stage 2 without
its persistence — rejected. The gap is accepted and named: mixed-engine
stale sets keep today's per-crossing swaps until Stage 2. That gap is why
Stage 2 is debt payment, not polish.

**P3-3 — funnel refinement: the one-synth-door rule covers MANAGED engines.**
External provider engines (remote APIs — no local process, no GPU, no slot)
have nothing to kill and nothing to group: their SINGLES stay direct. Lines
inside submitted sets pool regardless of engine — an external engine is just
a zero-swap-cost group. The preview doors split the same way:
`voice_preview_api.py:254` (managed synth) funnels; `:168`
(in-process/external) stays direct.

**Rejected alternatives (recorded so they stay rejected):**
- *"Just make the endpoints `def` — the freeze fix is one keyword."* The
  threadpool frees the loop, and freeing it WITHOUT the scheduler immediately
  creates the load-terminates-engine-mid-synth race (P2-6: the accidental
  serialization is load-bearing) plus cross-producer thrash. The cheap fix is
  the dangerous fix.
- *"A manager-level synth/load lock instead of funneling singles."* The lock
  prevents the kill but buys no cooperation: a direct single still forces
  slot swaps against a running drain. The funnel makes it jump at a line
  boundary instead.

**Also checked, fine as designed:** no reentrancy (the worker never
submits) · DB sessions are held across the await no longer than today's
blocking render holds them · one worker = today's effective synth
concurrency, no throughput regression (parallel rendering of external-API
lines is a possible later refinement, noted NOT built) · no new tunables
(the settings law holds — the drain policy is fixed) · Stage 1 changes no
API shape and touches no user-facing docs (Stage 2's job UI will).

Convergence: pass 3 produced ordering and scope corrections only.

## 7d · Build-prep discovery (2026-08-08, Stage 1 go given): render_line has NO local-engine door

Tracing the funnel targets before wiring found the deepest debt of the whole
think: **the production render path cannot render local engines at all.**
`state.engines` — the registry `render_line` drives — registers ONLY external
cloud providers (`app.py:438` boot + `external_api.py:140` runtime; grep: no
other `.register(` call in the tree). Every built-in engine became a managed
plugin, and the removal note is right in the boot code (`app.py:415-424`:
"The legacy in-process engine factory was removed") — but no managed adapter
was ever put back into the registry, and `render_line` was never retargeted.
`_resolve_engine_for_voice` RESOLVES managed ids fine (its third pass reads
manifest `static_voices`), then `render_line` does
`state.engines.get(engine_id)` → `None` → `not_found("engine …")`
(`render_core.py:160-162`) — BEFORE the auto-load branch can ever run.

Verified consequences:
- Chapter render, M4B export, QC, the voiceline ZIP, the Lines re-render,
  and the take re-roll — every `render_line` caller 404s for EVERY
  local-engine voice. These paths only ever worked with external cloud
  voices. (§4's "the first line rendered auto-loads that voice's engine" was
  WRONG — the branch at `render_core.py:192-200` exists but is unreachable
  for managed engines; the earlier read missed the registry-membership gate
  above it.)
- The new-voice preview door breaks identically
  (`voice_preview_api.py:134` registry lookup → 404 for managed
  clone/design previews). The row-audition door is fine (it routes through
  generate's manager path).
- The single-line `/v1/generate` door is fine — it has its own managed
  routing (`_generate_via_manager`), which is why singles work and the app
  demos fine while the entire multi-line render family is broken for the
  engines the product is FOR.
- The test suite never caught it because every render test either drives the
  resolver directly or injects a fake backend INTO the registry
  (`test_render_chapter_scene_mode.py:34-44`) — the fake occupies exactly
  the slot production leaves empty.
- P5-2 is re-framed: the render_core "second load door" has never loaded a
  local engine. The door unification is not a refactor of a working path —
  it is the FIX for a dead one.

**Stage 1 therefore opens with the managed bridge** (this IS wiring step 2's
render_core half, landing early): `render_line` + `probe_line_cached` grow a
managed branch — registry hit → today's path unchanged (preserves the test
seam and external engines); else manager manifest → tag-strip per
`manifest.capabilities["paralinguistic_tags"]` (the flag already ships in
every manifest's CAPABILITIES dict — no manifest edits), ensure-loaded via
`mgr.load(id, "auto")` when `current_for(kind)` differs, synth via
`mgr.synth`, cloned-voice reference WAV via the stored-voice resolver moved
into render_core. Cache keys unchanged — managed keys were unreachable, so
nothing can collide.

**Build order inside Stage 1:** (1) managed bridge · (2) manager per-kind
activity guard (synth/transcribe hold their kind's lock around the engine
HTTP call; load/unload acquire it before terminating a prior occupant — the
back-stop that makes every residual direct door safe) · (3) the
SynthScheduler · (4) producer conversions — render_chapter, QC, M4B,
voiceline ZIP (warm sets: awaited but ADVISORY, errors logged not raised —
the existing assembly code stays the sole error surface, so outcomes keep
exact parity and only order/performance change; withdraw-set-on-first-error
kept for abort parity), and the result-bearing interactive singles
(render_block, generate's managed branch, the managed new-voice preview) ·
(5) tests per piece. Known Stage-1 residuals, recorded: engines_api
load/unload runs in its jobs thread (fine) but a direct unload can wait
seconds on the activity lock; captures/STT keeps its loop-blocking async-def
body (same defect class, stt scope, untouched this stage).
