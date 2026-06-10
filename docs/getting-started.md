# Getting started

JustVoice is a cross-platform voice-production studio. Five audiences share one engine pool: audiobook producers, game developers (Unreal / NPC dialogue), podcasters, dictation users, and accessibility users.

## First launch

1. **Pick a use case.** The Welcome modal asks what you're doing with JustVoice. Your choice tunes terminology (Chapters vs Quests vs Episodes) and the landing tab — nothing is hidden: every feature stays reachable in the same 8-item sidebar regardless. You can re-pick later in Settings → About.

2. **You land in Projects** — the project library. Click **+ New blank Project** (pick a project type: audiobook / game voicelines / podcast / custom) or **+ Import…** (JustWrite / CSV / SRT / Audacity labels). Then **Open in Studio** to produce it. (Just exploring? Skip straight to the Scratchpad and render a line.)

3. **Pick a voice — any voice.** Voice pickers always show the *entire* catalog (Kokoro's 54 presets, your clones, every engine's voices) even before anything is installed or loaded. Badges tell you the cost: `●` renders immediately, `⇄` rendering will swap engines (you'll be asked once), `⬇` engine needs installing first. Audition with ▶ Preview in Library → Voices.

4. **Render a line.** Scratchpad tab. Type text, click ▶ Generate. If the voice's engine isn't loaded, JustVoice asks — "Swap to Chatterbox? (~40s)" — with an *Always swap without asking* checkbox. The Delivery overlay below the textarea tunes speed / pitch / temperature / emotion tags.

The Engines tab is for **installing** engines and picking model sizes — day-to-day engine switching happens automatically at render time.

## Common next steps

- **Producing an audiobook.** Projects → Import manuscript → Open in Studio → Cast tab (assign voices; a warning chip appears if your cast spans multiple engines — batch renders swap once per engine, not per line) → Script (speaker attribution) → Render → Takes (per-block re-rolls).
- **Voicing game NPCs.** Library → Voices → "+ Clone new voice" with a reference WAV (Chatterbox required). Then Projects → "+ Import…" with a CSV of dialogue rows.
- **Recording a podcast script.** Projects → "+ New blank Project" → type "Podcast" → use Stories to arrange voiced segments on a multi-track timeline.
- **Dictating with global hotkey.** Captures tab → readiness checklist → set the push-to-talk chord in Settings → Capture. Whisper preloads in the background at boot; or wire an online STT provider under Engines → STT.

## Headless mode

JustVoice runs without the desktop shell. From a terminal:

    justvoice-server serve --port 17494

The same UI is served at `http://localhost:17494/ui/`. Connect from any browser on your network. Useful for running JustVoice on a remote GPU box and hitting it from a laptop.

## Where things live

The sidebar is 9 flat items — same for every use case:

- **Projects.** The library and entry point: create (with a project type), import, metadata, QC, M4B export. Open a project in Studio from here.
- **Studio.** The production workspace for the selected project: Cast → Script → Render → Takes tabs (podcasters open into the episode content, not the cast). The header also has a project switcher + New + Import.
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
