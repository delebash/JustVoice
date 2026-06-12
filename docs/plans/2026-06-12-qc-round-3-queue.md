# QC round 3 queue — intake 2026-06-12 evening

<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

Sweep findings + plan delivered as text; user approved ("continue").
Execution order: sweep fixes (S steps 1-3) first, then items 1-4.

1. ✅ **Voice preview bar at bottom — remove.** It was ChapterView's
   pinned floating generate bar (voice/engine/effects chips + a dead
   "Render block" button that never had a handler) — mock furniture.
   Removed bar + CSS + llmRewrite ref + lede promise. GlobalAudioPlayer
   (the take transport with ✕) is a different surface and stays.
2. **"Pick it in Engines" → link** in the no-engine banner.
3. **Labs tab explainers** — Compare / Train / Audio get an intro lede
   like Speaker Lab's. Also normalize the duplicate sub-tab h2 titles
   found in the sweep (RenderLab/SpeakerLab/Webhooks/AudioChannels
   repeat their own tab name).
4. **Voice inspector → Train LoRA** opens Train with the voice
   preselected in its dropdown (parity with how "Blend with…" pre-fills
   the blend form). Currently: toast + bare #train navigation.
5. ✅ **Captures pane padding** — phantom 30px scroll. Root cause:
   `height: 100%` view roots inside .jv-content ignore the lede's
   ~30px. Canonical `.jv-fill` promoted to styles.css; Captures +
   Stories converted (commit b6cfcad).
6. ✅ **Chapters "Open Projects" button** — dead inline handler
   (`window` in a template resolves to undefined). Wired (67dd4a2).
7. ✅ **Chapters header** — one-line topbar w/ title ellipsis +
   nowrap status/engine pills; selectors → canonical .jv-lib-toolbar;
   double root padding removed (2b6fd9a).
S. ✅ **Whole-app HTML/CSS sweep** — findings delivered; fixes are
   items 5/6/7 above. Remaining follow-up folded into item 3 (duplicate
   sub-tab headers). No separate .jv-pagehead needed — topbar + lede
   are already centralized in App.vue.
