# Round 6b step 3 — Qwen3 CustomVoice 1.7B speaking our voice, told each line (plan, for a go)

TASKS "Round 6b — emotion we build ourselves", step 3. NOT STANDARD, named by the user ("we can try
your rec on replacing edict with the already built code … go on it all"). Research: RESEARCH §10.28
(checked against the code 2026-10-16; corrections at the end). Nothing here is built.

## 1. What it is

Qwen3-TTS comes as two halves that don't meet. **Base** copies a voice from a clip but ignores
direction. **CustomVoice** takes direction in words ("angry, raising his voice") but speaks only
its nine preset voices. This change makes **CustomVoice 1.7B speak the Hatter's voice** (his 8 s
clip) and still take each line's direction.

What you will hear: round 5's 13 page lines, in the Hatter's voice, from CustomVoice. Each line is
said once plain and once told, with 3 seeds each. The scorers pick the best take per line. The
picks go on a listening page beside the person (LibriVox) and round 5's best picks. You do your
four steps.

Two ways of handing over the voice are tested, as two arms:
- **`customvoice-ours`**: only the voice's fingerprint (the x-vector), as the MIT C engine does by
  default.
- **`customvoice-ours-icl`**: the fingerprint plus the clip itself and its words. This is Base's
  usual mode. The C engine's author says it holds the voice best but "Emotion barely moves".

Why it may work: Qwen's own model code already builds this exact prompt (direction + copied voice).
Only its wrappers refuse it (`qwen3_tts_model.py:401-407, 548-554, 788-794`).

Why it may not: the C engine's author hears the direction at "~half a preset's" strength on a
copied voice. Qwen has never trained CustomVoice on a copied voice. The test decides. If it fails,
we go to EDICT on VoiceDesign (TASKS).

Not in this step: any change to the app's screens or its stored data. App code changes only if it
works, and only after your go (§2 P10).

## 2. The pieces

Fork = `../audio.cpp`, branch `jv`, HEAD `bcc5dfbb`.

