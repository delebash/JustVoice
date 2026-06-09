# Getting started

JustVoice is a cross-platform voice-production studio. Five audiences share one engine pool: audiobook producers, game developers (Unreal / NPC dialogue), podcasters, dictation users, and accessibility users.

## First launch

1. **Pick a use case.** The Welcome modal asks what you're doing with JustVoice. Your choice retunes the UI: audiobook producers land on the Books tab with chapters terminology; game devs land on Voices with "voice line set" terminology; podcasters land on the Stories timeline. You can re-pick later in Settings → About.

2. **Load an engine.** Open the Engines tab. Click Load on Kokoro (free, fast, CPU-realtime, 54 preset voices, 8 languages) — that's the lightest starting point. Then try Chatterbox Turbo if you want voice cloning (clone from a reference WAV/MP3).

3. **Pick a voice.** Voices tab. Hit ▶ Preview on any row to audition.

4. **Generate a line.** Generate tab. Type text. Click ▶ Generate. The Delivery overlay below the textarea lets you tune speed / pitch / temperature / emotion (Chatterbox) or delivery direction (Qwen3 / LuxTTS).

## Common next steps

- **Producing an audiobook.** Import a manuscript via Books → "+ Import…", choose JustWrite or CSV or SRT or Audacity Labels, then open Studio (when it lands) for the Cast → Script → Render flow.
- **Voicing game NPCs.** Voices tab → "+ Clone new voice" with a reference WAV (Chatterbox required). Then Books → "+ Import…" with a CSV of dialogue rows.
- **Recording a podcast script.** Books → "+ New blank Project" → Project type "Podcast" → use Stories to arrange voiced segments on a multi-track timeline.
- **Dictating with global hotkey.** Captures tab → confirm all 6 readiness gates pass → set the push-to-talk chord in Settings → Capture.

## Headless mode

JustVoice runs without the desktop shell. From a terminal:

    justtts-server serve --port 17494

The same UI is served at `http://localhost:17494/ui/`. Connect from any browser on your network. Useful for running JustVoice on a remote GPU box and hitting it from a laptop.

## Where things live

- **Settings.** Server URL, mastering preset (ACX / iAudio / Podcast / YouTube), generation defaults, capture hotkeys, MCP server, GPU diagnostics.
- **Engines.** Per-engine venv isolation — installing Chatterbox doesn't break Kokoro.
- **Cache.** Disk-LRU render cache. Identical render of the same line costs nothing twice.

See [core-concepts.md](core-concepts.md) next for the data model and `[Project → Scene → Block]` shape that all five audiences share.
