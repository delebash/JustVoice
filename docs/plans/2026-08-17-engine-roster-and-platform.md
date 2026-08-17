<!-- SPDX-License-Identifier: MIT -->

# The engine roster and the platform layer — decided 2026-08-17

**Read this before proposing, adding, dropping or re-researching any TTS
engine.** Everything here was verified once, at real cost — in the code, or on
the web against primary sources. Nothing in it is recalled. If you are about to
look up what an engine can do, what it costs, or whether it runs on a Mac, the
answer is below.

Companion docs, and what each owns:

| Doc | Owns |
|---|---|
| `docs/dev/code-map.md` §3a–3d | What each shipped model **is**, the honest ✓ grid of what each adapter **reads**, the incompatible tag syntaxes, and the OS gate |
| `docs/plans/2026-08-15-voice-workflow-redesign.md` | The **voice workflow** design — identity → hear → make, line-is-the-unit, the persona layer. §9 covers Qwen VoiceDesign |
| `docs/engines.md` | The user-facing catalog and the per-OS table |
| `docs/dev/TASKS.md` | The decisions, in the six-field format, with their gos |

---

## 1. The decision

**The roster goes from 7 TTS engines (13 catalog variants) to 4 TTS engines
plus a CPU cloner, alongside the unchanged Whisper STT engine.**

Counted exactly, because "9 engines" in the README is a loose count of
engine-*variants* (Kokoro · Chatterbox ML · Chatterbox Turbo · Qwen3 CV ·
Qwen3 Base · LuxTTS · TADA · Dia · MOSS) and is not the same number as either
the engine count or the variant count. Before: kokoro 2 · chatterbox 2 ·
qwen3 4 · luxtts 1 · tada 1 · dia 2 · moss 1 = **13 variants, 7 engines**.

The rule that produced it, and the only rule used:

> **Keep an engine only if it is the ONLY one that does something we need.
> Everything else is surface: another branch in the knob panel, another
> trade-off to explain at cast time, another row that can drift.**

| Slot — and nothing else fills it | Engine | Verdict |
|---|---|---|
| Ready-made voices · any hardware · deterministic | **Kokoro** | **keep** |
| Cloning + inline expressive tags | **Chatterbox Turbo** | **keep** |
| Cloning across 23 languages | **Chatterbox Multilingual** | **keep** |
| **Prose direction + voice design** | **Qwen3-TTS** | **keep — the crown jewel** |
| Cloning without a GPU | **LuxTTS → Pocket TTS** | **swap** |
| — | **Dia** | **DROPPED 2026-08-17** |
| — | **TADA** | **marked for removal** |
| — | **MOSS-TTSD** | **marked for removal** |
| Transcription | **Whisper** | **keep** (STT, not in the TTS contest) |

**User ruling, verbatim, 2026-08-17:** *"drop dia stop testing for it"*, then
*"your rec but dont remove them now you can mark them for removal and hide them
if you want and ok oand the pcket tts swap"*.

So: **Dia is excised.** TADA and MOSS are **marked and hidden, not deleted** —
they keep working for anyone who already installed them, and no new install
offers them. Pocket TTS is **approved to build**.

**Download surface removed when all of it lands — summed from the manifests'
own pinned `size_bytes`, not estimated:**

| | Default variants only | Every variant |
|---|---|---|
| Dia (`dia2-1b` 4.31 + mimi codec 0.38; `dia2-2b` adds 7.68) | 4.69 GB | 12.38 GB |
| TADA (3 repos: 8.87 + 10.72 + 0.02) | 19.61 GB | 19.61 GB |
| MOSS-TTSD | 4.12 GB | 4.12 GB |
| LuxTTS (swapped, not pure removal) | 1.18 GB | 1.18 GB |
| **Total** | **29.60 GB** | **37.28 GB** |

> An earlier draft of this doc said "≈56 GB". That was wrong — nothing in the
> manifests sums to it. The table above is the arithmetic.

---

## 2. Every engine, and the full reasoning

### 2.1 Kokoro — keep, uncontested

The only preset library (54 voices), the only deterministic engine, the
smallest by 3×, and the only one declaring **CoreML and DirectML** alongside
CUDA and CPU. The only engine flagged `cpu_adequate: True`, which is what makes
`auto` resolve to CPU and book no device memory on a discrete box.

- StyleTTS2-derived, 82M parameters, ONNX via `sherpa-onnx` — **no torch**.
- `kokoro-multi-lang-v1_0`: **349,418,188 bytes** = 349 MB decimal = **333 MiB**.
  `docs/engines.md` says 333 and `code-map.md` says 349 — the SAME number in
  different units. Do not "fix" either to match the other.
