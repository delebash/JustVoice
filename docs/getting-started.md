# Getting started

JustVoice is a cross-platform voice-production studio. Five audiences share one engine pool: audiobook producers, game developers (Unreal / NPC dialogue), podcasters, dictation users, and accessibility users.

## First launch

1. **Pick a use case.** The Welcome modal asks what you're doing with JustVoice. Your choice tunes terminology (Chapters vs Quests vs Episodes) and the landing tab — nothing is hidden: every feature stays reachable in the same 8-item sidebar regardless. You can re-pick later in Settings → About.

2. **You land in Home (Studio)** — the project workspace. No project yet? The empty state offers the three ways in: **Import manuscript** (JustWrite / CSV / SRT / Audacity labels), **New project**, or **Just try a line** (jumps to the Scratchpad).

3. **Pick a voice — any voice.** Voice pickers always show the *entire* catalog (Kokoro's 54 presets, your clones, every engine's voices) even before anything is installed or loaded. Badges tell you the cost: `●` renders immediately, `⇄` rendering will swap engines (you'll be asked once), `⬇` engine needs installing first. Audition with ▶ Preview in Library → Voices.

4. **Render a line.** Scratchpad tab. Type text, click ▶ Generate. If the voice's engine isn't loaded, JustVoice asks — "Swap to Chatterbox? (~40s)" — with an *Always swap without asking* checkbox. The Delivery overlay below the textarea tunes speed / pitch / temperature / emotion tags.

The Engines tab is for **installing** engines and picking model sizes — day-to-day engine switching happens automatically at render time.

## Common next steps

- **Producing an audiobook.** Home (Studio) → Import manuscript → Cast tab (assign voices; a warning chip appears if your cast spans multiple engines — batch renders swap once per engine, not per line) → Script (speaker attribution) → Render → Takes (per-block re-rolls).
- **Voicing game NPCs.** Library → Voices → "+ Clone new voice" with a reference WAV (Chatterbox required). Then Studio → Import with a CSV of dialogue rows.
- **Recording a podcast script.** Studio → New project → type "Podcast" → use Stories to arrange voiced segments on a multi-track timeline.
- **Dictating with global hotkey.** Captures tab → readiness checklist → set the push-to-talk chord in Settings → Capture. Whisper preloads in the background at boot; or wire an online STT provider under Engines → STT.

## Headless mode

JustVoice runs without the desktop shell. From a terminal:

    justvoice-server serve --port 17494

The same UI is served at `http://localhost:17494/ui/`. Connect from any browser on your network. Useful for running JustVoice on a remote GPU box and hitting it from a laptop.

## Where things live

The sidebar is 8 flat items — same for every use case:

- **Home (Studio).** The project workspace: project switcher + Import + New in the header; Cast → Script → Render → Takes tabs. "Manage projects ›" opens the full project library (metadata, QC, M4B export).
- **Scratchpad.** One-off lines — try a voice, test a delivery, render a sentence.
- **Stories.** Multi-track timeline for podcast / dialogue assembly.
- **Captures.** Dictation + recorded samples.
- **Library.** Sub-tabs: Voices · Personas · Lexicons · Effects · Presets.
- **Labs.** Sub-tabs: Compare · Audio Tools · Render Lab · Speaker Lab · Train.
- **Engines.** Install engines, pick model sizes, register online providers (TTS / STT / LLM). Per-engine venv isolation — installing Chatterbox doesn't break Kokoro.
- **Settings.** Sub-tabs: General · Cache · Channels · Webhooks. Every operator-tunable value lives here.

Plus, everywhere: the topbar **engine pill** (loaded engine · variant; pulses during swaps; click → Engines) and the **task strip/panel** showing every render, install, swap, and background load with progress + cancel.

- **System tray.** Right-click the JustVoice icon in your OS tray (Windows) / menu bar (macOS) for quick access to Show app, Show dictate, Engines, Captures, Settings, and Quit — all without bringing the main window to the foreground.

See [core-concepts.md](core-concepts.md) next for the data model, the `[Project → Scene → Block]` shape all five audiences share, and how the one-engine-at-a-time pool works.
