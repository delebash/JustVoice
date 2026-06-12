# GUI parity — mock vs app, screen by screen

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

The approved contracts: `preview/journeys-preview.html`,
`preview/engines-redesign.html`, `preview/ai-features-redesign.html`.
Each row below is one screen; the test is the side-by-side pair in this
directory (`<name>-mock.png` vs `<name>-app.png`), judged structurally —
same layout, same panels, same affordances, real data behind it.

Status legend: ✅ matched (side-by-side judged this pass) ·
🟡 captured, minor diffs listed · ⬜ pair captured, NOT yet judged
element-by-element — next pass.

| Screen | Pair | Status | Notes |
|---|---|---|---|
| Nav — per-kind vocabulary | (verified live ×3 kinds) | ✅ | Chapters/Lines/Episodes+Timeline swap; lanes + Spk Lab label per mock. Deviation (user-approved 2026-06-12): the Advanced lane is GONE — Effects/Presets live in Library, Render Lab/Audio Tools in Tools, Cache/Channels/Webhooks are Settings sub-tabs (#cache/#channels/#webhooks deep links redirect) |
| Home (daily driver) | home-* | ✅ | judged earlier this pass; Continue/stat cards/tasks/engine/recent/hotkey |
| Kind picker | (live click-through) | ✅ | preselect from Home pills verified |
| Studio · Cast (audiobook) | studio-cast-* | ✅ | narrator spans, roles, colored portraits, library pills + amber banner + ✓ cast-as |
| Studio · Cast (game) | studio-cast-game-* | ✅ | NPC table, no Script step, steps renumber |
| Studio · Script | studio-script-* | ✅ | controls on steps row; mock column order; confidence pills |
| Studio · Render | studio-render-* | ✅ | ACX pill + Render all on steps row; Cached/Check columns; cache banner (shows once cast is voiced) |
| Chapters home base | chapters-* | ✅ | status table: Words/Est. audio/Script/Render + chips + Add + Open in Studio |
| Export (audiobook) | export-* | ✅ | package card + honest ACX checklist (unmeasured items say so) |
| Lines (game home base) | lines-* | ✅ | grouped grid, stable ids, status chips, re-import + VO zip |
| Voices | voices-* | ✅ | full table incl. cast-as; Edit via inspector (rename/gender/language) |
| Projects | projects-* | 🟡 | master/detail richer than mock's flat table (kept — detail pane holds cast/export); list rows carry kind tag + Open ➜ into kind home base. Mock's Structure/Progress columns not in the list pane |
| Personas | personas-* | 🟡 | used-in pills + Across-projects section present; mock's card-grid layout differs from app's master/detail (kept for edit surface) |
| Generate | generate-* | 🟡 | capability-driven knobs exceed mock; mock's inline tag-palette row is a slash-menu instead |
| QuickSetup (first-run) | (quicksetup-v2.png, session) | ✅ | engine checkboxes, helpers, what-happens-next, re-runnable |
| Fix-it → Lexicons | lexicons-* | ✅ | flag on block → prefilled grapheme verified live |
| Captures | captures-* | ⬜ | loads clean; element diff not done |
| Webhooks | webhooks-* | ⬜ | loads clean; element diff not done |
| Episodes (podcast home base) | episodes-* | ⬜ | ChapterView w/ podcast vocabulary; segment-specific affordances (inline tag pills, markers) not diffed |
| Timeline (podcast) | timeline-* | ⬜ | StoriesView; mock's grown-up timeline (music bed, stinger drag) not diffed |
| First-run clone/audition steps | — | ⬜ | recording UI is desktop/mic-dependent; screens not diffed |
| Dictation floating bar / OS flows | — | ⬜ | Tauri/desktop-dependent (user machine) |
| Proof & QC screens | — | ⬜ | whisper round-trip is model-dependent; flag-flow screens not diffed |
| Help system | — | ✅ | shipped + verified in an earlier pass |
| Engines (both tabs) | (session screenshots) | ✅ | rebuilt + provider form + merged rows, this session |
| Settings · AI features | (session screenshots) | ✅ | rebuilt to contract this session |

Regeneration: `node scripts/parity-cap.mjs <mockHash> <appHash> <outPrefix> [projectLabel] [extra]`
(script at repo root; server running; chromium at /opt/pw-browsers).
