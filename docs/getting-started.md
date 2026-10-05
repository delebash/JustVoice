# Getting started

JustVoice is a cross-platform voice-production studio. Five audiences share one engine pool: audiobook producers, game developers (Unreal / game dialogue), podcasters, dictation users, and accessibility users.

## First launch

1. **Pick a use case.** The Welcome modal asks what you're doing with JustVoice. Your choice retunes the UI: audiobook producers get Projects + Studio with chapters terminology; game devs get the Lines tab (every line of the game, stable ids); podcasters get Projects + Studio with episodes (the multi-track Stories timeline tab is a placeholder — not built yet). The chosen use case is also highlighted on the Home dashboard as a quick-action card so you can jump straight back into your workflow. You can re-pick later in Settings → About.

2. **Install the speech runtime, then load an engine.** Open the AI page's **Speech engines** tab. The **Speech runtime** row at the top installs the one program every voice engine runs on, in the build that suits your machine (the Voice engine setup wizard does this for you if you ran it). Then click Load on Kokoro (free, fast — faster than real time even on the CPU — with 49 preset voices in American and British English, Mandarin, Spanish, French, Hindi, Italian and Brazilian Portuguese); it downloads its 190 MB model first. That's the lightest starting point. For voice cloning, try Chatterbox Multilingual or Qwen3-TTS Base (clone from a reference WAV/MP3). See [engines.md](engines.md).

3. **Pick a voice.** Voices tab. Hit ▶ Preview on any row to audition.

4. **Hear a line.** On Voices, type your line in the test line above the list and ▶ any voice. To shape how it's said — pace, pitch, gain, an **Emotion**, and on Qwen3-TTS a direction in your own words — make it a persona (Personas → ＋ New persona) and use its **Hear it**.

## Common next steps

- **Producing an audiobook.** Import a manuscript via Projects → "+ Import…", choose JustWrite or CSV or SRT or Audacity Labels, and it opens in Studio on its Overview. Work the steps in order — Discover finds your speakers, Script works out who says each line, Cast gives each speaker a persona (a finished voice from your library), Render makes the audio.
- **Voicing game dialogue.** Voices tab → **Clone** with a reference WAV (Chatterbox Multilingual or Qwen3-TTS Base). Then Projects → "+ Import…" with a CSV of dialogue rows (fixed headers: scene, character, text, delivery, pause_after_ms — only text is required; each `character` becomes a speaker), give each speaker a persona in Studio · Cast, and work the Lines tab.
- **Recording a podcast script.** Projects → "+ New blank Project" → Project type "Podcast" → arrange voiced segments per chapter in Studio (the multi-track Stories timeline is planned, not built).
- **Dictating with global hotkey.** Captures tab → confirm all 6 readiness gates pass → set the push-to-talk chord in Settings → Capture.

## Headless mode

JustVoice runs without the desktop shell. From a terminal:

    justvoice-server serve --port 17494

The same UI is served at `http://localhost:17494/ui/`. Connect from any browser on your network. Useful for running JustVoice on a remote GPU box and hitting it from a laptop.

## Where things live

- **Home.** Dashboard — intro band + quick-actions for each audience + the engine/voice catalogue, loaded engine status, in-flight render tasks, and recent generations.
- **Settings.** Server URL, mastering preset (ACX / iAudio / Podcast / YouTube), generation defaults, capture hotkeys, MCP server, GPU diagnostics.
- **Engines.** One speech runtime runs every voice engine and speech recognition; each engine is a set of model files you download from its row. See [engines.md](engines.md).
- **Cache.** Disk-LRU render cache. Identical render of the same line costs nothing twice.
- **System tray.** Right-click the JustVoice icon in your OS tray (Windows) / menu bar (macOS) for quick access to Show app, Show dictate, Engines, Captures, Settings, and Quit — all without bringing the main window to the foreground.

See [core-concepts.md](core-concepts.md) next for the data model and `[Project → Scene → Block]` shape that all five audiences share.