- **8 languages across 9 locale codes** (`en-US`, `en-GB`, ja, zh, es, fr, hi,
  it, `pt-BR`) — the manifest's own description says 8, code-map §3a says 9,
  and both are defensible because en-US and en-GB are one language. 54 preset
  voices.
- **Cannot clone.** Verified: `supports_voice_cloning=False`. The architecture
  takes no reference clip.
- Reads `speed`; declares phoneme override which is **not wired**.

**It is the answer to "I have no GPU" and to "I want a voice right now".**

### 2.2 Chatterbox Turbo — keep

**The only tag-capable cloner we ship.** Nineteen inline tokens read straight
from the checkpoint's own `added_tokens.json` (reserved ids 50257–50275), split
into three categories because they are not one kind of thing:

- **emotion** (7): `[angry] [fear] [happy] [sarcastic] [surprised] [crying] [whispering]`
- **register** (3): `[narration] [dramatic] [advertisement]`
- **paralinguistic** (9): `[cough] [laugh] [chuckle] [sigh] [gasp] [groan] [sniff] [clear throat] [shush]`

This is the *whole reason* `Delivery.emotion` is cross-engine: it is the only
engine that can take the enum as anything but prose. `value_map` on its emotion
tagset maps our nine values onto its seven tokens; `neutral` → empty string
(expressible, emits nothing); `sad`, `shouted` and `contemptuous` have **no
token** and the UI says so rather than substituting a near-neighbour.

- 2.99 GB, English only, 3.0 GB-ish load set.
- Upstream documents only `[cough] [laugh] [chuckle]` by name and says "and
  more" — the other sixteen are **declared but unverified by ear**.
- Turbo accepts `exaggeration` / `cfg_weight` / `min_p` but Resemble defaults
  them to **0.0 (off)** for speed; we leave them there and hide the sliders.
- Multilingual **shares the engine id but not the tokenizer** and reads the tags
  aloud as words. This is why `_emotion_tagset()` resolves through
  `manager.current_variant_id()` and not the engine id.

### 2.3 Chatterbox Multilingual — keep

**Cloning across 23 languages — the widest by a distance.** 3.21 GB. Upstream
advice recorded in the manifest: for language transfer set `cfg_weight=0`.

Reads `temperature`, `exaggeration`, `cfg_weight`, `repetition_penalty`,
`min_p`, `top_p`, `seed`.

### 2.4 Qwen3-TTS — keep, and invest

**The only engine that takes prose direction, and the only route to voice
design.** If one engine survives, it is this one.

Three checkpoint families, and the split decides everything:

| Family | Presets | Clones | Takes `instruct` | Size |
|---|---|---|---|---|
| **CustomVoice** | **9** (Vivian, Serena, Uncle Fu, Dylan, Eric, Ryan, Aiden, Ono Anna, Sohee) | **✗** | **✓** | 4.52 GB (1.7B) / 2.50 GB (0.6B) |
| **Base** | 0 | **✓** | **✗ — drops it silently** | 4.54 GB (1.7B) / 2.52 GB (0.6B) |
| **VoiceDesign** | — | — | **✓ (as the description)** | ≈ 4.52 GB — **not shipped** |

All ten languages on every checkpoint: Chinese, English, Japanese, Korean,
German, French, Russian, Portuguese, Spanish, Italian.

**The trap, recorded because it has bitten twice:** `qwen3/manifest.py:34-37`
declares `voice_cloning: True` at *engine* level as the union across variants.
The **per-variant flag is the truth**. Any UI offering cloning must branch on
the variant.

**The tension this creates, and it is the important one:** direction and
identity pull against each other. Prose direction reaches CustomVoice and
nothing else, and CustomVoice cannot clone. Base clones and drops the
instruction — its clone call passes text, reference and language only. So
"direct the performance in words" and "use this character's cloned voice" are
a choice today. The three routes to having both:

| Route | Identity | Direction |
|---|---|---|
| VoiceDesign → clone | designed | **lost** — it is a clone now |
| Chatterbox Turbo clone | cloned | **categorical only** (19 tokens) |
| **LoRA on an instruct checkpoint** | trained | **kept** — costs a training run |

We already own the LoRA machinery: `POST /v1/train` and `TrainView`.

### 2.5 LuxTTS → Pocket TTS — swap

**LuxTTS holds the CPU-cloning slot today and Pocket TTS beats it on every
axis.** The slot itself is real and must not be lost: LuxTTS is currently the
**only cloner that works without a GPU**, and Kokoro is not a substitute
because Kokoro cannot clone at all.

