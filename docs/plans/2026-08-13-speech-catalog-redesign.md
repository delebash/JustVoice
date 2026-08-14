# The speech catalog + memory-truth redesign

**Date**: 2026-08-13 (late, same day the VRAM wiring shipped in `da006bd`).
**Status**: DECIDED in full (all rulings below) — phase ① go given
(*"save in docs in detail and go for coding"*), built, then AMENDED (§10).
2026-08-14: the user's go *"go on everything your rec"* covers the amended
fix set (BUILT — see the stamp at the end of §10), the speed-tables ruling
(cut), and phases ② → ③ → ④ in order under the recs.
**Supersedes in part**: the declared-pricing currency and the budget-strip
cells of the 2026-08-13 VRAM wiring (`docs/plans/2026-08-08-vram-think.md`
§6, STATUS STAMP 2). The wiring's *machinery* — device policy, admission
seam, busy flags, eviction executor, toasts, the endpoint, one-pool arch
handling — stands and is reused. What dies is the *currency* it displayed
and admitted on: hand-declared `vram_min_mb`.

---

## 1. The trigger, and the diagnosis trail

The user loaded chatterbox-turbo (350M parameters) and the new budget strip
showed **4 GB in use**. The chain behind that number, each link verified:

1. `engines/chatterbox/manifest.py:40` declares `vram_min_mb: 4096` — one
   price for the whole engine, both variants.
