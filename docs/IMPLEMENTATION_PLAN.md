# Implementation plan — from journeys mock to working app

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Built from the design phase of 2026-06-11: `preview/journeys-preview.html`
(12 tabs), `docs/CONCEPTS.md` §1–16, `docs/journeys/*`. Each milestone ends
green (ruff + pytest) and committed. UI transfers from the mock screens.

**Decision (supersedes the earlier vendoring idea):** book parsing happens
**server-side in Python with stdlib only** (EPUB/DOCX are zip+XML) so
headless `justvoice-server serve` imports books without the renderer, and
no JS parser code is vendored from JustWrite.

## Phase A — Audiobook core flow (mock: 📖 tab)

- **A0 Book import** ✅ done: `imports/adapters/book_prose.py`
  — EPUB/DOCX/MD/TXT → StandardImport (chapter split on headings/spine,
  front-matter skip, paragraphs→lines, narrator-implied). Registry entry +
  pytest w/ synthetic fixtures. Then: ImportModal dry-run preview UI (mock
  `#audiobook/2`), kind picker on create (mock `#audiobook/1` — 4 kinds incl.
  plain text alias), lexicon materialization fix (`projects_api.py` import
  path).
- **A1 Voices** ✅ done (cast-as column; row preview w/ ask-before-load; engine filter; gender/type chips; delete custom-only)
  —: v11 voice-library design transfer (table, engine combo,
  load banners, preview play).
- **A2 Studio Cast** ✅ done (assign/unassign verified live; picking status; smart-assign through runner)
  —: card+library click assignment (audiobook scale),
  per-row dropdown (table scale), smart-assign stub behind feature pin
  (mock `#audiobook/4`, `#game/4`).
- **A3 Script** ✅ done (task runner everywhere; discovered-speakers banner + promote endpoints; Speaker Lab v5 w/ per-column model/temp/prompt overrides + raw_llm)
  —: extraction pipeline wiring per CONCEPTS §16 — Studio
  Script analyze + discovered-speakers banner → personas; Speaker Lab final
  design (single column default, add/delete column, presets save/load/
  use-as-production, both prompts, Raw/Parsed streaming results); **AI task
  runner** (inline bar + slide-out, time/tokens/cancel/stall/notify) — used
  by ALL AI features (mock `#splab/*`, `#audiobook/5`).
- **A4 Render + export**: chapter batch render w/ cache stats + ACX check
  column; M4B + chapter WAV export + ACX checklist (mock `#audiobook/6,7`).

## Phase B — Game flow (🎮 tab) ✅ done

CSV column mapping (saved per project, stable line IDs, dup check) →
Lines grid (grouped, status pills, stale-on-reimport + re-render-changed)
→ NPC cast table → batch render per-quest progress → export
`{group}/{line_id}.wav` + deterministic manifest.json (+ opt-in viseme
sidecar later, CONCEPTS §15).

## Phase C — Podcast + plain text (🎙️ tab) ✅ done

✅ Markdown speaker-label adapter (podcast_markdown — labels/headings/
markers/tag preservation). −16 LUFS preset already ships (mastering
presets); per-episode export = render_chapter master=podcast.
✅ Segments view (ChapterView): shape fixes + persona-name pills +
[tag] pills, verified live w/ imported ep42. ✅ Adapter content-sniffing
(.md collision). Timeline = existing StoriesView multi-track editor;
pause-profile + auto-ducking → Phase E backlog. Plain-text (custom)
projects ride the same Chapter/Studio surfaces by design.

## Phase D — First-run, live voice, QC, help (🚀 ⌨️ 🎧 ❓ tabs) — IN PROGRESS

✅ QuickSetup: hardware tiers + engine rows + feature-pin routing existed;
ADDED detect-and-connect local LLM row (probe endpoint + one-click
register) and STT readiness row (capture/readiness). ✅ Help system:
drawer + per-view contextual ? + full docs/toc shipped and verified live.
Captures/CapturePill/DictateWindow exist.
DEFERRED (model/desktop-dependent — needs the user's machine):
- Tauri global hotkey registration (stubbed in lib.rs — desktop runtime
  untestable in this container)
- Proof-listen + Whisper round-trip auto-QC + word timestamps (require
  TTS+STT models on disk; design + endpoints land when a model-equipped
  machine can verify them honestly)

## Phase E — JustWrite adopts + polish (🗂 tab, CONCEPTS §13)

AI usage ledger + Settings panel · backup/restore UI over /v1/backup ·
tutorial/demo projects per kind · Ollama admin (model pull) ·
voice-metadata heuristics · per-line director notes · LLM show notes ·
word-timestamp caption export (SRT/VTT).
Voices backlog: hide/disable built-in voices (delete stays custom-only —
already enforced); grow ⚙ Inspect into a full Edit modal (rename, gender,
language, effects chain, channel, samples). UI rule: tooltips get added
to every control we touch, as we go.

## Styling is part of every milestone — not a later phase

The journeys mock IS the approved visual contract: warm --bg with white
bordered+shadowed cards on top, surface-2 table headers/sidebar, accent
green on every interactive control (never browser-default blue). Every
view milestone ends with a live screenshot compared against its mock
screen — feature parity without the contrast/finish is not done.
Global rules live in styles.css (tables self-card; form controls take
accent-color); fixes go to the base layer first, per-view second.

## Testing per milestone

pytest for every adapter/endpoint (synthetic fixtures built in-test);
extraction changes scored against `labs/extraction` corpus; renderer
changes screenshot-verified against the corresponding mock screen;
Playwright E2E (stubbed LLM/engine) lands at the end of Phase A.
