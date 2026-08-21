# 2026-08-21 — The Alexandria-parity LoRA rebuild + hardware acceleration for every roster engine

**THIS IS THE RESUME SURFACE for the 2026-08-21 session.** The decision
table in §2 was presented to the user and approved with **"go on table
your rec go"**, with two standing corrections folded in: **plain-language
copy** (Alexandria's *labels*, never its jargon sentences — *"you use lazy
words that dont make sense to user"*) and **readable text + a real design
pass** (*"stop using small text, do a good ui design use your ux plugins"*
— the frontend-design skill was loaded before UI work). Earlier rulings
this session, verbatim: *"1 git ride of train i what the tab chip ect to
be Lora … just remove what you have and start over witht he correct way
from alexandria"* · *"2 … a menu in that Lora tab like settings has menu"*
· *"3 and 5 do it like alexandria"* · *"not lable only that is easy way
lazy way"* · *"this is crossplatform app and all hardware acceleration
should work for all modeles"* · *"yes ship adapters … a and b"* · *"it
does not have to be exactly like alexandria it needs to fit our app, but
you are lazy on words and features"*.

## §1 The mis-attribution corrected (user's catch)

"Datasets are objects, not ZIP files" had been recorded as a user ruling.
**It was not** — it was the assistant's design choice inside the
2026-08-20 broad go, later mis-cited as the user's (the same foul as the
blend-strategies mis-cite corrected in TASKS on 2026-08-20). The user's
words: *"i did ruyle anything, whatever your rec"*. The rec that then ran:
datasets stay stored as folders server-side (identical to Alexandria's
own server-side layout after an upload) **plus ZIP as the transport both
ways** — byte-compatible interchange with Alexandria.

## §2 The decision table (all built this session unless marked)

