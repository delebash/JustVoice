<!-- SPDX-License-Identifier: MIT -->
# The 2026 TTS engine scan — IndexTTS 2.5, FireRedTTS3, FireRedAudio, audio.cpp's catalogue and the rest of the field

**Research only. Nothing was decided, nothing was started, nothing was measured on this
machine.** Every fact below was read from upstream repos, model cards, papers and leaderboards
on **2026-09-30** by five web researchers, then recorded here on 2026-10-01. Quality numbers are
the model authors' own unless a line says otherwise. The rulings this research needs are in §12.

**What the user asked (verbatim, 2026-09-30):**

- *"what are your thoughts on index tts 2.5, are there any other tts egnines that you would
  recommned adding, search for the latest"*
- *"FireRedTTS3 take a look at https://github.com/0xShug0/audio.cpp see if it has any engines we
  might want to add"*
- *"check https://github.com/FireRedTeam/FireRedAudio"*
- *"we dont have to stick with bf16 we can use quant versions"* — so VRAM at bf16 is not a
  blocker on its own; a quantised path that exists and holds quality is enough (§5).
- 2026-10-01: *"record the findings in detail in a new doc with a pointer in ideas"*.

**What every engine was judged against** — the standing rules, not new ones:

| Rule | Where it lives |
|---|---|
| Keep an engine only if it is the ONLY one that does something we need | `2026-08-17-engine-roster-and-platform.md` §1 |
| Weights download anonymously — no Hugging Face login or terms gate | `2026-08-22-engine-environment-and-platform-research.md` (Pocket TTS ruling) |
| Weights and output must permit commercial use | IDEAS 2026-09-30 (the Breeze TTS 2 / Higgs case) |
| Zero-shot cloning for the audiobook path | roster §1 |
| Windows 11 + NVIDIA first, Linux too; one uv venv per engine on Python 3.13, torch 2.13 (band 2.9.1–2.13 render-proven) | `docs/dev/code-map.md` §3e, env research |

The current roster, for comparison: Kokoro (presets, CPU), Chatterbox Turbo (cloning + inline
tags), Chatterbox Multilingual (cloning, 23 languages), Qwen3-TTS (prose direction + voice
design; Base clones but drops `instruct`), LuxTTS (CPU cloning), Whisper (STT). TADA and
MOSS-TTSD are marked and hidden.

---

## 1. Verdicts at a glance

These are the recommendations given in the conversation, not decisions.

| Engine | Recommendation | The deciding reason |
|---|---|---|
| **IndexTTS 2.5** | **Not now** | Custom Bilibili licence whose outputs may not be used to improve another AI model; Python <3.12 + torch 2.8; English is its weakest language |
| **FireRedTTS3** | **Test before adopting** | Best self-reported English speaker similarity, Apache-2.0 metadata, ungated — but an "academic research purposes" disclaimer, torch 2.8 + hard-coded flash-attn, 20.8 GB fp32 |
| **FireRedAudio** | **No** | A 9B sibling of FireRedTTS3 that matches voices less well in English; zh/en only; Python <3.11; compiled kernels; no Windows report anywhere |
| **VoxCPM2** | **Test** | Clones and takes a style description in one Apache-2.0 model, 30 languages, 48 kHz — fills the IndexTTS gap without its licence |
| **Step-Audio-EditX** | **Test** | Highest-ranked shippable open model in the Artificial Analysis arena; the only narration-grade candidate already inside our Python/torch band |
| **MOSS-TTS-Nano / Sopro** | **Test for the CPU cloning slot** | 100M / 120M Apache-2.0 cloners that run on CPU — either could replace LuxTTS |
| **audio.cpp** | **The cheapest door to test all of the above** | It already ships 8-bit and 16-bit GGUF builds of IndexTTS 2.5, FireRedTTS3, VoxCPM2, dots.tts and MOSS-TTS-Nano with Windows CUDA and Vulkan binaries |

The gap that keeps coming up: **emotion or style on a cloned voice.** Qwen3 Base clones but
silently drops `instruct`; CustomVoice takes `instruct` but cannot clone; Chatterbox Turbo has
tags but a fixed vocabulary. IndexTTS 2.5, VoxCPM2, dots.tts (edit model) and Step-Audio-EditX
each close that gap in a different way.

---

## 2. IndexTTS 2.5 (Bilibili IndexTeam)

### 2.1 What it is

- **It exists.** Weights on Hugging Face `IndexTeam/IndexTTS-2.5` created **2026-08-10**; README
  news entry the same day; tech report arXiv **2601.03888** (v1 2026-01-07, revised v4/v5
  2026-08-08/11). Lineage: 1.0 2025-03-25, 1.5 2025-05-14, 2 2025-09-08. **No IndexTTS 3** exists.
  Naming quirks: `pyproject.toml` still says version 2.0.0; the LICENSE calls the model
  "bilibili indextts2".
- **Pipeline (unchanged from 2):** autoregressive GPT text-to-semantic (~0.8B) → non-AR
  semantic-to-mel → BigVGAN vocoder. ~100K hours of training data.
- **What the paper says changed:** semantic codec 50 Hz → 25 Hz; S2M backbone U-DiT → Zipformer;
  Japanese, Spanish and Arabic added (five languages: zh/en/ja/es/ar); GRPO post-training; a
  2.28× RTF gain on an A10.
- **What actually shipped may differ.** The shipped `config.yaml` still declares `dit_type: "DiT"`
  and the repo has zero Zipformer files. The README's own RTX 4090 table shows **1.58×**
  (RTF 0.3257 → 0.2065), not 2.28×. Issue #801 asks which S2M shipped and whether the public
  `gpt.pth` is the base or the "-RL" row — no maintainer reply.

### 2.2 Capabilities

- Zero-shot cloning from one clip; the first **15 s** are used.
- **Three emotion-control modes**, the widest emotion API in the open field: an emotion reference
  clip with `emo_alpha` blending, an **8-float emotion vector**, or emotion from text via a bundled
  Qwen3-0.6B emotion model.
- Speed via `duration_factor` 0.5–2.0.
- Inline pronunciation overrides: Pinyin, CMU phonemes, Kana.
- Cross-lingual cloning across its five languages.
- A March 2026 third-party study (*Iterate to Differentiate*, arXiv 2603.24430) found it **best
  of 11 open models on emotion-control F1** — but only **54–59 %** on free-form instruction
  following, against CosyVoice3 64–76 % and Qwen-Audio-3.0 79–80 %. It controls emotion well; it
  does not follow prose direction the way Qwen3 CustomVoice does.

### 2.3 Licence — the blocker

