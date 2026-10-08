// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Deterministic dialogue-tag anchor propagation (the port of justvoice/extraction/anchors.py,
// itself ported from JustWrite speakerAttribution.js:218-303 — the pre-LLM pass that catches
// "Sarah said" patterns and turn-taking before spending LLM cycles).
//
// PARTIAL — the render wave (wave C) ported only DIALOGUE_VERBS, which extraction/tags.js
// (the "Leave out dialogue tags" rule every render path applies) is built from. The
// extraction wave fills in the rest (Anchor, the name regex, the propagation) under the same
// names.

// 40+ dialogue-tag verbs. Order doesn't matter — they're joined into one regex alternation.
// Past + present + third-person where relevant.
export const DIALOGUE_VERBS = [
  "said", "says", "asked", "asks", "replied", "replies", "answered", "answers",
  "responded", "responds", "shouted", "shouts", "yelled", "yells",
  "whispered", "whispers", "murmured", "murmurs", "muttered", "mutters",
  "growled", "growls", "snapped", "snaps", "snarled", "snarls",
  "barked", "barks", "called", "calls", "cried", "cries",
  "declared", "declares", "demanded", "demands", "exclaimed", "exclaims",
  "explained", "explains", "groaned", "groans", "hissed", "hisses",
  "insisted", "insists", "interrupted", "interrupts", "laughed", "laughs",
  "mumbled", "mumbles", "noted", "notes", "objected", "objects",
  "offered", "offers", "pleaded", "pleads", "remarked", "remarks",
  "repeated", "repeats", "retorted", "retorts", "sighed", "sighs",
  "smiled", "smiles", "sobbed", "sobs", "stammered", "stammers",
  "stuttered", "stutters", "thought", "thinks", "wailed", "wails",
  "warned", "warns", "wondered", "wonders",
];
