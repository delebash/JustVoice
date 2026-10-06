# Use cases

JustVoice serves five distinct audiences. Pick your primary at first launch — the UI retunes terminology, the default tab, and which features are surfaced first.

## 🎧 Audiobook production

**Goal**: turn a manuscript into a multi-narrator audiobook ready for Audible / Apple Books.

**Flow**:
1. **Import** the manuscript (JustWrite export, or any of the supported [import formats](import-and-export.md)).
2. **Discover** — find the people the manuscript names and add them to the book as its **speakers**.
3. **Script** — let the AI work out who speaks each line; the result saves onto the chapter. Correct any misattributions in the Script tab — every row is assignable, narration included, and your corrections feed back into subsequent re-analyses. Any line left without a speaker blocks the render rather than going missing from the audio.
4. **Cast** — give each speaker a **persona**, a finished voice from your [Personas](personas.md) library; one persona can play several speakers. Smart-assign proposes a match for everyone; change any you disagree with.
5. **Render** — batch render every chapter. ACX [mastering.md](mastering.md) preset applies automatically.
6. **Export** — M4B audiobook file with chapter markers, muxed server-side from the Export tab. See [Audiobook → M4B](import-and-export.md#audiobook--m4b).

**Engine pick**: Chatterbox Multilingual or Qwen3-TTS Base (voice cloning, sounds like real narrators) — or Qwen3-TTS CustomVoice when you want to direct each line in words — + Kokoro (personas for minor speakers).

## 🎮 Game dialogue

**Goal**: voice 50-500 dialogue lines with a consistent voice for every speaker.

**Flow**:
1. **Import** a CSV of dialogue rows (`scene, character, text, delivery, pause_after_ms` — only `text` is required; include an `id`/`line_id`/`dialogue_id` column so re-imports merge by stable id). See [import-and-export.md](import-and-export.md). Each `character` in the sheet becomes one of the project's speakers.
2. **Cast** — give each speaker a persona. Personas on cloned voices for the heroes, on built-in voices for villagers — one "villager" persona can play them all.
3. **Render** — bulk render every line.
4. **Export** — per-line WAVs grouped by scene plus a `manifest.json` of line metadata for Unreal import; an Unreal `.uplugin` bundle is planned.

**Engine pick**: Kokoro (fast at scale, 49 built-in voices) + Chatterbox Multilingual or Qwen3-TTS Base for protagonist clones.

## 🎙️ Podcast production

**Goal**: produce a multi-track podcast episode with several speakers' voices and effects.

**Flow**:
1. **Import** a script (CSV, SRT, or write directly in JustVoice).
2. **Cast** — give each speaker (hosts and guests) a persona.
3. **Timeline** *(planned, not built — episodes work through Studio today)* — arrange voiced segments on a multi-track timeline. Add SFX, music beds via drag-drop. Trim, split, version-pin per clip.
4. **Render** — full episode mix-down. Podcast [mastering.md](mastering.md) preset (-16 LUFS).
5. **Export** — MP3 / WAV.

**Engine pick**: Chatterbox Multilingual or Qwen3-TTS Base for the hosts' personas (clone real voices) + Kokoro for minor speakers.

## ⌨️ Dictation / agent voice

**Goal**: dictate into any text field via global hotkey; or expose JustVoice as a speak tool to agents via MCP.

**Flow**:
- See [dictation.md](dictation.md) for the 6-gate readiness checklist.
- See [mcp-server.md](mcp-server.md) for connecting Claude Desktop / claude-code / Unreal.

**Engine pick**: Kokoro (lowest latency, CPU-realtime).

## 🔊 Accessibility / screen reader

**Goal**: real-time TTS with low-latency engines for screen-reader use.

**Flow**:
- Keep JustVoice running headless (`justvoice-server serve`).
- MCP integrations with assistive tools, or a thin OS-level shim that pipes selected text to `/v1/render`.

**Engine pick**: Kokoro (faster than real time on the CPU, no GPU needed).

---

You can mix use cases. JustVoice doesn't lock you to one — picking "Audiobook" at first launch just sets the default tab and labels. Game devs who occasionally produce audiobook trailers don't need to repick.

To switch primary use case after first launch: Settings → About → "Run welcome again". Your projects + voices + lexicons survive unchanged.