- **Code and weights are both under one custom "bilibili Model Use License Agreement"** — not
  OSI; GitHub detects `NOASSERTION`; Hugging Face tag `license: other`,
  `license_name: bilibili-model-license`. The repo was **Apache-2.0 until 2025-09-09** (PR #300).
- Commercial use is **not prohibited below 100M monthly active users or RMB 1 billion annual
  revenue**; above that a separate licence is required. There is **no explicit commercial grant
  sentence**.
- **It forbids using the model or its outputs "to improve any AI model"** except non-commercial
  ones, and "Derivative Work" includes model outputs. In this app that would bar feeding
  IndexTTS output into the Dataset Builder or a LoRA run.
- Must retain the licence text and impose its terms downstream; **revocable on breach**; PRC law,
  Shanghai arbitration, **the Chinese text prevails**.
- The 2025 DISCLAIMER lists "using synthesized voices commercially without authorization" as
  prohibited — ambiguous against the licence itself. **Issue #228 asking for licence
  clarification has been unanswered since July 2025.**
- Components: w2v-bert-2.0 MIT, BigVGAN MIT, campplus Apache-2.0, Qwen3-0.6B (emotion model base)
  Apache-2.0. **The amphion/MaskGCT semantic codec is CC-BY-NC-4.0** and is still downloaded
  unconditionally by `ensure_models_available()`, though `infer_v2_5.py` never loads it (2.5 uses
  its own `codec.pth` through Amphion's MIT code).

### 2.4 Distribution

- **Ungated:** HF API `gated: false`; an anonymous HEAD on `gpt.pth` redirects to the CDN with
  `user_id=public`; ModelScope serves files with HTTP 200 without login.
- Sizes: `gpt.pth` 3.26 GB, `codec.pth` 607 MB, `s2mel.pth` 415 MB, Qwen emotion model 1.19 GB —
  **repo 5.49 GB**. First run pulls **≈5.3 GB more** of auxiliary models (the full w2v-bert
  snapshot is 4.65 GB, including an unused 2.3 GB file).
- **Not on PyPI** (`indextts`, `index-tts`, `indextts2` all 404). Git + uv only.

### 2.5 Requirements and Windows

- `requires-python ">=3.10,<3.12"` (`.python-version` 3.11.13), `torch==2.8.*` /
  `torchaudio==2.8.*` from the cu128 index, `transformers==4.52.1`, uv mandatory. **Outside our
  band on both Python and torch.**
- **Python 3.13:** PR #728, open since 2026-07-30, needs `audioop-lts`, pynini 2.1.7 and
  WeTextProcessing 1.2.0; its author ran it on torch 2.13 + CUDA 13 on Linux. On 2026-09-29 the
  maintainer said the base dependencies lock fine for Python 3.13 on Windows x86_64 and only the
  optional `accel` / `torch_compile` extras break, on a `triton-windows` pin (newer
  `triton-windows` releases do have cp313 wheels).
- A torchaudio ≥2.9 WAV-saturation bug was fixed 2026-08-18; saving now goes through TorchCodec,
  so newer torchaudio needs `torchcodec` + FFmpeg.
- **Windows is a first-class packaging target:** platform markers for `wetext` (pure Python, so
  no pynini on Windows) and `triton-windows`; README Windows notes; one-click Windows 10/11
  bundles for 2.5 exist (NVIDIA ≥6 GB, Python 3.10/3.11). Pain points: DeepSpeed (won't build —
  README says skip it on Windows), flash-attn/triton for the optional extras, page-file errors.
  Japanese/Spanish NeMo text normalisation is optional and effectively unavailable on Windows.
- No 2.5-specific Windows bug reports found. Older IndexTTS 2 reports: DeepSpeed build failures,
  RTX 5090 RTF 1.16 on Windows/WSL2, a pathological RTX 3060 RTF 13.1 (2025).

### 2.6 Speed and memory

- **≈6 GB VRAM at bf16.** Below 10 GB VRAM the code auto-chunks text to 40 characters.
- RTX 4090 bf16 (official table): RTF **0.2065** overall, **0.2871** for 7-character lines —
  about 5× real time. Model load ≈19 s.
- No CPU numbers anywhere, though CPU runs by device fallback.
- Faster paths: an official vLLM-Omni recipe (Linux); an in-repo TensorRT / TensorRT-LLM backend
  (Linux, from the *Faster IndexTTS-2* paper, arXiv 2607.21042: 3.6× end to end); audio.cpp GGML
  with Windows CUDA/Vulkan builds and Q8/F16 GGUFs, claiming 8.5× real time. MLX 8-bit port exists
  (`vanch007/mlx-indextts2-2.5-8bit`).

### 2.7 Quality

- **Official CV3-Eval table** (five languages + in-house Arabic): IndexTTS2.5-RL avg WER **6.00** /
  SS **73.63** (base row 6.75 / 73.18) vs VoxCPM2 7.22 / 72.02, Fish S2 Pro 5.94 / 64.49,
  MOSS-TTS 1.5 9.40 / 68.56. **CosyVoice3 has higher SS in every shared language**; Qwen3-TTS has
  lower WER in zh and es.
- **English is its weakest language for speaker similarity: SS 67.8 vs 77.9 for Chinese**,
  although English WER (3.89, RL row) is good.
- Emotion accuracy zh **0.713** vs CosyVoice3 **0.467**.
- Seed-TTS-Eval, self-reported: test-en WER 1.889, test-zh 1.426 — slightly worse than
  IndexTTS 2's own 1.521 / 1.008. Third-party 2026 tables put IndexTTS 2 at test-en 2.23 % WER /
  70.6 SIM, behind Fish S2 (0.99), Qwen3-TTS (1.23–1.24), dots.tts (1.30), Confucius4 (1.49),
  MOSS-TTS (1.84) and VoxCPM2 (1.84).
- **Not in any arena** (Artificial Analysis or HF TTS Arena). The only independent A/B is a
  single listener in issue #801 who found **2.0 better than 2.5 on Chinese, 5 of 6**.

### 2.8 Long-form behaviour

- A segment synthesiser: text splits at punctuation into ≤120-token segments, each generated
  independently with beam search, stitched with 200 ms silence. The model card says prosody is
  **not** modelled across boundaries.
- **Issue #775 (2026-08-15): English paragraphs collapse** into "fluent-but-wrong" audio at the
  default 120-token budget — 0/8 correct, vs 5/5 at 60. The budget was calibrated for Chinese
  (≈25 s) and yields ≈38 s English segments; >≈30 s "almost always collapses". PR #802 (scale the
  budget by 0.72) was still unmerged on 2026-09-29.
- Issue #800: speech rate drags at the end of long inputs. Open, unanswered.
- A fade-out fix for end clicks landed 2026-09-29.
- For this app: drive it line by line with small segments, which our per-line render already does.

### 2.9 App fit details

Reference audio: any librosa-readable file, first 15 s, resampled internally to 22.05 and 16 kHz.
**Output: 22.05 kHz 16-bit mono WAV.** Streaming is per segment (`stream_return=True` /
`infer_generator`), not token-level. Batching only in the TensorRT/Triton backend; the Python path
does one utterance at a time. Per-line latency on a 4090 ≈ 0.3× the line's duration.

### 2.10 Maintenance

24.2k stars, 2.9k forks, **408 open issues**, last push 2026-09-29. Bursty: ~24 commits in August,
8 on one day in September. Many substantive issues — licence, quality regression, long-form
collapse, Windows speed — have no maintainer reply.

### 2.11 What would change the verdict

A written licence clarification that permits commercial output use and output-as-training-data;
PR #728 merging (Python 3.13 + newer torch); PR #802 merging (English segment budget). Running it
through audio.cpp would remove the Python/torch objection but not the licence one.

---

## 3. FireRedTTS3 (FireRedTeam, Xiaohongshu / RedNote)

### 3.1 What it is

- **Exists:** GitHub `FireRedTeam/FireRedTTS3` and Hugging Face went live **2026-08-13**; arXiv
  **2608.17492** on 2026-08-21. Official spelling has no hyphen. Model card: Base 2026-08-05,
  Instruct 2026-08-13.
- **A new lineage, not an upgrade of FireRedTTS-2.** FireRedTTS-2 (Sept 2025) used a discrete
  12.5 Hz tokenizer and a dual transformer for dialogue/podcasts and remains the family's only
  dialogue model. FireRedTTS3 uses a continuous 25 Hz **"RedAE"** autoencoder (semantically
  supervised by FireRedAudio's frozen audio encoder), a **Qwen3-1.7B** backbone, a patch-level DiT
  generating 6.25 Hz patches, and a CAM++ speaker embedding. 24 kHz output.
- Training: 2.6M hours (zh/en), then 560k hours across **24 languages + 21 Chinese dialects**.
- One observer notes its weight structure matches VoxCPM2's (secondary source, on X).

### 3.2 Capabilities

- **FireRedTTS3-Base:** zero-shot cloning from a reference clip **plus its transcript**, 24
  languages and 21 dialects, one speaker per call, built-in sentence chunking.
- **FireRedTTS3-Instruct:** text-only voice design (emotion words allowed in the description) and
  semantic/acoustic editing; Chinese/English focus.
- **Not supported:** multi-speaker dialogue, streaming, paralinguistic tags, **emotion control
  over a cloned voice**.

### 3.3 Licence

- Code: the unmodified **Apache-2.0** text in the GitHub LICENSE.
- Weights: HF metadata `license: apache-2.0`, **no LICENSE file in the HF repo**.
- README and model card add that the zero-shot cloning capability **"is intended solely for
  academic research purposes"**. This is a disclaimer paragraph, not a licence clause — identical
  boilerplate appears on FireRedTTS-2, FireRedTTS3 and FireRedAudio. There is no explicit
  commercial grant or prohibition. **It needs a ruling, not an engineering answer** (§12).
- Upstream component licences (Qwen3, CAM++ `campplus_voxceleb.bin`, fastText `lid.176.ftz`) were
  not verified.

### 3.4 Distribution and requirements

- HF and ModelScope `FireRedTeam/FireRedTTS3`, **ungated**. **20.8 GB total:** two 8.48 GB
  **fp32** cores (Base, Instruct) + ≈3.8 GB shared RedAE/CAM++/tokenizer. Cloning-only (Base +
  shared) ≈ **12.3 GB**.
- Git-only install (`pip install -r requirements.txt`; no PyPI package, no pyproject). Pins:
  `torch==2.8.0`, `torchaudio==2.8.0`, `torchcodec==0.7.0`, **`flash_attn==2.8.3`**,
  `transformers==5.6.2`, plus `wetext` (pure Python, no pynini), `fasttext`, `faster-whisper`.
- **`attn_implementation="flash_attention_2"` is hard-coded in three places** and the device is
  hard-coded to CUDA. Python version unstated (launchers use 3.10/3.11; the HF Space uses 3.12).
  **No evidence for Python 3.13 or torch 2.9–2.13.**
- **Windows:** no official word, but three third-party packagings run it by swapping flash-attn
  for SDPA — Pinokio (torch 2.8.0 cu128, states 16 GB VRAM), the pyvideotrans one-click package
  (≥8 GB cloning-only, ≥16 GB full), and a ComfyUI node with a Windows zip (INT8 under 8 GB).

### 3.5 Speed, memory and quantised builds

- No official numbers. Third-party: fp32 peaks at **13.1 GiB**; a community INT8 conversion
  (`drbaph/FireRedTTS3-int8`) peaks at **8.3 GiB** and runs ≈1.3× slower. One user reports
  **RTF ≈0.9 on an RTX 3090** (issue #9, unanswered) — about real time.
- audio.cpp v0.7 (2026-08-26) ships Q8 GGUF and claims "4x faster than realtime" on unstated
  hardware. Also: a bf16 re-save, an F16 GGUF (`cstr/fireredtts3-GGUF`), ONNX, MNN and MLX ports.
  No vLLM path.

### 3.6 Quality

Objective metrics only, no MOS/CMOS:

| Seed-TTS-Eval | WER/CER | SIM |
|---|---|---|
| test-EN | 1.64 % (2nd to Qwen3-TTS 1.23 %) | **77.2 (best in its table)** |
| test-ZH | 1.01 % | 80.9 |
| test-Hard | 6.50 % | 78.4 |
| Average | 3.04 % | 78.8 — best of CosyVoice3-1.5B, IndexTTS2, Qwen3-TTS, Seed-TTS, F5-TTS, VoxCPM2, dots.tts, MiniMax-Speech, DiTAR, FireRedTTS2 (4.02 / 70.1) |

On the 24-language MiniMax-MLS-Test it reports the best average (WER 3.75 %, SIM 84.8 %) against
MiniMax, ElevenLabs, VoxCPM2, Fish S2 and dots.tts. **No independent evaluation or arena entry
exists.**

### 3.7 Long-form

No documented maximum. The code chunks text itself (≈60–80 tokens per English chunk) and caps each
chunk at 400 patch steps (≈64 s), stopping earlier via a learned stop head. All published
evaluations are short utterances; issue #10 challenging long-sequence robustness is unanswered.
Cross-line consistency is unmeasured; the same reference + fixed seed (default 1234) gives a
deterministic speaker embedding per call.

### 3.8 Maintenance

First commit 2026-08-13, **15 commits by one maintainer**, the last on 2026-09-08 (README only
after the upload); 6 open / 1 closed issues, **zero maintainer replies**; 19 forks. Unusually broad
third-party uptake in six weeks: audio.cpp, ComfyUI, Pinokio, a Windows package, GGUF/ONNX/MNN/
MLX/INT8 ports, an HF Space.

### 3.9 What it would fill

Highest-similarity cloning across 24 languages, which overlaps Chatterbox Multilingual (23, or 25
in v3) and Qwen3 Base. Under the roster rule it earns a slot only if it is audibly better at
cloning — hence "test before adopting". Instruct overlaps Qwen3 VoiceDesign.

---

## 4. FireRedAudio (FireRedTeam)

- **What it is:** a general audio LLM on a **9B Qwen3.5 dense backbone** (mixed linear/full
  attention 3:1), a Whisper-large-v3-initialised encoder, and the same RedAE / 6.25 Hz patch / DiT
  generation design as FireRedTTS3 (DiT depth 11, hidden 1024). It does ASR, audio understanding
  with chain-of-thought, zero-shot TTS, instruct TTS (voice design) and speech editing. **A
  sibling of FireRedTTS3, not the same checkpoint** — same InstructTTSEval scores within ~1 point,
  on a 5× larger backbone.
- **Dates:** README and HF say code + weights 2026-08-21 (the GitHub "init" commit is dated
  2026-08-22); Gradio demo 2026-09-08. 2.0k stars, 18 forks, 8 commits.
- **Languages:** "Everything but ASR is Chinese/English only."
- **Licence:** identical to FireRedTTS3 — Apache-2.0 code, `license: apache-2.0` metadata, no
  LICENSE file anywhere in the HF repo, the same "academic research purposes" disclaimer. Nothing
  addresses outputs.
- **Distribution:** ungated; **29.7 GB** — 21.2 GB of bf16 safetensors (five shards) + an 8.4 GB
  `RedAE_decoder/model.pt`.
- **Requirements:** Python **">=3.10,<3.11"**, `torch==2.11.0` (cu128), `transformers==5.8.0`.
  The `accel` extra installs flash-linear-attention 0.5.0 + liger-kernel 0.8.0; `accel-build`
  compiles causal-conv1d 1.6.2.post1 + flash-attn 2.8.3. The loader falls back from flash-attn to
  SDPA and skips liger with a warning; whether the linear-attention layers run without
  `fla`/`causal-conv1d` is not handled in the loader and is unverified. **No Windows mention,
  package or report anywhere.**
- **VRAM/speed:** nothing official; a Chinese write-up estimates "about 20 GB class". The CLI
  implies 160 ms of audio per autoregressive step and a 120 s per-call cap. No RTF published.
- **Quality:** Seed-TTS-Eval avg CER/WER **1.20 %** (best in its own table) but SIM **0.71**;
  English WER 1.56 / **SIM 0.68** — below CosyVoice3-1.5B (0.75), Seed-TTS (0.78) and
  FireRedTTS3-Base (0.772 EN). Its table omits IndexTTS2, Qwen3-TTS, MOSS, Fish, Chatterbox and
  FireRedTTS3. No English community reports.
- **Control:** emotion/style only through voice-design instructions; no emotion over a cloned
  voice; no dialogue mode (issue #11 asks); no consistency mechanism.
- **Quantisation:** none first-party — the loader takes only `torch_dtype`, the model is a custom
  `FireRedAudioForCausalLM` (`model_type: firered_audio`, no `auto_map`), so a generic
  transformers `quantization_config` would not apply. Community: two MLX 8/4-bit repos with no
  cards, and audio.cpp's Q8 GGUF. No AWQ/GPTQ/FP8, no llama.cpp port. Nobody has published VRAM at
  any precision.

**Verdict: no.** Everything it does for TTS, FireRedTTS3 does with better English similarity on a
smaller, more portable stack.

---

## 5. Quantisation — what holds up

The user's word: *"we dont have to stick with bf16 we can use quant versions."* The evidence on
whether that holds for speech:

- **arXiv 2609.28974 (2026-09-24), post-training quantisation across 13 TTS systems:** 8-bit
  weights are generally safe; 4-bit is architecture-specific; **the diffusion/flow decoder is the
  fragile part.** VoxCPM's local DiT — the same LLM + local-DiT + VAE shape as both FireRed models
  — lost 2.73 UTMOS at W4, recovered to −0.71 with GPTQ. Chatterbox kept quality with its LLM at
  W4 and its decoder at W8.
- FireRedTTS3 community INT8: only layer-level metrics (cosine similarity ≥0.99995, relative L2
  ≤0.012) — no WER, SIM or listening test.
- Community ear reports: Qwen3-TTS INT8 ≈ BF16; Higgs Audio 8-bit "near perfect", 4-bit "fair".
- audio.cpp Qwen3 Q8 (its current report): peak 7873 → 6397 MiB long-lived, 9412 → 8138 MiB
  long-form.

**Reading:** Q8 is the safe default for every candidate here. 4-bit only with a listening test,
and never on the DiT/flow decoder.

---

## 6. The rest of the 2026 field

### 6.1 Clean candidates — commercial weights, ungated, zero-shot cloning

| Engine | Org · date | Size | Languages | Control | Python / torch | Notes |
|---|---|---|---|---|---|---|
| **VoxCPM2** | OpenBMB · 2026-04 | 2B | 30 + 9 dialects | clone (ref + transcript for "Ultimate Cloning") + description-based voice design + inline style | README "≥3.10 (<3.13)"; PyPI `voxcpm` 2.0.3 declares `>=3.10`, `torch>=2.5` | 48 kHz; streaming; ~8 GB, RTF ~0.30 on a 4090 (0.13 with Nano-vLLM); Seed-TTS EN 1.84 / 75.3; 38.2k stars; timbre drifts in long single passes (issue #302) |
| **Step-Audio-EditX** | StepFun · Jan 2026 refresh | 3B | zh, en, Sichuanese, Cantonese, ja, ko | ~14 emotions, ~30 styles, 20+ paralinguistic tags; edits existing audio iteratively | **≥3.12, torch ≥2.9.1** | AA arena #3 open, Elo 1093; 12 GB optimal, 16 GB safer; AWQ 4-bit variant; keep audio <30 s per call; Linux-primary, no Windows notes; HF record has **no licence tag** (repo LICENSE is Apache-2.0) |
| **dots.tts** | RedNote + SJTU · 2026-06 | 2B | — | clone (~10 s ref + transcript, or x-vector) + an `edit` model (Aug 2026) for emotion/prosody/pause via XML tags | `<3.13`, torch ≥2.8 | 48 kHz; best published Seed-TTS EN (SOAR 1.30 / 77.1); MeanFlow RTF 0.13–0.15, 5.74 GB peak; **pynini/WeTextProcessing** on Windows needs a community wheel; torch.compile crashes on Windows |
| **Confucius4-TTS** | NetEase Youdao · 2026-05/06 | 1.3B | 14 | transcript-free cloning, "emotion transfer" | official env 3.10, CUDA 12.6 | streaming; Seed-TTS EN 1.49 / 0.700; experimental in audio.cpp |
| **MOSS-TTS v1.5 / Local-v1.5 / Nano** | OpenMOSS, Fudan · 2026-02→06 | 8B / 4.5B / 0.1B | 31 | `[pause X.Ys]`, duration, Pinyin/IPA control; instructions "not reliably followed" | 3.12, **`torch==2.9.1+cu128`**, transformers 5 | v1.5 8B: up to 1 h single run, q8 needs ~17.9 GiB, RTF 0.8 on a 3090; **Nano: 100M, CPU real time, ONNX CPU build**; Windows via WSL/conda officially, a pure-PyTorch Windows port exists |
| **Tencent AuK** | Tencent Hunyuan + SJTU · 2026-09 | 1.5B DiT + Qwen2.5-Omni-3B encoder | — | one instruction interface: TTS, editing, paralinguistics | 3.10 | MIT; ~25 GiB peak (17 GiB with CPU offload) |
| **Ming-omni-tts-0.5B** | Ant inclusionAI · 2026-02 | 0.5B | zh, en | rate/pitch/volume/emotion | — | no Windows notes |
| **Audio8-TTS-Preview-0.6b** | Audio8 · 2026-07 | 0.6B | 11 | clone | ≥3.10, torch ≥2.5, transformers <5 | 44.1 kHz; ONNX INT4 ≈1 GiB; Seed-TTS EN 1.506 |
| **MioTTS-1.7B** | individual · 2026-02 | 1.7B | en, ja | clone | — | RTF 0.10 on a 5090 (vLLM); GGUF + CPU llama.cpp tool |
| **Gepard 1.0** | nineninesix · 2026-06→08 | 0.56B | en, es, pt, nl | clone | 3.12, vLLM, nvcc | ~25× real time, 50 ms first audio on a 5090; codec under NVIDIA Open Model License |
| **Sopro v2-turbo** | individual · 2026 | 120M | en, pt-PT, fr, de | clone from 5–20 s | PyPI `sopro` 2.2.0: `>=3.10`, `torch>=2.3` | Apache-2.0; RTF 0.24 on an M3 **CPU**; browser ONNX; streaming not bit-exact with offline |
| **VoXtream2** | KTH · 2026-03 | 0.5B | en | clone, speaking-rate control | pins `torch<2.9` | CC-BY-4.0 weights; 74 ms first packet; 2.2 GB |

### 6.2 Fit by use

- **Long-form narration with emotion on a cloned voice:** VoxCPM2, then dots.tts and
  Step-Audio-EditX; FireRedTTS3, Confucius4 and MOSS-TTS-Local-v1.5 as heavier alternatives.
- **Fast per-line game dialogue:** Gepard, MioTTS-1.7B, Audio8 0.6B, Sopro, VoXtream2 (all clone).
  Preset/designed-voice options: Maya1 (Apache-2.0, description-designed voices + 20 emotion tags,
  AA Elo 1045, no cloning) and NVIDIA Magpie 357M (5 voices, 13 languages, Elo 1063, NVIDIA Open
  Model License, no cloning).
- **CPU cloning slot (today LuxTTS):** MOSS-TTS-Nano (100M, ONNX CPU) or Sopro (120M). LuxTTS is
  the slot ROADMAP already wants to vendor because it lives in one person's repo.

### 6.3 Excluded

| Engine | Why |
|---|---|
| Fish Audio S2 Pro | Fish Audio Research License (non-commercial); 22 GB; Windows 5 tok/s vs WSL2 24 |
| Higgs Audio v3 | Boson Research and Non-Commercial License |
| Voxtral TTS (Mistral) | CC BY-NC 4.0 (secondary source; model card not verified) |
| OmniVoice | weights CC-BY-NC since 2026-07-03 — the widely reported "Apache 2.0" is the code only |
| Raon-OpenTTS | CC BY-NC 4.0 |
| Breeze TTS 2 | non-commercial (IDEAS 2026-09-30) |
| MiraTTS, Echo-TTS | CC-BY-NC-SA |
| F5-TTS, OuteTTS, Vevo2, XTTS | non-commercial |
| NeuTTS (Air / Nano / 2E) | **HF-gated** (`gated: auto`, a 2026-08 change); also a <$5M revenue licence |
| Orpheus | HF-gated |
| Sesame CSM | HF-gated + Llama gate |
| OpenAudio S1 Mini | HF-gated + non-commercial |
| VibeVoice | MIT, but embeds an audible AI disclaimer and says "not for commercial"; 2026 releases are ASR only; the 7B weights are a community mirror |
| ZONOS2 | Linux only (x86_64) |
| DramaBox | LTX-2 Community License: $10M revenue cap, derivatives must carry the licence, Gemma terms |
| KaniTTS-2, LFM2.5-Audio | LFM Open License, $10M cap |
| Supertonic 3 | OpenRAIL-M and still no open cloning |
| MiniMax H3 | no rights in the USA/EU/UK |
| sanoTTS | GPL-3.0 |
| MiMo-V2.5-TTS | no weights (IDEAS 2026-09-30) |

**Not new in 2026 or not open:** CosyVoice3 (Dec 2025; Apache-2.0 but Python 3.10, pynini, and a
`torch==2.3.1` pin), GLM-TTS (Dec 2025, MIT, Python ≤3.12), Dia2 (Nov 2025), Spark-TTS, Llasa,
Kimi-Audio, Marvis, Muyan; StyleTTS 3 and XTTS v3 do not exist; Cartesia, ElevenLabs, ByteDance
Seed are closed; PlayHT shut down; Inworld released code only.

---

## 7. Field-wide quality evidence

### 7.1 Arenas (fetched 2026-09-30)

**Artificial Analysis, overall:** Eleven v4 1316, Sonic 3.6 1275, Gemini 3.8 Flash TTS 1268,
Qwen-Audio-3.0-TTS-Plus 1258. No open model is in the overall top 10.

**Artificial Analysis, open weights (provider voices):**

| # | Model | Elo | Shippable? |
|---|---|---|---|
| 1 | Breeze TTS 2 | 1207 | no — non-commercial |
| 2 | Fish S2 Pro | 1118 | no — research licence |
| 3 | **Step-Audio-EditX** | **1093** | **yes** |
| 4 | Voxtral TTS | 1080 | no — CC BY-NC |
| 5 | Kokoro | 1064 | shipped |
| 6 | Magpie | 1063 | no cloning |
| 7 | Maya1 | 1045 | no cloning |
| 8 | OpenAudio S1 Mini | 1042 | no — gated + NC |
| 9 | Higgs v3 | 1037 | no — NC |
| 10 | Chatterbox | 1023 | shipped |
| — | Zonos (anchor) | 1000 | — |
| — | VibeVoice | 955 | — |

The cloned-voice arena tops out at Breeze TTS 2 (1022) among open weights, against closed leaders
around 1184. **IndexTTS 2/2.5, Qwen3-TTS, VoxCPM2, CosyVoice3, GLM-TTS, MOSS-TTS, dots.tts and
FireRedTTS3 are not in any arena**, so no arena can rank them. The HF TTS Arena V2 open section was
unreadable (an app shell). EmergentTTS-Eval's public board is stale (Aug 2025); its 2026 numbers
are all self-reported (Fish S2 81.9 %, dots.tts 47.6–49.2 %, Qwen3-TTS 42.8 %, VoxCPM2 41.1 %).

### 7.2 Seed-TTS-Eval test-EN, as reported across 2026 papers

| Model | WER % | SIM | Source |
|---|---|---|---|
| Fish S2 | 0.99 | — | 2026 papers |
| Qwen3-TTS | 1.23–1.24 | — | 2026 papers |
| dots.tts SOAR | 1.30 | 77.1 | self |
| Confucius4-TTS | 1.49 | 70.0 | self |
| Audio8 0.6B | 1.506 | — | self |
| FireRedAudio | 1.56 | 68 | self |
| FireRedTTS3 | 1.64 | **77.2** | self |
| VoxCPM2 | 1.84 | 75.3 | self |
| MOSS-TTS (Delay) | 1.84 | — | 2026 papers |
| IndexTTS 2.5 | 1.889 | — | self |
| IndexTTS 2 | 1.52 self / 2.23 third-party | 70.6 third-party | — |

### 7.3 Long-input stability and practice

- **Nothing open is safe on multi-paragraph input in one pass.** IndexTTS 2.5 English collapse
  (§2.8); Chatterbox Turbo hallucinates beyond ≈350 characters (PR #457 unmerged); VoxCPM2 drifts
  in timbre over long passes. The Qwen-Audio-3.0 paper's 1–3 minute one-pass test: VoxCPM2 en WER
  3.2 but prompt-SIM 61.7; CosyVoice3-1.5B 23 % WER; dots.tts 29 % WER. VibeVoice's 90-minute claim
  comes with 22.6 % Chinese WER in Qwen3's long test.
- **Practice:** chunk at sentences — IndexTTS 60–86 tokens for English, Chatterbox servers 120–300
  characters, Alexandria 500 characters per speaker run; re-inject the reference each chunk; the
  better tools add a Whisper round-trip check with retry (tts-audiobook-tool).
- The Trelis benchmark on tricky text: Kokoro 17 % CER / 4.5 MOS, best open; Chatterbox 86 % CER.

### 7.4 Consistency across separately generated lines

No engine is consistent by default. Qwen3-TTS drifts in prosody across chunks even with a fixed
seed (discussion #220); x-vector-only cloning is markedly more consistent (tts-serve #37,
2026-09-20). One 2026 write-up dropped Qwen3-TTS for Chatterbox Multilingual, which "eliminated
seed dependency entirely" at ~5 GB VRAM. **No cross-engine line-to-line similarity measurement
exists** — for casting, this is the number that matters and nobody has published it.

### 7.5 What practitioners use

2026 audiobook tooling (tts-audiobook-tool, TTS-Story, Alexandria, ebook2audiobook) treats Qwen3-TTS,
Chatterbox Turbo/Multilingual, IndexTTS 2/2.5, VoxCPM, Fish S2 Pro and Kokoro as interchangeable
backends behind chunking + ASR verification. Write-ups favour Chatterbox Multilingual for
consistency, Qwen3-TTS for voice design with LoRA, Kokoro for accuracy per watt; IndexTTS 2.5 is
valued specifically for per-passage emotion. Reddit could not be read (blocked to search and
fetch); Hacker News had almost nothing (the IndexTTS-2.5 post: 1 point, 0 comments).

---

## 8. Python and torch fit against our per-engine venvs

| Engine | Declared Python | torch | Windows-hostile deps |
|---|---|---|---|
| Step-Audio-EditX | ≥3.12 | ≥2.9.1 | none stated; Linux-primary |
| MOSS-TTS family | 3.12 | ==2.9.1+cu128 | flash-attn optional; vLLM/SGLang fast paths |
| Sopro | ≥3.10 open | ≥2.3 | none |
| Audio8 | ≥3.10 open | ≥2.5 | none (transformers <5) |
| VoxCPM2 | README <3.13 (PyPI open) | ≥2.5 | flash-attn optional |
| dots.tts | <3.13 | ≥2.8 | **pynini/WeTextProcessing** |
| IndexTTS 2.5 | <3.12 | ==2.8.* | DeepSpeed, triton for extras |
| FireRedTTS3 | unstated (3.10–3.12 seen) | ==2.8.0 | **flash-attn hard-coded** |
| FireRedAudio | <3.11 | ==2.11.0 | compiled kernels |
| Gepard | 3.12 | — | vLLM, nvcc, NeMo codec |
| VoXtream2 | — | <2.9 | — |
| Confucius4-TTS | 3.10 (official env) | — | optional vLLM |

No engine documents torch 2.13. **Step-Audio-EditX and MOSS-TTS are the only narration-grade
stacks already built for Python 3.12+ / torch 2.9.1.** Every other candidate would need a pin fight
in its own venv — or the audio.cpp runtime (§9), where the Python pins stop mattering.

---

## 9. audio.cpp — the catalogue and what changed since the 2026-09-30 IDEAS entry

The IDEAS entry *"audio.cpp as a second speech runtime"* (2026-09-30) is still accurate. Updates
and additions as of the repo on 2026-09-30:

- **v0.9.0 shipped 2026-09-30T18:00Z** — 20 releases in all, 13 since 13 Aug (6 in August, 8 in
  September). Roadmap #34 calls the next phase "consolidation".
- **Catalogue:** 61 core + 35 community families (README: "100+ audio models and 170+ variants");
  26 core and ~20 community families are speech generation. **There is no stable/testing column** —
  status is only core vs community, an "Experimental" field in some model docs (Confucius4,
  DramaBox, DotTTS, NeuTTS), "(testing)" on `chatterbox_turbo`, and the per-family GGUF path-test
  matrix in `docs/gguf.md` ("Pass", "Pass (drift)", "Pass (ASR match, drift)", "No").
- **Already carries the candidates:** IndexTTS-2 (core since 2026-07-14) and IndexTTS-2.5 (PR #210
  merged 2026-08-11) with GGUF orig/f16/q8; FireRedTTS3 Base/Instruct (release 0.7, 2026-08-26)
  orig/q8; FireRedAudio Q8; VoxCPM2 (streaming + clone, F16/Q8); DotTTS SOAR/MeanFlow/Edit
  (streaming + clone); Confucius4 (streaming + clone, F32); MOSS-TTS-Local v1.5, MOSS-TTS-Nano;
  MioTTS; Magpie; Maya1 (added v0.9.0); community AuK, GLM-TTS, Sopro, Soprano. GGUFs are hosted
  ungated at `audio-cpp/audio.cpp-gguf` — including Pocket TTS, whose upstream cloning repo is
  gated.
- **Cloning:** exposed for the **core `chatterbox` family** (v2 default, v3 via
  `chatterbox.multilingual_t3=v3`, plus voice conversion) — only the community Turbo port is
  built-in-voice-only ("speaker encoder tensors not repacked"). 19 language codes for core
  Chatterbox. Also cloning for confucius4, cosyvoice3, dots, dramabox, fish, firered_audio,
  fireredtts3, higgs, index_tts2, miotts, moss_*, pocket_tts, qwen3_tts Base, voxcpm1/2, vibevoice,
  audio8, glm_tts, zipvoice, sopro and others; not for chatterbox_turbo, kokoro, supertonic,
  magpie, maya1, neutts, kitten, soprano, inflect, piper.
- **LoRA:** still only VibeVoice and YuE2; the maintainer calls LoRA hot-swapping "not a near-term
  priority"; no issue or PR for Qwen3 or Chatterbox LoRA.
- **Windows binaries:** CPU, CPU-portable, Vulkan, CUDA 12.4 (Pascal PTX added 2026-09-24), CUDA
  13.3 (needs compute capability 7.5+, driver 580+), separate `cudart` archives. ROCm on Windows is
  a community fork only.
- **Server:** `/v1/audio/speech` with SSE/PCM streaming, base64 `voice_ref` (5 MiB cap), presets,
  a `voice_dir` library; transcription, alignment, diarization and batch endpoints;
  `/v1/audio/voices`; `/v1/tasks/run`, `unload_models`, `unload_all_models`; config
  `max_loaded_models`, `idle_unload_ms`, `min_free_memory_mb`, `busy_timeout_ms`. **Requests are
  serialized per model** (parallel-slot PRs #706/#715 open).
- **Bindings:** no official Python package (all PyPI names 404); a C ABI DLL
  (`-DAUDIOCPP_BUILD_C_API=ON`); third-party PyPI "delusion", .NET and Node wrappers, a Windows tray
  app.
- **Parity:** route-labelled per family; seeds reproducible within audio.cpp but not bit-exact to
  torch for sampled models. IndexTTS2 WAV similarity 0.98–0.99999 vs Python.
- **Windows bugs:** **open PR #659 — non-ASCII paths decoded with the legacy code page**; the
  maintainer had not tested on Windows as of 2026-09-24. Fixed: #151 (IndexTTS2 commit limit),
  #511 (PATH quoting in the CUDA build), #352 (old-CPU crash — use the `-portable` zip).
- **Its own licence audit,** `docs/model_licenses.md` (checked 2026-09-21/26), is a useful second
  opinion and agrees with §6.3.
- Whisper was declined by the maintainer on 2026-08-06 ("whisper.cpp already exists and is
  mature"). XTTS v2 (#520) and Bark (#527) are open PRs. Orpheus is a roadmap candidate only.
- Qwen3 numbers: "1.83× one-shot / 3.06× long-form" are now labelled "the original release
  baseline"; long-lived session 2.74×.

**Why it matters for this scan:** every engine worth testing in §1 already has a Q8 build there.
One runtime integration — the shape the 2026-09-30 entry describes, a pinned binary managed beside
llama.cpp's in the kit — would let all of them be A/B'd on the same lines on this machine, without
building five venvs that fight our Python/torch band. It does not fix licences, and it does not
carry our Qwen3/Chatterbox LoRAs.

---

## 10. Changes to engines we already ship or evaluated

- **Chatterbox Multilingual v3** (2026-06-10, MIT, **25 languages**, PerTh watermark on by default)
  landed in the **same** HF repo `ResembleAI/chatterbox`. Verified in code on 2026-10-01: our
  manifest pins revision `5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18` for both Chatterbox variants
  that use that repo (`server/justvoice/engines/chatterbox/manifest.py` lines 153–154 and
  184–185), so **nothing changes until we choose to move the pin**. Moving it would take the
  roster from 23 to 25 cloning languages.
- **Pocket TTS:** cloning weights still gated (`gated: auto`, with an ungated
  `pocket-tts-without-voice-cloning` repo); training code shipped Aug 2026; sherpa-onnx int8 export
  2026-01-26. The rejection stands.
- **Supertonic:** 2 (2026-01-06) → 3 (May 2026, 31 languages, OpenRAIL-M), still no open cloning.
- **MOSS-TTSD-v1.0** (8B, 2026-05-26, 20 languages, 60-minute sessions). Its HF API returned 401
  on 2026-09-30. It stays marked for removal.
- **Qwen3-TTS:** no release since 2026-01-22. **Kokoro:** no v2.

---

## 11. The recommendation as given (not a decision)

1. **IndexTTS 2.5 — not now.** The licence clause on outputs collides with the Dataset Builder and
   LoRA training, and the commercial disclaimer is unresolved. Revisit if Bilibili clarifies.
2. **FireRedTTS3 — test it before adopting**, through audio.cpp Q8 first, against Chatterbox
   Multilingual and Qwen3 Base on the same lines and references. Adoption needs the disclaimer
   ruling.
3. **FireRedAudio — no.**
4. **VoxCPM2 and Step-Audio-EditX — test**, as the licence-clean answers to emotion on a cloned
   voice.
5. **MOSS-TTS-Nano or Sopro — test for the CPU cloning slot** against LuxTTS.
6. **audio.cpp as the test door** for all of the above.

---

## 12. Rulings this needs — the user's to make

None of these is decided. They are listed so the next session asks rather than assumes.

1. **FireRed's "intended solely for academic research purposes" line** — acceptable for a shipped
   engine, or a blocker? It is a disclaimer, not a licence clause, and the weights carry
   Apache-2.0 metadata.
2. **IndexTTS 2.5's licence** — is a custom, revocable, PRC-law licence with an
   outputs-may-not-improve-AI clause ever acceptable, given the Dataset Builder and LoRA training?
3. **Step-Audio-EditX's weights** have no licence tag on Hugging Face; only the GitHub repo's
   LICENSE (Apache-2.0) covers them. Accept the repo licence as covering the weights?
4. **audio.cpp** — pick up the 2026-09-30 IDEAS entry as the way to test these engines?
5. **The CPU cloning slot** — keep LuxTTS, or test MOSS-TTS-Nano / Sopro against it?
6. **Chatterbox Multilingual v3** — move the pin (25 languages, watermark default) or stay?

---

## 13. Gaps — what could not be verified

- **No independent listening evaluation** of any Apache-2.0 cloner here (VoxCPM2, dots.tts,
  FireRedTTS3, Confucius4, MOSS); every number is self-reported. HF TTS Arena V2 was unreadable.
- **No third-party numbers for IndexTTS 2.5;** whether the public checkpoint is the RL or base row;
  whether the shipped S2M is Zipformer; any maintainer statement on commercial use.
- **No consumer-GPU RTF** for IndexTTS 2.5 on an RTX 3060/4070, and no CPU speed for it.
- **No line-to-line voice consistency measurement** for any engine.
- **Python 3.13 support** is unstated by every narration candidate; no torch 2.13 claims anywhere.
- Upstream component licences for FireRedTTS3/FireRedAudio (Qwen3/Qwen3.5, CAM++, Whisper,
  fastText) not checked. Voxtral's licence came from a secondary source. ZONOS2 shows Apache-2.0 on
  HF vs MIT on GitHub.
- Sample rates unknown for Confucius4, Sopro, VoXtream2, Step-Audio-EditX, Magpie and AuK.
- Reddit was blocked to both search and fetch; community sentiment is GitHub, blog and benchmark
  evidence only.

---

## 14. Primary sources

**IndexTTS 2.5:** [github.com/index-tts/index-tts](https://github.com/index-tts/index-tts) ·
[huggingface.co/IndexTeam/IndexTTS-2.5](https://huggingface.co/IndexTeam/IndexTTS-2.5) ·
[arXiv 2601.03888](https://arxiv.org/abs/2601.03888) · issues #228, #728, #775, #800, #801,
PR #802 on the GitHub repo

**FireRed:** [github.com/FireRedTeam/FireRedTTS3](https://github.com/FireRedTeam/FireRedTTS3) ·
[huggingface.co/FireRedTeam/FireRedTTS3](https://huggingface.co/FireRedTeam/FireRedTTS3) ·
[arXiv 2608.17492](https://arxiv.org/abs/2608.17492) ·
[github.com/FireRedTeam/FireRedAudio](https://github.com/FireRedTeam/FireRedAudio) ·
[huggingface.co/FireRedTeam/FireRedAudio](https://huggingface.co/FireRedTeam/FireRedAudio) ·
[github.com/FireRedTeam/FireRedTTS2](https://github.com/FireRedTeam/FireRedTTS2) ·
[drbaph/FireRedTTS3-int8](https://huggingface.co/drbaph/FireRedTTS3-int8) ·
[cstr/fireredtts3-GGUF](https://huggingface.co/cstr/fireredtts3-GGUF) ·
[FireRedTTS3-Pinokio](https://github.com/PierrunoYT/FireRedTTS3-Pinokio) ·
[FireRedTTS3-ComfyUI](https://github.com/slender-prelature73/FireRedTTS3-ComfyUI)

**Studies:** [Iterate to Differentiate, arXiv 2603.24430](https://arxiv.org/html/2603.24430) ·
[TTS quantisation study, arXiv 2609.28974](https://arxiv.org/html/2609.28974) ·
[MOSS-TTS report, arXiv 2603.18090](https://arxiv.org/abs/2603.18090)

**Arenas:** [Artificial Analysis open weights](https://artificialanalysis.ai/text-to-speech/leaderboard/provider-voice/open-weights) ·
[Artificial Analysis controlled voice](https://artificialanalysis.ai/text-to-speech/leaderboard/controlled-voice)

**Candidates:** [VoxCPM](https://github.com/OpenBMB/VoxCPM) ·
[openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) ·
[Step-Audio-EditX](https://github.com/stepfun-ai/Step-Audio-EditX) ·
[dots.tts](https://github.com/rednote-hilab/dots.tts) ·
[Confucius4-TTS](https://github.com/netease-youdao/Confucius4-TTS) ·
[MOSS-TTS](https://github.com/OpenMOSS/MOSS-TTS) ·
[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano) ·
[Tencent AuK](https://github.com/Tencent-Hunyuan/AuK) ·
[Ming-omni-tts](https://github.com/inclusionAI/Ming-omni-tts) ·
[Audio8-TTS-Preview-0.6b](https://huggingface.co/Audio8/Audio8-TTS-Preview-0.6b) ·
[MioTTS-1.7B](https://huggingface.co/Aratako/MioTTS-1.7B) ·
[Gepard 1.0](https://huggingface.co/nineninesix/gepard-1.0) ·
[Sopro](https://github.com/samuel-vitorino/sopro) ·
[VoXtream2](https://huggingface.co/herimor/voxtream2) ·
[Magpie 357M](https://huggingface.co/nvidia/magpie_tts_multilingual_357m)

**audio.cpp:** [github.com/0xShug0/audio.cpp](https://github.com/0xShug0/audio.cpp) (README,
`docs/tts.md`, `docs/gguf.md`, `docs/model_licenses.md`, `docs/espeak_phonemizer.md`, releases,
issues #34 #484 #659, PRs #706 #715) ·
[audio-cpp/audio.cpp-gguf](https://huggingface.co/audio-cpp/audio.cpp-gguf)

**Practitioner tools:** [tts-audiobook-tool](https://github.com/zeropointnine/tts-audiobook-tool) ·
[TTS-Story](https://github.com/Xerophayze/TTS-Story) ·
[alexandria-audiobook](https://github.com/Finrandojin/alexandria-audiobook) ·
[Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)
