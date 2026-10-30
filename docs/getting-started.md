# Getting started

JustVoice is a cross-platform voice-production studio. Five audiences share one engine pool: audiobook producers, game developers (Unreal / game dialogue), podcasters, dictation users, and accessibility users.

## Installing it

Download the installer for your computer from JustVoice's [releases page](https://github.com/delebash/JustVoice/releases):
**Windows** the `justvoice-…-win-x64.exe`, **macOS** (Intel and Apple silicon) the `.dmg`, **Linux** the `.AppImage`
(or the `.deb`, for Debian and Ubuntu). The installers aren't signed with a publisher's certificate, so the first time:

- **Windows** says "Windows protected your PC": press **More info**, then **Run anyway**.
- **macOS** says the app can't be opened. On macOS 15 and later: open **System Settings → Privacy & Security**,
  go to **Security** and press **Open Anyway** (it's there for about an hour after you try to open the app), then
  enter your password. On macOS 14 and earlier: Control-click the app in Finder and choose **Open**. If it says the
  app "is damaged", run `xattr -cr "/Applications/JustVoice.app"` in Terminal once, then open it.
- **Linux**: make the `.AppImage` executable (`chmod +x`) and run it — nothing else to install. The `.deb` installs
  as any package does (`sudo apt install ./` and the file's name).
- **Windows with Smart App Control on** (some new Windows 11 computers) blocks the app with no **Run anyway**: the
  app's files aren't signed. It runs once Smart App Control is off (Windows Security → App & browser control →
  Smart App Control).

## First launch

1. **Pick a use case.** The Welcome modal asks what you're doing with JustVoice. Your choice retunes the UI: audiobook producers get Projects + Studio with chapters terminology; game devs get the Lines tab (every line of the game, stable ids); podcasters get Projects + Studio with episodes (the multi-track Stories timeline tab is a placeholder — not built yet). The chosen use case is also highlighted on the Home dashboard as a quick-action card so you can jump straight back into your workflow. You can re-pick later in Settings → About.

2. **Install the speech runtime, then load an engine.** Open the AI page's **Speech** tab. **Install** under **Engine: audio.cpp** at the top installs the one program every voice engine runs on, in the build that suits your machine (the Voice engine setup wizard does this for you if you ran it). Then open **Kokoro** in the list of models, click **Download** on its model (190 MB), and **Load** once it's on this computer — Kokoro is free and fast, faster than real time even on the CPU, with 49 built-in voices in American and British English, Mandarin, Spanish, French, Hindi, Italian and Brazilian Portuguese. That's the lightest starting point. For voice cloning, try Chatterbox Multilingual or Qwen3-TTS Base (clone from a reference WAV/MP3). See [engines.md](engines.md).

3. **Pick a voice.** Voices tab. Hit ▶ Preview on any row to audition.

4. **Hear a line.** On Voices, type your line in the test line above the list and ▶ any voice. To shape how it's said — pace, pitch, gain, an **Emotion**, and on Qwen3-TTS a direction in your own words — make it a persona (Personas → ＋ New persona) and use its **Hear it**.

## Common next steps

- **Producing an audiobook.** On Projects press **＋ New project**, pick Audiobook and drop your manuscript (a JustWrite book, EPUB, DOCX, Markdown or text) under **Bring the words in**; Create shows what it found, and after you import it opens in Studio on its Overview. Work the steps in order — Discover finds your speakers, Script works out who says each line, Cast gives each speaker a persona (a finished voice from your library), Render makes the audio.
- **Voicing game dialogue.** Voices tab → **Clone** with a reference WAV (Chatterbox Multilingual or Qwen3-TTS Base). Then Projects → **＋ New project** → Game, with a CSV of dialogue rows under **Bring the words in** (fixed headers: scene, character, text, delivery, pause_after_ms — only text is required; each `character` becomes a speaker), give each speaker a persona in Studio · Cast, and work the Lines tab.
- **Recording a podcast script.** Projects → "+ New blank Project" → Project type "Podcast" → arrange voiced segments per chapter in Studio (a multi-track timeline is planned, not built).
- **Dictating.** The global hotkey and in-app recording aren't built yet — see [Dictation](dictation.md). Settings → Capture holds the capture language and the cleanup switches.

## Headless mode

JustVoice runs without the desktop window. On Windows, from the install folder:

    justvoice-server serve --port 17494

(Where the same command sits on macOS and Linux, and a copy of the source code: see
[Run modes](run-modes.md#headless).)

The same UI is served at `http://localhost:17494/ui/`. Connect from any browser on your network. Useful for running JustVoice on a remote GPU box and hitting it from a laptop.

## Where things live

- **Home.** Dashboard — intro band + quick-actions for each audience + the engine/voice catalogue, the graphics memory and the models in it (as AI Settings shows them), in-flight render tasks, and recent generations (each with the persona that spoke it).
- **Settings.** Server URL, mastering preset (ACX / iAudio / Podcast / YouTube), generation defaults, capture language and cleanup, MCP server, GPU diagnostics.
- **Engines.** One speech runtime runs every voice engine and speech recognition, on the AI page's **Speech** tab; each engine is a set of model files you download from its rows there. See [engines.md](engines.md).
- **Cache.** Disk-LRU render cache. Identical render of the same line costs nothing twice.
- **System tray.** Right-click the JustVoice icon in your OS tray (Windows) / menu bar (macOS) for Show window and Hide window, Start, Stop and Restart server, Open settings, Copy server URL, Open log file, About JustVoice and Quit; a left-click shows or hides the window. See [System tray](system-tray.md).

See [core-concepts.md](core-concepts.md) next for the data model and `[Project → Scene → Block]` shape that all five audiences share.