| # | Piece | Follows |
|---|---|---|
| P1 | **A session option naming the Base GGUF on disk**: `qwen3_tts.base_model_path` (type path). It is accepted only on a CustomVoice model; Base and VoiceDesign refuse it. It is added to the allow-list at `session.cpp:311-331`. | Upstream audio.cpp's `miotts.codec_model_path`, a session option that names another model file (`model_specs/miotts.json:128`, `src/models/miotts/session.cpp:94-98`, `docs/models/miotts.md:13`). The alternative from our own fork is gap 1's self-contained converted GGUF (`docs/models/chatterbox_turbo.md:24-28`). That needs a converter run, a 2.8 GB file and an HF publish. For the test, the option avoids all three (Q1). |
| P2 | **The ECAPA speaker encoder comes from the Base GGUF.** `load_qwen3_tts_assets(base_path)` loads it, then the existing `Qwen3TTSEcapaTdnnEncoderRuntime(base_assets, voice_prompt_context_, …)` runs unchanged. It runs on the CPU (`session.cpp:112-118`). CustomVoice's own speech-tokenizer encoder makes the ICL frames (its GGUF has those 225 tensors, §10.28). Checks before use: the file is variant Base, `has_speaker_encoder` is true, `tts_model_size` matches, and `enc_dim` equals CustomVoice's `hidden_size`. | Existing code as-is (`session.cpp:368-381`, `speaker_encoder.cpp:389-404`). Only the assets source differs. |
| P3 | **Request routing.** In `make_request`, the CustomVoice branch (`:691-710`) also reads the reference clip, `reference_text` and `x_vector_only_mode`, the same way Base does (`:649-675`). In `synthesize`, the CustomVoice branch (`:518-544`) takes a clip through `Qwen3TTSVoiceClonePromptBuilder` + `resolve_voice_prompt`, so the clip is cached for every line, and adds the instruct ids. A request without a clip takes the preset path, unchanged. A clip sent without P1 is refused, and the error names the option. A request with both a preset speaker and a clip is refused too (Q7). The task stays `tts`, so the loader and session task checks are untouched: `voice_ref` reaches a `tts` model with no capability gate (`server_protocol.cpp:159-197`). | Existing code as-is (the Base branch), moved. |
| P4 | **The prompt layout.** The VoiceClone branch of `build_prompt_state` (`talker.cpp:637-720`) puts the instruct rows first, using the same code as the CustomVoice/VoiceDesign branch (`:576-584`). The order is: instruct → role → codec prefix with the x-vector in the speaker slot → text, or ICL frames + text. `talker_prefill_equal` already compares `instruct_ids` (`:135`), so the prefill cache stays correct. | Qwen's own model-level `generate()`, Apache-2.0, QwenLM/Qwen3-TTS `modeling_qwen3_tts.py` @022e286b. Instruct rows `:2075-2079`, the clone x-vector as `speaker_embed` `:2104`, its slot `:2171`, role `:2177`, ICL `:2189`, concatenation `:2233-2237`. |
| P5 | **The x-vector is rescaled to the norm of the "ryan" preset row** before it goes in the speaker slot. Raw norm and scale are written to the trace log. | **NOT STANDARD.** The C engine's own step (`qwen_tts.c:1319-1336`; it fires only when the target row's norm is > 0.1, so on CustomVoice and never on Base). The standard option is the raw x-vector, as official `generate()` does. Trade-off: untested by ear either way; the C engine applies it to every CustomVoice clone (Q4). |
| P6 | **Base weight overlay.** With P1 set, the CustomVoice talker uses three pieces of Base's weights: `talker.text_projection.*` (fc1 and fc2, with biases), `codec_embedding` rows 0–2047, and the 3 `text_embedding` rows for tts_pad, tts_bos and tts_eos. The copy happens in memory at load, through `create_weights_runtime` → `load_talker_weights` (`talker.cpp:723-771, 936, 2060`; `session.cpp:332`). Dtypes are checked to match; if they don't, both sides are decoded to f32. The overlay covers every request in that session, including preset speakers on the same load. | **NOT STANDARD.** The C engine's default "graft" (WOVR + TPAD, `main.c:2290-2380`; `docs/icl-graft-portability.md` §2, §4). §10.28's outline left this out. The standard option is pure CustomVoice weights. Trade-off: without the overlay its author measured "a different voice … (mel 0.49)". With it, the "sighs, pauses and prosody micro-detail" come back. Not heard here (Q3). |
| P7 | **The option is declared in all three places options are declared**: `loader.cpp` `cli()` (`:80-96`), `model_specs/qwen3_tts.json` `"session"` (`:196`+), and `docs/models/qwen3_tts.md` (`:157`+). The request-option descriptions of `reference_text`, `x_vector_only_mode` and `instruct` (`loader.cpp:74-76`) say that CustomVoice takes them with P1. | As every Qwen3 option is declared. |
| P8 | **Fork unit test**: `tests/qwen3_tts/customvoice_clone_test.cpp`. It is added with `add_engine_unittest` + `add_test` and runs only when `qwen3_tts` is among the linked models. It builds in the existing `build/jv-tests` folder (CPU, Ninja, `ENGINE_BUILD_TESTS=ON`, checked in its CMakeCache). It needs the two real GGUFs, named by `QWEN3_TTS_CV_GGUF` and `QWEN3_TTS_BASE_GGUF`, and skips without them. It checks five things: (a) the prefill with instruct I equals I's rows followed by the prefill without instruct; (b) the x-vector from P2 is bitwise equal to a Base session's for the same clip; (c) after P6, codec rows 0–2047 and text_projection equal Base's, and rows from 2048 up stay CustomVoice's; (d) the refusals: a clip without P1, P1 naming a CustomVoice or VoiceDesign GGUF, P1 on a Base or VoiceDesign model, a 0.6B/1.7B mismatch; (e) a preset request without a clip gives a byte-identical prefill to today's. For (a), one function is exposed in `talker.h`: `qwen3_talker_prefill_embeddings(weights_runtime, prefill)`. | CTest `add_test` (cmake.org/cmake/help/latest/command/add_test.html); upstream's `add_engine_unittest` (`CMakeLists.txt:3233-3236`). The exposed function follows `validate_qwen3_talker_voice_clone_prefill`, which is already exposed in the same header (`talker.h:41`). |
| P9 | **JustVoice test harness, `server/scripts/round4_render.js`.** Arms `customvoice-ours` and `customvoice-ours-icl`. Each arm does this: (1) no voice copy; it uses the Hatter's `ref.wav` directly, and for ICL its manifest `transcript`; (2) loads `qwen3-cv-1.7b-q8` through the app (`/v1/engines/qwen3/load`), so the memory booking evicts gemma and books CustomVoice's price; (3) registers the same id again on the speech runtime (`POST /v1/models/load`, the same entry plus P1, plus `conv_weight_type=f16` as the app sends); the runtime reloads a model whose options changed (`parallel_runtime.cpp:385-417`); (4) renders each take through `/v1/tasks/run` with `voice_ref`, `x_vector_only_mode=true` or `reference_text`, `instruct` when told, `language` and `seed`; (5) unloads through the app (`POST /v1/engines/unload`) at the end. A new `--lines` filter takes line ids. It writes the same manifest. Nothing is written to the database; output goes to a new `data/round6b/`. | The harness's existing direct-to-runtime arms (`round4_render.js:259-260, 320-337`). Our code, as-is. |
| P10 | **JustVoice app — only if it works, and after your go.** `curated/qwen3_tts.js`: the CustomVoice 1.7B row (`:92-102`), its clone flag and the Base file as its session file. `SESSION_FILES` is family-wide today (`generated.js:552-584`), so it needs a per-model form. Also `slot.js:566` (the warm-up skips a cloning row), `slot.js:965-982` (the request), `capability_details.js:369-380`, `voice_model.js:206`, the renderer's clone lists, and `docs/engines.md`. | Planned separately after the result. |
| P11 | **Notice.** A fork `NOTICE.md` entry for the C engine: MIT, "Copyright (c) 2025 Gabriele Mastrapasqua" (`gh api …/license`, 2026-10-16). It covers P5 and P6, the parts that come from it. P4 is Qwen's own Apache-2.0 code. | The approved text says NOTICE.md. The fork's own precedent is `dsp/THIRD_PARTY_NOTICES.md` (Q9). |
| P12 | **RESEARCH**: the corrections to §10.28 below, plus a new §10.30 with the results, in the same change. | The register rule. |

