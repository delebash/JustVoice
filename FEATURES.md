# JustVoice — features and how to use them

> Comprehensive user-facing guide. For every feature: what it is, when to use it, how to use it, and worked examples. If something is missing, file an issue.
>
> For developer/architecture docs see `DESIGN_FREEZE.md`, `CONTRACT.md`, `docs/plans/archive/PHASE_PLAN.md`. For the JustWrite→JustVoice bridge see `docs/plans/archive/PHASE5_JUSTWRITE_INTEGRATION.md`.

## Table of contents

1. [What JustVoice is](#1-what-justvoice-is)
2. [Two ways to run it: desktop app vs headless server](#2-two-ways-to-run-it-desktop-app-vs-headless-server)
3. [Books, scenes, blocks — the project model](#3-books-scenes-blocks--the-project-model)
4. [Voices — cloning, presets, designing, blending](#4-voices--cloning-presets-designing-blending)
5. [Voice preview — audition before committing](#5-voice-preview--audition-before-committing)
6. [Personas — characters, bios, LLM-rewriting](#6-personas--characters-bios-llm-rewriting)
7. [Lexicons — pronunciation discipline](#7-lexicons--pronunciation-discipline)
8. [Render presets — locking ACX consistency](#8-render-presets--locking-acx-consistency)
9. [Take versioning — re-roll one paragraph](#9-take-versioning--re-roll-one-paragraph)
10. [Engines — install, load, switch](#10-engines--install-load-switch)
11. [ACX mastering + chapter QC](#11-acx-mastering--chapter-qc)
12. [Effects chain — pedalboard](#12-effects-chain--pedalboard)
13. [Captures + dictation](#13-captures--dictation)
14. [Stories — the multi-track timeline editor](#14-stories--the-multi-track-timeline-editor)
15. [Audio output channels — multi-device routing](#15-audio-output-channels--multi-device-routing)
16. [MCP server — agents and Unreal Engine](#16-mcp-server--agents-and-unreal-engine)
17. [Webhooks — async event notifications](#17-webhooks--async-event-notifications)
18. [Backup, restore, project export](#18-backup-restore-project-export)
19. [System tray + keep-server-running](#19-system-tray--keep-server-running)
20. [Settings — every knob in one place](#20-settings--every-knob-in-one-place)
21. [JustWrite integration end-to-end](#21-justwrite-integration-end-to-end)
22. [Unreal Engine integration](#22-unreal-engine-integration)
23. [Troubleshooting](#23-troubleshooting)

---

## 1. What JustVoice is

A voice production studio. One app, five distinct audiences:

- **Audiobook producers** — write in JustWrite, produce in JustVoice, deliver to ACX
- **Game developers** — voice 50–500 NPCs from a single project file, ship to Unreal Engine
- **Podcasters** — multi-character timeline editor + paralinguistic tags
- **Dictation users** — global hotkey + Whisper transcription + LLM refinement
- **Accessibility users** — local TTS for screen-reader integration

Same engines, same voice library, same persona system. What changes per audience is the import + export pipeline and the UI tab you spend most of your time in.

License: **MIT**. History: Apache-2.0 → GPL-3.0-or-later (2026-06-08, when Spotify's pedalboard was adopted for the effects chain) → MIT (2026-07-29, when pedalboard was replaced by first-party DSP).

---

## 2. Two ways to run it: desktop app vs headless server

### Desktop app (default)

```
npm install
cd server && pip install -e .[kokoro] && cd ..
npm run tauri dev
```

Spawns a Tauri window with the Vue UI. The Python sidecar (FastAPI on port 17494) is spawned automatically and killed when you close the window — unless you turn on **Keep server running when app closes** in Settings → General (then the sidecar stays alive in the system tray, the close-button minimizes to tray).

### Headless server

```
cd server
pip install -e .[kokoro]
justvoice-server serve --port 17494
```

That's it. The same UI is served at `http://localhost:17494/ui/`. Power users:

- Run the server on a remote box (Settings → General → Network access toggle binds 0.0.0.0)
- Hit the UI from any browser on your LAN
- Bring up the Python server via Docker / systemd / supervisor
- Script against the HTTP API (`/v1/render_chapter`, `/v1/voices`, etc.)

> **Important**: the Python script is `justvoice-server`, not `justvoice`. On Windows the Tauri binary is `justvoice.exe`; using the same name would cause an infinite spawn loop. Never rename.

---

## 3. Books, scenes, blocks — the project model

The core data model is intentionally use-case-generalized. A **Project** is a top-level container with a `project_type`:

| Type | Project = | Scene = | Block = |
|---|---|---|---|
| `audiobook` | a book | a chapter | a paragraph |
| `game_voicelines` | a game module | a dialogue tree / quest | a single NPC line |
| `podcast` | an episode | a segment | a take |
| `custom` | whatever | whatever | whatever |

Why? Voice cloning, lexicons, personas, render presets — all of these work the same across use cases. The data shape is the same; the export pipeline is what differentiates an ACX-spec audiobook from a Wwise-bound game voice pack.

### How to use

#### Create a blank project

1. Open the **Books** tab.
2. Click **+ New**.
3. Pick a project type (audiobook / game_voicelines / podcast / custom).
4. Add scenes (chapters / quests / episodes) and blocks (paragraphs / NPC lines / takes) by hand, or…

#### Import from JustWrite

JustWrite (the novel-writing app from the same developer) exports books as JSON. JustVoice ingests them in one call:

1. **Books** tab → **Import JustWrite book** → pick the JSON file.
2. JustVoice creates: 1 Project + N Scenes (one per chapter) + N Blocks (one per paragraph) + 1 Persona per JustWrite character (auto-mapped using the character bio).
3. Returns a result: `scene_count`, `block_count`, `persona_count`, `created_personas`, `reused_personas`.

Re-importing the same book updates without duplicating characters — personas remember they came from JustWrite via `imported_from='justwrite'` + `imported_id`.

#### Filter by project type

Click any of the project-type chips (Audiobooks / Game voicelines / Podcasts / Custom) above the project list to filter.

#### Example: shipping an audiobook

```python
# Imagine you have a book.json from JustWrite. From the command line:
curl -X POST http://localhost:17494/v1/projects/import?source=justwrite \
  -H "Content-Type: application/json" \
  -d @book.json
# → { "project_id": "abc-123", "scene_count": 12, "block_count": 487, ... }

# Start a render of all scenes:
curl -X POST http://localhost:17494/v1/render_jobs \
  -H "Content-Type: application/json" \
  -d '{"scope": "project", "project_id": "abc-123"}'

# Subscribe to progress:
curl -N http://localhost:17494/v1/render_jobs/<job_id>/stream
```

---

## 4. Voices — cloning, presets, designing, blending

A **VoiceProfile** is a reusable voice. Four flavors:

- **cloned** — built from one or more reference audio samples + transcripts. Engines that support cloning (Chatterbox, Qwen3-TTS, LuxTTS, TADA) capture the timbre and prosody of the reference.
- **preset** — engine-built-in voices (Kokoro's 54 voices, Qwen3 CustomVoice's 9). No cloning needed.
- **designed** — text-prompted ("a Heroic Baritone with a slight rasp"). Engines: Qwen3 CustomVoice.
- **blended** — interpolated from two existing cloned voices (lerp / slerp / weighted_sum).

### How to use

#### Clone a voice

1. **Voices** tab → **+ Clone voice**.
2. Pick the engine you want (Chatterbox is the easiest start).
3. Upload 1–10 reference samples (WAV / MP3 / FLAC). 5–30 seconds each. Each sample needs a transcript.
4. Name the voice ("Narrator", "Mara", "Old Crow"). Set the language.
5. Save.

#### Use a preset voice

1. **Voices** tab → top-right filter to "preset".
2. Click any of the 54 Kokoro presets or 9 Qwen3 CustomVoice presets.
3. They're immediately available in the Generate tab and any persona cast.

#### Design a voice

1. **Voices** tab → **+ Design voice**.
2. Engine: Qwen3 CustomVoice (the only one that supports text-described voices currently).
3. Type a description: "A weary detective with a Brooklyn accent, lower register, slight gravel."
4. Generate a preview. Save if you like it.

#### Blend two voices

1. **Voices** tab → **+ Blend**.
2. Pick two existing cloned voices.
3. Choose a strategy: **slerp** (smoother), **lerp** (faster), **weighted_sum** (manual control).
4. Set weights (e.g. 0.7 + 0.3 for 70% voice A / 30% voice B).
5. Generate a preview. Save.

#### Export / import voices

`.justvoice.zip` packages a voice with its samples + metadata. Share with collaborators or move between machines.

- **Export**: Voices tab → row menu → **Export as .justvoice.zip**
- **Import**: Voices tab → **+ Import** → pick the .zip

---

## 5. Voice preview — audition before committing

Cloning a voice means committing to it for hours of audiobook output. Bad casting decision = hours of re-cloning. So JustVoice has a **preview** path that generates an audition clip WITHOUT persisting the voice to your library.

### How to use

1. **Voices** tab → **+ Clone** (or Design / Blend).
2. Fill in the form as you would normally.
3. Click **Preview** (not Save).
4. JustVoice generates a 5-second sample ("The quick brown fox jumps over the lazy dog.") with the candidate voice.
5. Listen. If you like it, click **Save voice** (the preview is promoted to a real VoiceProfile). If not, just close — the candidate vanishes from memory in 10 minutes.

Behind the scenes the preview voices live in an in-memory LRU (20-cap, 10-min TTL). Library never pollutes.

### Casting workflow

Auditioning 5 candidates per character across 10 characters = 50 previews. Without this feature you'd be creating + deleting 50 VoiceProfiles. With it: 5 audition cycles per character, 1 save, the rest expire on their own.

---

## 6. Personas — characters, bios, LLM-rewriting

A **Persona** is a character bio bound to a voice. Voicebox folds this into VoiceProfile via a `personality` field; JustVoice promotes it to a first-class entity because audiobook + game-dialogue projects have CAST.

### Fields

- `name` — "Old Crow"
- `bio` — free-form character bio (max 2000 chars). "A retired racetrack tout with three teeth and four lies for every truth."
- `voice_profile_id` — which VoiceProfile does this persona use?
- `engine_override` — pin a specific engine even if the voice's default differs
- `lexicon_id` — per-persona pronunciation override
- `personality_enabled` — when true, generation requests with `personality=true` trigger an LLM-rewrite that rewrites the text "in character" before TTS

### How to use

#### Create a persona manually

1. **Personas** tab → **+ New persona**.
2. Name, bio, pick a voice from the dropdown.
3. (Optional) Pick an engine override + lexicon override.
4. Toggle `personality_enabled` if you want the LLM-rewrite.

#### Persona via JustWrite import

When you import a book from JustWrite (see §3), JustVoice auto-creates one Persona per JustWrite character. The persona's `bio` is populated from the JustWrite character's bio. If `voice_notes` exist in JustWrite, they're appended to the bio.

#### Re-import safety

If you re-import the same book, JustVoice matches existing personas by `(imported_from='justwrite', imported_id=<char_id>)` and reuses them. Your voice assignments + lexicon overrides survive.

#### Personality LLM rewrite

When `personality_enabled=true` and the request includes `personality=true`, the text goes through a local Qwen3 LLM with the persona's bio as system prompt. The LLM rewrites the text in-character before it hits TTS. Example:

- Input text: "I need to leave now."
- Persona bio: "Old Crow speaks in fragments. Calls everyone 'boss'. Suspicious of cops."
- LLM rewrite: "Gotta clear out, boss. Now."

> **Warning**: never enable persona-rewrite on book-render workflows. It silently rewrites the manuscript. Use it for ad-hoc generations + agent integrations (see MCP §16) where the LLM-rewriting is the whole point.

---

## 7. Lexicons — pronunciation discipline

A **Lexicon** is a pronunciation dictionary. Forces "ARPAnet" → "AR-pa-net", "Beauchamp" → "BEE-chum", "Worcestershire" → "WUS-tə-shər" — every render, every chapter, every time.

Voicebox doesn't have this. It's a JustVoice differentiator because audiobook + game-dialogue projects have proper nouns + domain words that TTS engines pronounce wrong.

### Scopes

- **global** — applies everywhere
- **project** — scoped to one project (book / game)
- **persona** — scoped to one persona (so Old Crow says "guv'nor" with a Cockney pronunciation but the narrator says "governor" with RP)

### Entries

Each entry: a `word`, a `pronunciation`, a `notation` (IPA or ASCII-phonetic), optional `notes`.

### How to use

#### Create a book-scoped lexicon

1. **Lexicons** tab → **+ New** → scope: project → pick your book.
2. Add entries one at a time, or paste a CSV.
3. The lexicon's now active for any render of any block in that book.

#### Live preview

1. In the Generate tab, after picking a voice, the textarea shows a "lexicon preview" line.
2. Type "Worcestershire sauce". The preview shows "WUS-tə-shər sauce" as it would be sent to TTS.

#### Override per-persona

1. **Personas** tab → pick a persona → set `lexicon_id`.
2. That persona's blocks use the persona-scoped lexicon overlay (project lexicon still applies as fallback).

#### Export / import

`.justlex.json` is the portable lexicon format. Sharable on GitHub / Reddit / Discord. The community can curate domain-specific lexicons (medical, nautical, fantasy-novel-names).

---

## 8. Render presets — locking ACX consistency

A **RenderPreset** is a named bundle: voice + delivery (speed/gain/etc.) + mastering target + lexicons + seed + cache scope. Save once, reuse across chapters.

Why this matters: **ACX rejects audiobooks for inconsistency between chapters.** If you render chapter 1 with voice A at temperature 0.7 and chapter 2 with voice A at temperature 0.5, the chapter joins audibly. Render presets prevent that class of error.

### Scopes

- **global** — reusable across projects
- **project-scoped** — locked to one project (audiobook producers lock per-book; game-devs lock per-character)

### How to use

#### Save a preset

1. Render a few test chapters of your book until you like the result.
2. **Settings** → **Render presets** → **+ New preset from current**.
3. Name it ("Stillwater Heist - Narrator - take 3").
4. Bind it to the project (so it shows up in that book's render dialog).

#### Apply a preset

In the Generate tab or chapter-render dialog, pick the preset from the dropdown. Every block of every chapter rendered with that preset uses the same voice, delivery, lexicons, seed pattern.

#### Re-cast mid-book

When a character's voice gets recast in chapter 5, edit the preset (PATCH `/v1/presets/{id}` with new `voice_id`). Future renders use the new voice; existing rendered chapters keep their old audio.

#### Use programmatically

```bash
# Render with a preset (compact request):
curl -X POST http://localhost:17494/v1/generate \
  -H "Content-Type: application/json" \
  -d '{"preset_id": "preset-abc-123", "text": "Once upon a midnight dreary"}'
```

If `preset_id` is set, voice/delivery/lexicons/seed/cache_scope are inherited from the preset. Any explicit field in the request overrides per-field.

---

## 9. Take versioning — re-roll one paragraph

A **Take** is one rendered version of one block (paragraph / NPC line). Multiple takes per block means you can:

- A/B compare two takes (different temperature, different reference audio)
- Pin take 2 as the default for chapter 4 paragraph 17
- Re-roll just one paragraph without invalidating the rest of the book

Voicebox versions whole generations. JustVoice versions per-block — that's the audiobook QA killer feature.

### How to use

#### Generate multiple takes

1. In the Chapter view, hover over a paragraph.
2. Click **Regenerate** (or hit `R` while hovering).
3. A new Take is created with the same text but a different seed.
4. Continue regenerating until you have a take you like.

#### Pin the default

1. Hover over the paragraph → take selector dropdown.
2. Pick the take you want. Click **Set as default**.
3. That take is what ships in the final chapter render.

#### Label takes

1. Right-click a take → **Label as…** → "angrier" / "first try" / "faster delivery".
2. Labels show up in the take selector so you can pick semantically.

#### Linage

Re-takes track their source via `source_take_id`. The take chain is visible in the right-rail inspector. Useful for "this was the third re-take after the seed=42 attempt."

---

## 10. Engines — install, load, switch

JustVoice ships with up to 10 engines. Each engine = its own pip-installable adapter with isolated venv (so installing Chatterbox doesn't break Kokoro).

| Engine | Best for | Languages | VRAM (load) |
|---|---|---|---|
| **Kokoro** | Cross-platform realtime baseline; 54 preset voices | 8 | CPU realtime |
| **Chatterbox Multilingual** | Voice cloning, paralinguistic tags | 23 | 1.2 GB |
| **Chatterbox Turbo** | English-only, smaller / faster | en | 350 MB |
| **Qwen3-TTS Base** | High-quality multilingual TTS | 10 | 1.7 GB |
| **Qwen3 CustomVoice** | 9 preset voices + designed voices | 10 | 0.6–1.7 GB |
| **LuxTTS** | 48 kHz cloning, 150x realtime CPU | en | 1.0 GB |
| **TADA (HumeAI)** | 700s+ coherent audio; multilingual variant | 10 | 3.2 GB |
| **Dia (Nari Labs)** | Multi-speaker dialogue (experimental) | en | 3.0 GB |
| **MossTTS** | Cloning (experimental) | en+zh | TBD |
| **External OpenAI-compatible TTS** | ElevenLabs / OpenAI / Piper / etc. | — | 0 |

### How to use

#### Install an engine

1. **Engines** tab → row of the engine → **Install**.
2. JustVoice creates a per-engine venv, downloads the model weights from HuggingFace, installs the pip dependencies.
3. Progress bar shows current file + speed. Cancel button mid-install.

#### Load / unload

Most engines auto-load on first synthesis. To pre-load (so the first generation isn't slow):

1. **Engines** tab → **Load** button.
2. Watch for the green "loaded" badge.

To free VRAM:

1. **Engines** tab → **Unload**.

#### Switch engines mid-generation

The `engine` field on every render request picks the engine for that call. The Generate tab's dropdown is the visual equivalent.

#### Add an external OpenAI-compatible TTS provider

1. **Settings** → **External TTS engines** → **+ Add**.
2. Name, base URL, API key, model name, available voice names.
3. Now the provider shows up in the engine dropdown alongside the local engines.

### CUDA wheel auto-install

When a CUDA GPU is detected but torch is installed CPU-only (the default installer ships CPU baseline to keep the installer small), the GPU page offers an in-app CUDA wheel download. Click **Install CUDA support** and the right cu124/cu128 wheel downloads via pip, then the server restarts automatically to pick it up.

---

## 11. ACX mastering + chapter QC

ACX (Audible's submission system) rejects audiobooks for mastering inconsistency: too quiet, too loud, peaks too hot, noise floor too high. JustVoice's **ACX mastering preset** targets:

- **Loudness**: -20 LUFS (centered in ACX's -23 to -18 window)
- **True peak ceiling**: -3.5 dBFS (0.5 dB safety headroom below ACX's -3 dBFS limit)
- **Noise floor**: ≤ -60 dBFS RMS (ACX requirement)
- **Format**: 44.1 kHz / 16-bit / mono / MP3 192 kbps CBR

Plus head/tail silence per ACX spec (0.75s head, 3.0s tail).

### How to use

#### Master a chapter

1. Render the chapter via Generate or the chapter view.
2. Click **Master** → pick "ACX" from the preset list.
3. The output is an ACX-ready MP3.

#### Verify against ACX QC

1. **Analyze** → upload the mastered MP3.
2. The report shows: integrated LUFS, true peak, noise floor, clipping ratio, silence ratio.
3. Green if every value passes ACX spec, yellow if marginal, red if rejected.

> ACX has a free pre-submission QC tool. Use it to double-check before uploading. Our analyzer should match ACX's verdict bit-for-bit.

#### Other presets

- **iAudio** — Audible's internal "iAudiobook" spec (same as ACX, slightly different head silence)
- **Podcast** — -16 LUFS / -1 dBFS peak / stereo
- **YouTube** — -14 LUFS / -1 dBFS peak / stereo / 48 kHz

All four are operator-tunable via Settings → Mastering presets.

---

## 12. Effects chain — pedalboard

Per-voice or per-render post-process audio effects. 8 effect types:

- **Pitch shift** (±12 semitones)
- **Reverb** (room / damping / wet / dry / width)
- **Delay** (time / feedback / mix)
- **Chorus / Flanger** (rate / depth / feedback / centre / mix)
- **Compressor** (threshold / ratio / attack / release)
- **Gain** (-40 to +40 dB)
- **High-pass filter** (20–8000 Hz)
- **Low-pass filter** (200–20000 Hz)

4 built-in presets: Robotic, Radio, Echo Chamber, Deep Voice. Plus unlimited custom presets.

Implementation is first-party DSP in `server/justvoice/audio/dsp/` (numpy + scipy), with pitch shifting via Signalsmith Stretch (MIT). It replaced Spotify's pedalboard on 2026-07-29 — pedalboard is GPL-3.0 and was the only thing forcing the project to GPL.

### How to use

#### Apply to a single generation

1. Generate audio.
2. Click **Add effects** in the history row.
3. Pick a preset (or build a custom chain).
4. JustVoice creates a NEW version of the generation with effects applied. The original is preserved.

#### Bind to a voice (default chain)

1. **Voices** tab → row → **Default effects chain**.
2. Build a chain. Save.
3. Every generation with that voice gets these effects automatically.

#### Build a custom preset

1. **Effects** tab → **+ New preset**.
2. Add effects by drag-and-drop. Reorder by dragging. Toggle individual effects on/off without removing.
3. Save with a name.

#### Chain ordering matters

The chain is applied top-to-bottom. Convention: HP → compressor → EQ → reverb → gain. Try different orderings if the result sounds wrong.

---

## 13. Captures + dictation

**Captures** = recordings (live mic, system audio, or uploaded files). Used two ways:

1. **Dictation** — global hotkey → record → Whisper transcribes → optional LLM refinement → optional auto-paste into focused text field
2. **Voice cloning sample collection** — record yourself reading a paragraph → promote the recording to a voice sample on a cloned VoiceProfile

### Hotkeys

Two chord types:

- **Push-to-talk** (default `⌥⌘V`) — hold the keys, speak, release
- **Toggle** (default `⌥⌘D`) — tap to start, tap to stop

Change via **Settings** → **Captures** → **ChordPicker**. The chord picker captures live keypresses — press what you want, release, click Save.

### Refinement

When dictation lands, the raw Whisper output runs through a local Qwen3 LLM to refine:

- **Smart cleanup** — fix typos, remove "um"/"uh"
- **Self-correction** — "scratch that, I meant X" → keeps X, drops the rest
- **Preserve technical** — keep code names, API endpoints, proper nouns verbatim

All three toggleable in Settings → Captures.

### Auto-paste

After refinement, the cleaned text is auto-pasted into whichever text field had focus when you pressed the chord. Requires macOS Accessibility permission. Toggle in Settings.

### Permission gates (macOS)

Two macOS TCC checks:

- **Accessibility** — needed for synthetic paste. Settings → Captures shows a deep-link to System Settings if missing.
- **Input Monitoring** — needed for the global hotkey. Same pattern.

Both gates render inline notices on the relevant settings page when missing. Clicking the link opens System Settings to the right pane.

### System audio capture

Some platforms (Windows wasapi-loopback, macOS ScreenCaptureKit 13+) can capture system audio (e.g. a YouTube video playing). Use it for:

- Cloning a voice from a podcast clip
- Transcribing meeting recordings
- Capturing reference audio without re-recording

### Dictation readiness checklist

Six gates that must be green before the chord can start recording:

1. Mic permission
2. Accessibility permission (Mac)
3. Input monitoring permission (Mac)
4. STT model loaded (Whisper)
5. LLM model loaded (Qwen3 for refinement; only needed if auto-refine is on)
6. Hotkey enabled toggle

The Captures settings page renders this checklist with deep-links for each missing gate.

---

## 14. Stories — the multi-track timeline editor

Voicebox's signature feature, ported to JustVoice. A **Story** is a multi-track DAW-shaped timeline. Each clip references a Generation (or a specific GenerationVersion) and has a start time, track index, trim, and volume.

Use cases:

- Podcast assembly (multi-character dialogue with overlapping clips)
- Game dialogue arrangement (NPC line scheduling)
- Per-chapter multi-voice mix (one track per character)

Not the audiobook workflow — audiobook uses the Chapters tab (linear paragraphs). Stories is for non-linear assembly.

### How to use

1. **Stories** tab → **+ New story**.
2. Drag a Generation from the history pane onto the timeline.
3. Position the clip in the timeline. Set its track (0 = top track, 1 = below, etc.).
4. Trim the start / end by dragging the clip edges.
5. Adjust volume per clip.
6. Pin a specific take per clip via the version dropdown.
7. Play the timeline with spacebar.
8. Export the entire story as a single concatenated WAV.

### Web Audio API playback

Stories use the browser's Web Audio API for sample-accurate multi-track playback. Overlapping clips on different tracks mix in real time.

---

## 15. Audio output channels — multi-device routing

A **Channel** is a named audio output config that maps to one or more OS device IDs. Use cases:

- **Streaming**: route the narrator voice to OBS virtual mic, secondary characters to default
- **Multi-monitor**: voice A to your laptop speakers, voice B to your studio monitors
- **Per-character podcast monitoring**: each character on a separate output so the engineer can adjust them independently

Voice profiles assigned to channels with non-default device IDs use native playback (via Tauri IPC). Profiles without channel assignments use the default browser audio output.

### How to use

1. **Settings** → **Audio channels** → **+ New channel**.
2. Name it ("OBS virtual mic" / "Studio monitors").
3. Pick device IDs from the OS audio output list.
4. Save.
5. **Voices** tab → row → **Channels** column → assign channels to specific voice profiles.

Channels can broadcast to multiple devices simultaneously (e.g. play through both speakers AND the OBS mic).

---

## 16. MCP server — agents and Unreal Engine

JustVoice exposes a Model Context Protocol (MCP) server at `/mcp` with 6 tools. Use to:

- Let Claude / Cursor / other agents speak in your voice
- Let Unreal Engine call JustVoice from inside game scripts
- Let any MCP-compliant tool integrate without a custom HTTP client

### Tools

| Tool | Args | Returns |
|---|---|---|
| `justvoice.speak` | text, profile?, engine?, personality?, language? | generation_id |
| `justvoice.transcribe` | audio_base64 OR audio_path (loopback-only), language?, model? | text + timing |
| `justvoice.list_voices` | limit, offset | array of voice profiles |
| `justvoice.list_personas` | limit, offset | array of personas |
| `justvoice.list_captures` | limit, offset | recent transcripts |
| `justvoice.render_block` | block_id, voice_profile?, engine? | generation_id |

### Per-client bindings

Each MCP client identifies itself with an `X-JustVoice-Client-Id` header (e.g. `claude-code`, `cursor`, `unreal-editor`). For each client you can configure:

- Default voice profile
- Default `personality_enabled` flag
- Default engine override

So "Unreal NPCs always use Chatterbox with persona" is one-time config, not per-call.

### Install snippets

Settings → MCP shows ready-to-paste install snippets:

#### Claude Desktop / claude-code

```json
{
  "mcpServers": {
    "justvoice": {
      "url": "http://localhost:17494/mcp",
      "headers": { "X-JustVoice-Client-Id": "claude-code" }
    }
  }
}
```

#### Stdio shim (for older MCP clients)

```json
{
  "mcpServers": {
    "justvoice": {
      "command": "/Applications/JustVoice.app/Contents/MacOS/justvoice-mcp",
      "env": { "JUSTVOICE_CLIENT_ID": "claude-code" }
    }
  }
}
```

(Windows + Linux paths shown live in Settings → MCP.)

### Security gate

`justvoice.transcribe` with `audio_path` is **loopback-only** — prevents a 0.0.0.0-bound server from becoming an arbitrary-file-read primitive. Remote callers must base64-encode the audio.

---

## 17. Webhooks — async event notifications

Server-pushed event notifications for integration with CI pipelines, JustWrite, custom scripts. Subscribe to one or more events:

- `render.completed` / `render.failed`
- `generation.created`
- `voice.created`
- `training.completed` / `training.failed`
- `model.download.completed` / `model.download.failed`

### How to use

#### Register a webhook

1. **Settings** → **Webhooks** → **+ Add subscription**.
2. URL (HTTPS recommended), pick events, optional secret (auto-generated if omitted).
3. JustVoice returns the secret ONCE on creation — save it.

#### Verify delivery

JustVoice signs every POST with `X-JustVoice-Signature: hex(hmac_sha256(secret, body))`. Verify in your receiver:

```python
import hmac, hashlib
sig = request.headers["X-JustVoice-Signature"]
expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
if not hmac.compare_digest(sig, expected):
    return 401
```

#### Delivery semantics

At-least-once, exponential backoff (1s, 5s, 30s, 5m, max 3 retries). Receivers should be idempotent — check the `generation_id` / `render_job_id` in the payload to dedupe.

#### Test before going live

Settings → Webhooks → row → **Test**. Fires a synthetic `webhook.test` event with a `ping: timestamp` payload. 10-second timeout, surfaces status code + latency + error.

---

## 18. Backup, restore, project export

Three distinct workflows; don't confuse them.

### `/v1/backup` — whole-server disaster recovery

A complete server-state ZIP: settings.json + SQLite DB + audio blobs + voice samples + adapters + project files. Use when:

- Migrating to a new machine
- Disaster recovery (SSD died)
- Before a major upgrade

Settings → System → **Download backup**. Includes generations by default; flip the toggle if you only want config + DB without audio.

### `/v1/restore` — reverse of backup

Settings → System → **Restore from backup** → pick a `.zip`.

- **Replace mode**: nukes existing rows + audio, restores fresh
- **Merge mode**: upserts by id, skips conflicts

`confirm=false` returns a dry-run summary BEFORE touching state. Inspect the manifest, then confirm.

Schema version is checked. A `v2` backup can't restore into a `v1` server (a clean error, not a corruption).

### `/v1/projects/{id}/export` — per-project ZIP

Just one project's data: Project + Scenes + Blocks + Cast (personas + voices) + lexicons + default-take audio per block + masters.

Use when:

- Handing off a finished audiobook to the author for review (cast + audio included)
- Moving a book between machines (your studio desktop ↔ travel laptop)
- Archiving a completed book

Books tab → project → **Export ZIP**.

---

## 19. System tray + keep-server-running

### Tray icon

Right-click the JustVoice tray icon for the full menu:

- 📺 Show window / 🔵 Hide window
- 🖥 Server submenu: ▶️ Start / ⏹ Stop / 🔄 Restart
- 🎙️ Start dictation
- 🎚️ MCP server: toggle
- ⚙️ Open settings
- 📋 Copy server URL (useful for headless / remote access)
- 📜 Open log file
- ℹ️ About
- 🚪 Quit

Left-click toggles window visibility.

### Keep server running on close

Settings → General → **Keep server running when app closes**.

When ON:

- Closing the main window minimizes to tray instead of quitting
- The Python sidecar stays alive (no in-flight generations get killed)
- The tray icon stays — click to bring the window back

When OFF (default):

- Closing the window quits the app and kills the sidecar
- All in-flight generations are cancelled

Pair with the tray for the "leave it running overnight rendering a 10-hour book" workflow.

### Network access mode

Settings → General → **Network access (local vs remote)**.

- **Local** (default): server binds 127.0.0.1 — only this machine can reach it
- **Remote**: server binds 0.0.0.0 — any machine on your LAN can hit the UI + API

Use Remote when running JustVoice on a beefier desktop and accessing the UI from a laptop browser. **Set a bearer token** in auth before enabling.

---

## 20. Settings — every knob in one place

Settings has 8 sub-pages:

1. **General** — server URL, keep-running, network mode, theme (light/dark/system), language
2. **Generation** — max_chunk_chars (chunking threshold), crossfade_ms, normalize audio, autoplay on generate, open generations folder
3. **Captures** — hotkeys (push-to-talk + toggle), STT model, language, auto-refine, LLM model, refinement flags (smart cleanup / self-correction / preserve technical), allow auto-paste, default playback voice
4. **MCP** — install snippets, per-client bindings table, tools sidebar
5. **GPU** — live GPU info card, CUDA wheel download, backend variant
6. **Logs** — server log streaming, scroll-to-bottom, clear, log level
7. **Changelog** — rendered CHANGELOG.md
8. **About** — version, contributors, GitHub, third-party licenses

Every numeric value in Settings is **operator-tunable per CLAUDE.md "no hardcoded operator-tunable values" rule**.

---

## 21. JustWrite integration end-to-end

See `docs/plans/archive/PHASE5_JUSTWRITE_INTEGRATION.md` for the integration-engineer guide. User-facing flow:

1. Author writes novel in JustWrite.
2. JustWrite identifies characters automatically (via `speakerAttribution.js`).
3. Author clicks **Render audiobook** in JustWrite's Studio tab.
4. JustWrite imports the book into JustVoice (`POST /v1/projects/import?source=justwrite`).
5. For each chapter, JustWrite kicks off a render job. Progress shows in JustWrite's UI via SSE.
6. JustVoice renders + masters each chapter to ACX spec.
7. JustWrite collects per-chapter mastered WAVs.
8. JustWrite's `m4b.js` (FFmpeg.wasm) muxes the WAVs into an M4B with chapter markers.
9. JustWrite surfaces the M4B for ACX upload.

The split: JustWrite owns the manuscript + cast + final M4B mux. JustVoice owns the engine pool + ACX mastering + take versioning. They talk over HTTP per `CONTRACT.md`.

---

## 22. Unreal Engine integration

Out-of-the-box workflow (no plugin required):

1. Create a project of type `game_voicelines` in JustVoice.
2. For each NPC, create a Persona with bio + voice.
3. Import or hand-enter NPC lines as Scene → Block rows.
4. Render the whole project.
5. Export per-project ZIP — contains `audio/<scene>/<block>.wav` plus a JSON manifest.
6. Drag the WAVs into your Unreal Content/Audio/Dialogue/ folder. Unreal auto-imports them as `USoundWave`.

Future (Phase 6+): a UE5 `.uplugin` that calls JustVoice's HTTP API directly from inside the Unreal editor, writes USoundWave assets, and optionally generates Wwise SoundBanks. The endpoints are ready (`GET /v1/unreal/voicelines/{project_id}.zip` deferred); the plugin scaffolding is a separate repo.

MCP integration for game-dev tooling:

```python
# From any MCP-aware agent (Claude Desktop, Cursor, etc.) configured to talk to JustVoice:
result = await mcp.call("justvoice.render_block", {
  "block_id": "block-uuid-here",
  "voice_profile": "Old Crow",
  "engine": "chatterbox",
})
# Returns the generation_id. Audio lands at /audio/{gen_id} on the JustVoice server.
```

---

## 23. Troubleshooting

### "No engines listed" / GUI shows empty

Stale Python sidecar squatting on port 17494. The Tauri shell evicts stale listeners on startup (kills any LISTENING process on the port). If it's stuck:

- Open Task Manager / Activity Monitor
- Find `justvoice-server` or `python` listening on 17494
- Kill it manually
- Restart JustVoice

### Generations fail with "engine failed to load"

Engine model isn't downloaded yet. Engines tab → row → **Install**. Wait for the download progress to complete.

### Mac dictation hotkey doesn't fire

Missing Accessibility or Input Monitoring permission. Settings → Captures → click the deep-link buttons next to the missing gates. Grant in System Settings → restart JustVoice.

### "Server unreachable" toast

Bearer token mismatch — check Settings → Connection → bearer token matches what the server is configured for. Or: server died (check the Logs page).

### CUDA not detected even with NVIDIA card

torch installed CPU-only (the default installer baseline). Go to **Settings** → **GPU** → **Install CUDA support**. Pick cu124 or cu128 (cu128 only for newer cards). Server restarts automatically.

### ACX rejection on a chapter

Run the chapter through **Analyze**. If LUFS is outside -23/-18, RMS too high, or peaks above -3 dBFS, the mastering preset's `loudness_target_lufs` / `true_peak_dbfs` may be drifting due to engine output variance. Adjust the preset to give more headroom (try `true_peak_dbfs=-4.0`) and re-master.

### Long-form generation cuts off mid-sentence

The engine has a token limit (Dia at 1024 tokens by default cuts a long paragraph). JustVoice's chunking should prevent this — but if it doesn't, lower `settings.generation.max_chunk_chars` in Settings → Generation. Default 800; try 400 for engines with tight limits.

### Voice cloning produces wrong-voice output

If using MLX (Apple Silicon), there's a known upstream bug where MLX silently falls back to the default voice on cloning failure. JustVoice raises an explicit error in this path. If you see it, file an issue.

### Effects don't apply

The chain might be applied as a NEW version, not in-place. Check the History tab — the generation row should have a versions submenu showing the original + the effected version. Pick "set as default" on the effected version to make it the canonical one.

### "Recording too short, canceled" on dictation

Whisper needs at least ~500ms of audio. Hold the push-to-talk chord for longer, or speak immediately when you press.
