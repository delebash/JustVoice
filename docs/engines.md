# Engines

JustVoice ships with 7 commercial-output-permitting TTS engines plus an external OpenAI-compatible bridge. Each engine runs in its own Python venv or against a shared one (see Isolation below) so installing Chatterbox doesn't break Kokoro's dependency tree.

> **Why no Higgs?** Higgs Audio v3 was removed 2026-06-09 — its model weights are released under a non-commercial license, which conflicts with JustVoice's audiobook / game / podcast use cases where users sell their generated output. Every remaining bundled engine's weights permit commercial output (verified against each engine's HuggingFace model card).
>
> **TADA attribution.** TADA's wrapper code is Apache-2.0 but its weights are released under the Llama 3.2 Community License (it's built on Llama 3.2). The license requires any product or service built on Llama-derivative models to display **"Built with Llama"** in the UI AND include the same notice in documentation. JustVoice surfaces it on the TADA Engines card under the description (driven by the engine manifest's `WEIGHTS_LICENSE` + `ATTRIBUTION` fields). If you publish work produced with TADA (audiobook, podcast, game), reproduce **"Built with Llama"** in your credits. See `NOTICE.md` for the authoritative copy.

## The catalog

| Engine | Type | Size | Languages | Speed | Voice cloning | Weight license |
|---|---|---|---|---|---|---|
| **Kokoro** | preset (54 voices) | 82 MB | 8 | CPU-realtime | — | Apache-2.0 |
| **Chatterbox Turbo** | clone + paralinguistic | 350 MB | en | GPU 1-2× realtime | ✓ | MIT |
| **Chatterbox Multilingual** | clone | 1.2 GB | 23 | GPU 1-2× realtime | ✓ | MIT |
| **Qwen3-TTS** | clone + designed | 1.7 GB | 10 | GPU 0.5-1× realtime | ✓ | Apache-2.0 |
| **LuxTTS (ZipVoice)** | clone · 48 kHz | 1.0 GB | en | GPU 1× realtime | ✓ | Apache-2.0 |
| **Hume TADA** | clone · long-form coherent | 3.2 GB | 10 | GPU 0.5× realtime | ✓ | Llama 3.2 Community (+ MIT codec) |
| **Dia (Nari Labs)** | multi-speaker dialogue | 3.0 GB | en | GPU 0.5× realtime | — | Apache-2.0 |
| **MossTTS** | clone | — | en + zh | GPU | ✓ (experimental) | Apache-2.0 |
| **External** (OpenAI-compatible) | HTTP | 0 MB | — | Network | varies | depends on provider |

## Picking an engine for a use case

- **Audiobook narration in your own voice.** Chatterbox Turbo. Clone from 1-2 minutes of clean read-aloud.
- **Audiobook with 5+ characters.** Chatterbox Turbo for main voices + Kokoro for incidental characters (faster to render, plenty of voices).
- **Multilingual audiobook.** Chatterbox Multilingual (23 langs) or Qwen3 (10 langs, best on Asian languages).
- **Game NPC dialogue at 50-500 line scale.** Kokoro (CPU realtime, 54 voices). Render speed matters at scale.
- **Multi-speaker game cutscenes.** Dia. Single render produces multiple voices.
- **Podcast voiceover.** Chatterbox Turbo if you want it to sound like you; Kokoro if you want preset variety fast.
- **Dictation playback** (MCP `speak` tool). Kokoro. Lowest latency.

## Loading / unloading

Only one engine is **loaded** at a time per GPU. Loading takes 10-30s (model load + warmup). The Engines tab shows the current state per engine:

- `not installed` — first download required.
- `installed` — present on disk, not currently in VRAM.
- `loaded` — in VRAM, ready to render.
- `loaded · CPU realtime` — Kokoro running on CPU.

Click Load on any installed engine; the currently loaded one auto-unloads.

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

The Engines tab's GPU diagnostics panel shows your backend (CUDA / MPS / Metal / XPU / DirectML / ROCm), device name, VRAM total / used, compute capability, and HSA override status. JustVoice uses this to suggest defaults:

- CPU only → Kokoro recommended; clone engines disabled with a warning.
- 8-12 GB VRAM → Chatterbox Turbo or Qwen3 (small).
- 24+ GB → any engine, including Hume TADA + Dia.

## CUDA wheel download

Switching CUDA versions is a 4-phase flow: idle → stopping engines → waiting for download → ready. Initiate from Engines → GPU → "Re-download / switch CUDA version" or Settings → GPU. Roughly 2 GB per torch wheel.

## Per-engine venv isolation

Each engine lives at `server/justvoice/engines/<engine_id>/.venv/`. Installing Chatterbox writes to its own venv; Kokoro's venv is untouched. This is JustVoice's main reliability advantage over flat-environment TTS tools — engine-A's broken dependency upgrade can't take down engine-B's renders.

## Online + self-hosted providers (LLM + TTS)

Local engines (above) are managed by JustVoice — installed into per-engine venvs, loaded one-at-a-time. Online + self-hosted providers are a separate flow:

- **LLM providers** — Anthropic Claude, OpenAI, Gemini, Ollama, DeepSeek, OpenRouter. Needed for Compose, Persona rewrite, Speaker attribution, Smart-assign, Render preset suggest.
- **TTS providers** — ElevenLabs, Speechify, Speechmatics, OpenAI TTS, OpenAI-compatible self-hosted servers (Kokoro-FastAPI, Chatterbox-TTS-Server, Dia-TTS-Server, Qwen3-TTS).

Both register through Engines → LLM tab or TTS tab → **+ Add provider**, with an inline form that handles API key, base URL, model picking (with Fetch button), tier picker (LLM), voice multi-select (TTS), and Ping verification. See [providers.md](providers.md) for the full flow.

The Engines tab also tracks **how many** registered providers exist per kind. Tab labels read "TTS (N local · M online)" so you can see at a glance whether you have credentials configured.

After registering one or more LLM providers, configure feature routing in [ai-features.md](ai-features.md) — pin specific features (Compose, Speaker attribution, etc.) to specific provider+model+tier combinations.
