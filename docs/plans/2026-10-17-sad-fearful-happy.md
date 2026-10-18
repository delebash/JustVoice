# Round 6b step 4 — sad, fearful and happy on an engine we can sell (plan, for a go)

TASKS "Round 6b — emotion we build ourselves". The user's go (2026-10-17, "think on it again your
rec go") was for this plan: "for sad, fearful and happy a plan comparing the CREMA-D direction,
EDICT and instruct guidance". Research: RESEARCH §10.32. Nothing here is built.

## 1. What it is

By your ears (RESEARCH §10.29–10.30), every engine we can sell stays plain on **sad, fearful and
happy**. That includes CustomVoice speaking the Hatter's fingerprint, which already gives the full
feeling on shouted, angry and scornful lines and never goes wrong. BreezeTTS 2, which we can't sell,
does all of them.

This plan picks how to make **CustomVoice with the Hatter's fingerprint** give those three feelings.
Three ways were compared:

- **Instruct guidance.** Each step of a take is made twice: once with the line's direction and once
  without it. The told result is then pushed further from the untold one: logits = untold +
  γ·(told − untold). This is how BreezeTTS 2 takes direction: its untold prompt is its clone prompt
  minus the instruction, at γ 2–4. Today CustomVoice runs at γ = 1, which means no push.
- **An emotion direction.** The fingerprint itself is moved toward a feeling: the average CREMA-D
  actor's fingerprint for that feeling, minus their neutral one (the method of arXiv 2606.05367).
- **EDICT.** Qwen3 VoiceDesign, given the clip and its words, plus the line's direction.

**Rec: instruct guidance first; the direction's fingerprints extracted at the same time (CPU only);
EDICT not now.**
- Guidance is the mechanism of the engine your ears picked.
- The direction does reach CustomVoice: no told take was identical to its plain twin, and five lines
  acted (§10.30). Guidance amplifies exactly that difference.
- The direction's only evidence is emotion2vec on Qwen3 Base. That scorer gave the person's sad,
  fearful and happy lines 0.00, and missed CustomVoice's acting.
- EDICT's own paper shows the voice drifting when each line is made on its own (SIM-I 0.658), which
  is our case. And the clip's frames damped CustomVoice's direction to nothing (§10.30).

**Arguing against it:** guidance only amplifies a difference that is already there. If CustomVoice's
sad takes are plain because told and untold barely differ, guidance fails exactly where we need it.
The direction changes the input itself, so it is the next try. **What the attack changed:** the
direction's fingerprints are extracted alongside guidance, not after it. Guidance is gated by a check
that γ = 1 gives today's takes byte for byte.

## 2. The pieces

Fork = `../audio.cpp`, branch `jv`, HEAD `8461cdce`.

| # | Piece | Follows |
|---|---|---|
| G1 | **A request option `guidance_scale`** on Qwen3 TTS (float, default 1.0 = off), declared where every Qwen3 option is (`loader.cpp` `cli()`, `model_specs/qwen3_tts.json`, `docs/models/qwen3_tts.md`). | The fork's own option of the same name on BreezeTTS 2 (`src/models/breeze_tts/session.cpp:380`) and Chatterbox (`src/models/chatterbox/session.cpp:49`). |
| G2 | **The untold prompt** is the same request's prefill without the instruct rows. That is the clone prompt minus the instruction. | BreezeTTS 2's official construction (`breeze_infer/templates.py:54-55, 95-104`; our fork `breeze_tts/tokenizer_text.cpp:117-126`). |
| G3 | **A second talker cache stepped in lockstep.** A second `TalkerCachedStepGraph` (`talker.cpp:1175`) prefilled with G2 is fed the same sampled code each frame. Its logits are mixed before the existing processors (`apply_main_talker_processors`, `talker.cpp:1927`): untold + γ·(told − untold). The code predictor keeps the told hidden state, so it is not guided. | **NOT STANDARD on Qwen3**: no Qwen3 port has guidance (official code, upstream audio.cpp, the MIT C engine, mlx-audio, vLLM-Omni; RESEARCH §10.32). Guidance on autoregressive logits is itself established (Koel/Magpie, Chatterbox, Dia, Breeze), and our fork already has it in Breeze (`generator.cpp:1072, 1160-1164`) and Chatterbox (`t3_component.cpp:611-615`). The standard option is no guidance, which is today's plain result. |
| G4 | **Fork unit test** in `tests/qwen3_tts/customvoice_clone_test.cpp`: at γ = 1 the samples are byte-identical to a render without the option; at γ = 2.5 a render finishes and differs. | The P8 test as built (CTest `add_test`). |
| G5 | **Harness arms** in `server/scripts/round4_render.js`: `customvoice-ours-g2.5` and `customvoice-ours-g4`, the fingerprint arm with `guidance_scale` sent. | The round 6b step 3 arms, as built. |
| D1 | **Fingerprints out of the fork.** `qwen3_tts` emits its x-vector as the runtime's existing `SpeakerEmbedding` artifact (`include/engine/framework/runtime/session.h:134`), when asked by a request option `return_speaker_embedding`. It runs on the CPU, on Base or on CustomVoice with `base_model_path`. | **NOT STANDARD.** The artifact kind exists, but no model emits it. The other option is a separate fork tool that calls `Qwen3TTSEcapaTdnnEncoderRuntime::encode`, which is more code that only we use. |
| D2 | **CREMA-D** (7,442 clips, 91 actors; anger, disgust, fear, happy, neutral, sad) downloaded to `data/crema-d/` (gitignored). Only clips the crowd heard as the intended feeling are kept (`summaryTable.csv`). | The dataset as published (github.com/CheyneyComputerScience/CREMA-D). |
| D3 | **The directions:** per feeling, the mean fingerprint minus the neutral mean, written to `data/crema-d/directions.json`. The paper's method is reimplemented, because its repo has no licence. | arXiv 2606.05367 §3. **NOT STANDARD.** |
| D4 | **Using a direction** is the second step, after guidance's result, and gets its own pieces then. | — |