| | LuxTTS | Pocket TTS |
|---|---|---|
| Provenance | `ysharma3501/LuxTTS` — an **individual's fork** | **Kyutai Labs** (the Moshi team) |
| License | Apache-2.0 | **MIT** — matches our ship license |
| Base | ZipVoice (k2-fsa), 123M params | CALM — Continuous Audio Language Model, 100M params |
| Download | 1.18 GB | far smaller — **see the caveat in §5** |
| Languages | **English only** | **6** — en · fr · de · pt · it · es |
| Reads from delivery | `speed`, `seed` | **nothing** |
| Install | torch + pip + **piper-phonemize via a k2-fsa find-links index** + **LinaCodec from git** + **LuxTTS from a git fork** | **`pip install pocket-tts`** |
| CPU claim | "faster than realtime" — **never measured by us** | **~6× realtime on a MacBook Air M4**, ~200 ms first chunk, **2 cores** |

The install row is the one to weigh: LuxTTS needs **three non-PyPI sources**,
one of them a personal fork. Pocket TTS is one line from a research lab.

LuxTTS's only functional edge is `speed` — and `code-map.md` §3b already records
that `speed` should move host-side, where it would work for every engine. That
advantage is scheduled to evaporate regardless.

**Order of operations: add Pocket TTS and measure it BEFORE removing LuxTTS.**
Never leave a window where nothing clones without a GPU.

### 2.6 Dia — DROPPED, done

Excised 2026-08-17 on *"drop dia stop testing for it"*.

- Duplicated MOSS's slot (multi-speaker dialogue) and lost the comparison:
  MOSS does **3 speakers + pause tags + Chinese for 4.12 GB**; Dia did 2
  speakers for **4.69 GB (1B) / 8.07 GB (2B) + 0.38 GB codec**.
- **The ZipVoice-Dialog paper clocks Dia at 1.663 RTF on an H800** — slower
  than realtime **on a datacentre GPU**. (Same table: MoonCast 0.953,
  ZipVoice-Dialog 0.063.)
- Historical: Dia 1's adapter never read `req.audio_prompt_path`, so every
  cloned voice pointed at Dia rendered in the stock voice, silently, for
  months. Dia2 fixed that but was **never executed once** before the drop.

**Deliberately kept:** the **Dia-TTS-Server** entry in the self-hosted TTS
provider list (`TtsProviderForm.vue:76`). That is a different feature —
pointing JustVoice at someone else's OpenAI-compatible server — and costs
nothing.

### 2.7 TADA — marked for removal

**It costs the most and gives the least.**

- **19.61 GB across three repos** — the largest download we ship, by 2.4×.
- **`tada/engine.py` reads NO delivery field at all.** Text, reference clip,
  language, seed. Nothing else. Three sliders (`steps`, `noise_temperature`,
  `faithfulness`) were declared against it and moved nothing; removed
  2026-08-17.
- Its 10 languages (en ar de es fr it ja pl pt zh) are a **subset** of
  Chatterbox Multilingual's 23 — which also gives temperature, exaggeration and
  cfg_weight, for 3.21 GB.
- Weights are **Llama-3.2 Community**, which obliges us to display *"Built with
  Llama"* in the UI and the docs. Dropping it removes a licence obligation.

**The one argument against dropping it, recorded so it is not lost:**
**HumeAI publishes an OFFICIAL MLX port** — `HumeAI/mlx-tada-1b` and
`HumeAI/mlx-tada-3b`. On Apple Silicon that would make TADA the
lowest-risk cloning engine we could ship, because it is the only *official*
MLX port in the field. It still does not give TADA a unique job, and if we are
going to build an MLX path, Qwen3 is the better place to spend it. See §4.

### 2.8 MOSS-TTSD — marked for removal

**Its headline capability has never been reachable, and the architecture
cannot use it.** This is the finding that decided it, and it is the sharpest
one in the session — see §6.1 for the full proof.

Its remaining claims collapse on inspection:

| MOSS claim | Reality |
|---|---|
| Multi-speaker dialogue | **Unreachable.** `speaker_prompts` exists in a note string and a code comment; the adapter passes ONE `reference_audio` |
| `[pause 0.5s]`…`[pause 2.0s]` tags | `pause_before` / `pause_after` are **host-side** and work on **every** engine |
| Chinese | Chatterbox Multilingual does 23 languages including zh, **and clones** |

Cost: 4.12 GB, self-described **EXPERIMENTAL** in its own manifest, needs
**flash-attn** (Linux-only in practice), and carries its own venv.

**What is genuinely given up:** natural turn-taking — overlap, interruption,
reactive timing, a breath taken because of what the other person just said.
Concatenated per-line dialogue is clean but slightly walkie-talkie. That is a
real ceiling for podcast and cutscene work. But it is unreachable today, and
reaching it is not a model swap: it needs a render call spanning multiple
blocks, a speaker→clip map, per-speaker cast resolution and a different cache
key — all pushing against **line-is-the-unit**, which is already decided.

**If line-is-the-unit ever reverses, this comes back as a deliberate feature,
not a dormant engine.**

