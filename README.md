<div align="center">

# 🎙️ JustVoice

**A cross-platform open-source voice production studio for audiobook producers, game developers, podcasters, dictation users, and accessibility users. Built on Tauri 2 + Vue 3 + Python FastAPI.**

JustWrite-compatible imports are one of several supported workflows — see `docs/import-formats.md`.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Python](https://img.shields.io/badge/server-Python_3.10+-3776AB?logo=python&logoColor=white)](./server)
[![Vue 3](https://img.shields.io/badge/UI-Vue_3-4FC08D?logo=vue.js&logoColor=white)](./src/renderer)
[![Tauri](https://img.shields.io/badge/shell-Tauri_2-FFC131?logo=tauri&logoColor=black)](./src-tauri)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-85EA2D?logo=swagger&logoColor=black)](http://127.0.0.1:17494/docs)

Real GPU acceleration on **NVIDIA** (CUDA), **AMD** (ROCm / DirectML), **Apple Silicon** (Metal / MLX), **Intel** (DirectML / OpenVINO), with CPU fallback that always works. Bundled engine roster of 8 (Kokoro, Qwen3-TTS, Chatterbox with three variants, LuxTTS, TADA, Dia, MOSS-TTS, Higgs Audio v3) plus a documented engine-adapter protocol so any TTS model can be added — JustTTS-built or third-party.

**Five audiences share one engine pool, voice catalogue, lexicon, and persona layer — differentiation lives in import/export pipelines and per-use-case UI surfaces.**

</div>

---

## ✨ Features

### Audiobook production (the value-add)

- **`/v1/render_chapter`** — multi-line script in, mastered chapter out
- **ACX mastering preset** — `master: "acx"` produces ACX-spec MP3 (−19 LUFS / −3 dBFS peak / 44.1 kHz mono / 192 kbps CBR) ready for Audible submission
- **INaudio / Podcast / YouTube presets** — broadcast-standard targets per platform
- **Re-render cache** — edit one word in chapter 14 line 387 → only that line re-renders
- **Personas** — saved `(voice + name + default delivery)` for the cast layer
- **Per-line delivery overlay** — same voice can be calm in chapter 1, terrified in chapter 12

### Voices

- **54 Kokoro preset voices** — 8 languages
- **Voice cloning** — 3-30s reference → cloned voice (Qwen3 + Chatterbox + Higgs + TADA + Dia)
- **Voice design from prose** — describe the voice in natural language (Qwen3-native)
- **Voice import** — bring-your-own clip as a voice
- **Pronunciation lexicons** — W3C PLS-style; character names pronounce consistently every render
- **Voice fine-tuning** (`POST /v1/train`) — restart-survivable LoRA training jobs
- **Voice blending** (`POST /v1/voices/blend`) — speaker-embedding interpolation (SLERP / LERP / weighted-sum)

### Engine management

- **Engine catalog** with status (`not_installed` / `installing` / `installed` / `loaded`)
- **Hardware detection** — CPU / RAM / GPUs / acceleration runtimes
- **VRAM-aware model recommendation**
- **External OpenAI-compatible TTS servers** — register kokoro-fastapi, openai-edge-tts, OpenAI itself as engines via `POST /v1/audio/speech`
- **Engine hot-swap** — load swaps unload the previous engine
- **Plugin protocol** — third-party engines via Python entry_points (no fork required)

### Delivery controls

- **Speed** — 0.25× to 4.0×
- **Pitch** — −12 to +12 semitones
- **Gain** — −24 to +12 dB per-line
- **Pause before / after** — millisecond silence padding
- **9 emotion presets** — neutral / happy / sad / angry / fearful / whispered / shouted / sarcastic / contemptuous
- **Inline expression tags** — `[laugh]`, `[breath]`, `[pause:0.5s]`, `[whisper]…[/whisper]`, `[speed:0.7]…[/speed]`
- **Instruct prose** — Qwen3-native delivery instruction ("with growing horror, slowly losing composure")

### Compare + analyze

- **`POST /v1/compare`** — two WAVs in, side-by-side report out (format match, peak/RMS diff, sample-level RMSE, verdict)
- **`POST /v1/analyze`** — single-WAV format + loudness analysis

### API + GUI

- **Vue 3 SPA** at `/ui/` — Mercury banking aesthetic
- **OpenAPI 3.1** auto-generation from FastAPI handlers
- **Swagger UI** at `/docs`, **Redoc** at `/redoc`
- **Bearer-token auth** + loopback-bypass policy + CORS origins allowlist
- **Live task strip** — inline progress for renders / chapter renders / installs

## 🏛 Architecture

Three layers, one app:

```
┌──────────────────────────────────────────────────────────┐
│  src-tauri/  — Tauri 2 desktop shell                     │
│  Webview wrapper. Spawns the Python server as a sidecar  │
│  and shuts it down on exit. Same role as JustWrite's     │
│  Tauri shell.                                            │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼ webview
┌──────────────────────────────────────────────────────────┐
│  src/renderer/  — Vue 3 + Vite                           │
│  Single-page app. Pinia stores, components, views.       │
│  Talks HTTP to the Python server on localhost:17494.     │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼ http://127.0.0.1:17494
┌──────────────────────────────────────────────────────────┐
│  server/justtts/  — Python 3.10+ FastAPI                 │
│  Engines, storage, render pipeline, mastering, cache,    │
│  API. PyTorch-based engines run in-process.              │
└──────────────────────────────────────────────────────────┘
```

The Python server runs standalone — you can also deploy it headless on a remote host and point the desktop shell at it via the **Server URL** field in the colophon.

## 🚀 Getting started

### Headless (Python server only)

```bash
cd server
python -m venv .venv
.venv/Scripts/activate     # or `source .venv/bin/activate` on macOS/Linux
pip install -e .[kokoro]    # add [chatterbox], [qwen3], [all-engines] as needed
justtts serve
```

Open `http://127.0.0.1:17494/ui/` in your browser. The Vue SPA is served from the FastAPI process, so no Tauri / desktop build is needed for the headless flow.

### Desktop app (Tauri + Vue + Python)

```bash
npm install              # node deps
cd server && pip install -e . && cd ..
npm run tauri dev         # boots Vite + Tauri + spawns the Python sidecar
```

Production build:

```bash
npm run tauri build
```

Produces a per-platform installer at `src-tauri/target/release/bundle/`. The Python server is bundled as a sidecar process.

## 🎛 Engine roster

| Engine | License | VRAM | Notes |
|---|---|---|---|
| **Kokoro** | Apache 2.0 | 1-2 GB | 54 voices, 8 languages, `sherpa-onnx` backend |
| **Qwen3-TTS** | Apache 2.0 | 3-8 GB | 0.6B + 1.7B variants. Voice cloning + design + instruct + paralinguistic tags |
| **Chatterbox** | MIT | 5-8 GB | Three variants under one engine: Original (500M EN), Turbo (350M EN, native paralinguistic tags), Multilingual (500M, 23 languages) |
| **LuxTTS** | Apache 2.0 | 2-3 GB | Multilingual, lighter footprint |
| **TADA** | Hume terms | 6-16 GB | 1B + 3B variants. Voice cloning + multilingual presets |
| **Dia** | Apache 2.0 | 6-12 GB | 1.6B + 2-2B variants. Multi-speaker single-pass dialogue |
| **MOSS-TTS** | Apache 2.0 | 12-16 GB | 1-hour stable single-pass generation |
| **Higgs Audio v3** | **Non-commercial** | 8-12 GB | Best inline mid-utterance control |
| **External OpenAI-compatible TTS** | — | — | Configure any server speaking `POST /v1/audio/speech` |

## 🤝 Adding a TTS engine

```python
# server/justtts/engines/myengine.py
from justtts.engines.base import EngineMeta, TTSBackend

class MyEngineBackend:
    meta = EngineMeta(
        engine_id="myengine",
        display_name="My Engine",
        backend="python",
        supported_runtimes=["cuda", "metal", "cpu"],
        supports_cloning=True,
        supports_streaming=False,
        supports_paralinguistic_tags=True,
    )
    def load(self, device, model_variant=None): ...
    def unload(self): ...
    def ready(self): ...
    def voices(self): ...
    def synthesize(self, req): ...
```

Add one catalog entry to `server/justtts/engines/catalog.py`, done. Or publish your adapter as a pip package with a `justtts.engines` entry_point — JustTTS discovers it automatically, no fork needed.

## 🛠 Configuration

Single source of truth: `settings.json` at the platform data dir. Every field mutable via `PATCH /v1/settings`.

## ⚖️ License

Apache 2.0. See [LICENSE](./LICENSE).

## 🤖 Written entirely by Claude Code

Every line of code in this repository was authored by [Claude Code](https://www.claude.com/product/claude-code) under human direction. Same model as the sister project [JustWrite](https://github.com/delebash/justwrite). The maintainer reviews, directs architecture, runs the user studies, and ships releases; Claude writes the code, the tests, and the docs.
