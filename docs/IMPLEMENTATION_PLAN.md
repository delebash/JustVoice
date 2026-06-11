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

- **A0 Book import** ✅ *(in progress)*: `imports/adapters/book_prose.py`
  — EPUB/DOCX/MD/TXT → StandardImport (chapter split on headings/spine,
  front-matter skip, paragraphs→lines, narrator-implied). Registry entry +
  pytest w/ synthetic fixtures. Then: ImportModal dry-run preview UI (mock
  `#audiobook/2`), kind picker on create (mock `#audiobook/1` — 4 kinds incl.
  plain text alias), lexicon materialization fix (`projects_api.py` import
  path).
- **A1 Voices**: v11 voice-library design transfer (table, engine combo,
  load banners, preview play).
- **A2 Studio Cast**: card+library click assignment (audiobook scale),
  per-row dropdown (table scale), smart-assign stub behind feature pin
  (mock `#audiobook/4`, `#game/4`).
- **A3 Script**: extraction pipeline wiring per CONCEPTS §16 — Studio
  Script analyze + discovered-speakers banner → personas; Speaker Lab final
  design (single column default, add/delete column, presets save/load/
  use-as-production, both prompts, Raw/Parsed streaming results); **AI task
  runner** (inline bar + slide-out, time/tokens/cancel/stall/notify) — used
  by ALL AI features (mock `#splab/*`, `#audiobook/5`).
- **A4 Render + export**: chapter batch render w/ cache stats + ACX check
  column; M4B + chapter WAV export + ACX checklist (mock `#audiobook/6,7`).

## Phase B — Game flow (🎮 tab)

CSV column mapping (saved per project, stable line IDs, dup check) →
Lines grid (grouped, status pills, stale-on-reimport + re-render-changed)
→ NPC cast table → batch render per-quest progress → export
`{group}/{line_id}.wav` + deterministic manifest.json (+ opt-in viseme
sidecar later, CONCEPTS §15).

## Phase C — Podcast + plain text (🎙️ tab)

Markdown speaker-label adapter, segments view w/ tag pills, timeline
(Stories-derived) with pause profile + ducking, −16 LUFS preset export;
plain-text kind = same surfaces, neutral labels, no timeline.

## Phase D — First-run, live voice, QC, help (🚀 ⌨️ 🎧 ❓ tabs)

QuickSetup (hardware tier store — data not code; engine checkboxes; LLM
detect-and-connect; STT bundle row; graceful degradation), hotkey overlay +
channels + captures, Proof-listen + Whisper round-trip auto-QC (word
timestamps in take record first), help drawer (docs/*.md + toc bundling,
helpDocs.js pattern).

## Phase E — JustWrite adopts + polish (🗂 tab, CONCEPTS §13)

AI usage ledger + Settings panel · backup/restore UI over /v1/backup ·
tutorial/demo projects per kind · Ollama admin (model pull) ·
voice-metadata heuristics · per-line director notes · LLM show notes ·
word-timestamp caption export (SRT/VTT).

## Testing per milestone

pytest for every adapter/endpoint (synthetic fixtures built in-test);
extraction changes scored against `labs/extraction` corpus; renderer
changes screenshot-verified against the corresponding mock screen;
Playwright E2E (stubbed LLM/engine) lands at the end of Phase A.