### 2.9 Whisper — keep

Different kind (STT), not in the TTS contest. Powers dictation captures,
`/v1/transcribe`, and the `justvoice.transcribe` MCP tool. Five sizes; turbo is
the default at 1.62 GB. Pure transformers + torch, nothing platform-specific.

---

## 3. The architecture fact that decides CPU viability

**Every engine falls on one side of one question: does it decode audio tokens
one at a time?**

| Engine | Architecture | CPU viable? |
|---|---|---|
| **kokoro** | StyleTTS2 / ONNX via sherpa-onnx, **non-autoregressive** | **✓** |
| **luxtts** | ZipVoice flow-matching, **non-autoregressive**, 123M | **✓** |
| **pocket-tts** | CALM, **non-autoregressive**, 100M | **✓** |
| chatterbox Turbo / ML | T3 Llama backbone, **autoregressive** | GPU |
| qwen3 | LLM talker, **autoregressive** | GPU |
| tada | `TadaForCausalLM` (`tada/engine.py:114`) | GPU |
| moss-ttsd | LLM; the adapter docstring shows `device="cuda"` | GPU |

**RAM is not the binding constraint.** Turbo is 2.99 GB, Multilingual 3.21,
Qwen3 4.52 — they all *fit* in 32 GB with room to spare. The constraint is the
autoregressive decode loop, which does not parallelise the way CPUs need.

Resemble's own position: practical Chatterbox production requires a GPU. They
ship a **Nano** variant specifically for CPU (~3× realtime on 8 cores) — **we
do not ship Nano.** Unverified lead: if Nano exists as a checkpoint our pinned
`chatterbox-tts==0.1.7` can load, it would give us a CPU cloner *with* the tag
surface, which would change the tier table. Not checked.

Measured numbers on the record:

- **ZipVoice-Distill: 32.6× speedup on a single CPU thread**; 23.7× on GPU. 123M
  params, Zipformer flow-matching decoder, average-upsampling text-speech
  alignment, flow distillation to cut sampling steps.
- **Chatterbox Turbo: ~6.0× RTF on consumer GPUs**; 0.499 RTF on an RTX 4090,
  first-chunk latency ~472 ms.
- **Dia: 1.663 RTF on an H800.** MoonCast 0.953. ZipVoice-Dialog 0.063.

---

## 4. The platform layer — three runtimes, not one axis

"Cross-platform" is not a single question. There are **three runtimes**, and an
engine's reach is decided by which of them it has an adapter for.

| Runtime | Reach | Notes |
|---|---|---|
| **PyTorch** | Windows · Linux · macOS-CPU | What every adapter uses today |
| **ONNX** | everywhere, **slow on CPU** | 5–10× slower than GPU; batch work, not real-time |
| **MLX** | **Apple Silicon only, fast** | Apple's framework. A *third* load path per engine |

### 4.1 MLX — the full record

**`mlx-community` carries the COMPLETE Qwen3-TTS family, including VoiceDesign,
at every quantization.** This is the single most consequential finding of the
session.

| Repo family | Variants | Quantizations |
|---|---|---|
| `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-*` | Base | 4 · 5 · 6 · 8-bit · bf16 |
| `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-*` | CustomVoice | 4 · 5 · 6 · 8-bit · bf16 |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-*` | Base | 4 · 5 · 6-bit · bf16 |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-*` | CustomVoice | 4 · 5 · 6 · 8-bit · bf16 |
| **`mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-*`** | **VoiceDesign** | **4 · 5 · 6 · 8-bit · bf16** |

Also present from other publishers: `PatternMapper/…-1.7B-Base-MLX-8bit`,
`aufklarer/…-0.6B-{Base,CustomVoice}-MLX-4bit`,
`aitytech/…-0.6B-{Base,CustomVoice}-MLX-4bit`. 36 repos matched the search.

**The buried headline: `Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit` is ~0.6B on
disk**, against the PyTorch checkpoint's **4.52 GB**. That is the redesign
doc's §9.1 "one variant row away, 4.52 GB download" item, an order of magnitude
cheaper — on Mac.

**`HumeAI/mlx-tada-1b` — the OFFICIAL HumeAI org.**

```python
from mlx_tada import TadaForCausalLM, save_wav
model = TadaForCausalLM.from_pretrained("HumeAI/mlx-tada-1b", quantize=4)
ref = model.load_reference("ljspeech.wav")
out = model.generate("Hello, this is a test of TADA speech synthesis.", ref)
save_wav(out.audio, "output.wav")
```

- Base model Llama 3.2 1B; **Llama 3.2 Community License**; **English only**.
- Components ≈ 4.3 GB: LLM + VibeVoice head 3.0 GB · aligner 852 MB ·
  DAC decoder 226 MB · encoder 178 MB.
