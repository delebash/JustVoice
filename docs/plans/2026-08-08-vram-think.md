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
batch-level grouping · cross-APP arbitration (design §7.2 exclusion stands).
