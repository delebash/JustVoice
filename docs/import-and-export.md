<!-- SPDX-License-Identifier: MIT -->

# Import & export

Everything that crosses JustVoice's edge: how source material gets **in**
(a multi-adapter import pipeline that normalizes every format into one
standard schema) and how finished audio gets **out** (WAV, M4B audiobooks,
game-dev ZIP bundles, full project archives).

## Importing

JustVoice ingests source material through a multi-adapter pipeline.
Every adapter normalizes its native format into the **JustVoice import
standard schema**, which is what the rest of the server stores and
renders against. This section explains the schema, every shipping
adapter, and how to write your own.

The runtime registry is the source of truth — `GET /v1/projects/import/adapters` returns the live list with file extensions, descriptions, and whether each adapter is implemented.

### Endpoint summary

- `GET /v1/projects/import/adapters` — list available adapters.
- `POST /v1/projects/import` — multipart form upload. Fields: `source`
  (adapter id), `file` (the file), `dry_run` (optional boolean string), and New project's
  `name`, `project_type` and `language` (optional — they win over what the file says; a
  re-import with `project_id` ignores them).
- Backwards-compat: `POST /v1/projects/import?source=<id>&dry_run=true`
  with the raw body still works for the existing JustWrite integration.

A successful response carries a `StandardImport` payload (see schema
below) plus `committed`, `project_id`, and any non-fatal `warnings`.

---

### <a id="import-standard"></a>The JustVoice import standard schema

The shape every adapter produces. `schema_version` is bumped on
incompatible changes.

```json
{
  "schema_version": "1.0",
  "source": "<adapter id>",
  "project": {
    "id": null,
    "name": "Project name",
    "kind": "audiobook | game_voicelines | podcast | custom",
    "description": null,
    "language": "en-US"
  },
  "characters": [
    { "id": "narr", "name": "Narrator", "voice_hint": "warm baritone", "notes": null }
  ],
  "scenes": [
    {
      "id": "chapter-1",
      "title": "Departure",
      "kind": "chapter | scene | cue_sheet | label_track | …",
      "lines": [
        {
          "character_id": "narr",
          "text": "It began at dawn.",
          "delivery": { "emotion": "neutral", "speed": 1.0 },
          "pause_after_ms": 400,
          "source_ref": "chapter:ch1#line:0"
        }
      ]
    }
  ],
  "lexicon_entries": [
    { "grapheme": "Caoimhe", "phoneme_ipa": "ˈkiːvə", "alias": null }
  ],
  "warnings": []
}
```

`project.kind` decides which use-case UI surface the GUI mounts when
the project opens (audiobook chapter view, game voiceline table,
podcast timeline, …). `character_id` is optional — adapters can emit
lines without a speaker (e.g. SRT cues with no `SPEAKER:` prefix).

