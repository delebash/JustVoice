# Engines

JustVoice ships with up to 10 TTS engines. Each engine runs in its own Python venv (per-engine isolation) so installing Chatterbox doesn't break Kokoro's dependency tree.

## The catalog

| Engine | Type | Size | Languages | Speed | Voice cloning |
|---|---|---|---|---|---|
| **Kokoro** | preset (54 voices) | 82 MB | 8 | CPU-realtime | — |
| **Chatterbox Turbo** | clone + paralinguistic | 350 MB | en | GPU 1-2× realtime | ✓ |
| **Chatterbox Multilingual** | clone | 1.2 GB | 23 | GPU 1-2× realtime | ✓ |
| **Qwen3-TTS** | clone + designed | 1.7 GB | 10 | GPU 0.5-1× realtime | ✓ |
| **LuxTTS (ZipVoice)** | clone · 48 kHz | 1.0 GB | en | GPU 1× realtime | ✓ |
| **Hume TADA** | clone · long-form coherent | 3.2 GB | 10 | GPU 0.5× realtime | ✓ |
| **Dia (Nari Labs)** | multi-speaker dialogue | 3.0 GB | en | GPU 0.5× realtime | — |
| **MossTTS** | clone | — | en + zh | GPU | ✓ (experimental) |
| **Higgs Audio v3** | clone | — | 11 | GPU | ✓ (experimental) |
| **External** (OpenAI-compatible) | HTTP | 0 MB | — | Network | varies |

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

## GPU detection + tier-aware default

The Engines tab's GPU diagnostics panel shows your backend (CUDA / MPS / Metal / XPU / DirectML / ROCm), device name, VRAM total / used, compute capability, and HSA override status. JustVoice uses this to suggest defaults:

- CPU only → Kokoro recommended; clone engines disabled with a warning.
- 8-12 GB VRAM → Chatterbox Turbo or Qwen3 (small).
- 24+ GB → any engine, including Hume TADA + Dia.

## CUDA wheel download

Switching CUDA versions is a 4-phase flow: idle → stopping engines → waiting for download → ready. Initiate from Engines → GPU → "Re-download / switch CUDA version" or Settings → GPU. Roughly 2 GB per torch wheel.

## Per-engine venv isolation

Each engine lives at `server/justtts/engines/<engine_id>/.venv/`. Installing Chatterbox writes to its own venv; Kokoro's venv is untouched. This is JustVoice's main reliability advantage over flat-environment TTS tools — engine-A's broken dependency upgrade can't take down engine-B's renders.

## External (OpenAI-compatible) providers

ElevenLabs, OpenAI TTS, local Piper, anything that speaks OpenAI's TTS HTTP protocol. Configure in Settings → External TTS engines. Probe button checks reachability + lists available voices.
