# Engines

JustVoice ships with 7 commercial-output-permitting TTS engines plus an external OpenAI-compatible bridge. Each engine runs in its own Python venv or against a shared one (see Isolation below) so installing Chatterbox doesn't break Kokoro's dependency tree.

> **Why no Higgs?** Higgs Audio v3 was removed 2026-06-09 — its model weights are released under a non-commercial license, which conflicts with JustVoice's audiobook / game / podcast use cases where users sell their generated output. Every remaining bundled engine's weights permit commercial output (verified against each engine's HuggingFace model card).
>
> **TADA attribution.** TADA's wrapper code is Apache-2.0 but its weights are released under the Llama 3.2 Community License (it's built on Llama 3.2). The license requires any product or service built on Llama-derivative models to display **"Built with Llama"** in the UI AND include the same notice in documentation. JustVoice surfaces it on the TADA Engines card under the description (driven by the engine manifest's `WEIGHTS_LICENSE` + `ATTRIBUTION` fields). If you publish work produced with TADA (audiobook, podcast, game), reproduce **"Built with Llama"** in your credits. See `NOTICE.md` for the authoritative copy.

## The catalog

| Engine | Type | Size | Languages | Voice cloning | Weight license |
|---|---|---|---|---|---|
| **Kokoro** | preset (54 voices) · fast on CPU | 82 MB | 8 | — | Apache-2.0 |
| **Chatterbox Turbo** | clone + paralinguistic | 350 MB | en | ✓ | MIT |
| **Chatterbox Multilingual** | clone | 1.2 GB | 23 | ✓ | MIT |
| **Qwen3-TTS** | clone + designed | 1.7 GB | 10 | ✓ | Apache-2.0 |
| **LuxTTS (ZipVoice)** | clone · 48 kHz | 1.0 GB | en | ✓ | Apache-2.0 |
| **Hume TADA** | clone · long-form coherent | 3.2 GB | 10 | ✓ | Llama 3.2 Community (+ MIT codec) |
| **Dia (Nari Labs)** | multi-speaker dialogue | 3.0 GB | en | — | Apache-2.0 |
| **MossTTS** | clone | — | en + zh | ✓ (experimental) | Apache-2.0 |
| **External** (OpenAI-compatible) | HTTP | 0 MB | — | varies | depends on provider |

(The old per-engine "Speed" column was cut 2026-08-14: its realtime factors
were never measured. The honest generalisation: Kokoro is the one engine
that is genuinely fast on CPU; the PyTorch cloning engines want a GPU.)

## Picking an engine for a use case

- **Audiobook narration in your own voice.** Chatterbox Turbo. Clone from 1-2 minutes of clean read-aloud.
- **Audiobook with 5+ characters.** Chatterbox Turbo for main voices + Kokoro for incidental characters (faster to render, plenty of voices).
- **Multilingual audiobook.** Chatterbox Multilingual (23 langs) or Qwen3 (10 langs, best on Asian languages).
- **Game NPC dialogue at 50-500 line scale.** Kokoro (fast on CPU, 54 voices). Render speed matters at scale.
- **Multi-speaker game cutscenes.** Dia. Single render produces multiple voices.
- **Podcast voiceover.** Chatterbox Turbo if you want it to sound like you; Kokoro if you want preset variety fast.
- **Dictation playback** (MCP `speak` tool). Kokoro. Lowest latency.

## Loading / unloading

One engine is **loaded** per slot (one TTS, one STT). Loading takes 10-30s (model load + warmup). The **speech engines** tab on the ai page shows the current state per engine:

- `not installed` — first download required.
- `installed` — present on disk, not currently loaded.
- `loaded` — resident and ready to render. The card also shows **which device** it loaded on (`· CUDA` / `· CPU`).

Click Load on any installed engine; the same slot's prior occupant auto-unloads.

Loads run against the **shared memory budget** (the strip at the top of the tab — measured used/free, one cell per loaded engine with its real memory take, the AI model, other apps). For an engine JustVoice has measured before on this machine: if the pool is short, it frees the least-recently-used *idle* model and toasts what it unloaded; if everything resident is busy, the load refuses with an honest message quoting the measured numbers instead of an out-of-memory crash. An engine's first-ever load carries no number yet ("not measured yet" on the strip) — it simply attempts, gets measured, and is remembered. Each card also carries a **Device** select (Auto / CUDA / CPU) — Auto sends CPU-fast engines (Kokoro) to CPU and the rest to your GPU, and an explicit choice always wins. The full story is in [GPU / CUDA](gpu.md#the-shared-memory-budget).

### Cancelling an in-flight load

Loading can take a while — first-time loads also fetch model weights (hundreds of MB to multiple GB) and may stall if you have a flaky connection. While a load is in progress:

- A progress strip appears at the top of the content area with elapsed time + `spawning subprocess`, `loading model weights`.
- The strip has a **Cancel** button. Clicking it sends `POST /v1/engines/{id}/cancel-load`, which:
  - Sets a cancel flag the manager polls between safe steps (shared-venv setup → model download → subprocess spawn → child `/load` call).
  - Kills the child subprocess if already spawned, so no VRAM is left allocated.
  - Aborts the client-side fetch so you stop waiting.
- The strip flips to `cancelled` and stays visible for 3 seconds, with a **↻ Retry** button to re-run the same load (or click ✕ to dismiss).
- If a load fails for any reason, the strip stays in `failed` state with the error message until manually dismissed, plus the same **↻ Retry** button.

The same Cancel + Retry pattern applies to every long-running operation in the app per the standing rule: render, install, train, compose, import — all gain those affordances.

## GPU detection + tier-aware default

Settings → GPU shows your backend (CUDA / MPS / Metal / XPU / DirectML / ROCm), device name, VRAM total / used, compute capability, and HSA override status. On CPU-only boxes Kokoro is the recommended engine (it's built for CPU); for GPU boxes there is no hand-typed VRAM-to-engine pairing table any more — an engine's real footprint is **measured on your machine at its first load** and shown on the budget strip, which is the honest way to see what fits (the old GB-tier suggestions were never measured; cut 2026-08-14).

## CUDA wheel download

Switching CUDA versions is a 4-phase flow: idle → stopping engines → waiting for download → ready. Initiate from Settings → GPU → "Re-download / switch CUDA version". Roughly 2 GB per torch wheel.

## Per-engine venv isolation

Each engine lives at `server/justvoice/engines/<engine_id>/.venv/`. Installing Chatterbox writes to its own venv; Kokoro's venv is untouched. This is JustVoice's main reliability advantage over flat-environment TTS tools — engine-A's broken dependency upgrade can't take down engine-B's renders.

## Online + self-hosted providers (LLM + TTS)

Local engines (above) are managed by JustVoice — installed into per-engine venvs, loaded one-at-a-time. Online + self-hosted providers are a separate flow:

- **LLM providers** — Anthropic Claude, OpenAI, Gemini, Ollama, DeepSeek, OpenRouter. Needed for Compose, Persona rewrite, Speaker attribution, Smart-assign, Render preset suggest.
- **TTS providers** — ElevenLabs, Speechify, Speechmatics, OpenAI TTS, OpenAI-compatible self-hosted servers (Kokoro-FastAPI, Chatterbox-TTS-Server, Dia-TTS-Server, Qwen3-TTS).

Language-model providers register on the AI page's **LLM providers** tab.
Speech providers register on the **Speech engines** tab: cloud APIs under
**Online · metered** → **+ Add provider**; servers you run yourself under
**Local · free** → **Self-hosted servers** → **+ Add self-hosted server**.
The inline form handles API key, base URL, the TTS model, voice multi-select
(with Fetch voices), and Test verification. See [ai-providers.md](ai-providers.md)
for the full flow.

After registering one or more LLM providers, open **AI Settings → Routing by
feature** to point specific features (Compose, Speaker attribution, etc.) at
specific provider + model choices — see [ai-features.md](ai-features.md).
