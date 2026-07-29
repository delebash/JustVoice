# GUI parity — mock vs app, screen by screen

<!-- SPDX-License-Identifier: MIT -->

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
| Captures | captures-* | 🟡 | judged 2026-06-12: All/Pinned/Today chips + 📌 pin (new `pinned` column + PATCH) + ↺ speak-again (Generate prefill) shipped to match mock. Remaining gaps: promote-recording→clone-sample flow (needs the clone pipeline on a capture), mock's flat table vs app's master/detail (kept — detail pane holds transcript/refine tools) |
| Webhooks | webhooks-* | 🟡 | judged 2026-06-12: MCP-server card added above the table (mock pairs MCP+webhooks as one Automation surface) with real exposed tools + Settings link; lede mentions the CI use case. Remaining gap: mock's per-event ✓ 200 status pill vs app's Last-delivery column (column kept — same info) |
| Episodes (podcast home base) | episodes-* | 🟡 | judged 2026-06-12 (fabricated Signal & Noise ep.42 via podcast_markdown): vocabulary/speaker chips/[tag] highlight/directions/edit/fix-pronunciation all match. Fixed during judging: materializer DROPPED the importer's marker flag (episodes showed "unassigned speakers" forever — attribution now skips ♪ marker rows, which render muted-italic); podcast segments gain "Open Timeline ➜". Remaining gap: mock's −16 LUFS master chip lives on Studio, not the episode toolbar |
| Timeline (podcast) | timeline-* | 🟡 | judged 2026-06-12: app is the Stories master/detail with clip arrangement; mock's grown-up timeline (per-speaker tracks, zoom chips, music bed ducking, stinger drag, auto-lay pause profile) is a full feature slice, NOT built — biggest open parity gap, needs its own plan |
| First-run clone/audition steps | — | ⬜ | recording UI is desktop/mic-dependent; screens not diffed |
| Dictation floating bar / OS flows | — | ⬜ | Tauri/desktop-dependent (user machine) |
| Proof & QC screens | — | ⬜ | whisper round-trip is model-dependent; flag-flow screens not diffed |
| Help system | — | ✅ | shipped + verified in an earlier pass |
| Engines (both tabs) | (session screenshots) | ✅ | rebuilt + provider form + merged rows, this session |
| Settings · AI features | (session screenshots) | ✅ | rebuilt to contract this session |

Regeneration: `node scripts/parity-cap.mjs <mockHash> <appHash> <outPrefix> [projectLabel] [extra]`
(script at repo root; server running; chromium at /opt/pw-browsers).