2. `git blame` pins the number to `de592a7` (2026-06-08, the v1.0 design
   freeze scaffold): **it was invented when the manifests were first
   authored** — not sourced from Resemble, not measured. The same is true of
   every engine's `vram_min_mb` (qwen3 6000 · tada 8000 · dia 10000 · moss
   12000 · whisper 1500 · luxtts 1024). This violated the standing CLAUDE.md
   invariant ("upstream model facts get checked on the web, never
   recalled") at scaffold time, and the VRAM wiring then built on the
   numbers without auditing them.
3. Upstream check (2026-08-13): turbo is ~1 GB VRAM at fp16 per public
   hardware guides; the full pipeline (t3 backbone + s3gen vocoder + voice
   encoder — `engine.py:107` loads all of it) makes the real resident
   number higher than the naive 350M×2 math but nowhere near 4 GB.
4. The wiring booked the declared number (`source="declared"`) and the
   strip labeled the booking "in use".

The user's verdict, escalating across four messages (verbatim): *"that
makes no sense … what is using 4gb if the model is only 350mb"* → *"from a
user perspective this is extremely misleading"* → *"i dont like this booked
reserver too confusing for user … poor design you did on this manager"* →
*"rethink this manager process i do not like it at all rethink this
manifest too"*.

## 2. The root fault

The manifest states **conclusions** (`vram_min_mb`) where it should state
**facts** (weight files, sizes, languages, capabilities), and the manager
displays **plans** (ledger bookings) where it should display
**measurements**. Both are the diseases the family already cured on the LLM
side — the fit redesign's *facts-not-floors* ruling and the 2026-07-11
measured-first inversion of `_trued_up_vram_mb` (whose own docstring records
the identical failure: a wrong estimate wedged the ledger at "19.3/8 GB,
0 free"). The speech wiring ported the *declared arm* of the kit's pricing
ladder without the ladder: on the LLM side declared is the last resort that
measurement replaces on first load; on the speech side it was the only and
permanent currency.

Why three adversarial passes (Fable→Opus→Fable, the vram-think re-check)
missed it: they were scoped to the Q1–Q8 machinery decisions and verified
that the pipes route correctly; the pricing *input* was never on the
question list. The design doc itself said the declared number was "a first
guess — the spawn OOM is the real net" and all three passes accepted that
line instead of challenging it. Verification against a spec cannot catch a
wrong spec.

## 3. How the LLM side does it (the model to port)

Verified in kit code, `runner/lifecycle.py`:

- `_run_load` snapshots used pool memory **before** the load (line ~2207,
  `_probe_used_vram` → `hardware.used_device_mem_mb`, the Phase-4
  backend-aware door: nvidia-smi → rocm → amdgpu sysfs → Windows GPU
  counters on discrete; the used SYSTEM pool on one-pool boxes).
- `_trued_up_vram_mb` (line ~2268) takes the after-minus-before delta,
  floors at the driver-context constant, caps at the pool, and returns
  `(mb, "measured")` — or `(estimate, "computed")` when unmeasurable.
- Line ~2221 reserves **that** number. `_persist_load_footprint` records it
  as a `source='load'` measurement row for future prediction.
- llama.cpp allocates KV at load, so the post-load delta is nearly the
  whole footprint — a fact that does NOT transfer to TTS (see §5, Opus
  finding 2).

## 4. The rulings (user words verbatim)

- **Own catalog, shared feel**: *"the speech can have its own catalog just
  reuse what makes sense to do and desing it so it feels similiar but
  taking into account what is different about speach"*. Not LuModelCatalog
  itself — its own grouped catalog built from the kit's primitives
  (DownloadBar, status-chip mapping, three-dot DropdownMenu pattern, row
  grammar) with the identical verb set (Download · Load · Unload ·
  Re-download · Delete files · default star).
- **No quants, no model-card machinery** (user: *"do we need the model
  card the quants ect, i do not know. what do you think?"* — rec accepted):
  speech variants are one fixed artifact each; a quantized build, if one
  ever exists, is simply another variant row. No add-by-link, no
  add/edit/delete/reset of rows — the engine's pinned code defines the
  catalog. "View on Hugging Face" in the three-dot replaces the card.
- **Cloning distinction**: *"i would like a way to distingush between
  engines models that can do voice cloning vs not"* — `voice_cloning` and
  `preset_voices` become per-variant facts with first-class chips on every
  row (Cloning vs Presets · N), an aggregate on the engine header, and a
  filter row (All · Cloning · Preset voices). Consumers that read the
  engine-level flag today (GenerateView.vue:61 clone-only gating, the
  voices flow) are repointed in the same pass.
- **The full redesign** (the "rethink" order, then *"save in docs in detail
  and go for coding"*): facts-only manifests with `vram_min_mb` deleted
  from the format; measured-first pricing; kit downloader +
  `<data_dir>/speech-cache/`; download-before-load (network leaves the load
  path); strip shows measured reality only; admission on measured free;
  slots stay one TTS + one STT; the manager decomposes along the kit's
  service seams.

## 5. The adversarial pass (Opus, 2026-08-13) — four findings, one improvement

The user ordered a cross-check (*"opus what do you think of this redesing"*
→ *"fable what do you think of opus conclusions"*). All four findings
verified and adopted:

1. **Don't replace an invented 4096 with an invented 1500.** The "~1–1.5 GB
   turbo" figure quoted web numbers as if they settled it — the same sin
   the redesign exists to kill. `engine.py:107` loads the full pipeline
   (t3 + s3gen + voice encoder); "350M" counts the backbone only. The only
   honest number is the measured one; until first load the number is an
   estimate and is **labeled** as one.
2. **Measure-after-load undercounts TTS** — the sharpest catch. llama.cpp
   allocates KV at load; chatterbox allocates during `generate()`
   (engine.py:180), so a post-load delta books weights and misses render
   peak → admission over-admits → OOM mid-render, the exact failure the
   arbiter exists to prevent. Fix: a **raise-only high-water re-probe**
   when the engine leaves busy. Forgiving detail: torch's caching allocator
   never returns freed memory to the driver (the engine calls
   `empty_cache` only at unload, engine.py:134), so device-visible usage
   stays at ~render peak — even a lazy probe after the first render
   captures it.
3. **The attribution race.** The kit's delta is trustworthy because llama
   loads serialize under `_router_lock`; JV engine loads don't share it,
   and a warm-boot LLM load can overlap an engine load — device-wide
   deltas would cross-charge. Fable's amendment (adopted over a shared
   lock, which would couple the two systems' load timing across the app
   boundary): **per-process attribution** — the engine is its own PID.
   Linux/NVIDIA: `nvidia-smi --query-compute-apps` per PID. Windows WDDM
   (where nvidia-smi reports per-process memory as N/A): the per-PID **GPU
   Process Memory** performance counters (`\GPU Process Memory(pid_*)\
   Dedicated Usage` — what Task Manager itself uses; the per-PID sibling
   of the device-wide counter the kit's `_windows_gpu_dedicated_used_mb`
   already reads; localized counter names on non-English Windows make the
   probe fail → fall through). One-pool boxes: engine-process RSS. Fallback
   where no per-process probe works: the device-wide delta, honestly
   labeled `computed`.
4. **Probe cost.** `used_device_mem_mb()` (hardware.py:441) calls
   `detect()` fresh and can shell out to nvidia-smi with a 5 s timeout —
   a 4 s strip poll must hit a short-TTL cache, never the raw probe.

Improvement adopted from Opus: **file sizes, not params**. Hand-typed
`params_m` would be one more number wearing a fact's costume. Weight-file
bytes are verifiable — from disk for already-downloaded engines (no
network), from the HF tree at download time for new ones; fp16 safetensors
bytes map ~1:1 to resident weight bytes. First-load estimate = weight bytes
+ a learned per-engine overhead constant (seeded ~600 MB for torch CUDA
context + allocator slack; refined from measured rows as they accumulate).

Sequencing flip adopted: the measured true-up ships FIRST (it has no
dependency on the downloader work — file sizes come from disk for every
already-installed engine), then downloads/manifest, then the catalog UI.

## 6. The catalog anatomy (phase ③'s spec, decided now)

Two-level, because speech has a level LLMs don't: engine (runtime) →
variants (models).

```
▾ Chatterbox   TTS · installed · Device: Auto (cuda) · [CUDA wheel] [⋮]
    ● Multilingual v2   23 langs · Cloning · MIT     2.6 GB on disk   [Load] ★ [⋮]
    ▶ Turbo             en · Cloning · Tags · MIT    1.9 GB · loaded — 1.1 GB measured [Unload] [⋮]
▾ Kokoro       TTS · installed · Device: Auto (cpu) — fast on CPU
    ● v1.0              8 langs · Presets · 54       ~700 MB  [Download]
```

Engine header: setup/venv state, CUDA wheel switch, Device select, TTS/STT
badge, aggregated Cloning marker. Variant row: name · languages ·
capability chips (Cloning first-class) · license (the kit's use-limited
warning pattern intact — audiobook producers publish commercially) · real
size (HF tree / disk) · status chip (same states as the LLM catalog) ·
DownloadBar with cancel/retry inside it · Load/Unload · default star ·
memory hint ("needs ~X GB" pre-load, "X GB measured" once loaded) ·
three-dot (Re-download · Delete files · Open folder · View on Hugging
Face). A filter row atop: All · Cloning · Preset voices. Dropped
deliberately: quants, add-by-link, row add/edit/delete/reset, Tune &
measure, embedding roles, MTP/mmproj — all LLM-domain machinery whose
reasons don't exist for speech.

What genuinely stays different (the complete list): per-engine venvs (N
conflicting torch stacks vs one pinned binary — same architectural slot as
the kit's `binary.py`, forced different implementation) · engine-scoped
catalog (pinned code defines what runs — no open add-by-link) · voices (no
LLM analog) · slots (one TTS + one STT — policy, kept). Nothing else is
allowed to differ.

## 7. The phases

**① The measured true-up** (GO GIVEN 2026-08-13 — this build):
- Kit `hardware.py`: `process_device_mem_mb(pid)` (nvidia-smi
  query-compute-apps arm → Windows per-PID GPU Process Memory counter arm)
  + `process_rss_mb(pid)` (tasklist / /proc/status / ps arms). Pure-parse
  tests with faked subprocess output.
- JV `manager.py`: probe seams (TTL-cached pool probe; per-PID engine
  probe, discrete=device / one-pool=RSS) · the estimate ladder for a
  never-measured engine (prior measured row → weight-file bytes on disk →
  manifest size_mb, + overhead seed) · admission reworked onto **measured
  free** (`make_room(want + unledgered_foreign_usage)` so ledger-remaining
  targets account for other apps; unmeasurable boxes fall back to ledger
  remaining) · the load door true-up (probe engine PID after confirmed
  load, reserve measured, `source="measured"`; probe miss → estimate,
  `source="computed"`) · high-water raise-only bumps at synth/transcribe
  completion (TTL-absorbed) and the scheduler's busy→idle transition ·
  measurement rows persisted to the kit measurement store under namespaced
  ids (`tts:<engine>:<variant>`; API verified id-agnostic) · `vram_min_mb`
  DELETED outright — the field and all seven manifests' values, in phase ①
  (the user's mid-build check: *"vram_min_mb i thought this was inventied
  and not going to be used?"* — a dormant lying field violates
  removed-means-removed; grep-receipted zero code readers).
- Endpoint: `used_mb` (measured pool), `other_mb` (used − committed,
  clamped), reservations carry measured numbers + source (wire model
  already has `source`).
- Strip: "{used} of {total} used · {free} free" measured · per-engine rows
  with measured GB + "~ estimate" badge when source ≠ measured · AI-model
  cell keeps the kit claim (already measured-first) · "Other apps" row ·
  busy chips and toasts unchanged · "Speech in use"/booked phrasing dies.
  Card hint: "needs ~X GB (estimate)" replaces any vram_min display.
- Docs in the same change: gpu.md budget section rewritten to the measured
  story; the invented per-engine VRAM table replaced.

**② Downloads + facts-only manifests** (needs go): kit downloader grows the
generic per-file acquire (explicit file list / whole repo at pinned
revision; the GGUF-specific `select_files` stays for LLMs); files land in
`<data_dir>/speech-cache/<engine>/<variant>/` with a written file-manifest
(names+sizes+oids) as on-disk truth; engine subprocesses receive local
paths and never touch the network (kills WinError 1314 structurally + the
modelOnDisk folder heuristic); manifests split into adapter (runtime) +
per-variant facts rows (languages, capabilities incl. cloning, license,
repo+revision+files); `vram_min_mb` and hand-typed `disk_space_mb` deleted;
`cpu_adequate`/`gpu_runtimes` stay (device policy facts).

**③ The catalog UI** (needs go): §6's anatomy; kit primitives promoted
where generic; consumers of engine-level capabilities repointed to
per-variant.

**④ Locations + verbs** (needs go): data-dir convergence on the JW shape
(`platformdirs.user_data_dir("JustVoice")` → Local, one function;
JUSTVOICE_DATA_DIR/--data-dir unaffected); per-store clear verbs (LLM
cache · speech cache · render cache) in one grammar; venv location decided
here (rebuildable runtime, not user data).

## 9. STATUS — phase ① BUILT 2026-08-13/14 (same session), then AMENDED by
## the second rethink (§10). Read §10 before touching this code.

What is in the tree (uncommitted at first record, committed with this doc):

- **Kit `hardware.py`**: the per-process probe family after `budget_total_mb`
  — `_nvidia_process_mem_mb(pid)` (query-compute-apps; WDDM prints [N/A] →
  falls through), `_windows_gpu_process_dedicated_mb(pid)` (per-PID
  `\GPU Process Memory(pid_*)\Dedicated Usage` typeperf counters — what Task
  Manager uses; vendor-neutral WDDM infrastructure; localized Windows →
  None), `process_device_mem_mb(pid)` (the door), `process_rss_mb(pid)`
  (psutil → tasklist CSV → /proc/status VmRSS → ps -o rss=). Tests in
  `tests/test_hardware.py` (parse fixtures + routing + live RSS sanity;
  suite 24 green).
- **JV `engines/manager.py`**: consts `PROBE_TTL_S=2.0` /
  `ENGINE_OVERHEAD_SEED_MB=600` / `WEIGHT_FILE_SUFFIXES`; `_probe_cache` in
  __init__; `pool_used_mb` (TTL-cached kit used_device_mem_mb);
  `_engine_proc_mb` (per-PID, one-pool→RSS discrete→device, TTL);
  `_prior_measured_mb` (kit measurement store `get_model_measurement_store`,
  ids `tts:<engine>:<variant>`, machine-key filtered, MAX across variants);
  `_weight_files_mb` (disk weight files, `blobs` dirs excluded, fallback
  manifest MODELS size_mb); `_estimate_engine_mb` (ladder);
  `_admit_memory(m, kind, id, needed_mb)` (measured-free basis: free =
  budget_total − pool_used; short → make_room(want + foreign) where foreign
  = used − committed; then a ≤4 s settle re-probe loop; unmeasurable →
  ledger arithmetic; honest refusal quotes measured numbers);
  `_reserve_engine(m, kind, mb, source)`; `_record_speech_load` (store
  record, source="load", vram_model_mb, kind tts|stt);
  `bump_engine_reservation(kind, fresh=)` raise-only high-water +
  `bump_engine_reservation_async` (daemon thread — the probe can shell
  ~1 s); load door: estimate → admission → spawn → POST /load → true-up
  (probe → reserve measured + persist; miss → estimate as computed);
  synth/clone/transcribe call the async bump; `synth_scheduler.py`
  `_set_busy_locked(False)` spawns a fresh-bump daemon thread.
- **Wire + endpoint**: `EngineVramResponse.used_mb/other_mb`;
  `/v1/engines/vram` returns them (TTL probe, other = used − committed).
- **UI `SpeechEnginesTab.vue`**: strip = "{used} of {total} used" + Free +
  one cell per tts/stt reservation (name via engines list; `~` prefix +
  estimate tooltip when source ≠ measured) + AI-model cell + "Other apps"
  (>256 MB) + Busy; `budgetTitle` lists holders incl. other; variant row
  span "needs ~X {mem} (est.)".
- **`vram_min_mb` DELETED from all seven manifests** (user's mid-build
  check; grep-receipted zero code readers; IDEAS' parked NVML entry deleted
  — this build IS it).
- **Tests**: `test_engine_vram_wiring.py` REWRITTEN — 24 green (estimate
  ladder ×3, true-up measured + probe-miss-computed, high-water
  raise-only, measured-free admission ×2 incl. foreign-usage refusal +
  evict-then-settle, plus the surviving device/booking/busy/endpoint pins);
  `test_engine_activity_guard.py` `_bare_manager` += `_probe_cache`.
- **Docs**: gpu.md budget section rewritten to the measured story (§10
  strikes one sentence of it); engines.md loading sentence updated.

Gates at record time: kit ruff + hardware tests green, JV ruff + wiring
tests 24 + vitest 48 + biome green; full suites re-run at commit (see the
commit message for the final tally).

## 10. THE SECOND RETHINK (2026-08-14, same session) — the amended design.
## This SUPERSEDES §5's estimate ladder and parts of §7-①. Not yet built.

The user caught me mid-build treating the SECOND nest of invented numbers
(`engines/model_catalog.py` per-variant `vram_mb`, feeding the variants
dropdown + `recommend_for_vram`) differently from the first — "~(est.)"
labels instead of deletion — and ordered a full rethink (*"rethink the
desing if you are screwing this up mid code then what else in the desing
did you nad opus get wrong??"*). The rethink + a second Opus adversarial
pass (this time EMPIRICAL — run against the real box, the real files, the
real loader) found:

**Fable's rethink findings** (each code-verified): the design never ran a
complete INVENTORY of memory-number sites (the error class); the second
nest; my own gpu.md edit stating "Chatterbox-Turbo measures around
1–1.5 GB" — an unmeasured number written into user docs WHILE purging that
disease (Opus had explicitly warned "an invented 1500 in a smaller font");
engines.md's strip sentence stale; manifest `size_mb` claims unverified
and one provably wrong (turbo declares 2200 MB, the real snapshot is
~3.9 GB on disk); the admission→booking window (JV admits, loads for
seconds, books only after the 200 — a concurrent runner load admits into
the same freed memory; the runner has the mirror half — it also books only
after its load confirms; NEITHER adversarial pass had caught this); a
high-water bump/unload race (severity later corrected by Opus: the
`cur is not None` guard covers all but a microsecond window — hardening,
not a bug).

**Opus's empirical findings** (all verified by me, then extended):
1. **The estimator produces 4,455 MB for turbo** — WORSE than the deleted
   4,096: the snapshot's weight files sum to 3,855 MB + the 600 seed. Root
   causes proven by reading the actual loader (`tts_turbo.py`): turbo loads
   `ve` + `t3_turbo_v1` + `s3gen_meanflow` and NEVER loads
   `s3gen.safetensors` — repos ship alternative checkpoints that never
   co-load, so file sums overprice; and no dtype cast exists, so the
   fp16-bytes≈resident-bytes assumption is unverified too. A file's size
   is a fact; a file's size predicting VRAM is a model with unpriced error
   terms.
2. **The mechanism had never run against a real engine** — so I ran it:
   spawned a 1 GiB CUDA child through the shared venv and probed it.
   RESULT: **the launcher-shim bug.** uv's venv `python.exe` on Windows is
   a TRAMPOLINE — the Popen pid is a 4 MB shim; the real interpreter
   (`F:\Python312\python.exe` as its CHILD) holds the memory. Probing the
   Popen pid: device None, RSS 4 MB. Probing the child:
   **device = 1131 MB via the WDDM typeperf arm (proven working on a real
   CUDA process), RSS = 509 MB.** As built, production would book
   "computed" forever on discrete Windows and FOUR MEGABYTES on one-pool.
   Fix: probe pid + descendants, summed. POSIX venvs symlink (pid already
   real; walk is a no-op).
3. **`recommend_for_vram` picks which variant to DOWNLOAD**
   (`engines_models_api.py:99`, also `models_api.py:96`) — zeroing the
   invented numbers without replacing the picker makes best_fit collapse
   to biggest-checkpoint-always. My "breaks nothing visible" checked
   rendering, not behavior.
4. **Scaffold placeholder junk on disk**: `models/chatterbox-multilingual-
   v2/` holds a 4 KB model.onnx + 8 KB voices bin — folder-non-empty
   heuristics read it as "downloaded".
5. **Opus's design change, ADOPTED after the experiments made it
   inarguable: THE PRE-LOAD ESTIMATE DIES ENTIRELY.** On this very box
   (5.1/8 GB used) the 4,455 estimate + margin would have EVICTED the warm
   LLM to fit a phantom; with no estimate the load fits the free 3 GB
   untouched and gets measured. New ladder: a PRIOR MEASURED number on
   this box admits AND BOOKS EARLY (closing JV's half of the
   admission→booking window for every known engine); a FIRST-EVER load
   gets NO arithmetic — no admission, no invented number, no eviction on
   its behalf: attempt, measure (real pid), book, persist. Strip/card say
   "not measured yet". A genuinely-too-big first load fails with an
   honest CUDA OOM that strikes only the newcomer process — slow-but-
   honest once per engine per machine. `ENGINE_OVERHEAD_SEED_MB` and the
   file-sum estimator die with it; `size_mb` remains download-size display
   only; phase ②'s pinned file lists power a DOWNLOAD-time size warning
   (real facts at the right decision point).

**Platform coverage** (the user's question, answered + one gap exposed):
Windows all vendors ✓ (GPU Process Memory counters are vendor-neutral
WDDM infrastructure; the shim fix is Windows-only which is where the shim
lives). Linux NVIDIA ✓ (query-compute-apps is real there; symlink venvs).
Linux AMD: NO per-process arm (rocm/amdgpu are device-wide) → **the
DEVICE-WIDE DELTA FALLBACK must now actually be implemented** — the built
code's probe-miss path fell back to the estimate, which is being deleted
(snapshot used before load → delta after → book, honestly labeled when a
concurrent runner load could pollute it; KFD sysfs per-pid recorded as an
idea). Mac ✓ RSS on the one-pool ledger (symlink venvs, ps arm exists);
CAVEAT for the laptops walk: whether MPS/Metal buffers fully appear in
plain RSS is unverified — chatterbox is CPU-forced on macOS anyway.

**THE AMENDED FIX SET** (go given 2026-08-14, *"go on everything your
rec"* — BUILT the same day; the stamp with the as-built detail follows the
list):
1. Pid fix: probe pid + descendants, summed (kit or JV helper — decide at
   build; the child-enumeration needs a Windows arm (CIM/wmic) + POSIX).
2. Delete the pre-load estimate per finding 5 (admission first-load
   branch, strip "not measured yet", card wording; rework the affected
   tests).
3. Implement the device-delta fallback for probe-miss boxes (AMD Linux).
4. Delete `model_catalog.py`'s `vram_mb` values + the UI "needs ~X (est.)"
   span (fitBadge dies naturally) + REPLACE the install picker: manifest
   `DEFAULT_VARIANT_ID`, else smallest-by-size.
5. gpu.md: strike the "measures around 1–1.5 GB" sentence; "not measured
   yet" story.
6. Bump occupant re-check (hardening).
7. Tracker/doc records: the kit-side booking-gap half (runner books after
   load — needs its own kit go), size_mb wrongness, placeholder junk,
   MPS-RSS walk item.
8. STILL OPEN, user ruling needed: the unsourced SPEED tables (gpu.md CPU
   realtime factors; engines.md GB→engine pairings) — verify on the web or
   cut until measured.

**BUILT 2026-08-14** (the go: *"go on everything your rec"* — one word
covering the fix set, the speed-tables cut, and phases ②–④ in order). The
as-built record, item by item:

1. **Tree probing (kit)**: `hardware.py` grew `_nvidia_procs_mem_mb(pids)`
   (one query covers a whole pid set; the single-pid door delegates),
   `_pid_ppid_pairs()` (wmic — columns print ALPHABETICALLY, flip — →
   PowerShell CIM on Windows; one `ps -e` on POSIX), `_tree_from_pairs`
   (cycle-guarded walk; Windows pid reuse fabricates parent cycles),
   `process_tree_pids` (psutil recursive-children first),
   `process_tree_device_mem_mb` (nvidia set-query, else the WDDM counter
   arm per pid) and `process_tree_rss_mb`. JV `_engine_proc_mb` probes the
   TREE doors. 8 new kit tests (suite 858).
2. **The estimate is dead**: `_estimate_engine_mb`, `_weight_files_mb`,
   `ENGINE_OVERHEAD_SEED_MB`, `WEIGHT_FILE_SUFFIXES` deleted. The load
   door: prior measured → `_admit_memory(prior)` + `_reserve_engine(prior,
   "measured")` BEFORE the spawn (the early booking; a new `except` arm
   releases it on any failed/cancelled load — the non-200 path already
   did); first-ever load → no admission, no number. Strip cells say **not
   measured yet** (built from loaded engines joined with reservations, so
   an unbooked loaded engine is visible; CPU-on-discrete engines show no
   cell by policy); the dead `speechInUseMb` "booked" div and its
   `.ev-vrtotal` class died too.
3. **Device-delta fallback**: `pool_before` snapshot at the door (after
   admission's settle), `after − before` booked as `"computed"` on a
   post-200 tree-probe miss — only when no early booking exists (a prior
   measurement beats a pollutable delta), and NEVER persisted to the
   measurement store.
4. **The second nest is dead**: every `vram_mb=` in `model_catalog.py`
   deleted + the `ModelVariant.vram_mb` field; `recommend_for_vram`
   REPLACED by `default_variant_for` (the manager's resolved default —
   user override → manifest `DEFAULT_VARIANT_ID` → on-disk → first — else
   smallest download); the `/v1/engines/{id}/models/recommended` endpoint
   + `RecommendedResponse` DELETED (its only renderer read was a field it
   never returned); the UI "needs ~X (est.)" span, the fit dots
   (`fitFor`/`FIT_TITLES`/`.ev-fit*`/legend) and the legacy-gui VRAM
   column + recommended fetch (which would have broken on the 404) all
   excised.
5. **gpu.md** rewritten: the "1–1.5 GB" sentence struck; "not measured
   yet" story; first-load no-guess admission story; the CPU realtime
   table CUT (item 8's ruling, rec taken) — replaced by the honest
   qualitative split (Kokoro is built for CPU; the rest want a GPU).
   engines.md: Speed column cut with an explanatory note, GB→engine tier
   pairings cut, first-load sentence added.
6. **Bump hardened + grown**: occupant re-check under the lock before any
   booking write; and the bump now CREATES the booking when none exists
   (cur is None = "not measured yet" — the first successful post-work
   probe heals it), gated by `_books_memory` so CPU-placed engines still
   never book.
7. **The kit booking-gap half**: `_run_load` reserves the fit's computed
   number (pool-capped) right after `_admit`, BEFORE `_load_via_router`;
   the true-up reserve upserts it to measured; `_cleanup_cancelled` and
   the except arm already release. The stale "reservation recorded only
   AFTER a confirmed load" comment corrected. Kit suite green with zero
   test changes (858 passed / 10 skipped).
8. Scaffold junk `models/chatterbox-multilingual-v2/` (4 KB placeholder
   onnx + voices bin, untracked) deleted; the KFD-sysfs per-pid idea
   recorded in IDEAS.md; MPS-RSS stays on the laptops walk.

Tests: `test_engine_vram_wiring.py` REWRITTEN for the amended currency —
first-load-books-nothing · true-up measured · prior-books-early (asserted
INSIDE the child's /load call) · failed-load-releases-early-booking ·
delta-computed-never-persisted · one-pool measured · bump raise-only /
create / cpu-no-create / swap-guard · admission ×4 with prior-measured
pricing (29 green with the activity guard). Gates: kit ruff + 858; JV ruff
+ full pytest + vitest 48 + biome + build:vite + **the renderer smoke
(SMOKE PASSED, all views, zero JS errors)**.

## 11. Honest limits recorded at the ORIGINAL decision time (§10 amends
## several — the estimate items die with the estimate)

- Phase ① keeps the overhead constant seeded (~600 MB) until measured rows
  accumulate; the first-ever load of an engine on a machine admits on an
  estimate — labeled as such everywhere it shows.
- Windows per-PID GPU counters can fail on localized Windows (counter names
  are localized; typeperf-by-English-name misses) — the fallback ladder
  ends at device-delta labeled `computed`, so the number is never silently
  wrong, only honestly less attributed.
- A crashed engine's reservation still lingers until the slot next
  loads/unloads (unchanged from the wiring; conservative).
- Until phase ②, engines still download through the HF cache at load time —
  the 1314 retry guidance in gpu.md stays valid until then.
- CPU-placed engines on discrete boxes still book nothing (standing rule);
  one-pool boxes book measured RSS.

## 12. PHASE ② BUILD DESIGN (2026-08-14, under the standing go — recorded
## before code, grounded in the tree)

**STATUS: PHASE ② BUILT IN FULL 2026-08-14** (same session; the JV
tracker's convergence item carries the as-built inventory per slice):
②a the speech cache + kit-downloader fetch path wired end to end
(prefetch AND the load door's fetch-before-spawn; `_hf_snapshot_to`'s
symlink machinery deleted); ②b the SDK at v0.2.0 (`/load model_dir`,
spawn-time auto-refresh of stale venv installs) with all 8 engines
carrying local load doors and legacy branches intact for pre-②
installs; ②c facts-only VARIANTS in every manifest (pinned verified
sources below), model_catalog reduced to a reader, resolve_source
serving the pinned files + full multi-source lists, `disk_space_mb`
excised, MOSS renamed to the real MOSS-TTSD v0.

Ground truths that shaped the slices (all code-verified this session):
the host ALREADY has a plain-HTTPS HF fetcher (`installer._hf_snapshot_to`,
the 2026-06-15 "rip huggingface_hub" directive) — but it writes the HUB
CACHE layout (blobs + symlink-or-copy snapshots), which is exactly the
machinery the WinError 1314 class lives in, and engines still run
`from_pretrained(repo_id)` inside the subprocess (hub code in the load
path whenever anything is missing). The manager already exports per-engine
`HF_HOME` + `JUSTVOICE_MODEL_DIR` at spawn; `/load` carries
`{device, variant}`; the plugin SDK (`server/justvoice_plugin`, v0.1.0)
owns the subprocess protocol. `resolve_source` (manifest → operator
override) is the source layer and STAYS.

**Slice ②a — the acquire + the cache (host side):**
- Kit `runner/models.py` grows `select_repo_files(repo, *, revision="main",
  files=None)` → `(commit_sha, entries)`: an EXPLICIT file list (exact
  repo-relative paths; any missing name → FileNotFoundError naming it —
  fail loud, never fetch the wrong thing) or the whole tree when None.
  Reuses `_revision_sha` + `_tree` concurrently. GGUF `select_files`
  untouched.
- JV `speech_cache.py` (new): `speech_cache_root(data_dir)` =
  `<data_dir>/speech-cache/`; `variant_dir(...)/<engine>/<variant>/`;
  `fetch_variant(...)` downloads each resolved file via the KIT's
  `stream_download` (chunked, resumable, rate-limit-gated — replaces the
  installer's single-stream loop) as PLAIN FILES at their repo-relative
  paths, then writes `files.json` via `atomic_write_json`:
  `{repo, revision, commit_sha, fetched_at, files: [{path, size, oid}]}`
  — THE on-disk truth. `variant_on_disk(...)` verifies the manifest's
  every file exists at its recorded size (stat, no hashing); no manifest
  or any mismatch → False. NO symlinks anywhere — the 1314 class has no
  code path left.
- `spawn_prefetch`: HF sources → `fetch_variant`; URL/tarball sources
  (kokoro) → extracted into the same variant dir + files.json written
  from the extracted tree. `_hf_snapshot_to` dies with its symlink
  machinery. Progress/cancel ride the existing job channel; bytes_total
  comes from the RESOLVED entries (real sizes), not size_mb claims.
- `models_api.list_models` on_disk for speech: files.json truth, not
  HF-cache probing / folder-non-empty heuristics.

**Slice ②b — engines receive local paths:**
- Plugin SDK v0.2.0: `/load` gains `model_dir`; `EmbeddedEngine.load(
  device, variant, model_dir=None)`; server.py passes through. The
  manager's load door passes the variant's speech-cache dir when the
  files.json truth says present.
- Engines: chatterbox → `from_local(model_dir)` (the pinned package's
  local door); whisper/qwen3 (transformers) → `from_pretrained(<local
  dir>)`; kokoro already loads from a dir (keep); dia/moss/tada/luxtts →
  the same local-dir pattern where their pinned code has one.
- Fallback honesty: `model_dir=None` (an old HF-cache install, nothing in
  speech-cache yet) → the engine's existing repo-id path with HF_HOME
  still set — old installs keep loading; everything fetched the NEW way
  never runs hub code in the load path. Pre-release, no migrations: old
  cache dirs die at uninstall or reset.
- The SDK bump: setup reinstalls the plugin into venvs; existing venvs
  get it on the next shared-venv setup run (documented; pre-release).

**The verified facts (2026-08-14, the web pass — every repo checked
against the HF API; raw trees saved to the session scratchpad
`hf-trees/`):**

- **The ENGINE maps are the repo truth and the old catalog rows for four
  engines were fiction never wired to anything**: dia's engine loads
  `nari-labs/Dia-1.6B-0626` (one variant; the catalog's "dia-1.6b" /
  "dia-2-2b" repos don't exist and the variant id was never passed to the
  engine); moss loads `fnlp/MOSS-TTSD-v0` (→ 307-redirects to
  `OpenMOSS-Team/MOSS-TTSD-v0`, the canonical id to pin; catalog said
  "moss-llm/moss-tts-v1.5" — fiction); tada loads TWO repos
  (`HumeAI/tada-codec` + `HumeAI/tada-3b-ml`; catalog said "hume/tada-1b"
  / "hume/tada-3b" — fiction); luxtts loads `YatharthS/LuxTTS` (catalog
  said "luxtts/luxtts-base" — fiction). chatterbox / qwen3 (×4) /
  whisper (×5) repos are all real and match their engine maps.
- **Pinned per-variant file sets** (from the pinned loaders + real trees):
  · turbo (`from_local` reads them): ve.safetensors + t3_turbo_v1
    .safetensors + s3gen_meanflow.safetensors + conds.pt + the GPT2-style
    tokenizer set (vocab.json, merges.txt, tokenizer_config.json,
    special_tokens_map.json, added_tokens.json) ≈ 2,988 MB — the repo's
    s3gen.safetensors (1,056 MB) is NOT in the load set, exactly the §10
    diagnosis.
  · multilingual: the pinned `allow_patterns` list verbatim — ve.pt,
    t3_mtl23ls_v2.safetensors, s3gen.pt, grapheme_mtl_merged_expanded_v1
    .json, conds.pt, Cangjie5_TC.json ≈ 3,209 MB of the repo's 13,866.
  · whisper ×5: config + generation_config + preprocessor_config +
    model.safetensors + the tokenizer set (tokenizer.json, tokenizer_
    config, vocab, merges, added_tokens, special_tokens_map, normalizer)
    — never flax/tf/pytorch_model.bin duplicates (large-v3: 3,087 MB of
    the 24,702 MB repo).
  · dia: the safetensors shard pair + index + configs + processor set
    ≈ 6,445 MB of 19,334 (dia-v1.pth and pytorch_model.bin are 6.4 GB
    duplicates each).
  · qwen3 ×4 / moss: whole repo minus .gitattributes/README (their trees
    are already lean).
  · tada + luxtts: repos verified; their exact load sets need their
    engine deep-read at build time (tada's codec repo holds ten ~894 MB
    per-language aligners — which ones the engine actually loads decides
    the pin; luxtts's wrapper picks between fp and int8 onnx variants).
- Manifest `size_mb` claims die with this: download size = the SUM of the
  pinned real sizes (turbo's "2200" vs the real ~2,988 for the load set;
  multilingual's "2800" vs 3,209).

**Slice ②c — facts-only manifests:**
- Each engine `manifest.py` gains `VARIANTS = [...]` facts rows: id ·
  name · description · languages · per-variant capabilities (cloning
  first-class — the §4 ruling's data) · weights license · repo/url ·
  revision · pinned `files` list. Download size = the SUM of pinned file
  sizes, never hand-typed; `REQUIREMENTS.disk_space_mb` dies.
- `model_catalog.models_for` becomes a READER over the manifests; the
  hand-typed per-engine `_x_variants()` nests die (one source of truth).
- EVERY repo id + file list web-verified against the HF API at build
  time. A variant whose repo does not exist is DROPPED — a facts-only
  row cannot exist without verified facts (the scaffold invented some
  repo ids; each drop is recorded per engine in the build stamp).
## 13. PHASE ③/④ RESUME BRIEF (2026-08-14, written at the phase-② close
## — the grounded facts the UI build needs, so no re-derivation)

Phases ③ and ④ remain under the standing go (*"go on everything your
rec"*). Read §6 (the decided catalog anatomy) + this brief before code.

**What the wire now serves the ③ UI** (built in ②c — no server work
needed to start ③): `GET /v1/engines/{id}/models` rows carry
`voice_cloning: bool|None` · `preset_voices: int|None` ·
`weights_license: str` · `hf_repo: str|None` (the "View on Hugging Face"
target) · `url: str|None` · `size_mb` (verified download sum) ·
`languages` · `on_disk` (speech-cache truth first, then the per-engine
legacy hub cache). `GET /v1/engines/{id}/sources` serves per-variant
effective source + provenance (operator override layer — keep its
affordance). The budget strip and its measured story are DONE — ③
touches the catalog rows below the strip, not the strip.

**The renderer today**: `src/components/SpeechEnginesTab.vue` already has
the two-level grouped shape (sections → engine groups → variant rows),
search + kind chips, the loaded-now rail, DownloadBar-over-job-channel
plumbing (`makeEngineDownloadTask` + `bridgeJobProgress`), Device select,
default stars for engine and variant, install/load/unload/delete verbs.
③ is therefore a RESHAPE of this component toward §6's anatomy, not a
new view: add the per-variant capability chips (Cloning / Presets · N
from the new wire fields), the license column with the kit's use-limited
warning pattern, the filter row (All · Cloning · Preset voices), the
three-dot menu (Re-download · Delete files · Open folder · View on
Hugging Face), and the measured-memory hint per row ("X GB measured" /
"not measured yet" — join with the vram endpoint's reservations the way
the strip's speechRows already does).

**Kit primitives available** (verified in the kit tree): `DownloadBar`
(exported from ui/src/index.js), `UiChip`/`UiTag` (common components),
and the three-dot pattern used by LuModelCatalog — Reka's
`DropdownMenuRoot/Trigger/Portal/Content/Item/Separator` imported from
`reka-ui` directly (LuModelCatalog.vue:49 — copy that import shape; the
portal escapes the list's overflow clip). If a primitive needs promoting,
promote it in the KIT so both apps get it (the family drop-in principle).

**Consumers to repoint** (the §4 cloning ruling's second half):
`GenerateView.vue` gates cloning UI on `engineCaps.supports_voice_cloning`
from `GET /v1/engines/capabilities` (capability_details.py) — that API is
already variant-aware by id (chatterbox vs chatterbox-turbo have separate
detail rows), so verify which id the view resolves and prefer the LOADED
VARIANT's row; the voices flow has a similar engine-level read. The
catalog chips themselves read the new ModelVariant fields directly.

**④ (locations + verbs), decided scope**: `platformdirs.user_data_dir("JustVoice")`
→ Local, ONE function in paths.py (`speech_cache_root` was deliberately
built as the single place the speech location lives, so ④ re-roots
`data_dir` only); JUSTVOICE_DATA_DIR/--data-dir unaffected; per-store
clear verbs (LLM cache · speech cache · render cache) in one grammar on
the data-management surface; the engine venvs' location decided there
(rebuildable runtime, not user data). Pre-release no-migrations rule: the
path change is a default change — files re-download or the user resets.

**Known open edges carried forward** (recorded, not blockers):
- The tarball-step kokoro install path (`_install_engine_shared`'s
  model-tarball steps) still writes the LEGACY engine-dir models
  location at Load-time-install; the prefetch path already writes the
  speech cache. Converge the load-door tarball path onto the speech
  cache during ③/④ (kokoro's engine already accepts model_dir).
- The `spawn_install`/`known_engines` legacy in-process registry is
  dormant fiction-adjacent machinery (no legacy engines exist);
  excising it wholesale is a candidate ruling for ④'s cleanup.
- `is_installed` for shared engines still uses the legacy heuristics;
  with VARIANTS + the speech cache, `status` could become
  cache-truth-driven — fold into ③ when the catalog reads statuses.
- MPS-in-RSS verification stays on the user's laptops walk.
