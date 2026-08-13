# Use cases

JustVoice serves five distinct audiences. Pick your primary at first launch — the UI retunes terminology, the default tab, and which features are surfaced first.

## 🎧 Audiobook production

**Goal**: turn a manuscript into a multi-narrator audiobook ready for Audible / Apple Books.

**Flow**:
1. **Import** the manuscript (JustWrite export, or any of the supported [import formats](import-and-export.md)).
2. **Cast** — pick voices for every character via the Voices tab. Smart-assign auto-matches; review.
3. **Script** — let the AI work out who speaks each line; the result saves onto the chapter. Correct any misattributions in the Script tab — every row is assignable, narration included, and your corrections feed back into subsequent re-analyses. Any line left without a speaker blocks the render rather than going missing from the audio.
4. **Render** — batch render every chapter. ACX [mastering.md](mastering.md) preset applies automatically.
5. **Export** — M4B audiobook file with chapter markers, muxed server-side from the Export tab. See [Audiobook → M4B](import-and-export.md#audiobook--m4b).

**Engine pick**: Chatterbox Turbo (voice cloning, sounds like real narrators) + Kokoro (incidental characters).

## 🎮 Game NPC dialogue

**Goal**: voice 50-500 NPC lines with consistent character voices.

**Flow**:
1. **Import** a CSV of dialogue rows (`scene, character, text, delivery, pause_after_ms` — only `text` is required; include an `id`/`line_id`/`dialogue_id` column so re-imports merge by stable id). See [import-and-export.md](import-and-export.md).
2. **Cast** — assign each character to a voice. Cloned voices for hero NPCs, preset voices for villagers.
3. **Render** — bulk render every line.
4. **Export** — per-line WAVs grouped by scene plus a `manifest.json` of line metadata for Unreal import; an Unreal `.uplugin` bundle is planned.

**Engine pick**: Kokoro (CPU-fast at scale, 54 preset voices) + Chatterbox for protagonist clones.

## 🎙️ Podcast production

**Goal**: produce a multi-track podcast episode with multiple host voices and effects.

**Flow**:
1. **Import** a script (CSV, SRT, or write directly in JustVoice).
2. **Cast** voices for hosts + guests.
3. **Stories timeline** *(planned — the tab is a placeholder today; episodes work through Chapters + Studio)* — arrange voiced segments on a multi-track timeline. Add SFX, music beds via drag-drop. Trim, split, version-pin per clip.
4. **Render** — full episode mix-down. Podcast [mastering.md](mastering.md) preset (-16 LUFS).
5. **Export** — MP3 / WAV.

**Engine pick**: Chatterbox Turbo for hosts (clone real voices) + Kokoro for incidental characters.

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

**Engine pick**: Kokoro (CPU-realtime, no GPU needed) or a small Chatterbox model.

---

You can mix use cases. JustVoice doesn't lock you to one — picking "Audiobook" at first launch just sets the default tab and labels. Game devs who occasionally produce audiobook trailers don't need to repick.

To switch primary use case after first launch: Settings → About → "Run welcome again". Your projects + voices + lexicons survive unchanged.
