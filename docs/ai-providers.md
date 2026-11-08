# LLM + TTS providers

JustVoice's AI page handles two kinds of provider, each on its own tab:

- **Local engines** — Kokoro / Chatterbox Multilingual / Qwen3-TTS, plus Speech recognition. Managed by JustVoice: every one runs in the one speech runtime JustVoice installs, with one model loaded per kind (speech, speech recognition). See `engines.md` for the catalog.
- **Online + self-hosted providers** — Anthropic Claude / OpenAI / Gemini / Ollama / DeepSeek / OpenRouter for LLM; ElevenLabs / Speechify / Speechmatics / OpenAI TTS / OpenAI-compatible servers for TTS. These talk HTTP, don't install anything locally, and need an API key + base URL.

Language models live on the **LLM providers** tab; everything speech lives on
the **Speech** tab: the speech runtime and the models JustVoice installs, and,
under them, **Self-hosted servers** (speech servers you run) and **Online ·
metered** (cloud speech APIs). This doc covers the **online + self-hosted
speech provider** flow.

## When to add a provider

| You want… | Add this | Why |
|---|---|---|
| Speaker attribution on a fresh book | An LLM provider (Claude / OpenAI / Gemini / Ollama) | Speaker attribution + Compose + Rewrite + Smart-assign all route through LLM dispatch. No provider = these features error with HTTP 501 |
| Voice cloning without a GPU | ElevenLabs or Speechify (TTS provider) | Studio-quality cloning, charged per character. Useful for podcasters who don't have a GPU |
| Your own TTS server | OpenAI-compatible (TTS provider) | Point a base URL at your Kokoro-FastAPI / Chatterbox-TTS-Server / Qwen3-TTS server |
| Low-cost cloud LLM | DeepSeek or OpenRouter (LLM provider) | Cheaper per-token than Claude / OpenAI for speaker attribution at audiobook scale |
| Local LLM, no API costs | Ollama (LLM provider) | Run llama3.2 / qwen3 / mistral locally. Routes everything through your machine |
| A cloud LLM on the plan you already pay for | Your Claude plan (through Claude Code), or Sign in with ChatGPT on an OpenAI provider | No API key and nothing billed per call; it counts toward your plan's limits (see [Your own plan instead of a key](#your-own-plan-instead-of-a-key-llm)) |

## Adding a speech provider

1. **Open the AI page → Speech tab** and scroll past the models to the section
   that matches where it runs: **Self-hosted servers** for a server you run
   yourself, or **Online · metered** for a cloud API.
   (Language models: the LLM providers tab has its own form — connect
   Claude / OpenAI / Ollama and the rest there.)
2. Click **+ Add self-hosted server** or **+ Add provider**. An inline editor
   expands.
3. Fill in the form:
   - **Name** — what shows in dropdowns: the Voices page and a persona's **Voice** list.
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
     on the Voices page and in a persona's **Voice** list. **⟳ Fetch voices** asks the server for
     its list so you can pick instead of type.
4. **Test connection** checks the URL + key round-trip before you commit.
5. Click **Save provider**. It is ready at once — no restart.

## Which attribution route runs (LLM)

There's nothing to configure on a provider. Speaker attribution has two
routes — **Guided** (the system prompt's rules plus worked examples, for
small models) and **Direct** (the same system prompt without the examples,
for big models) — and the **Auto** row above them (AI Settings → Routing by
feature) picks which one runs by size alone: Direct at and above the
editable size line (a mixture-of-experts model counts its total size),
Guided otherwise and when the size is unknown. Analyze runs Auto's pick
unless you choose **Read: with examples** or **Read: rules only** on Script
for that run; a route card's Lab run or an API call forces its own route per
run too. Thinking is a per-feature preset setting like anywhere else — it
ships on for **Reasoned extraction** (speaker attribution's routes, Direction,
and Find same people's Frontier card) and off on every other preset. A Claude
(Anthropic) provider takes no temperature or samplers from a preset: Anthropic's
current API refuses them on every Claude model, so Claude answers at its own
defaults.

## Your own plan instead of a key (LLM)

- **Your Claude plan (through Claude Code)** — when Claude Code is installed on
  this computer, the **LLM providers** tab's online list says so; **Connect**
  makes it a provider that runs on the Claude plan you already pay for (not
  signed in, it gives the command, `claude auth login`, and **Look again**). Its
  row shows how much of this week's plan is used; **Test connection** says
  whether Claude Code is found and signed in. Each request starts Claude Code
  afresh, so the first word takes a few seconds. Anthropic's terms allow your
  own subscription in the unmodified Claude Code; how they apply to apps that
  run it isn't settled, and any enforcement would fall on your account.
- **Sign in with ChatGPT** — a saved **OpenAI** provider has **Sign in with
  ChatGPT** under **Edit**: it signs in at OpenAI in this computer's browser and
  then uses your ChatGPT Plus or Pro plan instead of the key; **Sign out** goes
  back to the key.

Calls on a plan cost nothing per call (the usage shows $0; the tokens still
count), and temperature and a reply-length limit don't apply to them. A plan's
limits are meant for ordinary personal use: a whole book's run is a lot of it.
Before a one-click run on a plan, the question names the plan instead of a
price — "on your Claude plan (30% of this week used so far) — nothing billed per
call" — and still asks once, because the book's text leaves the computer. A
Google AI Pro or Ultra plan includes monthly Google Cloud credits that can pay
for a Gemini key's use.

## Editing or removing

- **Edit** — click Edit on the row. The form expands in place; **Save** puts
  the change to work at once.
- **Remove provider** — inside the Edit form. Confirms before removing, and
  the provider is gone at once.
  A persona whose voice is on this provider falls back at render time.

## Self-hosted TTS — Kokoro / Chatterbox / Dia / Qwen3-TTS


If you're running a self-hosted TTS server (community-published OpenAI-compatible projects exist for each), add it under **Speech → Self-hosted servers** with its base URL — no key needed for local servers. The setup-hint band in the form links to each known project's canonical GitHub. JustVoice speaks the standard `POST /v1/audio/speech` shape — `model`, `input`, `voice`, `response_format` and `speed` — and sends nothing else, so a server's own fields (for example Chatterbox's `exaggeration` / `cfg_weight`) stay at the server's defaults.

## What about feature routing?

After registering one or more LLM providers, open **AI Settings → Routing by feature** to point specific features (Compose / Persona rewrite / Speaker attribution / Smart-assign / the rest) at specific provider+model presets. See `ai-features.md` for the routing model.

## Troubleshooting

- **Fetch voices hangs or errors** — the provider's server is unreachable.
  Test connection first; check the base URL + API key.
- **A provider's voices don't show when you pick a persona's voice** — only
  the voices picked on the provider row appear; Edit the row and add them.
- **Compose / Rewrite return HTTP 501** — no language model is set up yet.
  Connect one on the LLM providers tab (or run the LLM engine setup).
