# JustVoice design concepts

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Working design decisions and mental models, captured from design-review
discussion (2026-06-11). The clickable companion is
`preview/journeys-preview.html` (tabs: Audiobook / Game / Podcast / Identity
flow). The per-audience walkthroughs live in `docs/journeys/`.

## 1. One data model, per-kind vocabulary

Chapters and lines are not audiobook concepts — they are labels on one shared
shape. `Project → Scene → Block` (+ Personas) generalizes across all three
production audiences; what differs per use case is **labels, entry point, and
exit point**. `project.kind` (already in storage,
`server/justvoice/storage/projects.py`) is the switch.

| | Project | Scene | Block | Persona | Way in | Way out |
|---|---|---|---|---|---|---|
| Audiobook | book | chapter | paragraph / dialogue line | character | EPUB / DOCX / .jw.json | chapter WAVs → M4B, ACX −20 LUFS |
| Game | title / VO batch | quest / conversation | line w/ **stable line ID** | NPC | CSV / JSON / Unreal string table | per-line WAVs named by line ID + manifest.json |
| Podcast | show | episode | script segment | host / guest | speaker-labeled markdown, or written in-app | episode WAV/MP3 at −16 LUFS |

Audience differences that drive UI, not data:

- **Game devs work line-first.** The line is the deliverable; they never
  listen to a "chapter". They need a grid view, stable IDs, batch
  regeneration (served by the hash cache), and export the game engine can
  ingest by ID. They never open Script attribution — their CSV names speakers.
- **Podcasters work assembly-first.** They may have no file to import (write
  in app); Timeline is their render surface; −16 LUFS stereo, not ACX.
- **Dictation/accessibility are not project-shaped.** Global hotkey /
  realtime surfaces; chapters and lines never apply. Don't force them into
  the project framing.

## 2. Voice vs Persona (and what "cast" actually is)

Reference: `Persona` model in `server/justvoice/models.py`.

Decision (2026-06-11): there are only **two** entities — there is no
separate "cast member" object, and none exists in storage.

- **Voice = the instrument.** A clone, preset, or blend. No character
  attached.
- **Persona = the character.** A library object bundling everything that
  makes a character sound like themselves: `voice_id`, delivery defaults
  (speed/pitch/gain), effects chain (e.g. ghost = whisper + reverb),
  optional lexicon, and bio/`personality` text (consumed as a style prompt
  by instruct-capable engines, and used by Smart-assign for voice matching).
- **Cast is not a third thing.** It's the Studio surface that lists the
  personas speaking *in the current project*, plus project-local stats
  (line counts, "discovered in ch. 4") that live on the project, not the
  persona.

The whole reason persona is a library-level concept instead of living
inside the project: **persistence**. Personas survive the project and cross
project kinds — book 2 reuses book 1's "Mara Vance" and she arrives sounding
identical; the same persona can speak in an audiobook and a game project.

Consequences worth keeping visible in UI:

- One voice can back multiple personas (Old Crow voices Tom Harlan in
  *Stillwater* and Guard Captain Hale in *Emberfall*), and with different
  delivery per persona (the "Sarah" clone backs both the Stillwater
  Narrator and her podcast-host persona).
- Since cast cards ARE personas, edits made on the Cast surface (voice,
  delivery) edit the persona — and therefore follow it to other projects.
  The UI should make that visible ("backed by persona ➜" jump to the
  Personas tab) so cross-project edits never surprise anyone.

## 3. When personas get created (the four doors in)

Whether import creates personas depends on what the source file knows:

| Source | Speaker data in file | Personas created |
|---|---|---|
| `.jw.json` (JustWrite) | full character sheet (names, roles, bios) | **at import** — bios flow into `personality` |
| Game CSV / string table | explicit speaker column | **at import** — one per unique value; performance notes ride along |
| Podcast markdown | `SARAH:` / `**SARAH:**` labels | **at import** — unknown labels become new personas, known ones match existing |
| Bare EPUB / DOCX | none — just prose | **later** — Script's LLM pass discovers speakers; the "N speakers found that aren't in your cast" banner promotes them ("＋ Create personas & add to cast", or "Merge into existing…") |