**What arguing against it changed:** Q11 (the test reaches the app's runtime directly, near your no-scratch-config rule). Earlier: it added P6, because §10.28's outline missed the overlay and
its author heard a different voice without it. It added loading through the app first (P9), so the
booking stays true next to gemma. It added Q6, because 13 lines give wide intervals. It dropped a
pure-CustomVoice arm and a converted GGUF for the test.

## 3. Blast radius (pasted)

**Fork: every caller of what changes** (`rg -n "<names>" src include tests app`, the Qwen3 lines):
```
include/engine/models/qwen3_tts/talker.h:71:    std::shared_ptr<const Qwen3TalkerWeightsRuntime> create_weights_runtime(
include/engine/models/qwen3_tts/session.h:60:    Qwen3TTSRequest make_request(const runtime::TaskRequest & request) const;
include/engine/models/qwen3_tts/session.h:70:    const Qwen3VoiceClonePrompt & resolve_voice_prompt(
include/engine/models/qwen3_tts/session.h:100:    std::unique_ptr<Qwen3TTSEcapaTdnnEncoderRuntime> speaker_encoder_;
src/models/qwen3_tts/loader.cpp:129:        const auto assets = load_qwen3_tts_assets(request.model_path);
src/models/qwen3_tts/loader.cpp:190:    auto assets = load_qwen3_tts_assets(model_path);
src/models/qwen3_tts/session.cpp:332:    talker_weights_ = talker_.create_weights_runtime(
src/models/qwen3_tts/session.cpp:376:        speaker_encoder_ = std::make_unique<Qwen3TTSEcapaTdnnEncoderRuntime>(
src/models/qwen3_tts/session.cpp:501:            const Qwen3TTSRequest qwen_request = make_request(chunk_request);
src/models/qwen3_tts/session.cpp:519:        Qwen3TTSCustomVoicePromptBuilder prompt_builder(
src/models/qwen3_tts/session.cpp:528:            const Qwen3TTSRequest qwen_request = make_request(chunk_request);
src/models/qwen3_tts/session.cpp:545:    const Qwen3TTSRequest first_request = make_request(chunk_requests.front());
src/models/qwen3_tts/session.cpp:552:    Qwen3TTSVoiceClonePromptBuilder prompt_builder(
src/models/qwen3_tts/session.cpp:565:        const auto & voice_prompt = resolve_voice_prompt(*qwen_request.voice_clone, prompt_builder);
src/models/qwen3_tts/session.cpp:608:    entry.prompt = prompt_builder.build_voice_prompt(input);
src/models/qwen3_tts/talker.cpp:936:            load_talker_weights(*assets_, backend_, backend_type_, kTalkerWeightContextBytes, weight_storage_type));
src/models/qwen3_tts/talker.cpp:1830:            cached_prompt_state_ = build_prompt_state(
```
Outside `qwen3_tts`, these headers are included only by
`tests/shared_mel_migration/probe.cpp:14: #include "engine/models/qwen3_tts/speaker_encoder.h"`
(that file is unchanged). `tests/qwen3_tts/qwen3_tts_warm_bench.cpp:129` has its own local
`make_request`, unrelated.

**The runtime server on this path:**
```
app/server/server_protocol.cpp:159:  if (const auto *value = body.find("voice_ref")) {        # → voice.speaker->audio, no capability check
app/server/server_protocol.cpp:199:  if (const auto *value = body.find("reference_text")) {
app/server/parallel_runtime.cpp:397:            existing->config.session_options != candidate->config.session_options ||   # → reload
app/server/model_memory.cpp:89:    for (const auto & [key, value] : model.session_options) {   # adds the Base GGUF's size to the estimate
```
The memory guard is off unless `min_free_memory_mb > 0` (`runtime.cpp:2336`).
`rg -n "min_free_memory" server/src` in JustVoice returns nothing.

**Fork: errors already on these paths** (`rg -n "throw std::runtime_error"`, the relevant lines):
```
session.cpp:329: "unknown Qwen3 TTS session option: " + key      session.cpp:366: custom voice model only supports the Tts task
session.cpp:547: base TTS requires voice clone reference audio    session.cpp:550: base TTS session is missing voice clone runtimes
prompt_tts_voice_clone.cpp:38: ICL mode requires reference text   prompt_tts_voice_clone.cpp:11,14: token limits
prompt_tts_custom_voice.cpp:32,35: requires custom voice input / speaker
talker.cpp:45,48,51: voice clone prefill requires speaker embedding / exactly one prompt mode / ICL ids and codes
talker.cpp:429,433,439,452: embedding table shape / byte size / id out of range / must be f32, f16, or bf16
talker.cpp:498,537,541,562: input ids too short / unsupported speaker / missing dialect / unsupported language
speaker_encoder.cpp:398,401: requires assets / requires a base model with speaker_encoder_config
assets.cpp:139-148: tokenizer type, base needs speaker_encoder_config, custom voice needs speaker ids
```
P1–P3 add these errors: a clip without the option; a file that is not Base, or the wrong size; the
option on a non-CustomVoice model; a speaker and a clip together.

**JustVoice: where CustomVoice's `clone` flag is read and its request routed**
(`rg -n "spec\.clone|cannot clone|clone-only|qwen3-cv" server/src`, catalog.json lines left out):
```
server/src/engines/audiocpp/slot.js:566:    } else if (family === "qwen3_tts" && task === "tts" && !spec.clone) {
server/src/engines/audiocpp/slot.js:970:      if (!spec.clone) throw new AudioCppError("the CustomVoice model cannot clone — use a Base model for this voice");
server/src/engines/audiocpp/slot.js:979:      if (spec.clone) throw new AudioCppError("the Base model is clone-only — this voice needs a reference clip");
server/src/engines/capability_details.js:369:  "qwen3-cv": detail({
server/src/engines/capability_details.js:374:    supports_voice_cloning: false,
server/src/voice_model.js:206:  if (action === "clone") return Boolean(row.supports_voice_cloning);
server/src/voice_model.js:272:  if (engineId === "qwen3") return "qwen3-cv";
server/src/engines/audiocpp/curated/qwen3_tts.js:94:    model: "qwen3-cv",
server/src/engines/audiocpp/curated/qwen3_tts.js:105:    model: "qwen3-cv",
server/src/engines/audiocpp/generated.js:739:  const clone = kind === "tts" && (note.clone ?? clones(fam));
server/src/engines/audiocpp/generated.js:814:      voice_cloning: clone,
server/src/engines/audiocpp/generated.js:824:        clone,
```
The renderer reads `voice_cloning` / `supports_voice_cloning` / `.clone` in 14 files, 97 times
(VoicesPage, PersonaCloneMaker, SpeechEnginesTab, services/capabilities.js, the mocks). All of that
is P10 only. **This step touches none of them.** It changes only `round4_render.js`, whose
direct-to-runtime lines are:
```
server/scripts/round4_render.js:259:              told && a.clip
server/scripts/round4_render.js:260:                ? await runtimeTake(args.runtime, a.variant, { … })
server/scripts/round4_render.js:320:async function runtimeTake(runtime, model, { text, voiceRef, clip, alpha, seed }) {
```
**Data deleted or overwritten:** none. The overlay lives in memory per session. The harness writes
only `data/round6b/`. No voice is copied and no setting is changed.

## 4. The test

- **Lines:** round 5's 13: 7-95, 8-57 (shouted), 7-32, 7-3 (angry), 7-31, 7-70 (sad), 7-58, 7-57
  (contemptuous), 8-67, 8-48 (whispered), 8-44, 8-27 (fearful), 7-117 (happy).
- **Told:** round 5's direction words (`data/round5-direction.json`), the same words every round-5
  arm got (Q5).
- **Voice:** `voice_8862414b55f04b1ca66c43700b741848/ref.wav` (24 kHz mono, 8.16 s) and its
  manifest transcript, used for ICL.
- **Takes:** told and plain, seeds 7, 8, 9, giving 78 takes an arm and 156 in all. Sampling stays
  at the runtime's defaults (temperature 0.9, top-k 50, repetition 1.05 — the C engine also uses
  ~0.9).
