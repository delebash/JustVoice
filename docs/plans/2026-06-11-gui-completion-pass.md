# Plan: GUI completion pass — one shot, user verifies at the end (2026-06-11)

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

User directive (verbatim intent): finish the WHOLE GUI in one pass — no
approval pauses, no stopping at turn boundaries, unit tests + screenshots
as we go — then the user verifies everything at once, we debug together,
write a new plan, and do another pass.

**Visual identity decision for this pass:** apply the current approved
system (full-app-preview tokens: paper bg, white cards, green accent)
consistently everywhere. No new brand is invented unilaterally — the
"bless or evolve" Phase-4 identity question stays open for the user's
debug pass.

## What the GUI track contains (scope answer)

1. **Fidelity sweep** — every view screenshotted live and compared
   against its mock (journey-*.png steps + engines-redesign.html +
   ai-features-redesign.html + full-app-preview.html). LAYOUT-level
   comparison, not element-presence. Punch list recorded below as it is
   built; fixed view by view.
2. **Phase A4** — Render & Export (audiobook journey steps 6–7): chapter
   batch render with cache stats + ACX check column; M4B + chapter-WAV
   export + ACX checklist. Backend largely exists (render_chapter_api,
   export_audiobook); this is mostly GUI wiring.
3. **Nav** — per-project-type sidebar vocabulary (the journeys-preview
   nav behavior): sidebar adapts to the open project's kind, building on
   App.vue's existing `visibleFor`.
4. **Phase D/E GUI remainders** that are container-verifiable: Edit-voice
   modal (grow ⚙ Inspect: rename, gender, language, effects chain,
   channel, samples), tooltips on every control we touch.
5. **Phase 4b remainder audit** — verify which PHASE_PLAN 4b UI items
   are genuinely missing vs already shipped; fold real gaps into the
   punch list.

**Excluded (cannot be honestly verified in this container — next pass on
the user's machine):** Tauri global hotkey/chord capture, proof-listen QC
+ word timestamps, real model loads + fit dots with detected VRAM,
auto-updater behavior, OS audio device routing behavior (UI ships, device
enumeration needs hardware), Wwise/SRT/VTT (need engine timestamps).

## Execution order

- S0 audit sweep → punch list (amended into this doc)
- S1 per-view fidelity fixes (commit per coherent chunk)
- S2 Phase A4 render/export view
- S3 sidebar vocabulary by project kind
- S4 Edit-voice modal + D/E GUI leftovers
- S5 4b remainder gaps
- S6 final gates: ruff + pytest + scripts/e2e.mjs + screenshot album +
  MORNING_RECAP update + push

Every commit: ruff + pytest green; renderer changes screenshot-verified.

## Punch list (S0 findings — amended as the audit runs)

(filled in by the audit below)