**Not in this step:** any change to the app's screens or data. The app sends `guidance_scale` only
if it works, after your go.

## 3. Blast radius (pasted)

**Fork: every caller of what G1–G3 change** (`rg -n` at 8461cdce):
```
src/models/qwen3_tts/session.cpp:502:        const auto codes = talker_step_->generate(prefill, options, options.repetition_penalty);
src/models/qwen3_tts/session.cpp:531:    talker_step_->generate(prefill, options, options.repetition_penalty,
src/models/qwen3_tts/talker.cpp:1175:class TalkerCachedStepGraph {
src/models/qwen3_tts/talker.cpp:1898:                cached_step_graph_ = std::make_unique<TalkerCachedStepGraph>(
src/models/qwen3_tts/talker.cpp:1927:            apply_main_talker_processors(logits, config, generated_first_codes, step, repetition_penalty);
src/models/qwen3_tts/talker.cpp:2062:    float repetition_penalty,
src/models/qwen3_tts/talker.cpp:2064:    return impl_->generate(prefill, options, repetition_penalty, on_frame);
include/engine/models/qwen3_tts/talker.h:63:        float repetition_penalty = 1.05F,
src/models/qwen3_tts/loader.cpp:76:        {"instruct", "string", "Optional natural-language voice or style instruction for VoiceDesign and CustomVoice variants, including a CustomVoice clone; empty instructions are accepted.", false},
```
Every Qwen3 render (Base, CustomVoice, VoiceDesign) passes `talker.cpp:1927`. At γ = 1 the second
cache is never built, so today's path is unchanged (G4 checks it byte for byte).

**The fork's existing guidance, followed:**
```
src/models/breeze_tts/session.cpp:380:    generation.guidance_scale = runtime::parse_finite_float_option(request.options, {"guidance_scale"}).value_or(generation.guidance_scale);
src/models/breeze_tts/generator.cpp:1072:        const bool use_cfg = request.guidance_scale != 1.0F;
src/models/breeze_tts/generator.cpp:1163:                    state.uncond->logits[i] + request.guidance_scale * (state.cond.logits[i] - state.uncond->logits[i]);
src/models/chatterbox/session.cpp:49:    config.guidance_scale = runtime::parse_float_option(options, {"guidance_scale"})
```

**D1:** `prompt_tts_voice_clone.cpp:34` makes the x-vector (`speaker_encoder_.encode`) and `:62` puts
it in the prefill. The artifact is added beside the audio; requests without the option are unchanged.

**JustVoice:** only `server/scripts/round4_render.js` (G5). `slot.js`, the curated notes and the
renderer are untouched.

**Data deleted or overwritten:** none. Output goes to `data/round6b/guided/` and `data/crema-d/`.

## 4. The test

- **Lines:** round 5's 13 page lines, so shouted, angry and scornful are checked for damage too. The
  five sad, fearful and happy lines are the ones that count.
- **Takes:** told, seeds 7, 8, 9, at γ 1 (today's, already rendered), 2.5 and 4. That is 78 new
  takes, about 2 minutes on the card.
- **Scored** as round 5. Only read-back (WER), likeness and runaway are trusted; the feeling is yours.
- **The page:** on each line, the fingerprint arm at γ 1, 2.5 and 4, seed 7, behind letters, with
  the same buttons as rounds 5 and 6b.
- **It works if** your ears give the full feeling on at least 3 of the 5 sad, fearful and happy
  lines at some γ, with no line made worse elsewhere and likeness at least 0.85.
- **If it fails:** the direction (D4), with the fingerprints from D1–D3 already made.

## 5. Memory, speed, licences

- **Card:** the second cache costs 2 × 28 layers × 8 heads × 128 × 4 bytes = 224 KB per position.
  That is about 60 MB for a 256-position line and 470 MB at 2,048. It applies only when γ ≠ 1.
- **Speed:** one more talker step per frame, so at most about twice today's 0.8 s a take.
- **CREMA-D:** Open Database License, its clips under the Database Contents License; commercial use
  is allowed (ODbL §3.1). Shipped averaged directions are most likely a Produced Work, which needs an
  attribution notice (ODbL §4.3). Publishing the per-clip fingerprints would make a Derivative
  Database, which shares alike (§4.4, §4.6). This is a reading, not legal advice. The paper's code
  has no licence, so nothing is copied from it.
- **Build:** `npm run dev` rebuilds only the qwen3_tts sources; the unit test builds in
  `build/jv-tests`.

## 6. Open questions

1. **Instruct guidance (G1–G3), NOT STANDARD on Qwen3: build it?** **Lean:** yes.
2. **Fingerprints out of the fork (D1), NOT STANDARD, plus CREMA-D and the directions (D2–D3): now,
   alongside guidance?** **Lean:** yes, CPU only; using a direction waits for guidance's result.
3. **EDICT: set aside?** It was the approved fallback for step 3. **Lean:** set aside; its own
   paper's per-line row loses the voice.
4. **Which γ values?** **Lean:** 2.5 and 4. These are Breeze's range; 1.5 adds takes to listen to
   for a small step.
5. **Is the bar right (3 of 5 lines at the full feeling)?** **Lean:** as written.
