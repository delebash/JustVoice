# LLM + TTS providers

JustVoice's AI page handles two kinds of provider, each on its own tab:

- **Local engines** — Kokoro / Chatterbox / Qwen3-TTS / Dia / LuxTTS / MossTTS / TADA. Managed by JustVoice, installed into per-engine Python venvs, loaded one-at-a-time per kind (TTS / LLM / embedding). See `engines.md` for the catalog.
- **Online + self-hosted providers** — Anthropic Claude / OpenAI / Gemini / Ollama / DeepSeek / OpenRouter for LLM; ElevenLabs / Speechify / Speechmatics / OpenAI TTS / OpenAI-compatible servers for TTS. These talk HTTP, don't install anything locally, and need an API key + base URL.

Language models live on the **LLM providers** tab; everything speech lives on
the **Speech engines** tab, which splits into **Local · free** (engines
JustVoice installs, plus self-hosted servers you run) and **Online · metered**
(cloud speech APIs). This doc covers the **online + self-hosted speech
provider** flow.

## When to add a provider

| You want… | Add this | Why |
|---|---|---|
| Speaker attribution on a fresh book | An LLM provider (Claude / OpenAI / Gemini / Ollama) | Speaker attribution + Compose + Rewrite + Smart-assign all route through LLM dispatch. No provider = these features error with HTTP 501 |
| Voice cloning without a GPU | ElevenLabs or Speechify (TTS provider) | Studio-quality cloning, charged per character. Useful for podcast hosts who don't have a GPU |
| Your own TTS server | OpenAI-compatible (TTS provider) | Point a base URL at your Kokoro-FastAPI / Chatterbox-TTS-Server / Qwen3-TTS server |
| Low-cost cloud LLM | DeepSeek or OpenRouter (LLM provider) | Cheaper per-token than Claude / OpenAI for speaker attribution at audiobook scale |
| Local LLM, no API costs | Ollama (LLM provider) | Run llama3.2 / qwen3 / mistral locally. Routes everything through your machine |

## Adding a speech provider

1. **Open the AI page → Speech engines tab**, then pick the half that matches
   where it runs: **Online · metered** for a cloud API, or **Local · free** →
   the *Self-hosted servers* section for a server you run yourself.
   (Language models: the LLM providers tab has its own form — connect
   Claude / OpenAI / Ollama and the rest there.)
2. Click **+ Add provider** (Online) or **+ Add self-hosted server** (Local).
   An inline editor expands.
3. Fill in the form:
   - **Name** — what shows in dropdowns and the Studio Cast voice library.
   - **Base URL** — the API root. Examples:
     - ElevenLabs: `https://api.elevenlabs.io`
     - OpenAI TTS: `https://api.openai.com/v1`
     - Self-hosted Kokoro: `http://localhost:8880`
   - **API key** — paste from your provider's console. JustVoice stores it
     locally; never sent anywhere except to that provider's base URL. Editing
     an existing provider? Leave blank to preserve the saved key.
   - **TTS model** — the model id the server expects (e.g.
     `eleven_flash_v2_5`).
   - **Voices** — the voice ids you want JustVoice to use; only those appear
     in the Studio Cast voice library. **⟳ Fetch voices** asks the server for
     its list so you can pick instead of type.
4. **Test connection** checks the URL + key round-trip before you commit.
5. Click **Save provider**.

## Which attribution route runs (LLM)

There's nothing to configure on a provider. Speaker attribution has three
routes — **Guided** (the system prompt's rules plus worked examples, for
small models), **Direct** (the same system prompt without the examples, for
big models), **Reasoned** (Direct's rules with thinking on, for reasoning
models) — and the **Auto** row above them (AI Settings → Routing by feature)
picks which one runs: Reasoned when the model can think (the catalog's
Thinking flag), Direct at and above the editable size line, Guided
otherwise. Production always runs Auto's pick; a route card's Lab run or an
API call forces its own route per run. Thinking rides each route's preset —
models that can't think are never asked to.

## Editing or removing

- **Edit** — click Edit on the row. The form expands in place.
- **Remove provider** — inside the Edit form. Confirms before removing.
  Casting that pointed at this provider's voices falls back at render time.

## Self-hosted TTS — Kokoro / Chatterbox / Dia / Qwen3-TTS

If you're running a self-hosted TTS server (community-published OpenAI-compatible projects exist for each), add it under **Speech engines → Local · free → Self-hosted servers** with its base URL — no key needed for local servers. The setup-hint band in the form links to each known project's canonical GitHub. JustVoice speaks the standard `POST /v1/audio/speech` shape; non-standard fields (Chatterbox's `exaggeration` / `cfg_weight`, Dia's multi-speaker tags) ride through `params` JSON.

## What about feature routing?

After registering one or more LLM providers, open **AI Settings → Routing by feature** to point specific features (Compose / Persona rewrite / Speaker attribution / Smart-assign / Render preset suggest / the rest) at specific provider+model presets. See `ai-features.md` for the routing model.

## Troubleshooting

- **Fetch voices hangs or errors** — the provider's server is unreachable.
  Test connection first; check the base URL + API key.
- **A provider's voices don't show in Studio Cast** — only the voices picked
  on the provider row appear; Edit the row and add them.
- **Compose / Rewrite return HTTP 501** — no language model is set up yet.
  Connect one on the LLM providers tab (or run the LLM engine setup).