`characters` is the schema's word for the people the source names. On commit
each one becomes a **speaker** in the new book — a name, its aliases as **Also
called**, and `notes` plus `voice_hint` as **Who they are** — and each line
points at its speaker. An import creates **no personas**: a speaker whose name is
exactly the name of a persona in your library arrives already cast with it, and
the rest wait for one in [Studio → Cast](studio.md#cast). Two people with one
name in the source stay two speakers.

---

### <a id="import-justwrite"></a>JustWrite book (`justwrite`)

JustWrite is the primary integration partner, and the handoff is a **file**, not a
live connection between the two apps. In JustWrite, open the book and export it —
the `.zip` card on the **Export** page, or the same button in **Settings**. You
get one `<Book Title>.zip`. Drop that here.

**Why a zip when it's really just JSON.** Unzipped, it holds `book.json` — the
entire book as structured data, with parts, chapters and scenes as separate
records — next to an `images/` folder. The zip exists for those images:
JustWrite keeps picture bytes inside its own database, so a plain JSON file could
not carry them to another machine. JustVoice reads `book.json` and ignores the
images, telling you in the import warnings how many it skipped. If you already
unzipped the file, a bare `book.json` imports too.

**What comes across**

- **Chapters**, in the book's own order, each becoming one JustVoice scene — the unit you analyze and render. Chapter titles come with them; a chapter without one
  is named for its number.
- **The prose**, paragraph by paragraph. Where JustWrite splits a chapter into
  scenes, the paragraphs stay in order and remember which scene they came from.
  Bold and italics flatten to plain text, which is what a voice engine reads. The
  `* * *` scene marks you see in JustWrite are never spoken — they are drawn on
  screen between scenes, not stored in the text. Where one scene ends, the
  chapter pauses for **Pause at a scene break** (Settings → Generation pipeline,
  2 seconds by default — see [Studio → Render](studio.md#render)).
- **The speakers.** Every person in the book becomes a speaker in this book,
  carrying its name, its aliases as **Also called**, its pronouns as
  **Pronouns** (he/him, she/her, they/them or it/its; anything else is left
  unset), and a **Who they are** built from the one-line description and a
  casting hint from gender, age and role.
  Aliases earn their place: the same person gets addressed by different names
  through the prose, and attribution has to recognise every one of them.

  A speaker is a person, not a voice, so nothing here decides how anyone sounds:
  "female, age 34, protagonist" tells you which persona to give them, not how to perform. A
  speaker whose name is exactly a persona in your library arrives cast with that
  persona; everyone else gets one in [Studio → Cast](studio.md#cast). The import
  creates no personas. A book with its own "Narrator" makes that speaker the
  narrator; a book without one gets none. See [Personas](personas.md).

**What does not come across, and why**

- **Who speaks each line.** JustWrite never tags dialogue with a speaker, so every
  line arrives unassigned. That is the normal result, not a problem to fix during
  import — finding speakers is a separate step you run when you are ready, from
  **Studio → Script**.
- **Pronunciations.** A JustWrite book has no pronunciation list, so the project
  starts without a lexicon. Build one under **Lexicons** for the names your engine
  gets wrong — people's and place names are the usual offenders.
- **Scene titles.** JustWrite's per-scene titles are planning labels ("Sarah
  confronts him"), not published prose, so they are not narrated.
- **Everything else in the file** — plot strands, notes, worldbuilding, statuses,
  JustWrite's own AI results, deleted items. JustVoice takes prose and speakers.

**Empty chapters are skipped**, and the warning names them, so an outlined but
unwritten chapter does not become a silent scene. To leave more out, use the
per-chapter checkboxes on the import review screen before committing.

**A file that can't be read is refused with the reason.** A damaged zip says
*zip file is damaged* — export the book from JustWrite again. A `book.json` whose
fields have the wrong type names the field, for example *book.json is malformed —
'characters' must be a list*.

---

### <a id="import-book_prose"></a>Book / manuscript (`book_prose`)

EPUB, DOCX, Markdown, or plain text — the audiobook entry point for any
finished book. Stdlib-only parsing (works headless, no optional deps).

- **EPUB** — chapters follow the spine; chapter title = first `<h1>`–`<h3>`
  in each document; nav/cover and near-empty front-matter docs are skipped
  (each skip is reported in `warnings`). Title/author/language come from
  the OPF metadata.
- **DOCX** — `Heading 1/2/3` paragraph styles start a new chapter; title
  from `docProps/core.xml` when present, else the file name.
- **Markdown** — `#`/`##`/`###` headings start chapters.
- **TXT** — short `Chapter N` / `Part N` lines start chapters; otherwise
  the whole file becomes one scene.

A file that can't be read is refused with the reason: a damaged zip says
*zip file is damaged*, and an `.epub` missing its parts names the missing file
(*EPUB has no META-INF/container.xml*). Re-download or re-export the book.

Every paragraph becomes one `line` with `character_id: null` — prose
carries no speaker data. The book's speakers are found later by
**Studio → Discover**, whose **＋ Add** makes each one a speaker in the book,
and **Studio → Script** gives lines to them (see [Studio](studio.md)).

**Chapter-split strategy** — the import-review page's "Split on"
selector (form field `split_on`, also accepted by the API directly):

| Mode | Behavior |
|---|---|
| `auto` (default) | The per-format rules above. |
| `h1` | Split only on level-1 headings. For EPUB the whole spine is merged first, then re-split at `<h1>` — fixes books that ship every chapter in one spine document. Deeper headings stay in the text. |
| `h1_h2` | Split on level-1 AND level-2 headings (same merge for EPUB). |
| `none` | No splitting — the whole book lands as one chapter. |

Plain text has no heading levels: `h1`/`h1_h2` fall back to `auto` with
a warning; `none` works. Changing the selector re-runs the dry run.

### <a id="import-podcast_markdown"></a>Podcast script (`podcast_markdown`)

Speaker-labeled markdown/text — the podcast way-in. `SARAH:` /
`**JIN:**` / `[MAVE]:` at paragraph start name the speaker (short
ALL-CAPS or Title-Case labels only — prose sentences with colons are
left alone); unlabeled paragraphs continue the current speaker.
`## headings` split segments into scenes; `— marker —` / `---` lines
import as unattributed marker lines (`delivery.marker=true`).
Paralinguistic tags like `[laughs]` stay in the text, and an engine that
lists the tag performs it; every other engine has it removed before rendering,
never read aloud (no engine on the speech runtime takes tags yet). Each label becomes one of the episode's speakers at commit.

### <a id="import-csv_lines"></a>CSV lines (`csv_lines`)

For studios who track dialogue in a spreadsheet. UTF-8 with header row
(case-insensitive):

```csv
scene,character,text,delivery,pause_after_ms
village,Guard,"Halt! Who goes there?","{""emotion"":""angry""}",250
village,Hero,A traveller.,,500
forest,Hero,The trees are thick here.,,
```

- Only `text` is mandatory.
- `scene` groups rows into a `StandardScene` (default `default`).
- `character` names the line's speaker: it is slugged into an id and reused
  across rows, so each name becomes one speaker in the project.
- `delivery` is parsed as JSON if it looks like JSON, otherwise stored
  as `{"instruct": "<raw string>"}`.
- `pause_after_ms` is parsed as an integer; ignored if non-numeric.
- Project kind defaults to `game_voicelines`.
- Any line ends work: Windows, Unix and old Mac (a carriage return alone).
- A field longer than 131,072 characters is refused with the reason:
  *not a readable CSV file — a field is longer than 131,072 characters*.

---

### <a id="import-srt"></a>SubRip subtitles (`srt`)

Drop a `.srt` cue sheet:

```srt
1
00:00:01,000 --> 00:00:04,000
NARRATOR: The story begins.

2
00:00:05,500 --> 00:00:08,000
ALICE: Hello? Anyone there?

3
00:00:10,000 --> 00:00:12,000
An unattributed line.
```

- One cue becomes one `StandardLine`.
- A leading `SPEAKER:` (uppercase, up to 40 chars) is lifted into a
  `StandardCharacter` — a speaker in the project — and stripped from the text.
- `pause_after_ms` on a line is the gap between its cue's end and the
  next cue's start (so the rendered chapter preserves the original
  pacing).
- Project kind defaults to `custom`.

---

### <a id="import-audacity_labels"></a>Audacity label track (`audacity_labels`)

Audacity exports label tracks as a tab-separated file:

```
0.000000	1.500000	Intro music fades
2.000000	4.250000	Narrator opens the scene
5.000000	7.000000	Nettle speaks
```

- Two-column form (point labels: `time<TAB>label`) is also accepted.
- Audacity's frequency-bound continuation rows (starting with `\`)
  are skipped.
- `pause_after_ms` is the gap between the current label's end and the
  next label's start.
- Project kind defaults to `custom`.

---

### <a id="import-standard-json"></a>JustVoice standard JSON (`justvoice_standard`)

Pass-through for payloads already in the standard schema shape — most
useful for re-importing previously exported projects, hand-authored
pipelines, or adapter chaining. The body is validated against the
Pydantic model; mismatches surface as `400` with a field-level message.

If the inbound `schema_version` differs from the server's, a warning is
appended to the response but the import still runs.

---

### Importing from another TTS tool

There is no adapter for ElevenLabs Studio, Resemble, Speechify, Murf, Coqui or
OpenVoice yet. A stub for ElevenLabs used to appear in the format list and
answer every file with an error; it was removed in August 2026 rather than left
sitting in the menu — the list only offers formats that actually import.

If you have a project in one of those tools, the route today is to export its
script as CSV or a speaker-labeled markdown file and use those adapters.

---

### Writing your own adapter

1. Create `server/justvoice/imports/adapters/<your_source>.py`. Export
   `SOURCE_ID` (snake_case string) and `parse(raw: bytes, *, filename:
   str | None = None) -> StandardImport`. Raise `bad_request(...)` on
   any parse error so the server surfaces RFC 7807 problem-details.

2. Register it in `server/justvoice/imports/__init__.py` by appending a
   `(AdapterInfo(...), parse)` tuple to `_ADAPTER_REGISTRY`. Set
   `docs_anchor` to a stable id you'll use as a section anchor in
   this document — the GUI passes it through `data-help-key` for the
   future help-bus integration.

3. Add a test class to `server/tests/test_projects.py` mirroring the
   shipped ones — exercise a representative payload through the
   `/v1/projects/import` endpoint, assert the resulting `standard`
   shape, and commit at least one round-trip through
   `committed=true` so the project store records it.

4. Add a `### <a id="import-<source>"></a>` section to this document
   with the input shape, an example, and any nuances.

That's it — no further wiring needed. The adapter is automatically
listed in `GET /v1/projects/import/adapters`, in New project's table of sources, and in the
re-import picker.

---

### The import review page

Every import lands on a review page before anything is written — a dry run you
can steer. Change the **split strategy** and the dry run re-runs so you see the
chapter boundaries move; untick chapters you don't want; if speaker information
turns up mid-review, a banner surfaces it. Nothing exists until **Commit** — an
import you abandon leaves no trace.

## Exporting

JustVoice produces audio in three shapes, depending on what you're doing with it:

| Format | What it is | Use case |
|---|---|---|
| **WAV** | Single uncompressed audio file | One-line renders, podcast intros, game dialogue lines |
| **M4B** | Audiobook container with chapter markers | ACX submission, audiobook distribution |
| **ZIP** | Bundle of per-block WAVs + manifest.json | Game-dev workflows, archival, hand-off to a DAW |

### Single render → WAV

In the app, a persona's **Hear it** plays a typed line in place, and **⤓ WAV**
saves it. Over the API, every `/v1/generate` call returns `audio/wav`:
`curl -X POST -H "Content-Type: application/json" -d '...' /v1/generate > out.wav`.

`/v1/generate` takes:

| Field | What it is |
|---|---|
| `text` | the line |
| `voice` | the voice id |
| `persona_id` | optional — speaks it as that persona (its delivery, lexicon and effects) |
| `seed` | optional |
| `delivery.speed / pitch / gain_db / temperature / pause_before / pause_after` | the numbers, over the persona's |
| `delivery.instruct` | a written direction (models that take one) |
| `delivery.emotion` | folded into the instruction for Qwen3 CustomVoice and VoiceDesign |
| `delivery.engine.{key}` | a model's own knobs |
| `lexicons` | `["lexicon id", …]` |
| `[tags]` inline in `text` | kept only for a model that lists them; any other `[tag]` is removed before rendering |

### Chapter render → mastered WAV

Chapter renders apply mastering before emitting WAV, and you don't choose the
target per render — it is the project's, else the project kind's (see
[mastering.md](mastering.md#which-preset-a-render-uses)):

- **ACX** — -20.0 LUFS, true peak -3.5 dBFS: centred inside Audible's
  -23…-18 LUFS window with headroom against re-encoding overshoot
- **iAudio** — -19.0 LUFS, -3.0 dBFS
- **Podcast** — -16.0 LUFS, -1.0 dBFS
- **YouTube** — -14.0 LUFS, -1.0 dBFS
- **None** — raw concatenation, no mastering (game voicelines default to this)

The render returns **WAV** with the processing applied; the preset's encoded
format is what Export produces. The chapter tab's **Render → Export → WAV**
action emits one mastered WAV per chapter.

### Audiobook → M4B

M4B assembly happens **on the JustVoice server**, no other app involved.

**In the app** (Studio → Export → **⬇ Export M4B**, since 2026-10-07): a strip under the buttons
follows it — *Chapter 2 of 4 · Bigger Inside* as each chapter is joined and mastered, then
*Encoding the book* — with **Cancel**, which stops after the chapter it is on. When the file is
made, a **Save** dialog asks where to put it and what to call it (the book's title is filled
in); the message after says where it went, with **Open folder**. Cancel the dialog and it says
nothing was saved. (Until then the app saved nothing in the desktop window — the window
ignores a browser-style download — and said "M4B exported." anyway.)

**⬇ Chapter WAVs (zip)** runs the same way, with the same strip, and saves a zip with two
folders: `chapters/` — each chapter joined from its lines' takes in use (`01 Brass Rank.wav`)
— and `masters/` — the same chapters mastered to the book's target, the audio the M4B is made
from. (Until 2026-10-07 this button saved the project package instead — the book's data and
each line's take — which is what Overview's project export is for.) A chapter that can't
render stops it and says why, as the M4B does.

**For other callers:** `POST /v1/projects/{project_id}/export_m4b/start` starts the job;
`GET /v1/export_jobs/{id}` says `{status, done, total, step}`; `POST /v1/export_jobs/{id}/cancel`
stops it between chapters; `GET /v1/export_jobs/{id}/file` hands over the finished `.m4b` once.
`POST /v1/projects/{project_id}/export_m4b` still does it all in one request and returns the
`.m4b`. The chapter audio: `POST /v1/projects/{project_id}/export_chapters/start`, then the same
`/v1/export_jobs/{id}` doors.

1. `assemble_project()` renders every scene through the **production render path** (the same
   scene resolution and `render_core` the Studio Render tab uses), so the exported book sounds
   exactly like what you previewed.
2. One `ffmpeg` invocation muxes it: the chapter WAVs go through the concat demuxer, an
   FFMETADATA file supplies the chapter marks, and `-f ipod` writes the M4B container at
   `aac 128k`.
3. Title comes from the project name; author is read from the project description when it starts
   with `by `.
4. Download → upload to ACX.

**ffmpeg must be on the server's PATH.** Without it the endpoint returns `503` with
`"ffmpeg is not installed — required for M4B export"` rather than failing silently. This is the
same ffmpeg [mastering](mastering.md) requires.

Cover art and narrator/ASIN metadata are **not** written today — add them in a tag editor
(MP3Tag, Audiobook Builder) if your distributor wants them.

> JustWrite does not touch audio at all. Earlier versions of this page described client-side
> muxing in JustWrite via `services/m4b.js` and FFmpeg.wasm — that has not been true since audio
> moved wholly into JustVoice, and no such code remains in JustWrite.

### Game-dev → ZIP bundle

For game dialogue, the voicelines export packages:
- One WAV per line, named by its stable line id and grouped into a folder per scene
- A `manifest.json` listing each WAV's metadata — one entry per line, with these
  fields (`speaker` is the line's speaker by name, `null` for a line with none;
  until 2026-09-29 this key was `character`):
  ```json
  {
    "line_id": "s01_l001",
    "scene": "tavern",
    "speaker": "Shopkeeper",
    "text": "Welcome, traveler. What'll it be?",
    "file": "tavern/s01_l001.wav",
    "duration_s": 2.4,
    "text_hash": "9f2a…"
  }
  ```

There are **no per-line JSON sidecar files** — the aggregate `manifest.json` is
the only metadata artifact today. (A richer per-line sidecar for engine
importers is a tracked idea, not a shipped feature.)

Unreal / Unity integration plans: an `.uplugin` (Unreal) and `.unitypackage` (Unity) will consume this manifest format directly. Until those ship, write a small script in your engine to read manifest.json + load the WAVs as `USoundWave` / `AudioClip` assets.

#### Whole project → voiceline ZIP

`POST /v1/projects/{project_id}/export_voicelines` does the same thing for an entire project
rather than one chapter, and downloads as `<project>_VO.zip`.

- **One WAV per line**, named by its stable line id and grouped into a folder per scene, so the
  archive stays diffable across re-exports — the same line keeps the same path.
- **`manifest.json`** alongside, in the format above.
- Every line is rendered through the **production render path** (`render_core.render_line` with
  the voice, delivery, effects and lexicon of the persona that plays the line's speaker, after
  the project's own pronunciation lexicon), so the export matches what the Studio Render tab
  produced. It is not a separate, drifting code path.
- A line nobody voices stops the export — no speaker, a speaker with no persona, or a persona
  with no voice — with `line <id> has no voice (…) — give every speaker a persona with a voice
  before exporting`.

Stable ids are what make this useful in a game pipeline: re-export after editing three lines and
only those three files change, so your engine's asset diff stays small. That is also why
[re-import](#import-csv_lines) rejects rows without a stable id — positional `row:N` fallbacks
would silently mismatch every line the moment the sheet was reordered.

### Project export (full project archive)

Studio → Overview → **📦 Export .justvoice.zip** (under *Also from here*) saves the project as one `<name>.justvoice.zip` archive:
- All chapters' rendered WAVs
- All takes (not just defaults — full history for re-roll archaeology)
- The project's full SQLite snapshot
- The book's speakers (`speakers/<id>.json` — name, Also called, Pronouns, Who they are, the
  persona that plays them, the narrator role) and the personas that play them (`personas/<id>.json`);
  the archive's `manifest.json` counts both (`speaker_count`, `persona_count`)
- Lexicons used

Useful for archiving a finished book, or handing its audio and script to someone. **Nothing imports it back yet** — there is no "open a .justvoice.zip" in JustVoice; the archive is a backup you can unzip. Importing it is in the backlog.

### Single take → ZIP (with effects history)

Per-take ZIP export (endpoint exists but not yet exposed in the UI): bundles the take's audio + every effects-applied version + a manifest with the lineage. Useful for handing a take to a sound designer.

API: per-line files ride the project voicelines export (`/v1/projects/{id}/export_voicelines`).

### Mastered audio direct from API

For agents / scripts driving JustVoice via MCP:
- `POST /v1/master` — apply a mastering preset to bytes you supply
- `POST /v1/analyze` — get LUFS / peak / noise floor report on bytes

Useful for masking JustVoice-produced audio without re-rendering.

## Voice bundles

A voice travels as one file: `GET /v1/voices/{id}/bundle.zip` exports it,
`POST /v1/voices/bundle` imports it on any install. The bundle carries
what the voice *is*: a cloned or imported voice brings its reference
clip (and can re-clone on any cloning engine), a designed voice brings
its description, a blended voice brings its mixed vector (Kokoro-only —
the numbers only mean something to the engine that mixed them).
Importing refuses, with the reason, anything that could not render:
a clip voice without its clip, or a voice whose engine this install
doesn't have.

## Troubleshooting

- **M4B export fails with 503** — ffmpeg is not on the server's PATH. Install it and restart the server; the same binary powers [mastering](mastering.md).
- **M4B is missing chapter markers** — chapters come from the FFMETADATA file `mux_m4b()` writes, one entry per assembled chapter. A project whose scenes have not been rendered produces no chapters; render first, then export.
- **WAV plays at wrong speed** — Mismatched sample rate. Check the engine's output rate vs the destination application's expected rate. Every local engine — Kokoro, Qwen3-TTS, Chatterbox — renders at 24 kHz on the speech runtime; an online provider may differ.
- **Mastered audio is silent at the start** — A bug in the mastering normalize step. Try the "iAudio" target instead of ACX; iAudio's threshold is gentler.
- **ZIP export is huge** — Overview's project export holds each line's take in use, unmastered; `GET /v1/projects/{id}/export?include_audio=false` leaves the audio out. Mastered chapters are Export's ⬇ Chapter WAVs (zip), not the project export.