### A — Training sub-tab
| # | Decision |
|---|---|
| A1 | Card "LoRA Training" + plain-language lede |
| A2 | Dataset section first: **Upload ZIP** (`POST /v1/train/datasets/upload`, Alexandria-compatible, ref.wav → reference sample) |
| A3 | Dataset list panel: name · clips · minutes · **⬇ Download** (`GET …/archive.zip`) · Delete |
| A4 | **Build New Dataset** → Dataset sub-tab, Alexandria's hint verbatim |
| A5 | **New Dataset from WAV Files** — the 2026-08-20 gates+Whisper clip flow REHOMED here (run form is dataset-only) |
| A6-A8 | **Training Configuration**: Adapter Name · Base Model (JV-only, defaults to Qwen3-TTS Base) · Dataset ("-- Select dataset --") · Language · Epochs / Learning Rate (text input so 5e-6 displays) / Batch Size / LoRA Rank / LoRA Alpha / Grad Accum Steps — **always visible, prefilled** from the base's verified recipe |
| A10 | **Reference Sample** select kept (dataset's saved choice → longest-clip fallback → per-run override) |
| A12 | **Training Progress**: Epoch x/y · Loss · % · bar · live `.jv-logbox` |
| A13 | **Trained Adapters** + Refresh: Name · Base · Dataset · Language · Epochs · Final Loss · **Samples** · Actions; built-ins listed with `built-in` / `not downloaded` badges |
| A14 | **Test Voice**: Adapter · Text · Instruct · **Generate** (Alexandria's default line) |

### B — Preparer sub-tab
| # | Decision |
|---|---|
| B1 | Title **"Voice Training Dataset Preparer"** (⚑ one word from Alexandria's "…Builder" — their name collides with the actual Dataset Builder tab) |
| B2 | Plain-language lede (no metadata.jsonl in the user's face) |
| B3 | **Batch Mode** right-aligned · "Select Audio File(s) (WAV/MP3)" |
| B4 | **Configuration**: Output Name (⚑ "Filename" would be a lie — output is a dataset, with a ZIP download beside it) · Language · **Confidence** · **Min SNR** — per-run overrides, prefilled from Settings → Training (`min_confidence`/`min_snr_db` form fields → `training_prep._prepare_one`) |
| B6 | **Processing Queue** (Audio File · Status · Clips Kept · Dataset) · **Start Preparation** · Cancel · **Execution Logs** |
| B7 | Results: chunk table (dropped rows dimmed with reasons) + ⬇ Download ZIP + "Use in Training →" |

### C — Dataset Builder sub-tab
| # | Decision |
|---|---|
| C1-C3 | "Dataset Builder" + lede · "-- Select project --" · **New Dataset** · **Root Voice Description** · **Global Seed** ("Empty = random. Same seed = same voice.") · JV keeps **Model** + **Language** |
| C4 | **Add Row · Import JSON · Export JSON · Generate Pending · Regen All · Cancel** — JSON format is Alexandria's exactly (bare array of {emotion, text, seed}; import accepts `instruct` as emotion alias) |
| C5 | Columns # · **Emotion / Style** · **Text** · Seed · **Status** (pending/generating/done/error) · **Audio** · actions |
| C6 | **Save as Training Dataset** + **Reference Sample** (default "First completed sample" — Alexandria's default) |
| — | BUG FIXED en route: the first build stored the capability ROW id (`qwen3-vd`) as the project's engine; the render door resolves ENGINE ids (`VoicesView.vue:524` is the precedent) — every generate would have 404'd |

### E — Built-in adapters ("yes ship adapters … a and b")
| # | Decision |
|---|---|
| E1 | **(a) BUILT**: `training_builtin.py` manifest + `GET /v1/train/builtin` + `POST …/{id}/download` — fetch, validate (refuses a ZIP without ref_sample.wav/training_meta.json — it could never render), extract, mint `VoiceRecord(source="lora")`; idempotent. Shipped manifest is EMPTY: an entry without real published weights would be fiction |
| E2 | **(b) STAGED**: two Dataset Builder projects in the real data dir — **Alder** (warm male baritone, seed 41, `dsb-915458bc1889`) and **Wren** (clear female mezzo, seed 42, `dsb-3128dc8572f7`), 33 rows each per Alexandria's lora.md recipe (emotional range, short utterances for EOS, long calm closing passage = the Reference Sample). **Not auto-run** — training takes the whole GPU and evicts the user's live engines. To ship: generate both sets → train (~10-15 epochs, lr 5e-6, per lora.md's ~30-sample row) → download each adapter.zip → host → add the two `BUILTIN_ADAPTERS` entries |

### F — Hardware acceleration (verified, then fixed)
| Engine | State after this session |
|---|---|
| Kokoro | **Was declared-but-unreachable on CUDA/DirectML** (nothing ever installed the accelerated onnxruntime build). Now: `ACCEL_INSTALL` in the manifest + the manager's generic accel step installs `kokoro-onnx[gpu]` (CUDA) or `onnxruntime-directml` per detected runtime; engine pre-flights the provider with an actionable error; **Apple Silicon auto→CoreML** (one memory pool — nothing to preserve); discrete boxes keep auto→CPU (real-time there; VRAM stays free — the 2026-08-13 ruling, now with explicit choice actually working) |
| Chatterbox | Verified already correct: torch step picks cu124/rocm6.2/MPS wheels (`manager.py:660-706`); MPS float32 repair (`mps_patch.py`) |
| Qwen3 | Verified already correct: torch on Windows/Linux; macOS = its own MLX venv + OS-gated `-mlx` variants |
| Whisper | Verified already correct: torch step + `pick_device` (MPS allowed) |
| Not built | torch-DirectML (upstream stalled) — Windows AMD/Intel run torch engines on CPU, documented; kokoro-ROCm ORT wheels not on PyPI — Linux AMD gets torch-engine ROCm only |

### G — Stale-dependency cleanup
`engines/kokoro/requirements.txt` (sherpa-onnx — 28 MB dead install on
every engine install, constraints-bypassing) DELETED · pyproject per-engine
extras + `[training]` DELETED (`[qwen3]` even named a wrong package) ·
CLAUDE.md / README.md / NOTICE.md commands updated to `pip install -e .`
(engines install their own venvs) · existing kokoro venvs keep the dead
sherpa until the engine is reinstalled — no migration, per the standing rule.

### H — Lexicon IPA (was stored, displayed, and silently ignored at render)
`render_core._apply_lexicons` now returns (text, ipa_map): alias entries
substitute text on any engine; IPA entries ride `delivery.ipa_map` (auto-
keyed by `with_delivery_json`) to engines with `supports_phoneme_input`,
where `engines/kokoro/ipa.py::splice` splices the given pronunciation into
the phoneme stream (case-insensitive, word-boundary exact — Worcestershire
never half-matches Worcester; phonemizer failure → plain-text fallback,
never a dead render). Non-capable engines fall back to the alias. The two
contradictory previews (GenerateView ipa||alias vs LexiconsView alias||ipa)
are NOT yet unified — carried as the open item below.

## §3 Word-level timestamps — the research note (rec: schedule as its own item)

Verified on the web 2026-08-21: the practical engine-agnostic route is
post-render forced alignment against our own Whisper. Three approaches:
(1) [WhisperX](https://www.isca-archive.org/interspeech_2023/bain23_interspeech.pdf)
— transcribe, then force-align with a phone-recognition model;
(2) [stable-ts](https://gigagpu.com/fix-whisper-timestamp-alignment/) —
stabilised timestamps from Whisper itself; (3) cross-attention/DTW —
Whisper's internal alignment, which
[recent work](https://arxiv.org/pdf/2509.09987) shows lives in specific
attention heads. Known limits: WhisperX word stamps can sit
[100-400 ms off](https://github.com/m-bain/whisperX/issues/1247) vs the
[Montreal Forced Aligner](https://arxiv.org/pdf/2606.18466) gold standard,
and cross-attention timing varies between Whisper sizes. For read-along
highlighting, ±100 ms is acceptable; for tight captioning it is not. JV
angle: we KNOW the text that was rendered (no transcription errors), which
makes alignment strictly easier than the general case — a
forced-alignment-only pass (MFA-style, or WhisperX's alignment stage
alone) against the known line text is the right shape. No build yet.

## §4 Verification record

46 pytest pins green across three files (`test_lora_alexandria_parity.py`
12 new · `test_lora_builder_and_reference.py` 22 · 
`test_training_prep_and_datasets.py` 12) — the only tests run, per the
standing no-gates word. App boots with 20 `/v1/train*` paths. Vite builds.
Playwright against the live dev app: every decided label present on all
three sub-tabs (case-insensitive — UiField uppercases), zero horizontal
overflow, zero sub-12px text in the LoRA views (the 9px hits are the app
shell's nav-rail icon labels, pre-existing), screenshots eye-reviewed.
Not verified: a real training run end-to-end (GPU-long, evicts the user's
live engines), the CoreML/CUDA/DirectML arms on real non-Windows hardware
(UNMEASURED — the wheels and detection are per upstream's documented
matrix), Whisper confidence values from a live model.

## §5 Closure pass (same day, "go" on the closure list minus Blend)

The user walled off the Blend tab + A4 for a parallel session, then gave
go on the rest. Done: **A1** previews unified on one truth
(`services/lexiconPreview.js` — alias = text substitution, IPA = /ipa/
pronunciation annotation, mirroring render_core + kokoro/ipa.py;
GenerateView and LexiconsView both ride it) · **A2** deprecated engines
excluded from every acquisition picker in `capableRows`
(capabilities.js — the roster ruling's picker half; VoicesView untouched,
Blend unaffected since Kokoro isn't deprecated) · **A3** five silent
jv:health-refresh doors fixed (SpeechEnginesTab.unload + four in the LoRA
views); VoicesView's two doors left for the Blend session · **A5**
transcriber-confidence line restored in the clips table · **A6** all
three device defects closed (tada force_cpu_on_mac; chatterbox verified
already fixed 2026-08-19; tada ISOLATION="venv" so its torch 2.7 pin is
real). Cross-session handoff sent to the Blend session (files held, files
changed today, A4 + VoicesView doors are theirs).

## §6 The C go ("go on c" → "do all of c", same day)

All four built; C5 parked in IDEAS (the approved rec).

- **C1 word timestamps**: whisper engine `align` (HF token timestamps —
  cross-attention DTW over the checkpoint's alignment heads) → plugin
  `/align` → `manager.align` → `POST /v1/align` + `GET
  /v1/scenes/{id}/captions?format=vtt|srt`. The host maps the hypothesis
  onto the KNOWN text (`alignment.py` — an ASR misread never loses a
  word's timing; unmatched runs interpolate between anchors, monotonic by
  construction). `captions.py` groups cues at 42 chars / 7 words / 1 s
  gaps. Engine-agnostic: it measures finished audio, so it works for all
  four TTS engines — strictly more than Kokoro-FastAPI's Kokoro-only
  version. Accuracy honestly ±~100 ms (plan §3 sources).
  ALSO FIXED en route: `/v1/transcribe` returned text-only, silently
  starving the clip table's confidence display shipped the day before.
- **C2 pronunciation pre-flight**: `pronunciation.py` scan (capitalized
  where no sentence forced it · never seen lowercase · covered names
  subtracted · frequency-ordered) → `POST
  /v1/projects/{id}/pronunciation-report` → LexiconsView 🔎 button with
  add-chips; JW import seeds every character name as a blank lexicon row
  (safe: empty entries verified inert). Three more `UiTag
  intent="ghost"` bugs from the missed 2026-08-20 sweep fixed in passing.
- **C3 Pocket TTS**: integration complete (see the roster item in TASKS);
  measure-then-retire-LuxTTS remains the decision's own gate.
- **C4 voice bundles**: `voice_bundle.py` + `/v1/voices/{id}/bundle.zip`
  + `POST /v1/voices/bundle`. Carries what the voice IS (clip /
  description / mixed vector); refuses with the reason anything that
  could not render (missing clip, unknown engine, lora → pointed at the
  adapter zip). **Own API file on purpose** — voices_api.py/VoicesView
  are the Blend session's; the UI button waits for that file to free.
- **Pins**: `test_c_features.py`, 16 green first run.

## §6b Voice hiding removed (user order, same day)

*"remove hidden on voices grid that function shouldnt exist"* — full
excision, receipted sweep: VoicesView's hiddenIds/showHidden/toggleHidden
block + 🙈 chip + grid filter (the feature was already half-dead — nothing
called toggleHidden, so only leftover prefs could hide anything), the
resetAllTweaks unhide half, AND the sweep-caught mirror in
StudioView.vue:413-432 (Cast sidebar honored the same pref). The
"hiddenVoices" pref key is read by nothing; stale rows stay unread
(no-migrations rule). Rendered-verified on the live app: chip gone, 66
rows, 0 JS errors. The Blend session was notified with exact line
regions (it holds VoicesView.vue).

## §6c Cross-session test repair (peer-flagged, same day)

The Blend session ran the full suite and flagged 8 failures in this
session's area; all fixed, 124 passed across the six files. Causes, honestly
split: **four were mine** (the transcribe dict-contract change broke two
test fakes; the pocket-tts capability row needed an ADAPTER_FOR map entry;
the seeded-names change obsoleted two import pins — updated to the decided
contract incl. a true-no-op case). **Four were stale before this session**:
test_variant_wiring sliced manifest FILE TEXT and choked on qwen3's valid
platform conditional (the peer read it as a malformed literal — the file
is fine; the test now imports the module), and test_os_gate still pinned
pre-MLX "qwen3 excludes macOS" (param moved to tada+moss-tts; tada
qualifies since today's ISOLATION fix). Full suite NOT run here (the
no-gates hold) — by the peer's count it should now be 739 passed.

## §6d The review closures (go on R1–R6; R7 rides the peer session)

- **R1** built-in re-download after a lost adapter dir now restores the
  files onto the SAME voice record (reproduced: two records; pinned).
- **R2** the pronunciation scan strips covered multi-word phrases from
  the text before tokenizing — "Mara Vance" covered no longer re-flags
  its words, while a lone "Mara" still surfaces (pinned). The first fix
  attempt silently failed: the shell pipeline converted the regex's 
  escapes into LITERAL BACKSPACE characters — same injection class as the
  earlier NUL trap; repaired at byte level and the repo swept clean.
- **R3** align_api's dead tempfile block deleted.
- **R4** `base_voice` excised (request model + worker metadata) — it
  never reached any trainer; zero survivors on sweep.
- **R5** scene_captions no longer blankets exceptions into 404 — the
  resolver's own 404/400 answers propagate.
- **R6** was the ruff triple, already fixed inside commit 228a28e.
- NOT touched, per the go's boundaries: R7 (live-engine E2E — the peer
  session's), R8 + dropdown alphabetizing + the grid progress bar (not
  named in the go).

Verified: 67 targeted pins green (2 new), ruff clean, app boots.

## §6e Clone/Import consistency pass (user orders, end of session)

The orders, verbatim: *"hide show controls based on what model uses so if
chatterbox does not take refence dont show it"* · *"explain refernce
better so user know what is need in user terms not code terms"* · *"model
that speaks the clip drop down not working"* · *"instead of having ready
for model on clone tab be consistant it should say loaded"* · *"the
dropdown should show which models are load, we should resuse same
mechanism"* (+ the earlier standing order: all model dropdowns a-z).

Built:
- **The clone-option matrix, code-verified**: `supports_clone_prompt_text`
  — chatterbox False (capability_details.py:113), qwen3-base True (:359)
  + `supports_xvector_only` True (:362), tada True (:437, deprecated →
  filtered). So the transcript field now renders ONLY on Qwen3 Base
  (`supportsCloneText` gate in VoicesView), labelled **"What's said in
  the recording"** with plain-language copy ("listens to the clip while
  reading these words… skip it and the copy still works, just less
  exact"); the x-vector checkbox copy rewritten the same way. The old
  always-shown field with the "does not change the sound" hint is gone.
- **Import picker was DEAD**: `importEngineOptions` passed the FIELD name
  into `capableFor`, which maps CAPABILITY names → lookup missed → empty
  list forever. Fixed on the shared builder.
- **ONE option-builder** (`services/capabilities.js` `rowOptions` +
  `engineOptionsFor`): load state from the engines store (the same
  jv:health-refresh mechanism as the topbar pill), suffixes
  "· loaded" / "(not loaded)" / "(not installed)", **a-z always**.
  Consumers switched: VoicesView tabEngineOptions, Import picker,
  TrainingTab baseOptions, DatasetTab designEngines.
- "ready" tag → **"loaded"**; dead `engineStatusLabel` deleted.
- docs/voices.md Clone section gained "What each model asks for".

## §8 FULL SESSION CHECKPOINT (2026-08-21, save-everything order)

**Committed state**: everything above IS in this commit (the one carrying
this section) + its parent 228a28e. Both pushed to main. The parallel
Blend session's work (blend strategies, grid transport, blend-language
fix) rode 228a28e; its own record is
`docs/plans/2026-08-21-blend-rework-and-consistency-audit.md`.

**Verification state at save**: full suite was green at 228a28e (ruff
clean + 739 passed, 7:46). After it: R1-R5 fixes + this consistency pass
verified by targeted pytest (67 + 29 green), ruff clean, vite builds;
rendered checks of the LoRA sub-tabs + Lexicons + Voices grid recorded in
§4/§6b. NOT rendered-live after the very last pass (Clone/Import gating,
option suffixes) — the dev server was down when last checked; first
thing next session: open Clone (transcript field only on Qwen3-TTS Base),
Import (picker populated + defaulted), any model dropdown (a-z, "· loaded").

**OPEN — waiting on the user's word, nothing else**:
1. **R8** — collapse my scoped one-offs (.lora-heading/.prep-heading
   duplicate each other, .prep-toggle-label) into one canonical class.
2. **Grid play progress bar** (user-reported: slow/unsynced). Diagnosis
   in the session record: streamed WAV carries unknown-length header →
   duration unusable until stream end (cached replays inherit it), and
   timeupdate ticks ~4/s. Rec: real header + Content-Length for CACHED
   auditions, rAF-driven fill. Transport is the Blend session's rebuild
   (VoicesView ~:2058-2075) — user assigns who fixes.
3. **Alder + Wren training runs** (staged Builder projects
   dsb-915458bc1889 / dsb-3128dc8572f7, seeds 41/42, 33 rows each) →
   after training: download adapter zips, host, fill BUILTIN_ADAPTERS
   (training_builtin.py, format documented in-file).
4. **Pocket TTS: install + measure on this machine**, then retire LuxTTS
   (the roster decision's own gate — never before measuring).
5. **R7 / live-engine E2E** (Builder generate, Preparer full run,
   captions/align end-to-end) — assigned to the peer session.
6. **Sidecar restart** whenever the dev app runs old server code (today's
   endpoints: align/captions/pronunciation-report/bundle/builtin/upload).
7. Timestamps consumer work beyond the API (read-along in JW) — unranked.

**Environment traps hit this session (save for next time)**:
- The shell heredoc pipeline CONVERTS escape sequences in written files:
  ` ` became real NULs (test file), `` became literal BACKSPACE
  chars inside a regex (pronunciation.py) — the fix pattern: write bytes
  via Python `bytes([8])`/`chr(92)` constructions or the Write tool, then
  byte-scan; repo swept clean of control chars after.
- Full pytest buffers ~8 min with no output; wait on the summary regex,
  not on "passed" (ruff prints "All checks passed!" first).
- Kit truths: UiToggle has NO label prop (aria-label + sibling span —
  SettingsView:1091 is the shape); promptDialog uses `label:`/
  `defaultValue:` fields; UiTag takes value/slot, intents without
  ghost/warning; requestBlob(path, {method, body}) JSON-encodes body
  itself; manifests() returns a DICT keyed by engine id.
- `capableFor(capability)` takes CAPABILITY names (cloning/design/…),
  NOT field names — passing a field name silently yields [].
- Stale `__pycache__` can survive an mtime-equal write; when a module's
  behavior contradicts its source, purge the pycache FIRST, then suspect
  invisible bytes.

## §7 Still open

- Train + publish Alder and Wren; fill `BUILTIN_ADAPTERS` (§2-E2 steps).
- Pocket TTS: install + measure on this machine, then retire LuxTTS
  (the roster decision's own gate).
- The voice-bundle UI button — waits for the Blend session to release
  VoicesView.vue.
- **Sidecar restart** needed before today's server surface answers in the
  dev app (upload/builtin/builder + the Confidence prefill).
- Full gates + commit — user's word only.
