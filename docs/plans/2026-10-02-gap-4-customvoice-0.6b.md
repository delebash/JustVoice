# Gap 4 — Qwen3 CustomVoice 0.6B: the small directable model, converted by us

## 1. What this is

Gap 4 of the audio.cpp switch ([switch plan §5](2026-10-01-audiocpp-switch.md)): bring back the
0.6B CustomVoice checkpoint — Qwen3's nine preset speakers you direct in plain words, at about
half the 1.7B's size. audio.cpp's model repo publishes CustomVoice only at 1.7B, so we convert
the official checkpoint ourselves with the runtime's own converter. Go: "you have a go for all
gaps" (2026-10-02, TASKS). This doc is the research and the plan as presented; the open question
is where the converted file lives.

## 2. Facts, measured 2026-10-02 (RTX 2070 SUPER 8 GB, runtime v0.9.0 CUDA build)

- **Not published anywhere we pin.** `audio-cpp/audio.cpp-gguf` at `main` (sha `351dbab…`,
  2026-10-02) holds Qwen3-TTS 0.6B **Base**, 1.7B Base, 1.7B CustomVoice, 1.7B VoiceDesign — no
  `Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF` (the API answers "does not exist on main").
- **The official checkpoint** `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` @ `85e237c…`: not gated,
  Apache-2.0, 2.5 GB (`model.safetensors` 1,811,626,576 B + `speech_tokenizer/model.safetensors`
  682,293,092 B + configs). Speakers: aiden, dylan, eric, ono_anna, ryan, serena, sohee,
  uncle_fu, vivian — the same nine as the 1.7B (our `STATIC_VOICES`).