- *"Tested on Apple M1 Pro and above. 4-bit quantization is recommended for
  most devices — it is roughly 10x faster with 60% less memory."*
- Sibling: **`HumeAI/mlx-tada-3b`** — 3B multilingual MLX weights.

**`mlx-community/MOSS-TTS-8B-8bit` — read this carefully before citing it.**
It converts **`OpenMOSS-Team/MOSS-TTS`** (MossTTSDelay-8B), which is **NOT**
MOSS-**TTSD**, the dialogue model we ship. The model card is explicit that
MOSS-TTSD is the multi-speaker one. This port is **single-speaker cloning**.
**It does not give us dialogue on a Mac.** Apache-2.0, 8-bit, 20 languages,
loads via `transformers` (5.0+) with `trust_remote_code=True`.

**`kapi2800/qwen3-tts-apple-silicon`** — MLX CLI wrapper, 551★ / 77 forks, all
three variants in Pro (1.7B) and Lite (0.6B). Claims 2–3 GB RAM vs 10+ GB, and
40–50 °C vs 80–90 °C, on a fanless M4 MacBook Air. `pip install -r
requirements.txt` + `brew install ffmpeg`, Python 3.10+. **No license stated —
that alone disqualifies it as a dependency.** Useful as evidence that the MLX
path works end to end, including VoiceDesign.

### 4.2 ONNX — real, community, and slow on CPU

Qwen3-TTS ONNX exports exist but are **all community**, none from QwenLM:

- `romara-labs/Qwen3-TTS-12Hz-0.6B-Base-ONNX`
- `sivasub987/Qwen3-TTS-0.6B-ONNX-INT8`
- `xkos/Qwen3-TTS-12Hz-1.7B-ONNX`
- `arubeh/qwen3-tts-12hz-1.7b-base-onnx` — re-exported from PyTorch FP32,
  **9 components, self-described as parity-verified**

CPU inference is reported **5–10× slower than GPU** — viable for batch, not
real-time. FP32 is the CPU precision of choice; FP16 on CPU adds **9–13%
overhead**. Quality-versus-PyTorch is **unmeasured by us**.

### 4.3 Apple Silicon, engine by engine — the honest state

| Engine | macOS today | The route, if there is one |
|---|---|---|
| **Kokoro** | **✓ works** | CoreML declared; no work needed |
| **Chatterbox** | **✓ but CPU-only** | `_pick_device_chatterbox` forces CPU on Darwin |
| **LuxTTS** | declared, **unverified** | `mps` in `gpu_runtimes`; nobody has run it |
| **Whisper** | ✓ | plain `pick_device`, falls through to mps |
| **Qwen3** | **✗** | **MLX** — the complete family exists (§4.1) |
| **TADA** | **✗** | **MLX** — official port exists |
| **MOSS-TTSD** | **✗** | none. The MLX port is a different model |

**On Chatterbox and MPS — the devnen finding.**
`devnen/Chatterbox-TTS-Server` claims *"Full support for NVIDIA (CUDA), AMD
(ROCm), and Apple Silicon (MPS) GPUs"* and supports all three Chatterbox
variants. **But it gets there through a fork.** It depends on
`git+https://github.com/devnen/chatterbox-v2.git@master`, not upstream Resemble,
and applies an automatic post-install patch for a specific Turbo crash:

> *"Turbo Model crash ('Cannot convert a MPS Tensor to float64 dtype') by
> forcing float32 in s3tokenizer and voice_encoder"*

Requires macOS 12.3+ and `device: mps` in `config.yaml`.

**Conclusion: our force-CPU-on-macOS is CORRECT for the package we pin.** MPS
for Chatterbox needs a fork we do not ship. Recorded so nobody "fixes" the
CPU override without also changing the dependency.

### 4.4 The recommendation on MLX

**Build MLX for Qwen3, and only Qwen3.**

- Qwen3 is the only engine with a capability nothing else has.
- MLX is the only route to it on Apple Silicon.
- `mlx-community` has the complete family including **VoiceDesign**, which is
  simultaneously the cheapest path to shipping voice design at all.
- It turns "Mac users lose our best feature" into "Mac users get it cheapest".

Not for TADA (being removed). Not for MOSS (the port is a different model).

**Caveats, stated plainly:** `mlx-community` is a community org, not Alibaba.
MLX is a **third runtime**, which is real surface. **Nobody has heard any of
these ports.**

---

## 5. Pocket TTS — the full record

**`github.com/kyutai-labs/pocket-tts`** · Kyutai Labs (the Moshi team) ·
released January 2026.

