<!-- SPDX-License-Identifier: MIT -->

# Import formats

JustVoice ingests source material through a multi-adapter pipeline.
Every adapter normalizes its native format into the **JustVoice import
standard schema**, which is what the rest of the server stores and
renders against. This document explains the schema, every shipping
adapter, and how to write your own.

The runtime registry is the source of truth — `GET /v1/projects/import/adapters` returns the live list with file extensions, descriptions, and whether each adapter is implemented.

## Endpoint summary

- `GET /v1/projects/import/adapters` — list available adapters.
- `POST /v1/projects/import` — multipart form upload. Fields: `source`
  (adapter id), `file` (the file), `dry_run` (optional boolean string).
- Backwards-compat: `POST /v1/projects/import?source=<id>&dry_run=true`
  with the raw body still works for the existing JustWrite integration.

A successful response carries a `StandardImport` payload (see schema
below) plus `committed`, `project_id`, and any non-fatal `warnings`.

---

## <a id="import-standard"></a>The JustVoice import standard schema

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

---

## <a id="import-justwrite"></a>JustWrite manuscript (`justwrite`)

JustWrite is the primary integration partner. It exports a manuscript
as a JSON document the JustVoice server consumes verbatim. **This
adapter's input shape is load-bearing — never change it without
coordinating with the JustWrite team.**

```json
{
  "schema": "justwrite/v1",
  "book": {
    "title": "The Quiet Frontier",
    "author": "Jane Doe",
    "language": "en-US",
    "description": "Optional blurb."
  },
  "characters": [
    { "id": "narr", "name": "Narrator", "voice_hint": "warm baritone" }
  ],
  "chapters": [
    {
      "id": "ch1",
      "title": "Departure",
      "lines": [
        { "character_id": "narr", "text": "It began at dawn.", "pause_after_ms": 400 }
      ]
    }
  ],
  "lexicon": [
    { "grapheme": "Caoimhe", "phoneme_ipa": "ˈkiːvə" }
  ]
}
```

Maps directly: `book.title` → `project.name`, `chapters` → `scenes`,
`lexicon` → `lexicon_entries`. Project kind is always `audiobook`.

---

## <a id="import-book_prose"></a>Book / manuscript (`book_prose`)

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

Every paragraph becomes one `line` with `character_id: null` — prose
carries no speaker data. Speakers are discovered later by Script
extraction and promoted to personas (see CONCEPTS.md §3).

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

## <a id="import-podcast_markdown"></a>Podcast script (`podcast_markdown`)

Speaker-labeled markdown/text — the podcast way-in. `SARAH:` /
`**JIN:**` / `[MAVE]:` at paragraph start name the speaker (short
ALL-CAPS or Title-Case labels only — prose sentences with colons are
left alone); unlabeled paragraphs continue the current speaker.
`## headings` split segments into scenes; `— marker —` / `---` lines
import as unattributed marker lines (`delivery.marker=true`).
Paralinguistic tags like `[laughs]` stay in the text — capable engines
perform them. Unknown labels become characters → personas at commit.

## <a id="import-csv_lines"></a>CSV lines (`csv_lines`)

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
- `character` is slugged into an id and reused across rows.
- `delivery` is parsed as JSON if it looks like JSON, otherwise stored
  as `{"instruct": "<raw string>"}`.
- `pause_after_ms` is parsed as an integer; ignored if non-numeric.
- Project kind defaults to `game_voicelines`.

---

## <a id="import-srt"></a>SubRip subtitles (`srt`)

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
  `StandardCharacter` and stripped from the text.
- `pause_after_ms` on a line is the gap between its cue's end and the
  next cue's start (so the rendered chapter preserves the original
  pacing).
- Project kind defaults to `custom`.

---

## <a id="import-audacity_labels"></a>Audacity label track (`audacity_labels`)

Audacity exports label tracks as a tab-separated file:

```
0.000000	1.500000	Intro music fades
2.000000	4.250000	Narrator opens the scene
5.000000	7.000000	Character speaks
```

- Two-column form (point labels: `time<TAB>label`) is also accepted.
- Audacity's frequency-bound continuation rows (starting with `\`)
  are skipped.
- `pause_after_ms` is the gap between the current label's end and the
  next label's start.
- Project kind defaults to `custom`.

---

## <a id="import-standard"></a>JustVoice standard JSON (`justvoice_standard`)

Pass-through for payloads already in the standard schema shape — most
useful for re-importing previously exported projects, hand-authored
pipelines, or adapter chaining. The body is validated against the
Pydantic model; mismatches surface as `400` with a field-level message.

If the inbound `schema_version` differs from the server's, a warning is
appended to the response but the import still runs.

---

## <a id="import-elevenlabs"></a>ElevenLabs Studio (`elevenlabs`) — not implemented

ElevenLabs Studio exports projects as a proprietary JSON bundle. Voice
IDs in the export are scoped to the operator's ElevenLabs cloud
account, so the adapter needs either a voice-manifest fetch or an
operator hand-mapping step before a project can be materialized.

Both are out of scope for the initial multi-adapter pipeline. The
stub returns `501 Not Implemented` with a pointer to this section.

Reference: <https://elevenlabs.io/docs/api-reference/studio>.

---

## Writing your own adapter

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

4. Add a `## <a id="import-<source>"></a>` section to this document
   with the input shape, an example, and any nuances.

That's it — no further wiring needed. The adapter is automatically
listed in `GET /v1/projects/import/adapters` and selectable in the
ImportModal's UI picker.

---

## The import review page

Every import lands on a review page before anything is written — a dry run you
can steer. Change the **split strategy** and the dry run re-runs so you see the
chapter boundaries move; untick chapters you don't want; if speaker information
turns up mid-review, a banner surfaces it. Nothing exists until **Commit** — an
import you abandon leaves no trace.
