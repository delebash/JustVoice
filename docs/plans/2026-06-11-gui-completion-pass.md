# Plan: GUI completion pass — whole journeys-preview, one shot (2026-06-11)

<!-- SPDX-License-Identifier: MIT -->

User directive: complete the ENTIRE approved GUI in one pass — every
screen in `preview/journeys-preview.html` (the approved contract),
adjusted for the real app — no approval pauses, no stopping at turn
boundaries, unit tests + screenshots per chunk. The user verifies the
whole thing at the end, then we debug together, write a new plan, and do
another pass. Scope confirmed in conversation 2026-06-11: the new Home
screen, the first-run setup (questions), the new per-kind nav, and
Studio (all three tabs, all three scales) are all explicitly in.

**Visual identity:** the current approved system (full-app-preview
tokens: paper bg, white cards, green accent) applied consistently. No
new brand invented unilaterally — bless-or-evolve stays open for the
user's debug pass.

## Scope — every journeys-preview screen, by surface

The mock's `shell()` defines the nav contract: lanes Workflow / Library /
Tools / Settings; the structure item + extras swap by project kind
(`KIND_NAV`: audiobook→Chapters, game→Lines, podcast→Episodes+Timeline);
topbar carries title + project/kind/master chips + status. Body screens:

1. **Nav + app shell** — per-kind sidebar vocabulary (KIND_NAV), lane
   structure exactly as the mock (Workflow: Home·Studio·<struct>·
   Generate; Library: Projects·Voices·Personas·Lexicons·Engines; Tools:
   Compare·Train·Spk Lab; Settings pinned bottom), topbar project chips.
2. **Home** (library journey step 1) — daily driver replacing Overview:
   Continue/Resume card + Start-something kind pills, 6 stat cards
   (Projects/Voices/Personas/Lexicons/Cache/Captures), Active tasks
   panel w/ inline progress + cancel, Loaded engine card w/ VRAM bar +
   Unload/Switch, Recent generations list w/ play/download, hotkey
   banner.
3. **First-run** (firstrun journey, 5 steps) — QuickSetup machine scan →
   proposed engine set (consent-first), engine download progress states,
   clone-a-voice walkthrough (record/drop + quality check), audition +
   save, "setup done" Home handoff.
4. **Kind picker** (shared step 1) — 4 kind cards w/ vocabulary
   explanation; everything downstream adapts.
5. **Studio · Cast** — audiobook scale (character cards + voice-library
   click assignment), game scale (NPC table), podcast scale (3 speakers
   + tag flow note).
6. **Studio · Script** — per-chapter LLM attribution + discovered-
   speakers banner → promote to personas.
7. **Studio · Render** — batch render, per-chapter rows w/ cache stats,
   ACX check column, failures retry (game: per-quest progress fan-out).
8. **Export** — audiobook (M4B w/ markers + per-chapter WAVs + ACX
   checklist), game (per-line WAVs by ID in quest folders + diffable
   manifest), podcast (episode file at −16 LUFS + chapters from
   markers).
9. **Chapters / Lines / Episodes** — per-kind home base: chapter status
   ladder ("just text"→"rendered & mastered"); game grid w/ stale-on-
   reimport; podcast segments w/ speaker rows + inline tags + markers.
10. **Timeline** — Stories surface as podcast assembly (voice track +
    music bed + stinger).
11. **Generate** — no-project surface, knobs from the engine's actual
    capability manifest.
12. **Fix-it loop** — flag line in Studio → lexicon entry w/ test-in-
    voice + scope → "3 lines re-render, rest cached" → Compare A/B.
13. **Proof & QC** — listen-back pass screens (whisper round-trip
    auto-QC = user-machine; the screens + flag flow ship).
14. **Library surfaces** — Voices (cast-as column, every type), Personas
    (used-in chips), Projects (kind badges), Captures (replay/pin/
    promote-to-sample), Webhooks/MCP (agent door), Lexicons.
