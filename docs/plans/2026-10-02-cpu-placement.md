# CPU placement — steps 1–3: which audio.cpp speech models are worth running on the CPU, measured

## 1. What this is

Steps 1–2 of the TASKS item **"Speech models run on the CPU or the GPU — chosen per model,
automatically, measured"** ([`docs/dev/TASKS.md`](../dev/TASKS.md); go 2026-10-02 for steps 1–3).
The question: which small models in audio.cpp's catalogue pass our rules and deserve a CPU
measurement (step 3) before we build the automatic placement (step 4)?

Why it matters: on the RTX 2070 SUPER 8 GB, loading Kokoro on the GPU (567 MB measured) evicted
the whole 6,844 MB Gemma model ([switch plan §8 B](2026-10-01-audiocpp-switch.md)). Kokoro through
audio.cpp on the CPU measured **2.84× real time** (switch plan §2.1) and uses no graphics memory.

This pass is research only: nothing was downloaded, run or measured. Every fact below comes from a
source read on 2026-10-02 — the HF API, model cards, LICENSE files, `model_specs/*.json` in
`F:/audio-v0.9.0-bin-windows-x64-cuda12.4`, and audio.cpp's own licence table
[`docs/model_licenses.md` at v0.9.0](https://github.com/0xShug0/audio.cpp/blob/v0.9.0/docs/model_licenses.md).
It builds on [the 2026-10-01 engine scan](2026-10-01-tts-engine-scan.md) and
[the 2026-08-17 roster](2026-08-17-engine-roster-and-platform.md) and does not repeat their research.

## 2. The rules a candidate must pass

These are the approved plan text in TASKS: *"weights that permit selling the output, no Hugging Face
login to download, clones or preset voices"*. The login rule is the user's own words from 2026-08-22:
*"i dont like requireing hf auth so pocket tts is out"*
([env research, rulings item 4](2026-08-22-engine-environment-and-platform-research.md)).

| # | Rule | How it was checked |
|---|---|---|
| 1 | The weights permit commercial use — **selling the generated output** | The licence on the original weights (card plus LICENSE), cross-read against audio.cpp's licence table, plus any dataset licence the card points to |
| 2 | **No Hugging Face login** and no gated access to download | HF API `gated` field. `audio-cpp/audio.cpp-gguf` is `gated: False`, `private: False`. Each upstream repo was checked too |
| 3 | Offers **cloning or preset voices** | `capabilities` in the model spec, plus the upstream card |
| 4 | **Runs in audio.cpp v0.9.0** | A `model_specs` family exists, and a GGUF folder exists in `audio-cpp/audio.cpp-gguf` at commit `7bf52723f5a95b6cec53ea905fd10eca1c8b942e` (HF tree API at that commit) |

Scope, from the go:
- Small models only (≲ 1B parameters) that plausibly suit a CPU.
- **Not** Qwen3 or Chatterbox — *"we dont need to test qwen chaterbox on cpu we already know they
  run poorly"*.

## 3. Candidates

Shared facts for every row:
- **Sizes** are MB (10⁶ bytes) of the file at the pinned commit. The exact bytes are in §4.
- **Licence**: the source is linked in the upstream column. "audio.cpp: Yes" means that row of
  audio.cpp's licence table says *Commercial use: Yes*.
- **HF login**: "no" means both the GGUF repo and the upstream repo report `gated: False`, unless
  the row says otherwise.

### 3.1 Speech (TTS)

| Family | Upstream | Params | GGUF at the pin | Weights licence | HF login? | Voices | Languages | Upstream's own CPU claim | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `kokoro_tts` | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | 82M (name) | `Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf` 189.5 · bf16 212.0 | Apache-2.0 · audio.cpp: Yes | no | 54 presets · no clone | 9: en-us en-gb es fr hi it ja pt-br zh | audio.cpp spec: *"optimized native CPU inference"*. Ours: 2.84× real time on CPU (switch plan §2.1) | **Shortlist — baseline**, re-measured under the same protocol |
| `kitten_tts` | [KittenML/kitten-tts-mini-0.8](https://huggingface.co/KittenML/kitten-tts-mini-0.8) | 80M (card) | `KittenTTS-GGUF/kitten-tts-mini-0.8-orig.gguf` 302.2 (F32; the GGUF README says it is larger than the upstream ONNX because the ONNX stores quantised weights) | Apache-2.0 (card, [GitHub LICENSE](https://github.com/KittenML/KittenTTS)) · audio.cpp: Yes | no | 8 presets (Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo) · no clone | en | [GitHub README](https://github.com/KittenML/KittenTTS): *"delivers high-quality voice synthesis on CPU without requiring a GPU"* | **Shortlist** |
| `inflect_v2` | [owensong/Inflect-Micro-v2](https://huggingface.co/owensong/Inflect-Micro-v2) | 9,356,513 (card) | `Inflect-Micro-v2-GGUF/inflect-micro-v2-orig.gguf` 72.1 | Apache-2.0 — card: *"Original Inflect code and weights are released under Apache-2.0"* · audio.cpp: Yes | no | **1** — *"one fixed synthetic English voice"* · no clone | en | Card: *"4-thread CPU throughput … 6.28× real-time"* (HF CPU Upgrade, 8 vCPU) | **Shortlist** — one voice only |
| `moss_tts_nano` | [OpenMOSS-Team/MOSS-TTS-Nano-100M](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M) + [MOSS-Audio-Tokenizer-Nano](https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano) | 0.1B + ~20M tokenizer (card) | `MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf` 193.3 · bf16 332.4 | Apache-2.0 — HF metadata and [GitHub LICENSE](https://github.com/OpenMOSS/MOSS-TTS-Nano/blob/main/LICENSE); tokenizer repo apache-2.0 · audio.cpp: Yes. (See §5: the card's licence paragraph says otherwise) | no (both repos) | **Clone** (`speaker_reference`) · no presets | 19 in the spec (the card lists 20 and adds he) | Card: *"CPU friendly: streaming generation can run on a 4-core CPU"* | **Shortlist** — the only clean CPU cloner here; the [scan §1](2026-10-01-tts-engine-scan.md) already named it for the CPU cloning slot |
| `magpie_tts` | [nvidia/magpie_tts_multilingual_357m](https://huggingface.co/nvidia/magpie_tts_multilingual_357m) | 364M (card) | `MagpieTTS-Multilingual-357M-GGUF/magpie-tts-multilingual-357m-q8_0.gguf` 1,562.1 · orig 1,912.1 | [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/): *"Models are commercially usable … NVIDIA does not claim ownership to any outputs"* · audio.cpp: Yes | no | 5 presets (Aria, Jason, Leo, Sofia, John Van Stan) · no clone | Card: 12 (ar de en es fr hi it ja ko pt vi zh). Spec: 13 codes, no ja | **None.** The card says the model is *"faster … compared to CPU-only solutions"* on NVIDIA GPUs | **Shortlist, low expectation** — autoregressive and the largest file; the measurement decides |
| `pocket_tts` | [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts) (cloning) · [kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) (presets) | 100M (card) | Per language: `PocketTTS-GGUF/<lang>/pocket-tts-<lang>-q8_0.gguf`, 127.9 for en; bf16 219.1. 26 preset embeddings per language, 3.7–8.3 each (166.0 for en). Default en package: q8 plus `english/embeddings/alba.safetensors` 6.2 | CC-BY-4.0 (card) · audio.cpp: Yes. Presets keep their own licences ([kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices)): cosette (Expresso) and jean (EARS) are *"Non-commercial use only"*; giovanni, lola, juergen, rafael have no licence stated | **GGUF copy: no.** Upstream cloning repo: **still `gated: auto`** — the card answers *"Access to model kyutai/pocket-tts is restricted … Please log in."* | Clone + 26 presets | GGUF: en de it pt es (upstream adds fr, nl) | Card: *"~6x real-time on a CPU of MacBook Air M4"*, *"Uses only 2 CPU cores"*. Ours (2026-08-22, PyTorch, a preset): ≈ 3.2× real time | **Needs your word** (§5) |
| `supertonic` | [Supertone/supertonic-3](https://huggingface.co/Supertone/supertonic-3) | *"about 99M parameters"* (card) | `Supertonic-3-GGUF/supertonic-3-f16.gguf` 312.8 · orig 454.1 · q8_0 454.1 (same byte count as orig) | BigScience OpenRAIL-M ([LICENSE](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE)): *"Licensor claims no rights in the Output You generate"*. The Attachment A use restrictions apply and must be passed on · audio.cpp: Yes, with that note | no | 10 presets (F1–F5, M1–M5) · **no open cloning**: custom styles only through the paid Voice Builder (*"purchased Voice Builder styles include downloadable embeddings"*) | 31 | Card: *"Supertonic 3 runs fast on CPU, even compared with larger baselines measured on A100 GPU"* | **Needs your word** (§5) |
| `chatterbox_turbo` | [ResembleAI/chatterbox-turbo](https://huggingface.co/ResembleAI/chatterbox-turbo) | 350M (spec) | `Chatterbox-Turbo-GGUF/chatterbox-turbo-q8_0.gguf` 699.1 (the spec also lists an f16 that is not at the pin) | MIT · audio.cpp: Yes | no | The audio.cpp port: *"a built-in voice"*; no clone capability; status `testing` | en | — | **Out** — your *"chaterbox"* ruling. Named in §5 because it is a different, distilled model |
| `piper_tts` | [rhasspy/piper-voices … lessac/medium](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium) | not stated | `Piper-TTS-GGUF/piper-en-us-lessac-medium-orig.gguf` 62.7 | The repo is MIT, but the voice's MODEL_CARD points to the [Lessac Blizzard 2013 licence](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html): *"Research Purposes … excludes … using the Materials for any commercial purpose, including the development, marketing, commercialisation, sale or licencing of voice synthesis … products"*. audio.cpp: **Unclear** | no | 1 | en | The GGUF README runs it with `--backend cpu`; no speed claim | **Out** — fails rule 1 on its training data, and it is the only Piper voice packaged |
| `neutts` | [neuphonic/neutts-2e](https://huggingface.co/neuphonic/neutts-2e) | — | `NeuTTS-2E-GGUF/neutts-2e-orig.gguf` 3,016.2 | NeuTTS Open License v1.0. audio.cpp: **Conditional** — *"only while yearly revenue stays under USD 5M"* | **upstream `gated: auto`** | Built-in speaker prompts · no clone | en | — | **Out** — rules 1 and 2 (as in [scan §6.3](2026-10-01-tts-engine-scan.md)); 3 GB |
| `soprano_tts` | [ekwek/Soprano-1.1-80M](https://huggingface.co/ekwek/Soprano-1.1-80M) | ~80M (spec) | **None in audio.cpp-gguf**; the spec downloads third-party `WalkingCat/Soprano-1.1-80M-GGUF` | Apache-2.0 | no | The spec lists no voices and no clone | en | — | **Out** — rule 4 |
| `sopro_tts` | [samuel-vitorino/sopro-v2-turbo](https://huggingface.co/samuel-vitorino/sopro-v2-turbo) | 120M | **None** — the spec: *"No audio.cpp GGUF build of sopro-v2-turbo is published yet"* | Apache-2.0 | no | Clone | en pt fr de | *"RTF 0.24 on an M3 CPU"* ([scan §6.1](2026-10-01-tts-engine-scan.md)) | **Out** — rule 4. Recheck if a GGUF appears |
| `zipvoice` | [k2-fsa/ZipVoice](https://huggingface.co/k2-fsa/ZipVoice) | 123M ([roster §3](2026-08-17-engine-roster-and-platform.md)) | None in audio.cpp-gguf; the spec uses third-party `davidxifeng/zipvoice-gguf` | **Not stated** on the card. audio.cpp: Unclear (*"the code is Apache-2.0"*) | no | Clone | en zh | *"ZipVoice-Distill: 32.6× speedup on a single CPU thread"* (roster §3) | **Out** — rules 1 and 4 |
| `sanotts` | [ampixa/sanoTTS](https://huggingface.co/ampixa/sanoTTS) | 0.3M–2.3M per voice (spec) | None in audio.cpp-gguf (downloads from `ampixa/sanoTTS`) | GPL-3.0 · audio.cpp: Yes, *"Copyleft"* | no | Presets (heart, heart-nano, amy, hfc, kristin, others) | 14 | — | **Out** — rule 4 |
| `audio8_tts` | [Edge0/Audio8-TTS-Preview-0.6b](https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6b) | 0.6B | None in audio.cpp-gguf (third-party `js-byte/Audio8-TTS-Preview-0.6b-GGUF`) | Apache-2.0 | no | Clone | 12 | — | **Out** — rule 4, and a "Preview" |
| `irodori_tts` | (audio.cpp-gguf README) | — | Three Irodori folders | MIT | no | Clone + design | ja only | — | **Out** — Japanese only |
| `f5_tts`, `mira_tts`, `outetts` | per audio.cpp's table | — | — | CC-BY-NC / CC-BY-NC-SA | — | Clone | — | — | **Out** — rule 1 |
| `miotts`, `maya1`, Qwen3-TTS, Chatterbox | — | 1.7B / 3B / … | — | — | — | — | — | — | **Out** — over 1B, or excluded by your ruling |

### 3.2 Recognition (ASR)

| Family | Upstream | Params | GGUF at the pin | Weights licence | HF login? | Languages | Upstream's own CPU claim | What we already measured | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `parakeet_tdt` | [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | 627,057,286 (HF; card "600 million") | `Parakeet-TDT-0.6B-v3-GGUF/parakeet-tdt-0.6b-v3-q8_0.gguf` 915.7 · f16 1,255.4 | CC-BY-4.0 · audio.cpp: Yes | no | 25 European; no ja/zh | **None.** The card claims GPU speed *"compared to CPU-only solutions"* | GPU 0.08 s/clip. WER: en 4.4 · de 3.7 · fr 8.8 · es 3.3 · ru 7.1 % ([switch plan §8 D](2026-10-01-audiocpp-switch.md)) | **Shortlist** — check D's fastest contender (the shipped recogniser is Qwen3-ASR 1.7B); its CPU number decides whether dictation can leave the GPU |
| `moonshine_asr` | [moonshine-ai/moonshine-streaming-tiny](https://huggingface.co/moonshine-ai/moonshine-streaming-tiny) / [-small](https://huggingface.co/moonshine-ai/moonshine-streaming-small) / [-medium](https://huggingface.co/moonshine-ai/moonshine-streaming-medium) | 34M / 123M / 245M (card) | tiny q8 60.4 · small q8 300.6 · medium q8 315.6 | MIT · audio.cpp: Yes | no | en | Card: *"intended for low-latency, on-device English speech transcription on memory- and compute-constrained platforms (roughly 0.1--1~TOPS and sub-1~GB memory budgets)"* | — | **Shortlist, all three.** audio.cpp marks it `experimental` |
| `canary_asr` | [nvidia/canary-180m-flash](https://huggingface.co/nvidia/canary-180m-flash) | 182M (card) | `Canary-180M-Flash-GGUF/canary-180m-flash-q8_0.gguf` 249.5 · f32 757.9 | CC-BY-4.0 · audio.cpp: Yes | no | en de es fr (+ translation) | **None** — *"more than 1200 RTFx"* on the GPU leaderboard. The GGUF README: *"offline text output, not timestamps"* | — | **Shortlist** |
| `citrinet_asr` | [nvidia/stt_en_citrinet_256_ls](https://huggingface.co/nvidia/stt_en_citrinet_256_ls) | *"around 10M parameters"* | `Citrinet-ASR-GGUF/citrinet-asr-q8_0.gguf` 40.6 | CC-BY-4.0 · audio.cpp: Yes | no | en — *"lower case English alphabet along with spaces and apostrophes"*; LibriSpeech-trained | **None** | — | **Shortlist** — tiny, no punctuation |
| `granite5asr` | [ibm-granite/granite-speech-5.0-470m-turboctc](https://huggingface.co/ibm-granite/granite-speech-5.0-470m-turboctc) | 472,993,792 | `Granite-Speech-5.0-470M-TurboCTC-GGUF/granite-speech-5.0-470m-turboctc-q8_0.gguf` 504.7 | Apache-2.0 · audio.cpp: Yes | no | en | Card: *"well suited for deployment on laptops, smartphones and other edge devices"* | — | **Shortlist** |
| `nemotron_asr` | [nvidia/nemotron-3.5-asr-streaming-0.6b](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b) | 637,997,088 | `Nemotron-3.5-ASR-Streaming-0.6B-GGUF/nemotron-3.5-asr-streaming-0.6b-q8_0.gguf` 930.6 · f16 1,277.7 | [OpenMDW-1.1](https://openmdw.ai/license/1-1/): *"does not impose any restrictions or obligations with respect to any use … of any outputs"* · audio.cpp: Yes | no | 40 locales, **including ja-JP, zh-CN and ko-KR** | **None** (a GPU statement only) | — | **Shortlist** — the only small model here covering the ja and zh that Parakeet lacks |
| `qwen3_asr` 0.6B | [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) | 938,008,576 | q8 1,151.3 · f16 1,880.6 | Apache-2.0 · audio.cpp: Yes | no | 30 | None | GPU f16: human English 4.7 % wrong, rendered 9.4 %, German with the language given 57 % (switch plan §2.2) | **Not shortlisted** — your *"qwen … on cpu"* ruling (§5 asks whether it covers the recogniser) |
| `kroko_asr` | [Banafo/Kroko-ASR](https://huggingface.co/Banafo/Kroko-ASR) | not stated | `Kroko-ASR-GGUF/kroko-en-community-64-l-q8_0.gguf` 167.8 — English only at the pin, though the spec lists 10 languages | CC-BY-SA in the card prose only. The LICENSE file is **0 bytes** and no version is named | no | en at the pin | Card: *"Fast & lightweight"* | — | **Out** — no licence file, and English-only at the pin, where five shortlisted models already cover English |
| `gigaam_asr` | [ai-sage/GigaAM-v3](https://huggingface.co/ai-sage/GigaAM-v3) | 220M–240M (card) | e.g. multilingual-ctc f16 442.3 | MIT · audio.cpp: Yes | no | ru kk ky uz en | — | — | **Out (my call)** — a Russian specialist, and Parakeet already does ru at 7.1 % |
| `niagara_asr` | abr-ai/niagara-19m / 38m | 19M / 38M | f32 255.4 / 427.1 | ABR Open License v1.1. audio.cpp: **Conditional** — *"under USD 1M"* revenue | — | en | — | — | **Out** — rule 1 (the same revenue-cap ground as NeuTTS) |
| `cohere_asr` | CohereLabs/cohere-transcribe-03-2026 | — | q8 2,438.9 · q4 1,534.3 · bf16 4,134.9 | Apache-2.0 | — | 14 | — | — | **Out** — the file sizes put it past the size cap |
| `fun_asr_nano` | FunAudioLLM/Fun-ASR-Nano-2512 | — | The folder exists (q8 1,045.3), but the spec status is `wip` | Apache-2.0 | — | auto zh en ja | — | — | **Out** — `wip` in v0.9.0 |
| `sense_asr`, `vibeasr` | — | — | The spec has no download source | — | — | — | — | — | **Out** — rule 4 |
| `audio8_asr`, `hviske_asr`, MMS aligner, Sortformer | — | — | — | CC-BY-NC-4.0 | — | — | — | — | **Out** — rule 1 |

## 4. The shortlist, the download list, and what step 3 measures

**Shortlist — passes every rule:**
- **Speech:** Kokoro (the baseline) · KittenTTS Mini 0.8 · Inflect-Micro-v2 · MOSS-TTS-Nano
  (the cloner) · Magpie 357M.
- **Recognition:** Parakeet-TDT 0.6B v3 · Moonshine tiny / small / medium · Canary 180M Flash ·
  Citrinet 256 · Granite Speech 5.0 470M · Nemotron 3.5 0.6B.
- **Only on your word (§5):** Pocket TTS · Supertonic 3.

Download list: anonymous fetches from
`https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/7bf52723f5a95b6cec53ea905fd10eca1c8b942e/<path>`.
Each of these packages is the single file listed, because the configuration and voices travel
inside the GGUF.

| Path | Bytes |
|---|---|
| `Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf` | 189,549,408 |
| `KittenTTS-GGUF/kitten-tts-mini-0.8-orig.gguf` | 302,167,104 |
| `Inflect-Micro-v2-GGUF/inflect-micro-v2-orig.gguf` | 72,082,176 |
| `MOSS-TTS-Nano-100M-GGUF/moss-tts-nano-100m-q8_0.gguf` | 193,337,984 |
| `MagpieTTS-Multilingual-357M-GGUF/magpie-tts-multilingual-357m-q8_0.gguf` | 1,562,142,912 |
| *Speech subtotal* | *2,319,279,584* |
| `Parakeet-TDT-0.6B-v3-GGUF/parakeet-tdt-0.6b-v3-q8_0.gguf` | 915,733,744 |
| `Moonshine-Streaming-GGUF/moonshine-streaming-tiny-q8_0.gguf` | 60,408,448 |
| `Moonshine-Streaming-GGUF/moonshine-streaming-small-q8_0.gguf` | 300,621,792 |
| `Moonshine-Streaming-GGUF/moonshine-streaming-medium-q8_0.gguf` | 315,584,192 |
| `Canary-180M-Flash-GGUF/canary-180m-flash-q8_0.gguf` | 249,496,128 |
| `Citrinet-ASR-GGUF/citrinet-asr-q8_0.gguf` | 40,574,432 |
| `Granite-Speech-5.0-470M-TurboCTC-GGUF/granite-speech-5.0-470m-turboctc-q8_0.gguf` | 504,717,376 |
| `Nemotron-3.5-ASR-Streaming-0.6B-GGUF/nemotron-3.5-asr-streaming-0.6b-q8_0.gguf` | 930,625,888 |
| *Recognition subtotal* | *3,317,762,000* |
| **Total** (minus whatever the speech cache already holds — Kokoro and Parakeet may be there) | **5,637,041,584** (5.64 GB) |
| On a yes only: `PocketTTS-GGUF/english/pocket-tts-english-q8_0.gguf` + `PocketTTS-GGUF/english/embeddings/alba.safetensors` | 127,856,704 + 6,194,424 |
| On a yes only: `Supertonic-3-GGUF/supertonic-3-f16.gguf` (the smallest of its three) | 312,784,196 |

**Step 3 measures, per model, on `--backend cpu`** (the installed CUDA build ships the
`ggml-cpu-*.dll` libraries), recording the CPU model and thread count:

- **Speech**:
  - CPU real-time factor (audio seconds ÷ wall seconds) on **5 fixed lines**, the same five for
    every model. They come from the 20 Ninth Facet lines of switch plan §2.1
    (`scratchpad/abtest/lines.json`): #2 (33 characters), #8 (34), #9 (102), #13 (123) and
    #17 (351).
  - One seed per line; the first, cold load is reported separately as load time.
  - Peak RAM of the runtime process.
  - The WAVs, kept for a listen.
  - MOSS-TTS-Nano clones from the same reference clip `bench.py` uses for Chatterbox.
- **Recognition**:
  - Word error rate on the existing clips in `scratchpad/abtest`: 73 LibriSpeech clips (`libri/`,
    `libri_refs.json`) and FLEURS, 15 clips each in de, es, fr, ru, ja and zh (`fleurs/`,
    `fleurs_refs.json`).
  - The same normaliser as check D; character error for ja and zh, as check D did.
  - Each model is scored only on the languages it claims.
  - CPU seconds per clip, plus peak RAM.

## 5. Needs your word, and what could not be verified

**Needs your word:**

1. **Pocket TTS**:
   - The audio.cpp-gguf copy downloads with no login.
   - Kyutai's own cloning repo still requires logging in and accepting a prohibited-use form.
     Their code says to *"go to https://huggingface.co/kyutai/pocket-tts and accept the terms,
     then make sure you're logged in"*.
   - audio.cpp's licence table names the gated repo as the original weights.
   - The question: does an ungated third-party copy meet *"no Hugging Face login to download"*?
   - If yes, cosette and jean have to be dropped (non-commercial). giovanni, lola, juergen and
     rafael have no stated licence. That leaves 20 presets with a stated commercial-OK licence:
     VCTK CC-BY-4.0, voice-zero and voice-donations CC0, alba CC-BY-4.0, and estelle, one of
     Kyutai's own recordings (CC0).
2. **Supertonic 3**:
   - Your 2026-08-22 *"no supertonic"* was given when the slot needed cloning. It still has no open
     cloning, but it passes the new "or preset voices" rule.
   - OpenRAIL-M's Attachment A must be passed on to users. Clause (e) forbids placing generated
     content *"in any context … without expressly and intelligibly disclaiming that the
     information and/or content is machine generated"*, and (g) forbids impersonation without
     consent.
   - Is that acceptable for audiobooks?
3. **Qwen3-ASR 0.6B**: did *"qwen … on cpu"* cover the recogniser, or only Qwen3-TTS? It is 1.15 GB
   to add.
4. **Chatterbox Turbo**: did *"chaterbox"* cover the distilled 350M Turbo? Its audio.cpp port is
   English only, with a built-in voice, no cloning, and status `testing`.

**Not verified:**

- **Whether audio.cpp's Pocket GGUF carries the cloning weights.**
  - The spec advertises `clone: speaker_reference`.
  - The English bf16 GGUF (219,096,064 bytes) is the same size class as both upstream English
    safetensors (219,029,196 bytes each), and the gated repo hides its hash.
  - Only the file itself can settle it, so it waits for a yes.
- **Training data for KittenTTS and MOSS-TTS-Nano**: neither card names its training data. Inflect
  says its voice is synthetic and its corpus pipeline private. Piper fails on exactly this point,
  because its card does name a research-only dataset.
- **MOSS-TTS-Nano's licence paragraph**:
  - The HF card says *"If you are reading this before that file is published, please treat the
    repository as not yet licensed for redistribution"*, and the HF repo has no LICENSE file.
  - The GitHub repo does have an Apache-2.0 LICENSE, and the HF metadata says apache-2.0.
  - Read as Apache-2.0 here. That reading is yours to overrule.
- **Supertonic's voices inside the GGUF**: the package entry lists only the `.gguf`, so the 10
  styles should be embedded. The file was not opened. Its q8_0 is byte-for-byte the same size as
  orig, so whether it is quantised at all is unknown.
- **Moonshine sizes**: small q8 (300.6 MB) is nearly the size of medium (315.6 MB), despite 123M
  against 245M parameters. Unexplained.
- **No upstream CPU claim** exists for Magpie, Parakeet, Canary, Citrinet or Nemotron. Step 3's
  numbers will be the only ones.
- **MOSS-TTS-Nano outputs 48 kHz stereo** (card). How audio.cpp hands that back was not checked.
- **The CPU build on this machine**: the scan notes audio.cpp issue #352 (*"old-CPU crash — use the
  `-portable` zip"*). This matters to step 4's CPU process and was not tested.
- **Families not examined in this pass:** moss_transcribe_diarize, higgs_audio_stt,
  vibevoice_asr(_streaming), samsone, confucius4_r2t2/tts, dots_tts, auk, index_tts2, cosyvoice3,
  glm_tts, breeze_tts and the other multi-billion or non-commercial families. The
  [scan](2026-10-01-tts-engine-scan.md) covers the TTS ones.

## 6. Step 3 — measured on the CPU (2026-10-02)

**Setup.**
- Machine: AMD Ryzen 7 5700X (8 cores, 16 threads), 32 GB RAM, RTX 2070 SUPER 8 GB (not used).
- Runtime: audio.cpp v0.9.0, the CUDA build started with `--backend cpu`. It loaded the AVX2
  kernels (`ggml-cpu-haswell.dll`).
- One fresh server per model, holding only that model. 8 threads unless the row says otherwise.
  Nothing else was running.
- Peak RAM is the server process's peak working set. An idle server holds 16 MB.
- Harness: `scratchpad/abtest/cpu_bench.py`. Results: `scratchpad/abtest/cpu/` (session
  scratchpad, temporary).

**A CPU server holds no graphics memory.** Total VRAM stayed at the 316 MB desktop baseline from
start, through a load and a synth, to exit. That held for both the CUDA build and the Vulkan
build. A second, CPU-only runtime process costs the GPU nothing (`cpu_vram.py`).

### 6.1 Speech

The five lines are #2, #8, #9, #13 and #17 of `lines.json` (33, 34, 102, 123 and 351 characters).
The seeds are fixed.

"Words heard wrong" is the five outputs transcribed by Parakeet and scored against the text. Line
#8's made-up name *Kell* is heard as *Kel* for every voice; that is the recogniser's spelling, and
it adds the same 3.3 points to every row.

| Model | × real time | Load | Peak RAM | Words heard wrong | Same seed, same audio | Voices · languages |
|---|---|---|---|---|---|---|
| Inflect-Micro-v2 | **4.77×** | 3.0 s | 651 MB | 4.9 % | yes | 1 · en |
| **Pocket TTS — clone** (measured after the decisions below) | **4.05×** | 0.5 s | 1,115 MB | 3.6 % | yes | clone · en (de it pt es as separate files) |
| Pocket TTS — preset alba / estelle | **3.90× / 3.94×** | 0.3 s | 1,103 / 1,228 MB | 3.9 / 8.0 % | yes | 26 presets per language, 20 usable (§5) |
| KittenTTS Mini 0.8 | **3.41×** | 0.6 s | 1,860 MB | 3.6 % | **no** | 8 · en |
| Kokoro 82M (baseline) | **3.15×** (2.28× at 4 threads) | 3.8 s | 2,287 MB | 3.9 % | yes | 49 usable · 8 |
| MOSS-TTS-Nano 100M (clone) | 0.21× (0.25× at 16 threads) | 1.0 s | 976 MB | 5.6 % | yes | clone · 19 |
| Magpie 357M | 0.13× | 4.6 s | 2,466 MB | 3.3 % | yes | 5 · 12 |

- **Three speech models run comfortably faster than real time on the CPU: Kokoro, Kitten and
  Inflect.** Each line renders in a third of its own length or less.
- **Pocket TTS clones on the CPU at 4× real time** — the one cloner here that does. audio.cpp's
  ungated copy carries the cloning weights: cloning a low voice (106 Hz) gave about 96 Hz, cloning
  a high one (229 Hz) gave 226 Hz, and the clone's audio differs from the preset's. Its clone runs
  as the plain speech task with a reference clip; audio.cpp's Pocket refuses the clone task.
  (Decided 2026-10-02: use this copy, and show Kyutai's terms before the first clone.)
- **MOSS-TTS-Nano is not usable on the CPU.** It takes five seconds of wall time per second of
  speech, and doubling the threads barely moves it. Its card's *"streaming on a 4-core CPU"* is
  not what audio.cpp's CPU path delivers. On the long line it also repeated a sentence (*"she had
  not moved it"* twice).
- **Magpie is autoregressive and runs at 0.13×**, as expected. It is a GPU model.
- **Threads matter.** Kokoro does 2.28× real time at the app's current 4 threads and 3.15× at 8.
- **Kitten does not repeat itself under a fixed seed** — the same request twice gave different
  audio.
- **Peak RAM runs well above the file size.** Kokoro reaches 2.3 GB for a 190 MB file, which
  points at the runtime's default work buffers rather than the weights. Not tuned here.

### 6.2 Recognition

The clips are the check-D clips: LibriSpeech English (73) and FLEURS, 15 each of de, fr, es, ru,
ja and zh. The measure is mean word error, or character error for ja and zh, with the language
given. Each model is scored only on the languages it claims.

| Model | en | de | fr | es | ru | ja | zh | × real time | Peak RAM |
|---|---|---|---|---|---|---|---|---|---|
| Citrinet 256 | 7.5 % | | | | | | | **90×** | 266 MB |
| Moonshine tiny | 10.6 % | | | | | | | 81× | 444 MB |
| Moonshine small | 7.2 % | | | | | | | 25× | 951 MB |
| Moonshine medium | 6.8 % | | | | | | | 17× | 1,177 MB |
| Granite Speech 470M | 8.0 % | | | | | | | 23× | 1,369 MB |
| Canary 180M Flash | **4.1 %** | 5.0 % | 13.8 % | 4.4 % | | | | 10× | 1,028 MB |
| **Parakeet-TDT 0.6B v3** | 4.3 % | **3.9 %** | **8.8 %** | **3.3 %** | **7.1 %** | | | 12.7× | 4,636 MB |
| Nemotron 3.5 0.6B | 7.1 % | 8.5 % | 16.9 % | 5.0 % | 13.0 % | 14.0 % | 20.5 % | 13.6× | 1,956 MB |
| **Qwen3-ASR 1.7B (shipped)** | **4.2 %** | **2.3 %** | **7.7 %** | **2.6 %** | **3.8 %** | **5.2 %** | 8.1 % | 2.6× | 4,934 MB |
| Qwen3-ASR 0.6B | 4.7 % | 4.3 % | 12.4 % | 4.6 % | 7.0 % | 10.2 % | **7.9 %** | 5.0× | 2,821 MB |
| *Qwen3-ASR 1.7B, GPU (check D)* | *4.3 %* | *2.3 %* | *7.3 %* | *2.9 %* | *3.8 %* | *5.5 %* | *8.6 %* | *GPU* | |

- **The shipped recogniser runs on the CPU with its GPU accuracy**, at 2.6× real time: 2.5 s for an
  English clip, up to 5.7 s for a German one, against 0.53 s on the GPU. It loads in 6.8 s and
  peaks at 4.9 GB of RAM. The 0.6B is twice as fast and clearly worse outside English and
  Chinese. (Measured after the decisions below, under D4.)
- **Every other recogniser here is ten times faster than real time or more on the CPU**; for them
  accuracy and languages decide.
- **Parakeet on the CPU matches its GPU accuracy** from check D (4.4 / 3.7 / 8.8 / 3.3 / 7.1 % there),
  and it matches the shipped Qwen3-ASR in English. It is behind Qwen3-ASR on de, fr, es and ru, and
  it has no ja or zh. Its 4.6 GB peak is the session's default 3 GB weight buffer.
- **Nemotron is the only small model with ja and zh**, but it is the least accurate of the
  multilingual three everywhere.
- **The English-only models** (Citrinet, Moonshine, Granite) trail Parakeet and Canary on English.
  Citrinet also returns lower-case text with no punctuation.

## 7. Step 4 — the proposal (needs your go)

This is the approved direction from TASKS, with what the numbers settle and what they leave open.

**What the numbers settle:**
1. **A second runtime process, CPU-only.** It runs the same binary with `--backend cpu`, which
   was measured at 0 MB of graphics memory. It holds the models placed on the CPU, and the GPU
   process holds the rest. Both use the existing runtime code, with a second server and
   configuration.
2. **Per model: Auto / GPU / CPU.** Each Speech engines row carries the choice and says where the
   model runs and why — for example *"CPU — 3.2× real time here, keeps the graphics card free for
   the AI model"*.
3. **Auto, in the approved order:**
   - the GPU when the model fits beside the AI model;
   - else the CPU, if it is fast enough there;
   - else the GPU with the AI model unloaded, and a toast.
4. **The facts Auto reads.**
   - Every manifest variant states whether it is CPU-capable — a fact from this measurement, the
     same way `vram_min_mb` is.
   - The kit's measurement store records the real CPU speed on the user's own machine at the
     first render, and from then on that number decides.
   - Voice engine setup recommends from the same numbers.
5. **CPU-capable today**, from §6:
   - Speech: Kokoro.
   - Recognition: any model on the ASR row once it is in the catalog. Qwen3-ASR 1.7B on the CPU
     is unmeasured — the next point.
   - Qwen3-TTS, Chatterbox, MOSS-TTS-Nano and Magpie are GPU-only.

**What needs your word:**
- **D1 · "Fast enough" for speech.** I lean towards **2× real time**: Kokoro, Kitten and Inflect
  pass, and everything else fails by a wide margin.
- **D2 · CPU threads.** I lean towards **the physical core count** (8 here), as a setting on the
  speech runtime. The process uses 4 today, and Kokoro loses about a third of its speed there.
- **D3 · New CPU voices.** Add KittenTTS (8 voices, English) and Inflect (1 voice, English) as
  engines? Both are fast and clear. Kitten does not repeat itself under a fixed seed, and the
  app's "same seed, same audio" promise would need an exception for it. I lean towards adding
  Kitten and leaving Inflect out, since one voice adds little.
- **D4 · A CPU recogniser.** Measure Qwen3-ASR 1.7B on the CPU first. The research pass counted
  your *"qwen … on cpu"* as covering it — §5 question 3. If it is too slow, I lean towards
  Parakeet as the CPU recogniser for English and European languages, with Qwen3-ASR kept on the
  GPU for ja and zh.
- **D5 · Cloning on the CPU.** Nothing in audio.cpp clones fast enough on the CPU today. Cloned
  voices stay GPU-only, and the CPU cloner stays on the gap list (switch plan §5 item 6).
- **§5 questions 1–4** (Pocket TTS, Supertonic 3, Qwen3-ASR 0.6B, Chatterbox Turbo) still stand.

## 8. Step 4 — the build (go 2026-10-02)

**What it is.** Every speech model now has a place to run: the graphics card or the CPU. Auto
chooses per model, from numbers measured on this machine, so a small model no longer pushes the AI
model off an 8 GB card. The user sees where each model runs and why, and can pin it to GPU or CPU.
Two new engines come with it: KittenTTS (8 English presets) and Pocket TTS (cloning plus 20
presets, five languages), both fast enough to live on the CPU.

**Two runtime processes.** The speech runtime's build (CUDA, Vulkan, Metal) runs the GPU models, as
today. A second process of the same build runs with `--backend cpu` for the CPU models — measured
at 0 MB of graphics memory (§6). Its thread count is a setting (`speech_runtime.cpu_threads`, 0 =
the physical core count). On a machine whose runtime is the CPU build there is only the one process.

**The rule (TASKS, decided).** Per model: Auto / GPU / CPU (`engine_overrides[id].placements`).
Auto, in order:
1. the GPU when nothing else is on the card, or when the model's measured graphics-memory size fits
   beside the AI model;
2. else the CPU, when the model runs at least `speech_runtime.cpu_min_realtime` (2×) real time there;
3. else the GPU, with the AI model unloaded first — the kit's eviction event, so the existing toast.

A model never measured on the card counts as not fitting while an AI model is on it (decision 1).
"Fast enough" reads the speed measured on this machine; until a first CPU render records one, the
manifest's reference speed (§6, this Ryzen 7 5700X) stands in. A model with neither is not offered
to the CPU by Auto (Qwen3-TTS, Chatterbox). A runtime that is the CPU build puts everything on the
CPU.

**Measurement.** The first line a CPU-placed model speaks (and the first clip it transcribes) after
each load records its real-time factor in the kit's measurement store — a new additive
`realtime_x` column beside `vram_model_mb`, `backend` set to `cpu`. The kit's tok/s speed bands
are an LLM scale; speech uses the one decided bar and shows the number itself.

**What the user sees.** Speech engines: a CPU-threads field on the runtime row; on every model row
an Auto / GPU / CPU select and a line saying where it runs (or would run) and why. Changing a loaded
model's place reloads it there. Voice engine setup: the three tiers of decision 3, each engine
saying where it will run.

**Pocket TTS terms (decision 2).** The manifest carries Kyutai's prohibited-use terms. The server
refuses any Pocket render from a reference clip until they are accepted once
(`engine_overrides.pocket.terms_accepted_at`), with a message that says so. The Clone tab shows the
terms with Accept when Pocket is the chosen model; a refusal met in Generate or an audition opens
the same prompt; JustWrite, MCP and API calls get the refusal until then.

**Languages.** Pocket is one model per language; its presets speak whichever language's model is
loaded, and a line in another language is refused by name, as Qwen3 refuses the wrong checkpoint.
KittenTTS is English only and does not repeat itself under a fixed seed, so it offers no seed.

## 9. Built and verified (2026-10-02)

**What landed.**
- **Kit:** `model_measurements.realtime_x` plus `record(realtime_x=, backend=)` (additive);
  `ApiError(extra=)` → RFC 7807 extension members; the UI transport's errors carry `status` and
  `problem`.
- **Server:** two runtime processes (`runtime.get_server("gpu" | "cpu")`);
  `manager.placement_for` and the load door's placement; `_unload_ai_model`; `_record_cpu_speed`;
  the KittenTTS and Pocket TTS manifests (Pocket's TERMS and its 20 presets); the slot's
  Kitten/Pocket mapping, Pocket's language refusal and the terms gate; `TermsRequired` → 403
  `terms-required`; `PUT /v1/engines/{id}/models/{model}/placement`, `POST /v1/engines/{id}/terms`,
  `speech_runtime.cpu_threads` / `cpu_min_realtime`.
- **App:** each model's **Runs on** line; CPU threads on the runtime row; Pocket's terms on its
  foot, on the Clone tab and in `EngineTermsDialog` (opened by any refusal); Voice engine setup's
  tiers.
- **Docs:** engines, voices, quick-setup, settings-reference, gpu, troubleshooting, whats-new,
  NOTICE, LICENSES, code-map.

**Pocket TTS's other languages, measured for their reference speeds** (same five lines
translated, preset alba, 8 threads): German 3.42×, Italian 3.57×, Portuguese 3.63×, Spanish 3.62×.
Read back by Parakeet, German and Italian came out clean; Portuguese and Spanish drop words
depending on the seed (a Spanish short line came out as 0.8 s; a long Portuguese line in quotation
marks kept only its last sentence, 4.4 s against 7 s without the marks). Shipped as decided; the
docs say it.

**Gates.**
- Server: ruff clean, 895 passed.
- Renderer: biome clean, vitest 122, vite build, smoke 14/14 views with zero JS errors on the real
  data dir.
- Kit: 1,027 passed, 10 skipped; JustWrite's build and its 592 unit tests pass with the kit's
  client change.

**Live, through JustVoice on the real data dir.** Gemma 26B-A4B was resident at 6,797 MB of the
8 GB card.

| Step | Result |
|---|---|
| Model rows | Kokoro, KittenTTS, all five Pocket models and speech recognition → CPU (reference speeds); Chatterbox and Qwen3 → the card, the AI model making room |
| Load Kokoro (Auto) | on the CPU; the card 7,180 → 7,189 MB; Gemma still running; the CPU process up at 8 threads, the GPU one not started |
| First Kokoro line | recorded **2.47×** real time here (the row now reads "2.5× real time here") |
| Pocket clone audition, terms not accepted | 403, type `…/terms-required`, `engine: pocket`, the message |
| Accept, audition again | 200, 4.8 s of audio, on the CPU, the card unchanged. **The test acceptance was then cleared — accepting Kyutai's terms is the user's to do** |
| Kokoro set to GPU, loaded | on CUDA ("your choice"); Gemma unloaded through the admission, eviction event `loading kokoro` |
| Kokoro set to CPU while loaded | `moves: true`; the reload put it on the CPU; its booking was released |
| Speech recognition (Auto) beside Gemma | on the CPU; transcript correct; recorded **2.06×** here — just over the 2× bar |
| Screens | the Runs on line (select 110 px after narrowing it from 180), the runtime row's CPU threads, Pocket's foot, the Clone tab's terms, the terms dialog, Voice engine setup's 8 GB tier |

**Open.**
- Speech recognition sits at 2.06× on this machine, just over the bar. A slower measurement would
  send it back to the card, with the AI model unloaded.
- The third step's blanket unload (a model never measured on the card) is covered by unit tests
  only. Every GPU model on this machine already has a measured size.
- Old speech load rows carry the LLM's backend in `backend`. Kokoro's newest measured size is the
  949 MB Vulkan figure from Check C, so the fit check is conservative here until a CUDA load
  records again.