Dedup rule everywhere: personas carry `imported_from + imported_id`
provenance; re-importing the same source **updates in place, never
duplicates**. For games this extends to lines: matching line IDs update text
in place, and only changed lines lose their rendered take (go *stale*).

## 4. How voices get assigned (three paths, by scale)

1. **Smart-assign** — one button proposes a full cast from the voice library
   using character role/bio vs voice traits; user overrides anything wrong.
2. **Card + library click** (audiobook scale, ~5–15 characters) — select a
   character card, the library panel shows "Picking for: X", click a voice
   row to assign; click the assigned voice again to unassign; ▶ auditions
   any voice in place.
3. **Per-row dropdown** (game/podcast table scale) — the voice cell *is* the
   picker: click for a searchable dropdown with ▶ previews inline.
   "▶ test line" auditions the candidate voice on a **real line from that
   character's script**, which beats a generic sample.

Assigned voices in the library show who they're cast as but stay clickable —
one voice, many minor characters is a normal pattern.

## 5. Per-kind navigation (menu changes with project kind)

Decision: the sidebar adapts to the **active project's kind** — an audiobook
user never sees Episodes, a game dev never sees Chapters. Three rules:

1. **Only the structure slot changes.** One nav item swaps its noun
   (Chapters / Lines / Episodes); podcast additionally gains Timeline under
   it. Everything else is bolted down: Home, Studio, Generate (Workflow);
   Projects, Voices, Personas, Lexicons, Engines (Library); Compare, Train
   (Tools). Shared machinery keeps shared vocabulary and never moves.
2. **The menu follows the active project, not a global app mode.** Open
   *Stillwater* → Chapters; switch to *Emberfall* → Lines. Slot position
   stays identical so muscle memory holds. One user can be all three
   audiences in the same week.
3. **No project open → the slot disappears** (or shows generic "Project").
   Generate/dictation still work — they were never project-shaped.

Rationale: with five audiences, a union menu is the worst of all worlds —
dead-weight items for everyone. Per-kind labeling is self-documenting: pick
"Game dialogue" in the kind picker and the app speaks your language.

Open question (deliberately deferred): whether **Timeline stays
podcast-only**. Future cases exist elsewhere (audiobook intro music beds,
game cutscene bark sequencing). Lean: podcast-only in v1; if demand shows
up, expose per-project as opt-in rather than per-kind. The data model
doesn't block this — the timeline reads rendered takes regardless of kind.

## 6. Per-kind defaults switched by the kind picker

Picking a kind at project creation sets:

- **Sidebar vocabulary** (rule set above)
- **Studio steps** — audiobook: Cast → Script → Render (LLM attribution
  needed); game & podcast: Cast → Render (the source already names speakers)
- **Mastering target** — ACX −20 LUFS mono / 48 kHz per-line mono /
  −16 LUFS stereo — same mastering engine, different preset
- **Export surface** — M4B + chapter WAVs / per-line WAVs + manifest.json /
  episode MP3-WAV + stems

## 7. The three things called "preset" (all in use, naming collision)

| Term | What it is | Where |
|---|---|---|
| **Mastering preset** | Loudness/peak/format target: `acx`, `inaudio`, `podcast`, `youtube`. Default chosen by project kind; operator-tunable via settings. | `MasterPreset(Settings)` in `models.py`, applied by `mastering.py` (ffmpeg) |
| **Render preset** | Tier 3 of the delivery cascade — bundles voice/master/effects-chain overrides for a render job. Cascade: **render preset (T3) > persona `default_delivery` (T2) > engine defaults (T1)**; T3-beats-T2 covered by `test_render_chapter_scene_mode.py`. | `/v1/presets` CRUD, `RenderPresetsView.vue`, `delivery_merge.py` |
| **Preset voice** | A voice *type* (vs cloned/blended/trained): engine built-ins like Kokoro `af_heart`. | `VOICE_TYPES` in `models.py` |

Design flag for Phase 4: users meet all three meanings ("preset voice" in
the library, "Render Presets" in the sidebar, "ACX preset" on export) — the
collision is confusing. Lean: rename mastering presets to **targets** (ACX
target, podcast target); "preset" stays with the render-preset library, and
"preset voice" reads as a plain adjective.
