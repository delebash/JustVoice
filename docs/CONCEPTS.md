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

## 8. Generic "paste some text" use → the Plain-text kind (thin alias)

Question raised 2026-06-11: do we need a kind for "I just have pieces of
text and want to manually assign a voice per piece"?

Answer: **the podcast kind already covers the mechanics** — write-in-app
segments, a speaker per segment, manual voice assignment, no import
required. What it doesn't cover is the *front door*: a user making
onboarding VO or a YouTube narration shouldn't have to read "Podcast" and
mentally translate "Episodes".

Decision: add a fourth kind, **📄 Plain text (Narration)**, as a thin alias
over the podcast machinery:

- Same section editor + per-section voice assignment (one voice for all is
  just assigning once).
- Neutral labels (Sections, not Episodes), **no Timeline**, no episode/ID3
  framing.
- Plain WAV/MP3 export, no spec checklist; mastering target configurable,
  none by default.
- Cost is near-zero: kinds are labels + defaults over the same
  Scene/Block model — this is exactly what the kind switch exists for.

Boundary with Generate: a single phrase needs no project at all — that's
Generate. Plain-text projects are for text you want to *keep, structure,
and re-render*.

## 9. Help system — three altitudes (proposal, mocked in ❓ tab)

User requirement: menu/item-sensitive help — a "?" by headings opening a
side panel with the correct topic — plus full user documentation.

Design: three altitudes, each with its own delivery:

1. **Micro — tooltips.** Hover any control. Already in the design system.
2. **Task — the "?" drawer.** A `?` button on every view header AND on
   complex cards (item-sensitivity). Opens a right-side, non-modal drawer
   scoped to that topic so users read while doing. Topic template:
   *What is this → How to use it → Concrete example → Related links*.
   Search across all topics (`/`); `F1` opens help for the focused area.
3. **Flow — "Show me" tours.** Help topics link to a guided replay of the
   matching journey (the same step sequences as the journeys mock),
   overlaid on the real app.

Reinforcements:
- **Empty states are help** — every empty list states what the thing is
  and offers the first action.
- **First-visit hint strip** — one dismissable line per view pointing at
  the `?` and the tour; shown once, never again.

Implementation shape (single-sourced, headless-parity):
- One markdown file per topic in `docs/help/`, with front-matter
  `id`/`related`. Served by the FastAPI server (`GET /v1/help/{id}` +
  index for search), so desktop and `/ui/` headless render identical
  content, offline.
- UI regions carry `data-help-id`; the drawer maps region → topic.
  Card-level `?` opens the same drawer scrolled to the topic anchor.
- The same markdown set builds the public docs site later — write once.
- Journeys docs (`docs/journeys/`) become the tour scripts.

Rejected alternatives: external-docs-only (context switch, useless
offline); coach-mark overlays everywhere (annoying after first run —
reduced to the one-time hint strip).

## 10. LLM & STT in first-run (optional helpers, never blockers)

Question (2026-06-11): should the user select an LLM and STT at startup?

Yes — both ride in QuickSetup as **optional, skippable rows** under the
engine list. Principle: the TTS core never depends on either; skipping
costs specific features, and the UI says exactly which.

- **LLM — connect, don't bundle.** QuickSetup probes for running local
  servers (Ollama / LM Studio on their default ports) and offers one-click
  connect; otherwise add any OpenAI-compatible endpoint + key, or skip.
  This sets the default provider for the per-feature bindings that already
  exist in settings (`LLMBinding` in `models.py` — speaker_attribution,
  smart_assign, render_preset_suggest, compose, persona_rewrite; QuickSetup
  pre-fills per hardware tier).
  **Graceful degradation when skipped:** Script becomes manual speaker
  assignment, Smart-assign hides, preset-suggest hides — each spot shows a
  "connect an LLM" hint deep-linking to setup. Audiobook EPUB flow is the
  big loser without one; games/podcasts barely notice (their sources name
  speakers).
- **STT — bundle small.** Whisper-small (~244 MB) as a checkbox, on by
  default. Consumers: Train dataset auto-transcripts, promoting captures
  to clone samples. Skipped → Train asks for manual transcripts.
- Both re-offerable later: Settings → AI features, plus the deep-links
  from degraded spots. First-run stays one screen — no wizard sprawl.

## 12. Speaker Lab (attribution tuning) — Tuner is production-facing, Lab is preserved

Grounded in code: `engines/llm/tiers.py`, `SpeakerLabView.vue`,
`api/extraction_api.py`, `api/feature_pins_api.py`, `labs/extraction/`.

- **Tuner tab (the main one).** Detects the connected model and
  auto-classifies its tier (heuristics ported from JustWrite's
  modelMeta.js): reasoning-first families (DeepSeek-R1, Qwen3.5,
  Phi-4-Reasoning, GLM-Z) and Qwen3 14B+ → **Reasoned** (think blocks on,
  floor 0.5); ≥12B non-reasoning → **Direct** (floor 0.5); sub-12B →
  **Guided** (worked-example prompt, floor 0.7 — safe fallback). The lab
  races tiers side-by-side on real project text (same backend as Studio ·
  Script), shows per-line speaker + source chip (anchor / llm / propagated
  / floored) + confidence, and **"Pin to production"** writes the
  `speaker_attribution` feature pin so Script uses the override from then
  on. Nothing touches the project until pinned.