| | |
|---|---|
| License | **MIT** — matches our ship license exactly |
| Parameters | 100M |
| Architecture | **CALM** — Continuous Audio Language Model. Processes text and audio in parallel |
| Languages | **6** — English, French, German, Portuguese, Italian, Spanish. Non-English have optional **24-layer variants** for higher quality |
| Cloning | **✓ zero-shot** from an audio file, or a Hugging Face voice |
| CPU speed | **~6× realtime on a MacBook Air M4**, **~200 ms** to first audio chunk |
| Hardware | **2 CPU cores.** Python 3.10–3.14, PyTorch 2.5+ |
| Install | **`pip install pocket-tts`** (or `uv add pocket-tts`) |
| Expressive controls | **none.** No emotion, speed, instruct or tags. README explicitly lists "adding silence in the text input to generate pauses" as unsupported |

API:

```python
voice_state = tts_model.get_state_for_audio_prompt("alba")          # or a .wav path
audio       = tts_model.generate_audio(voice_state, "Hello world, this is a test.")
```

**The architectural fit, and it is a good one:** the README notes that encoding
an audio file is *"relatively slow"* but that **exported voice embeddings load
quickly**. Clone once, store the embedding, reuse instantly. That maps directly
onto `VoiceRecord.embedding` and fits our Voice-as-artifact model better than
anything else we ship.

**⚠ The size caveat — do not type a number until it is checked.** Secondary
write-ups say "~30 MB". **The README does not state a download size.** 30 MB
for 100M params implies about 2.4 bits/param, which would be aggressive:
100M is ~400 MB at fp32, ~200 MB at fp16, ~100 MB at int8, ~50 MB at int4.
**Read the actual weight files before this goes in a manifest.**

**Also unverified:** nobody has heard it. Clone fidelity is the entire point of
a cloning engine and this is a spec-sheet judgement. And macOS is proven (the
benchmark is an M4); **Windows is not**.

**This is an integration, not a swap** — new adapter, manifest, variant row,
install plumbing, capability row.

---

## 6. Rejected candidates, and why

### 6.1 Kokoro cloning — does not exist

Kokoro has **no native cloning**. StyleTTS2-derived, 82M params, takes no
reference clip. Confirmed against `hexgrad/Kokoro-82M`.

**`Ashish-Patnaik/kokoclone`** (Apache-2.0, 187★ / 26 forks, single maintainer,
Python 3.10–3.12, HF Spaces demo, library + CLI + web UI) is **not Kokoro
cloning**. It is a **two-stage pipeline**: Kokoro-ONNX synthesizes in a preset
voice, then a separate **"Kanade Tokenizer"** does zero-shot voice *conversion*
on the output to match a 3–10 s reference. Quality is bounded by the conversion
stage, not by Kokoro.

| | kokoclone | Pocket TTS |
|---|---|---|
| Provenance | one maintainer, 187★ | Kyutai Labs |
| License | Apache-2.0 | **MIT** |
| Architecture | TTS + separate VC pipeline | single model |
| Languages | **8** — en · **hi** · fr · **ja** · **zh** · it · pt · es | 6 (European only) |
| Stated perf | **none** | 6× realtime, 2 cores, ~200 ms |
| Model size | **not stated** | not stated in README |

**Its one genuine edge is Asian-language coverage** (ja / zh / hi), which Pocket
TTS lacks. If those matter to the audiences, that is a real argument — but a
third-party two-model pipeline with no published numbers is not the thing to
put in the CPU cloning slot.

### 6.2 LuxTTS's standing in the field

A 2026 open-source voice-cloning ranking put **Fish Speech V1.5, CosyVoice2-0.5B
and IndexTTS-2** in the top three; LuxTTS was not in the top tier. It remains
functional. Recorded as context for the swap, not as the reason for it.

### 6.3 piper-phonemize was NOT a platform blocker — correction

An earlier claim in this session that piper-phonemize threatened LuxTTS on
Windows was **wrong**. The k2-fsa find-links index publishes
`win_amd64`, `win32`, `macosx_10_14_x86_64`, `macosx_11_0_arm64`,
`macosx_10_9_universal2` and manylinux (x86_64 / aarch64 / armv7l / i686)
wheels for **Python 3.7–3.14**. The *supply-chain fragility* point stands —
three non-PyPI sources, one a personal fork — but the platform point does not.

### 6.4 edge-tts — raised and withdrawn the same day

Proposed 2026-08-17 (*"gives quick cheap tts i think with lots of voices"*),
withdrawn minutes later (*"never mind drop edg-tts"*). **Not added.** Recorded
only so the research is not repeated:

- `pip install edge-tts`, **LGPLv3**, Python ≥3.7, no API key or account.
- Dozens of locale-specific neural voices; `--rate`, `--volume`, `--pitch`.
- **It is Microsoft Edge's ONLINE service.** No offline mode at all.
- **No SSML** — upstream removed it because *"Microsoft prevents the use of any
  SSML that could not be generated by Microsoft Edge itself."*