- **The converter is native** — `audiocpp_gguf.exe` ships in every runtime build we install; no
  Python, no PyTorch. Command used (namespaces copied from the published 1.7B file's inspect):

  ```
  audiocpp_gguf --input model_weights=<src>/model.safetensors
                --input speech_tokenizer_weights=<src>/speech_tokenizer/model.safetensors
                --output qwen3-tts-12hz-0.6b-customvoice-q8_0.gguf --type q8_0
                --family qwen3_tts --model-spec model_specs/qwen3_tts.json --root <src>
  ```

  **7 seconds.** Output 1,710,423,328 B, embedded spec + 9 sidecars.
- **The 16-bit policy matches the published file.** audio.cpp's docs say a Qwen3 Q8 must keep
  speaker-sensitive tensors 16-bit (quantising them causes long-form silence). Tensor types
  (our stdlib GGUF reader): published 1.7B CV Q8 = 360 q8_0 · 145 f16 · 137 bf16 · 258 f32;
  our 0.6B = 359 q8_0 · 145 f16 · 136 bf16 · 258 f32. The converter's default selection already
  keeps the same parts 16-bit — no `--keep-type` needed.
- **It renders and reads back.** `audiocpp_cli --task tts`, speaker Ryan, English, seed 1234, on
  CUDA: 0.6B → 8.48 s of audio in 5.65 s wall (incl. load); 1.7B → 6.96 s in 6.52 s. Qwen3-ASR
  read both back word for word ("The harbor lights came on one by one, and the old ferry turned
  for home. Nobody on the quay said a word."). A written instruction ("Very sad, slow and quiet,
  close to tears.") is accepted and renders. Whether it *sounds* sad is unchecked — no listening.
- **Memory (CLI, one short paragraph):** peak over the 476 MiB baseline — 0.6B **1,385 MiB**,
  1.7B **2,489 MiB**. Not comparable with QuickSetup's "Qwen3 1.7B peaked at 7.8 GB", which was
  measured in the server; the server's footprint for the 0.6B is measured at build time.
- File sizes in the catalog: 1.7B CV 2.82 GB · 0.6B Base 1.99 GB (published) · **0.6B CV 1.71 GB**
  (ours).

## 3. The plan

1. **A new variant** `qwen3-cv-0.6b-q8` — "Qwen3-TTS CustomVoice 0.6B", nine presets, written
   direction, no cloning, the 10 languages — in `engines/qwen3/manifest.py`. The `qwen3-cv`
   capability row already covers it (`lookup` walks the suffix); the default stays the 1.7B.
2. **Its source** — the question below decides the shape.
3. **Tests**: `test_variant_wiring.py`'s id set; the family split test (`cv`) already holds; a
   request-mapping test for the 0.6B row; whatever the source choice adds.
4. **Docs**: `engines.md` (the catalog + "Not available yet" loses the line), `code-map.md` §3
   table, the qwen3 manifest docstring, the switch plan §5 gap 4, `whats-new.md`, TASKS.
5. **Checks**: gates; live through the app on the real data dir — download, load (placement and
   the server's measured footprint recorded), render a preset line with and without direction,
   ASR read-back.

**Not in gap 4:** changing the QuickSetup tiers or the Qwen3 default variant for 8 GB cards —
that is a separate call once the server's footprint for the 0.6B is measured.

## 4. Open — where the converted file comes from

- **1. Publish it on Hugging Face under your account** (a public model repo, e.g.
  `<you>/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF`, with the Apache-2.0 licence and a note that it
  is a conversion). The app downloads 1.71 GB from it, pinned by revision, like every other
  model. Needs your Hugging Face account and a write token, once; the repo is outward-facing.
- **2. Convert on each machine.** The app downloads Qwen's official 2.5 GB checkpoint and runs
  the runtime's converter (7 s here) at first Load, then deletes the 2.5 GB. No repo of ours,
  nothing published; but a new download-then-convert path in the speech cache, a bigger
  download, and this one model's Load needs the runtime's converter.
- **Recommendation: 1** — the app keeps one shape (every model is a pinned file in a repo),
  users download less, and it is the model half of the "our own copy" plan (code on GitHub,
  converted models on Hugging Face).

**DECIDED 2026-10-02: "1 go ahead and publish".**

## 5. Built, published, measured (2026-10-02)

- **Published**: huggingface.co/delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF, public, not gated,
  revision `030089f09bdd8e77b275b7ed7e503e2f24749922` — the q8_0 GGUF (sha256 `e2ac7876…f108f5`),
  `LICENSE` (Apache-2.0), `README.md` (credits Qwen, the command, the tensor split, what was and
  wasn't checked). Anonymous download: 200, full length. (`hf repo create` is `hf repos create`
  in CLI 2.1.1 — the upload created the repo itself.)
- **Wired**: `qwen3-cv-0.6b-q8` in `engines/qwen3/manifest.py` (`CV_06_REPO` / `CV_06_REVISION`,
  quality 80 — the value the pre-switch 0.6B CustomVoice row carried); `model_source` gained
  `repo=` / `revision=`. Tests: the id set, the cloning/preset flags, the request mapping and the
  wrong-family refusal now cover both CustomVoice sizes; the two "every source is audio.cpp's
  repo" assertions accept this pinned repo too. Docs: engines.md catalog + Qwen3 paragraph,
  "Not available yet" line removed, code-map §3a, models_api docstring, switch plan §5.
- **Live through the app** (headless server on the real data dir): Load with the variant
  downloaded 1.71 GB from our repo and loaded in **35 s**; memory in use **422 → 1,771 MB**
  (the arbiter later recorded its high-water at 2,231 MB). `/v1/generate`, Ryan, seed 1234:
  plain — 8.48 s of audio in 4.69 s (1.81× real time), read back word for word. **Directed
  ("Very sad, slow and quiet, close to tears.") — 19.84 s of audio, babble after the first
  clause.**
- **A/B, audiocpp_cli on CUDA, same text, Ryan, Qwen3-ASR read-back:**

  | Model | Plain, seeds 1234/7/42 | Directed, seeds 1234/7/42 |
  |---|---|---|
  | 0.6B q8_0 (ours) | 3/3 clean | **2/3** — seed 1234: 17.8 s, WER 1.18 |
  | 0.6B bf16 (ours, 2,157,313,376 B) | 3/3 | 3/3 |
  | 1.7B q8_0 (published) | 3/3 | 3/3 |

  Small sample; a different number format can take a different sampling path from the same
  seed, so one failure is a signal, not proof.
- **10 more seeds (1–10), directed only:** 0.6B q8_0 **10/10** clean (seed 8: one word, WER
  0.05); 0.6B bf16 10/10; 1.7B q8_0 10/10. **Combined directed: 0.6B q8_0 12/13, 0.6B bf16
  13/13, 1.7B q8_0 13/13.** Not enough to call the q8 worse; the one failure is deterministic
  (seed 1234 repeats it) and is the same failure class the 1.7B showed once under both runtimes
  (switch plan §2.1). Shipped as decided (8-bit, R3); the larger 0.6B q8 vs bf16 comparison
  rides gap 9 (16-bit rows), with the bf16 file already converted (2,157,313,376 B, scratch).