- **Lab tab (experimental, deliberately preserved).** The two-pass
  pipeline (pass 1: candidate speakers per chunk; pass 2: re-verify
  low-confidence picks with wider context), scored against the
  ground-truth corpus in `labs/extraction/corpus/` with markdown reports
  (block accuracy, per-character F1, source breakdown). Verdict on
  record: ~+2 pp accuracy at 2.3× token cost — not the default, kept so
  the next bigger local model can be re-scored in one click. Headless:
  `python -m justvoice.labs.extraction.run --corpus <slug> --tier <t>`.

## 13. Final idea pass — JustWrite carry-overs (2026-06-11)

Audited `justwrite-app` file-by-file for transplant candidates. Verdicts:

### Why TWO speaker LLM features existed (on the record, as requested)

JustWrite separates **speaker identification** from **speaker attribution**,
and JustVoice should keep that separation:

- **Identification** (`services/analysis/entityExtraction.js`) answers
  *"who exists in this text?"* — scans prose, proposes new
  characters/locations/objects as a **review list, never a commit**
  (tick-box before anything lands), deduped against the existing cast.
  Runs rarely (once per import/chapter), so it can afford a bigger model.
  In JustVoice this is the "N speakers found that aren't in your cast"
  banner — the discovered-speakers flow.
- **Attribution** (`services/speakerAttribution.js`) answers *"who speaks
  THIS line?"* — the [D#]-numbered segment pipeline with dialogue-anchor
  propagation, tier-resolved prompts, confidence floor. Runs constantly
  (every chapter, every re-analysis), so it must be cheap and is the thing
  Speaker Lab tunes.

Different cadence, different cost profile, different failure modes →
separate feature pins so each can bind to a different provider/model/tier.
JustVoice's `feature_pins_api.py` already supports this; the UI should
expose both pins, not one "LLM" setting.

### Adopt (with where it lands)

1. **AI usage ledger** (`stores/ai.js` — tokens + estimated cost per
   feature, byFeature totals, recent-activity list, capped log; Settings →
   Usage section with per-provider badges). JV: `/v1/ai_usage` + Settings →
   AI usage panel. Pairs with feature pins: see exactly what attribution
   costs vs smart-assign.
2. **Global AI task registry** (`stores/aiTasks.js` — in-flight calls
   survive component unmount; header status button + slide-in panel;
   stalled detection ~5 s / stuck >30 s via lastDeltaAt). JV already has
   active_tasks + SSE server-side; adopt the **header task panel UI** for
   renders + LLM calls + training jobs in one place.
3. **Editable hardware-preset store** (`stores/hardwarePresets.js` —
   factory seed + user-editable tier recipes + reset; "model ids and
   quants change every few weeks — store data, don't hardcode").
   JV QuickSetup tiers should follow exactly this pattern (matches the
   no-hardcoded-tunables rule).
4. **Promotable prompt presets** (Speaker Lab `MODES` — lab presets can be
   *promoted* to production; production prompt configs are stored, not
   inlined). JV: per-feature system-prompt override on the feature pin,
   factory-resettable, with "Promote to production" from the Speaker Lab
   Tuner — already mocked as the 📌 pin button.
5. **Backup UI** — server side already exists (`/v1/backup` + `/v1/restore`,
   stream-zipped, settings + SQLite + optional blobs, DESIGN_FREEZE §5).
   Adopt JustWrite's **manual "Export backup…" + restore flow** as a
   Settings → General card, plus a scheduled-auto-backup toggle.
6. **In-app help docs pattern** (`services/helpDocs.js` — `docs/*.md` +
   `toc.json` bundled at build, same files shipped to the marketing site).
   Exactly matches the help-drawer design already mocked (❓ tab); reuse
   the loader pattern wholesale.
7. **Tutorial project** (`services/tutorialProject.js` — a real seeded
   project, "the Scrivener pattern", not a coach-mark tour). Converges
   with the per-kind demo projects already in the journeys mock.
8. **Ollama admin helpers** (`services/ollamaAdmin.js` — native /api/*
   reachability + model list/pull). Powers the first-run "Ollama detected →
   Connect" row and lets users pull a recommended model without leaving
   the app.
9. **Voice-metadata heuristics** (`services/voiceGender.js` — provider
   canon → Kokoro id convention → heuristic fallback for gender/accent).
   JV's voice library gender chips for external providers should use this
   three-pass approach instead of guessing.
10. **External TTS provider adapters** (`elevenlabs.js`, `speechify.js`)
    — candidates for JV external-engine adapters later; low priority,
    the OpenAI-compat path already covers most servers.

### Skip (writer-side, stays in JustWrite)

Voice fingerprint ("match my style"), session recap / resume briefing /
stuck diagnostic, critique + multi-reader critique, AI-tell scanner, RAG
character chat, plot templates, marketing pack, version diff (JV's
equivalent is take history, which already exists).
