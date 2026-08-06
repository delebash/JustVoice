# LLM + TTS providers

JustVoice's Engines tab handles two kinds of provider:

- **Local engines** — Kokoro / Chatterbox / Qwen3-TTS / Dia / LuxTTS / MossTTS / TADA. Managed by JustVoice, installed into per-engine Python venvs, loaded one-at-a-time per kind (TTS / LLM / embedding). See `engines.md` for the catalog.
- **Online + self-hosted providers** — Anthropic Claude / OpenAI / Gemini / Ollama / DeepSeek / OpenRouter for LLM; ElevenLabs / Speechify / Speechmatics / OpenAI TTS / OpenAI-compatible servers for TTS. These talk HTTP, don't install anything locally, and need an API key + base URL.

The Engines tab is split into both sections per kind. This doc covers the **online + self-hosted provider** flow.

## When to add a provider

| You want… | Add this | Why |
|---|---|---|
| Speaker attribution on a fresh book | An LLM provider (Claude / OpenAI / Gemini / Ollama) | Speaker attribution + Compose + Rewrite + Smart-assign all route through LLM dispatch. No provider = these features error with HTTP 501 |
| Voice cloning without a GPU | ElevenLabs or Speechify (TTS provider) | Studio-quality cloning, charged per character. Useful for podcast hosts who don't have a GPU |
| Your own TTS server | OpenAI-compatible (TTS provider) | Point a base URL at your Kokoro-FastAPI / Chatterbox-TTS-Server / Qwen3-TTS server |
| Low-cost cloud LLM | DeepSeek or OpenRouter (LLM provider) | Cheaper per-token than Claude / OpenAI for speaker attribution at audiobook scale |
| Local LLM, no API costs | Ollama (LLM provider) | Run llama3.2 / qwen3 / mistral locally. Routes everything through your machine |

## Adding a provider

1. **Open Engines → LLM tab** (or TTS tab).
2. Click **+ Add LLM provider** (or **+ Add TTS provider**). An inline editor expands at the top of the registered-provider list.
3. Fill in the form:
   - **ID** — a stable identifier the routing refers to (e.g. `my-claude`). Cannot change after the first save (would orphan routing that points at it).
   - **Display name** — what shows in dropdowns. Edit later if you want.
   - **Kind** — `llm`, `tts`, or `both`. Most providers are one or the other.
   - **Base URL** — the API root. Examples:
     - Anthropic: `https://api.anthropic.com`
     - OpenAI: `https://api.openai.com/v1`
     - DeepSeek: `https://api.deepseek.com/v1`
     - Ollama: `http://localhost:11434`
     - Self-hosted Kokoro: `http://localhost:8880`
   - **API key** — paste from your provider's console. JustVoice stores it locally; never sent anywhere except to that provider's base URL. Editing existing? Leave blank to preserve the saved key.
   - **API format** (LLM only) — `Anthropic` / `OpenAI` / `OpenAI-compatible` / `Gemini` / `Ollama` / `DeepSeek` / `OpenRouter`. Drives which wire format JustVoice speaks. The Install / setup hint band shows you where to get credentials for each.
4. Click **Save**. JustVoice registers the provider, and the row appears in the list with a 🔑 indicator (API key on file) and a `live` pill if the adapter constructed cleanly.

## Picking a model

After saving, click the row's **Edit** button to expand the form again. The chat-model and TTS-model fields each have a typing combobox + a **Fetch models** button.

- **Fetch models** — for live LLM providers, calls the provider's `/v1/models`-equivalent endpoint and lists everything available. Click an entry to pick it, or type to filter.
- **Fetch voices** (TTS) — calls the server's voices endpoint and shows them in a multi-select with checkmarks. Pick the ones you want JustVoice to use; only those appear in the Studio Cast voice library.

If Fetch fails (network error, bad credentials), the error appears under the field and the saved key gets preserved.

## Tier picker

The chat-model row shows a 3-button tier picker (**Guided** / **Direct** / **Reasoned**) with an auto-detected suggestion:

- **Guided** — small or quantized models (Qwen 3B, Llama 3.2 1B). JustVoice sends hand-held step-by-step prompts.
- **Direct** — mid-range (Haiku 4.5, GPT-4o-mini, Qwen 14B). Standard one-shot prompts.
- **Reasoned** — reasoning models (Claude 3.7 thinking, o1 / o3, qwen3:32b). JustVoice allows chain-of-thought; longer but higher accuracy for speaker attribution and structural analysis.

JustVoice classifies the picked model automatically via heuristic on the model id (the Speaker Lab can override the tier per run when the auto-classification gets it wrong — rare).

## Ping / verify the provider works

Every provider row has a **Ping** button. It does an unauthenticated round-trip:

- For LLM providers: hits the adapter's reachability check. Returns a green "Reachable" strip or a red error.
- For TTS providers: probes `/v1/models` + `/v1/audio/voices` to confirm the URL and credentials work, and reports back which models + voices the server exposes.

Use Ping before relying on a provider — catches a typo'd base URL or expired API key before you try to render a chapter.

## Editing or removing

- **Edit** — click Edit on the row. The form expands in place. Fields readonly when not editable (e.g. `id`).
- **Delete** — inside the Edit form, bottom-left. Confirms before removing. Routing that pointed at this provider falls back at dispatch time.

## Self-hosted TTS — Kokoro / Chatterbox / Dia / Qwen3-TTS

If you're running a self-hosted TTS server (community-published OpenAI-compatible projects exist for each), register it as a TTS provider with `kind=tts` and `provider_type=openai-compat`. The install-hint band in the form links to each project's canonical GitHub. JustVoice handles the standard `POST /v1/audio/speech` shape; non-standard fields (Chatterbox's `exaggeration` / `cfg_weight`, Dia's multi-speaker tags) ride through `params` JSON.

## What about feature routing?

After registering one or more LLM providers, open **AI Settings → Routing by feature** to point specific features (Compose / Persona rewrite / Speaker attribution / Smart-assign / Render preset suggest / the rest) at specific provider+model presets. See `ai-features.md` for the routing model.

## Troubleshooting

- **Save failed: 400 "provider id X already exists"** — IDs must be unique. Use the Edit button on the existing row instead of registering a new one.
- **Fetch models hangs** — the provider's server is unreachable. Ping first; check the base URL + API key.
- **"unregistered" pill on an LLM row** — the adapter persisted to settings but couldn't construct (most often a missing or invalid API key field). Open the row, fix the field, Save again.
- **Compose / Rewrite return HTTP 501** — no LLM provider is registered yet. Add one before using features that need an LLM.
