# Use cases

JustVoice serves five distinct audiences. Pick your primary at first launch — the UI retunes terminology, the default tab, and which features are surfaced first.

## 🎧 Audiobook production

**Goal**: turn a manuscript into a multi-narrator audiobook ready for Audible / Apple Books.

**Flow**:
1. **Import** the manuscript (JustWrite export, or any of the supported [import-formats.md](import-formats.md)).
2. **Cast** — pick voices for every character via the Voices tab. Smart-assign auto-matches; review.
3. **Script** — let the AI work out who speaks each line. Manually correct any misattributions in the Script tab. Corrections feed back into subsequent re-analyses.
4. **Render** — batch render every chapter. ACX [mastering.md](mastering.md) preset applies automatically.
5. **Export** — M4B audiobook file with chapter markers (via JustWrite's m4b.js, or directly via the Export tab).

**Engine pick**: Chatterbox Turbo (voice cloning, sounds like real narrators) + Kokoro (incidental characters).

## 🎮 Game NPC dialogue

**Goal**: voice 50-500 NPC lines with consistent character voices.

**Flow**:
1. **Import** a CSV of dialogue rows (`speaker, line, voice_hint, delivery`). See [import-formats.md](import-formats.md).
2. **Cast** — assign each character to a voice. Cloned voices for hero NPCs, preset voices for villagers.
3. **Render** — bulk render every line. Per-line WAV + JSON sidecar with metadata for Unreal import.
4. **Export** — WAV+JSON per line, or a single Unreal `.uplugin` bundle (planned).

**Engine pick**: Kokoro (CPU-fast at scale, 54 preset voices) + Chatterbox for protagonist clones.

## 🎙️ Podcast production

**Goal**: produce a multi-track podcast episode with multiple host voices and effects.

**Flow**:
1. **Import** a script (CSV, SRT, or write directly in JustVoice).
2. **Cast** voices for hosts + guests.
3. **Stories timeline** — arrange voiced segments on a multi-track timeline. Add SFX, music beds via drag-drop. Trim, split, version-pin per clip.
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