- **The blocker if it is ever reconsidered:** it is unofficial use of a
  Microsoft endpoint, and PyPI states no terms — it defers to Microsoft's own.
  Our roster rule is that output must permit commercial use (Higgs was removed
  2026-06-09 for exactly this). For a product whose users sell audiobooks, that
  is unresolved, not merely unstated.

---

## 7. Code-verified findings from this session

### 7.1 MOSS's multi-speaker capability is unreachable — and we advertise it

**The proof, in full, because it decided §2.8.**

`speaker_prompts` appears in exactly **two** places in the whole repository, and
**both are prose**:

1. `capability_details.py:435` — a note **string**: *"Fundamentally
   multi-speaker. Provide a speaker_prompts map per [Sx] tag."*
2. `models.py:906` — a **comment**: `# MOSS speaker_prompts map`

It is never passed. `moss_tts/engine.py:108-115` builds its kwargs as exactly:

```
mode · reference_audio · temperature · top_p · top_k · repetition_penalty · max_new_tokens
```

**One `reference_audio`. Singular.** Put `[S1]`/`[S2]` in the text and both
characters come out of the same clip.

Meanwhile `supports_multi_speaker=True` is served to the client and
**`GenerateView.vue:845` renders a green "✓ multi-speaker" badge**. A capability
claim with nothing behind it.

**And the architecture could not use it anyway.** `Block.persona_id` is one
persona per block (`database/models.py:236`); `render_chapter_api.py:526-540` is
a `for line in lines` loop calling `render_line` per line, stitched by
`concat_lines(rendered, silence_ms=...)`. Every line is an independent synth.

> **This badge is a live false claim regardless of whether MOSS is removed.**

### 7.2 QuickSetup hardcodes the tier recipe — and had drifted

Raised by the user: *"doesnt quick setup just pull engine config info and or
data in db, nothing is hardcoded to a specific engine like dia in quick setup,
correct?"* — correct instinct, opposite reality.

`QuickSetup.vue:43-80` holds `TIER_RECIPES`, a renderer-side constant with
hardcoded engine ids, hardcoded `estimatedDownloadGb`, and blurbs naming
engines in prose. It fetches `/v1/system` for VRAM and `/v1/engines` for the
list, but the **recipe itself is typed by hand**.

Two drifts found and **fixed** 2026-08-17:

1. **`"moss_tts"` was a dead id.** The manifest is `ID = "moss-tts"`
   (`moss_tts/manifest.py:22`); only the *folder* is `moss_tts`. The 24 GB and
   32 GB tiers named an engine the server does not serve.
2. **Every download estimate was wrong**, before Dia was involved: typed
   **4.1 / 6.8 / 14.0 / 22.0 GB** versus **8.1 / 9.3 / 13.4 / 33.0** summed from
   the manifests' own pinned `size_bytes`. Same invented-number class the
   `vram_mb` purge killed on 2026-08-14; this one survived.

**Still open:** derive the recipe from the manifests so the numbers cannot be
wrong and an engine add/drop needs no renderer edit.

### 7.3 The OS gate was inert in every case — FIXED

`SUPPORTED_OSES` existed, `supports_current_os()` existed, and **no engine was
ever blocked**:

- The only call sat in `shared_venv.py:199`, behind
  `if m.isolation != "shared": continue` — so it could **never** reach Dia or
  MOSS-TTSD, the only two engines that declared a restriction.
- Everything it did evaluate declared all three OSes and passed.
- Three TTS engines (luxtts, qwen3, tada) plus whisper declared **nothing** and
  inherited the all-three default. **qwen3's inherited claim included macOS
  while its REQUIREMENTS said `cuda` only.**
- `manager.supported_oses`'s docstring promised *"Manager filters the catalog by
  sys.platform"*. **No such filter existed.**
- `engines_api` served `supported_oses` to a UI that never read it.

**Fixed** — see §8.

### 7.4 Three device-picking defects — found, reported, NOT fixed

