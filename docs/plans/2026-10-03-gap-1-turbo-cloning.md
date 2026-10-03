# Gap 1 — Chatterbox Turbo and Nano clone again: core Chatterbox's encoders in our audio.cpp

## 1. What this is

Gap 1 of the audio.cpp switch (switch plan §5: "Chatterbox Turbo cloning (and Nano with it) —
fork C++: repack the voice-encoder and S3 tokenizer weights, wire core Chatterbox's
conditioning into the Turbo family"), under "you have a go for all gaps". Before the
2026-10-01 switch the app had both models as clone-only rows with Turbo's 19 inline tags
(`git show 1c7398d^:server/justvoice/engines/chatterbox/manifest.py` — `chatterbox-turbo-v1`
"Chatterbox Turbo (350M, English)", `chatterbox-nano-v1` "Chatterbox Nano (110M, English)").
audio.cpp's Turbo speaks only its one built-in voice, so both rows were dropped at the switch.
This brings them back as they were: the same two models, clone-only, English, with the tags.

## 2. Facts (2026-10-03)

- **audio.cpp's Turbo refuses a clip**: `chatterbox_turbo/session.cpp` throws "Chatterbox Turbo
  does not support custom voice cloning (only the built-in default voice)". It conditions every
  line on the five tensors of the built-in voice (`tts.cpp`: `t3.speaker_emb`,
  `t3.speech_prompt_tokens`, `gen.prompt_token`, `gen.prompt_feat`, `gen.embedding`).
- **Its GGUF was not made from Resemble's files.** `repack_chatterbox_turbo_gguf.py` repacks a
  third-party pair (`cstr/chatterbox-turbo-GGUF`) and leaves out the three encoders on purpose:
  "`ve.*` … and `s3.se.*`/`s3.tok.*` … are not staged … their tensor layout has not been
  validated".
- **Core Chatterbox already builds those five tensors from a clip**:
  `ChatterboxConditionalsComponent::prepare` (`src/models/chatterbox/conditionals.cpp`) from a
  `VoiceEncoderComponent`, an `S3TokenizerComponent` and a `CAMPPlusEncoderComponent`. It is a
  plain component with no Chatterbox-Multilingual coupling.
- **The encoders are the same weights in all three models**, checked against Resemble's own
  repos (huggingface.co, sha256 from the LFS pointers, and tensor by tensor over HTTP ranges):
  - `ve.safetensors` is byte-identical in chatterbox, chatterbox-turbo and chatterbox-nano
    (`f0921cab452fa278…`).
  - In Turbo's decoder file `s3gen_meanflow.safetensors`, `speaker_encoder.*` (937 tensors)
    and `tokenizer.*` (103 tensors) are byte-identical to core Chatterbox's `s3gen.safetensors`.
    The meanflow file adds two tensors, `flow.decoder.estimator.time_embed_mixer.weight` and
    the buffer `tokenizer.window`.
  - Nano has the same `conds.pt`, `s3gen_meanflow.safetensors` and `ve.safetensors` as Turbo.
    Only its T3 differs: `t3_nano_v1.safetensors`, GPT-2 small (hidden 768, 12 heads) against
    Turbo's GPT-2 medium (1024, 16).
- **What upstream does differently for Turbo** (`resemble-ai/chatterbox` master,
  `src/chatterbox/tts_turbo.py`, `prepare_conditionals`):
  - the clip must be longer than 5 s (an assert);
  - it is loudness-normalised to −27 LUFS (pyloudnorm, ITU-R BS.1770) before anything else;
  - the T3 prompt is 375 speech tokens from the first 15 s (`speech_cond_prompt_len = 375`,
    `ENC_COND_LEN = 15 * S3_SR`), against core's 150 tokens from 6 s;
  - the decoder prompt is the first 10 s at 24 kHz, the same as core's.
  - Emotion exaggeration is off for Turbo (`hp.emotion_adv = False`); CFG, min_p and
    exaggeration are ignored with a warning.
- **The Turbo T3 loader hard-codes 16 heads** (`t3_turbo_weights.cpp:90 weights->num_heads = 16;`),
  which is wrong for Nano's 12.
- **Licence**: Resemble's three repos are MIT and ungated.

## 3. The plan

1. **Our audio.cpp: a converter from Resemble's official files.**
   `tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py` stages
   `t3_turbo_v1` / `t3_nano_v1`, `s3gen_meanflow`, `ve` and `conds.pt`. It renames to what the
   loaders read:
   - GPT-2's Conv1D weights are transposed to `blk.N.*`;
   - `cond_enc.spkr_enc` becomes `cond.spkr_enc`, and `tfmr.ln_f` becomes `output_norm`;
   - `tfmr.wte` is dropped, as upstream does (`del t3.tfmr.wte`);
   - `mel2wav.*` becomes `v.*`;
   - flow, `tokenizer.*`, `speaker_encoder.*` and `ve` keep their own names.

   It reads `conds.pt` without torch, and it writes the head count into the GGUF. The rest of
   the conversion is `audiocpp_gguf`'s, at q8_0 and bf16. The spec gains a
   `voice_encoder_weights` tensor source and the `speaker_reference` capability.
2. **Our audio.cpp: Turbo clones.**
   - The Turbo session takes a speaker clip when the GGUF carries the encoders, and refuses it
     by name when it does not, so the old GGUF still loads and speaks its built-in voice.
   - It builds the conditionals with core's component, under Turbo's settings (375 tokens,
     15 s, 10 s, after −27 LUFS). A clip of 5 s or less is refused: "the reference clip must
     be longer than 5 seconds".
   - Prepared voices are cached like core's (`conditionals_cache_slots`).
   - The head count is read from the GGUF, defaulting to 16 for the old file.
   - BS.1770 integrated loudness at any sample rate is added beside the audio helpers.
     irodori's 48 kHz-only copy is left alone.
3. **Hugging Face**: `delebash/chatterbox-turbo-GGUF` and `delebash/chatterbox-nano-GGUF`,
   q8_0 and bf16 each, with model cards naming Resemble's repos and revisions — **needs your
   yes (Q1)**.
4. **Release**: `v0.9.0-jv.3`, `release.FEATURES["turbo_clone"]` (Q2).
5. **The app**:
   - Rows `chatterbox-turbo-q8`, `chatterbox-nano-q8` and their bf16 siblings, gated by
     `pinned_has("turbo_clone")`. English, clone-only, no preset voices.
   - Capability rows `chatterbox-turbo` and `chatterbox-nano` as they were before the switch:
     temperature 0.8, repetition penalty 1.2, top p 0.95, top k 1000, seed; the three tag sets
     (emotion with its value map, register, non-verbal). Training is not restored (gap 5).
   - The engine's `paralinguistic_tags` returns to True. Multilingual keeps none, because the
     tag filter reads the rendering variant's row.
   - The slot gets a `chatterbox_turbo` branch (clip → `voice_ref`, the knobs) and a 409
     "update the speech runtime" when the installed build lacks the feature. Warm-up uses the
     built-in voice, so a Load books its memory (the VoxCPM2 lesson).
6. **Checks**:
   - Our Turbo GGUF with no clip against audio.cpp's own Turbo GGUF, same seed, f16 vs f16,
     to prove the renaming.
   - A clone of two different voices: speaker similarity of output against reference (CAMPPlus
     embedding, the same encoder), against the other voice as control.
   - ASR read-back (WER).
   - Real-time factor and VRAM for Turbo and Nano on the GPU and the CPU.
   - Your ear on one line each.
7. **Docs**: engines.md (Turbo and Nano are back, the 5-second minimum), voices.md if the clip
   rule is shown there, whats-new, NOTICE/LICENSES (Resemble's MIT weights, our converter), the
   manifest docstring, and TASKS.

## 4. Questions

- **Q1 · Publish the two converted models on Hugging Face?** Public repos under your account,
  as with CustomVoice 0.6B. Lean: yes. The weights are MIT, and the app needs a pinned download
  source. This needs your HF token again if you revoked it after the gap-9 uploads.
- **Q2 · Which release carries it?** Lean: `v0.9.0-jv.3`. jv.2 stays gaps 2 and 3 as decided, so
  blends and IPA reach you without waiting. The cost is one more runtime download (≈2 GB for
  CUDA) when jv.3 lands.

## 5. Blast radius (greps 2026-10-03)

| Change | What it touches | Grep |
|---|---|---|
| New `chatterbox_turbo` mapping | the one place requests are built | `slot.py:536 if family == "chatterbox":` (the new branch sits beside it) · `slot.py:583 raise AudioCppError(f"no speech mapping for the {family} family")` |
| Warm-up with the built-in voice | Load's memory booking | `slot.py:277 def _warm` · `slot.py:296 elif spec["family"] == "voxcpm2":` (same shape) |
| Rows return | the Turbo test that asserts their absence | `test_audiocpp_switch.py:64 def test_turbo_and_nano_rows_are_gone_until_turbo_clones():` |
| Capability rows return | the variant → row walk | `capability_details.py:337 def lookup` · `:352-354` the `rsplit("-", 1)` walk (`chatterbox-turbo-q8` → `chatterbox-turbo`) |
| `paralinguistic_tags` True on the engine | which engines keep tags, Cast's tag column, the engines API | `render_core.py:282 return bool(manifest.capabilities.get("paralinguistic_tags"))` · `render_core.py:332 for tagset in row.inline_tags` (variant-precise, so Multilingual keeps none) · `render_core.py:359 for tagset in row.inline_tags:` (emotion → token) · `StudioCast.vue:169 if (caps.includes("paralinguistic_tags")) {` · `engines_api.py:53 "paralinguistic_tags": "paralinguistic_tags",` |
| The emotion compiler gets a real row | its test's "not on the runtime yet" text | `test_emotion_wiring.py:9-13` · `:50-52 TURBO_EMOTION = InlineTagSet(` |
| Feature gate | rows and capability follow the pin; slot follows the installed build | `capability_details.py:23 from .audiocpp.release import pinned_has` · `slot.py:312-314 has_feature("voice_pack")` (same shape) |
| Our audio.cpp: Turbo session takes a clip | the old GGUF must still load | `chatterbox_turbo/session.cpp` (the refusal) · `chatterbox_turbo/loader.cpp:18,43 out.supports_speaker_reference = false;` · `chatterbox_turbo/assets.cpp:13 open_tensor_source("builtin_conditionals_turbo")` |
| Our audio.cpp: head count from the GGUF | Turbo's own load | `t3_turbo_weights.cpp:90 weights->num_heads = 16;` |

## 6. Build record (2026-10-03)

**Our audio.cpp `3865d245`** (on `jv`, committed locally, not pushed):
- `convert_chatterbox_turbo.py` writes Resemble's checkpoint into one GGUF.
- The Turbo session clones when the GGUF has the three encoders.
- Nano loads: the head count is read from the GGUF.
- `ResourceBundle::has_tensor_source` is added.
- The spec gains `voice_encoder_weights` and `speaker_reference`.
- The docs are updated: tts.md, the community doc and the README row.

**The conversion, checked against the published (repacked) Turbo GGUF:**
- Every published tensor exists in ours, with the same shape and the same quantisation type.
  Ours adds the 1,041 encoder tensors and `t3/hparams.num_heads`.
- The three tokenizer sidecars are byte-identical.
- The five built-in-voice tensors are identical.
- Two bugs were caught by those comparisons and fixed:
  - `conds.pt` stores `prompt_feat` transposed (strides 40000, 1, 500), and safetensors writes
    the raw buffer. The built-in voice read back as nonsense until every staged array was made
    C-contiguous.
  - The sidecars came out with CRLF line endings on Windows. They are now written with LF.
- Upstream's own recipe repacks cstr's *q8_0* pair, so the published file was quantised twice.
  Ours is quantised once, from Resemble's f32 weights.
- File sizes:

  | | q8_0 | f16 |
  |---|---|---|
  | Turbo | 880,908,100 B | 1,391,709,474 B |
  | Nano | 616,250,532 B | 894,652,290 B |

  The 16-bit rows are f16, as audio.cpp ships core Chatterbox (all f16, batch-norm statistics
  included); its Turbo spec already names an `f16` package.

**Live, our CPU server build:**
- Both references are Kokoro renders: af_heart, a US woman (9.5 s, 202 Hz), and bm_george, a
  UK man (10.3 s, 142 Hz). Their two embeddings are 0.598 alike.
- Same line, seed 7, q8_0. "Sim" is the voice-encoder cosine against each reference (Resemble's
  encoder, ported to numpy).

  | Run | Sim af_heart | Sim bm_george | Median F0 | ASR read-back |
  |---|---|---|---|---|
  | Published Turbo, built-in voice | 0.706 | 0.609 | 212 Hz | exact |
  | Our Turbo, built-in voice | 0.724 | 0.640 | 220 Hz | exact |
  | Our Turbo, clone of af_heart | **0.940** | 0.604 | 205 Hz | exact |
  | Our Turbo, clone of bm_george | 0.593 | **0.923** | 146 Hz | exact |
  | Our Nano, clone of af_heart | **0.939** | 0.590 | 200 Hz | exact |
  | Our Nano, clone of bm_george | 0.582 | **0.929** | 125 Hz | exact |
  | Our Nano, built-in voice | 0.701 | 0.623 | 222 Hz | exact |

- f16 gives the same picture: clones 0.935 / 0.918 (Turbo) and 0.946 / 0.918 (Nano). One ASR
  slip, "Harper" for "harbor", on the Turbo clone of bm_george.
- The two built-in-voice renders are not sample-identical, because the weights differ (cstr's
  double-quantised chain against Resemble's f32), so sampling diverges.
- The refusals come back by name:
  - a clip on the published GGUF: "this Chatterbox Turbo package has no voice encoder or speech
    tokenizer … convert Resemble's checkpoint with …convert_chatterbox_turbo.py";
  - a 3-second clip: "Chatterbox Turbo needs a reference clip longer than 5 seconds".
- CPU wall time for one 4.6 s line: Turbo ≈ 11 s, Nano ≈ 7 s (8 threads; includes the clip's
  preparation on a cache miss). GPU numbers come with the release build.

**App (uncommitted):**
- `release.FEATURES["turbo_clone"] = "v0.9.0-jv.3"` (Q2's lean).
- The `chatterbox-turbo` / `chatterbox-nano` capability rows.
- The slot's `chatterbox_turbo` mapping, its 409 on an older runtime, and its warm-up on the
  built-in voice.
- `tests/test_turbo_cloning.py`; test_audiocpp_switch and test_emotion_wiring follow the change.

**Waiting on Q1:**
- The manifest rows need the published repos' pinned revisions.
- Until those rows exist, `test_engine_knob_wiring` fails for the two new capability rows
  (`test_every_capability_row_has_a_variant_to_drive`, and the knob test for each), because it
  drives every row through a real manifest variant.

## 7. Decided and published (2026-10-03)

"your rec on all go, commit and push":
- Q1 yes. Both repos are public, MIT, with a model card and LICENSE:
  - `delebash/chatterbox-turbo-GGUF` @ `db9317b6f796c4d11112ee845a6189328e25fb15`
  - `delebash/chatterbox-nano-GGUF` @ `e707626a9bb9d3cbb035abfaacb82616c4c3d2e7`
  - The sizes and sha256 in the repos' LFS pointers match the local files.
- Q2 `v0.9.0-jv.3`.

The manifest rows (`chatterbox-turbo-q8`, `-f16`, `chatterbox-nano-q8`, `-f16`) wait in
`PENDING_VARIANTS` and join `VARIANTS` when the pin has `turbo_clone`. The knob-wiring test reads
them there, so the two capability rows are driven through real rows now.