- **Run** (the app on `npm run dev`, so the rebuilt fork; one app window; gemma not loaded):
  `npm run round4:render -- --out data/round6b --direction data/round5-direction.json --arms
  customvoice-ours,customvoice-ours-icl --lines <the 13> --voice voice_8862… --runtime
  http://127.0.0.1:<runtime port>`
- **Score:** take-check exactly as round 5 (Whisper turbo; UTMOSv2 on seed 7; emotion2vec+; speaker
  similarity to the clip), then `npm run round4:report -- data/round6b/score/out`. Round 5's arms are
  scored on the same 13 lines too, so the rows compare.
- **The page:** for each line, the person, round 5's best sellable pick, and each new arm's pick (the
  scorers' best of 3, chosen by round 5's rule). Then your four steps (Q8).

**What counts as "it works"** (proposed; your ears decide last):
1. **It speaks.** At least 95 % of takes read back (WER ≤ 0.25). No runaway: no take longer than 3×
   its plain twin.
2. **It is the Hatter.** Speaker similarity at least 0.90 plain and 0.85 told. Round 5's sellable
   arms scored 0.87–0.93.
3. **It acts.** Emotion gain on the 13 lines is at least that of round 5's best sellable arm on the
   same lines, with its interval above 0. Shouted lines are more than +3 dB and whispered lines
   below 0 dB (VoxCPM2's whisper came out +3.5 dB).
4. **Your four steps** prefer its picks to round 5's best sellable pick on more lines than not.

**Falling back to EDICT** (VoiceDesign, TASKS), in either of two cases:
- Both arms fail 2. Or both pass 2 and fail 3: that would be the half-strength ceiling the C
  engine's author reported.
- Your ears say no.

A failure of 1 alone (noise, runaway) gets one rebuild with the raw x-vector first (Q4).

## 5. Memory, build, licences

- **Graphics card (8 GB):** CustomVoice 1.7B Q8 runs on the card as it does today. Its booked price
  was 4,057 MB at 200 characters (§2.3), and its peak runs about 2.5 GB above the loaded model
  (§2.1). Round 5's lines are short.
  - ICL adds about 102 reference frames (8.16 s × 12.5 Hz) to the prompt. A Base clone's peak sits
    1,670 MB above its model (§2.1).
  - Gemma can't sit beside it (§2.2); loading through the app first evicts gemma (P9).
  - Not measured yet; the run records the peaks.
- **Computer memory:** the ECAPA (~24 MB), the speech-tokenizer encoder (~117 MB) and the overlay
  (~25 MB, the C engine's WOVR size) all sit in RAM on the CPU.
  - The Base GGUF (2.70 GB) is memory-mapped, not read whole (`read_binary_blob` →
    `MapViewOfFile`, `binary.cpp:140-210`). Only the tensors read become resident.
- **Build:** `npm run dev` rebuilds `build/jv-dev`, only what changed: the qwen3_tts sources, the
  embedded `qwen3_tts` spec, and a relink. ggml and CUDA are untouched. Time not measured; it gets
  recorded.
  - The unit test builds in `build/jv-tests` (CPU) with `cmake --build build/jv-tests --target
    qwen3_tts_customvoice_clone_test` and runs with `ctest -R qwen3_tts_customvoice_clone`.
  - Both GGUFs are already on disk: `data/speech-cache/qwen3/qwen3-cv-1.7b-q8/…` (2.82 GB) and
    `…/qwen3-base-1.7b-q8/…` (2.70 GB). Nothing to download.
- **Licences:** CustomVoice 1.7B and Base 1.7B are both Apache-2.0 (Hugging Face API, checked
  2026-10-16), so combining their weights in one session is allowed.
  - The C engine is MIT, "Copyright (c) 2025 Gabriele Mastrapasqua", and MIT code fits in the
    Apache-2.0 fork. Its notice goes in with P5/P6 (P11).

## 6. Open questions

1. Should the Base file be named by a session option (P1) or bundled in a converted GGUF (the gap 1
   way)? **Lean:** the option for the test; the shipping form decided only if it works.
2. Is the option called `qwen3_tts.base_model_path`? **Lean:** yes, following upstream's
   `miotts.codec_model_path`.
3. Is the Base overlay (P6) always on with the option, or is there also an arm without it?
   **Lean:** always on, the C engine's default. A pure-CustomVoice arm only if the overlay arms fail
   likeness.
4. The norm rescale (P5)? **Lean:** port it as the C engine has it. The raw x-vector only as a
   one-rebuild check if takes break.
5. What is a told line given: round 5's direction words, or a fuller sentence in the model card's
   style? Line 7-70's words are "pointing with his tea spoon". **Lean:** round 5's words, so the page
   compares like with like.
6. Should we render all 50 cue lines for the numbers? It is about 5× the takes, estimated 15–20 min
   an arm from §2.1's 2× real time. The 13 lines still go on the page. **Lean:** yes, because 13
   lines give wide intervals.
7. A request with both a preset speaker and a clip? **Lean:** refuse it, by name.
8. The page: a new round 6b page (the person, round 5's best sellable pick, both new arms), or rows
   added to round 5's? **Lean:** a new page.
9. Where does the notice go: `NOTICE.md` at the fork root (the approved text), or the fork's
   precedent `THIRD_PARTY_NOTICES.md`? **Lean:** NOTICE.md, as approved.
10. Are §4's pass bars the right ones? **Lean:** as written.
11. The test registers CustomVoice again on the app's own speech runtime with the Base file option
    (P9), because the app can't send that option until P10. Your rule is "never a private audio.cpp
    server with a scratch config"; this is the app's runtime and dev build, reached directly as
    round 5's clip arms were. **Lean:** yes, for the test only; the app sends it itself only after
    P10.

## 7. Built (2026-10-17, after "go your rec")

- **Fork `jv` 8461cdce: P1–P4, P7, P8.** The option, the Base speaker encoder, the routing, the
  instruct rows first, the three declarations, and the unit test.
- **P5 (rescale) and P6 (Base overlay) are not built.** They are NOT STANDARD and wait for their
  word by name.
- **The unit test changed in three places from §2 P8, because P5 and P6 aren't in yet:**
  - (b) is now four short renders through a session, x-vector and ICL, plain and told, instead
    of a bitwise x-vector compare. A compare would need the session to expose its prompt.
  - (c) waits for P6.
  - (e) compares a preset render with the option against one without it. They are the same
    samples until P6.
- **The test result:** 16 checks pass, CPU, 35 s, `build/jv-tests`. `model_spec_system_test`
  passes too.
- **P9 is built in `server/scripts/round4_render.js`:** the arms `customvoice-ours` and
  `customvoice-ours-icl`, and `--lines`.
- **The dev build `build/jv-dev` is rebuilt with the change.** The renders wait for the card.

## Corrections to RESEARCH §10.28 (found while checking)

- The "smallest fork change" leaves out the Base weight overlay. That overlay is Base's
  text_projection, codec rows 0–2047 and tts_pad/bos/eos (WOVR + TPAD). It is part of the C
  engine's default 25 MB graft, and its author heard "a different voice … (mel 0.49)" without it
  (`docs/icl-graft-portability.md` §2, §4; `main.c:2290-2380`). P6 adds it.
- "Neither alone is enough on a clone" is at `blog/emotions-on-cloned-voices.md:70`, not
  `emotions-on-cloned-voices.md:71`. That blog is an unpublished draft (`published: false`).
- The rescale to row 3061's norm applies only when that row's norm is > 0.1. So it applies on
  CustomVoice and never on Base (`qwen_tts.c:1319-1336`). Not wrong in §10.28, just unstated.
- In §10.26, not §10.28: "the same developer calls it a dead end on 1.7B" is inaccurate. The blog
  (`:52`) says "the 4 KB speaker vector", which is 0.6B's size (1.7B's is 8 KB), and it doesn't
  name 1.7B.
- Confirmed as written: `session.cpp:368-381, 648-675, 691-710`; `talker.cpp:576-584, 645`;
  `prompt_tts_voice_clone.cpp:32-61`; `slot.js:969-982`; `curated/qwen3_tts.js` (`clone: false`
  at `:99, :110`); the official Python lines; `main.c:2141-2142, 2155, 2334-2346`.