1. **`tada/engine.py:68`** calls plain `pick_device()`, but `pick_device`'s own
   docstring names TADA in the `force_cpu_on_mac` set (*"Chatterbox, TADA — MPS
   has tensor issues with their models"*). Chatterbox has an override for
   exactly this; TADA never got one. Moot while TADA excludes macOS.
2. **`chatterbox/engine.py:64-70`** returns `"cpu"` on Darwin **before**
   delegating, so it overrides an **explicit** operator device request — base
   `pick_device` honours `requested != "auto"` first and never gets the chance.
3. **`tada/manifest.py`'s docstring** says *"Per-engine venv makes that a
   non-issue"* about its `torch>=2.7` pin colliding with chatterbox's 2.6.0 —
   but TADA declares no `ISOLATION`, so it defaults to **shared**, and
   `shared_venv.py:207-211` skips torch steps. **TADA gets 2.6.0.** This is the
   one that can produce a wrong runtime rather than a wrong claim.

---

## 8. What was BUILT on 2026-08-17

All gates green at each step, and again at the commit (`87077e7`): **ruff
clean · 663 pytest · biome 91 files ·
69 vitest · vite build · Playwright smoke 16/16, zero JS errors.**

### 8.1 The OS gate, made real

- **Every manifest declares `SUPPORTED_OSES` explicitly**, with its grounds
  recorded in a comment: luxtts (all three — every dep has wheels for all three,
  `mps` declared), qwen3 (**windows + linux** — resolves the CUDA-vs-macOS
  contradiction), tada (**windows + linux** — the `force_cpu_on_mac` fact),
  whisper (all three — transformers + torch only).
- **The gate moved to `install_engine()`** (`manager.py:663`), **above** the
  isolation split, so it covers `venv` engines too. Raises `InstallError`
  naming the host OS and the declared list.
- **`EngineInfo.supported_on_this_os`** — the verdict, computed **server-side**
  because the renderer may be a browser on a different machine.
- **`SpeechEnginesTab.vue`** — `osBlocked()` swaps the Install button for a
  badge (`not available on this OS · windows · linux`) with an explanatory
  title, and disables per-variant Download / Load. Engines are **listed, not
  hidden**, so a Mac user learns what exists and why it is not offered.
- **`server/tests/test_os_gate.py`** — 32 tests: explicit declaration required
  (no silent default), valid labels, verdict agreement, refusal for both
  isolation modes, refusal *before* any install work, the happy path, and the
  wire.
- The false docstring and the false `models.py` comment were replaced with what
  actually happens.

### 8.2 Dia excised

`engines/dia/` deleted; capability row + the `dia2` alias, model catalog,
QuickSetup tiers, slash-menu docs, tauri `longDescription`, and the engines /
gpu / quick-setup / generate / ai-providers / code-map / design-decisions docs
all swept. The closed Dia2 tracker item deleted per **close = delete**.
Receipted grep sweep clean; the only remaining mentions are deliberate history
inside other tracker items and dated plan docs, plus the kept external-provider
entry.

### 8.3 QuickSetup corrected

Dead `moss_tts` id fixed to `moss-tts`; all four tier estimates replaced with
sums computed from the manifests; the 16 GB tier re-pointed at LuxTTS since Dia
was what it used to add. `docs/quick-setup.md` updated to match.

### 8.4 Earlier the same day — the emotion wiring

(Recorded here because it is the same subsystem.) `style_prompt` excised
everywhere; `delivery.emotion` wired end-to-end as the one cross-engine
direction control — prose for Qwen, `[fear]`-style tokens for Chatterbox Turbo,
whose 19 tokens were declared at 4 — with a UI writer it never had. Variant
precision via `manager.current_variant_id()`. Cache-key parity between
`probe_line_cached` and `render_line` pinned by test.

---

## 9. What is next, and what each needs

| Item | State | Needs |
|---|---|---|
| **Mark + hide TADA and MOSS** | **go given** — *"mark them for removal and hide them if you want"* | a manifest deprecation flag → `EngineInfo` → UI treatment + exclusion from QuickSetup tiers |
| **Pocket TTS integration** | **go given** — *"ok oand the pcket tts swap"* | adapter · manifest · variant row (**read the real weight size first**) · capability row · install plumbing · measure on CPU · **then** retire LuxTTS |
| **MLX path for Qwen3** | recommended, **no go** | a third load path; `mlx-community` variant rows incl. VoiceDesign-4bit |
| **Qwen3 VoiceDesign (PyTorch)** | **no go** — redesign doc §9.1 | variant row + ~4.52 GB download + one adapter branch. Byte total needs one re-pull (file list sums 4,520,159,099; the HF API's own total differs by ~3 MB) |
| **`supports_multi_speaker` false badge** | **no go** | true regardless of MOSS's removal |
| **Derive QuickSetup from manifests** | **no go** | §7.2 |
| **Host-side `speed`** | **no go** | redesign doc §9.6 — the big one; makes "the persona survives a recast" substantially true |
| **The three device defects** | **no go** | §7.4; (3) is the dangerous one |
| **Chatterbox Nano** | unverified lead | check whether it exists as a checkpoint our pinned `chatterbox-tts==0.1.7` can load |

---

## 10. The one-line summary

**Four TTS engines, one CPU cloner, one STT engine. Kokoro for ready voices
anywhere, Chatterbox Turbo for expressive English cloning, Chatterbox
Multilingual for 23 languages, Qwen3 for prose direction and voice design,
Pocket TTS for cloning without a GPU, Whisper for transcription — and MLX is
how Qwen3 reaches a Mac.**