15. **Dictation/live-voice screens** — settings (hotkey + output
    routing), floating bar, captures integration. OS-level behavior
    (hotkey firing, virtual mic, type-into-focus) = user-machine pass.
16. **Help system** — shipped earlier; verify against mock, fix drift.
17. **Edit-voice modal** (grow ⚙ Inspect: rename/gender/language/
    effects/channel/samples) + tooltips on every control touched.

**Excluded (cannot be honestly verified in container — next pass):**
Tauri global hotkey/chord capture live behavior, real model downloads/
loads + fit dots w/ real VRAM, proof-listen whisper round-trip, OS audio
device routing behavior, auto-updater, Wwise/SRT/VTT (need timestamps).

## Execution order

S0 audit sweep (screenshot every view vs mock; punch list below) →
S1 nav + shell → S2 Home → S3 kind picker + per-kind home bases →
S4 Studio (Cast/Script/Render ×3 scales) → S5 Export screens →
S6 first-run → S7 fix-it + Compare + QC → S8 library surfaces +
Generate → S9 dictation screens → S10 Edit-voice modal + tooltips →
S11 final: ruff + pytest + scripts/e2e.mjs + full screenshot album +
MORNING_RECAP + push.

Every commit: ruff + pytest green; renderer changes screenshot-verified
against the corresponding mock step. Plan amended in-repo as findings
land (user rule).

## Execution record (amended at end of pass)

Shipped, in order, each commit gates-green and live-verified:

- **S1 nav/shell** — activeProject store; per-kind sidebar (Chapters /
  Lines / Episodes+Timeline swap verified live for all three kinds);
  lanes to the mock (Effects/Presets/Audio Tools/Render Lab →
  Advanced); topbar Project/Kind/Master chips; Home = launch tab.
- **S2 Home** — full journeys daily driver (Continue/Resume, kind
  pills, 6 stat cards, Active tasks, Loaded engine, Recent
  generations, hotkey banner; bootstrap banner for cold installs).
- **S3 kind picker** — Home pills → Projects create with kind
  preselected (NewProjectModal initialKind).
- **S4 Studio** — numbered steps (game drops Script + renumbers);
  Cast: lede, Clear cast, mock card anatomy, whole-cast ✓ cast-as;
  Script: mock column order + confidence pills; Render: master pill,
  Render all, Run ACX QC → Check column, Cached column + cache banner.
  Backend: cache.has() probe, probe_line_cached, GET
  /v1/render/cache-stats, unified per-scene cache scope, lazy
  SessionLocal fix (boot-order crash).
- **S5 Export** — Chapters Export panel: package card + honest ACX
  checklist (measured ✓/✗ from /v1/projects/{id}/qc; unmeasured items
  say so).
- **S6 first-run** — QuickSetup: per-engine checkboxes, plain-English
  routing (tier jargon removed per AI-features contract), What-
  happens-next + locally banner; re-runnable from Settings → General.
- **S7 fix-it loop** — 🔤 Fix pronunciation on chapter blocks →
  Lexicons prefilled via jv.lexicon.prefill (selection-aware).
- **S10 Edit voice** — Inspect editor: rename/gender/language PATCH on
  stored voices; presets read-only pill.
- **S11 final** — scripts/e2e.mjs ALL GREEN; 16-view screenshot sweep
  zero JS errors; 192 pytest.

**Left for the user's debug pass** (next plan): deep mock-fidelity
audit of the remaining library surfaces (Generate knobs vs capability
manifest, Personas used-in chips, Projects kind badges, Captures,
Stories/Timeline anatomy, dictation screens) — they load clean and
carry their phase-era designs, but did NOT get the element-by-element
layout comparison this pass gave Home/Studio/Export/first-run/nav.
Game/podcast Studio scales rendered with demo data only. User-machine
items unchanged (hotkey, real downloads, fit dots, proof-listen).
