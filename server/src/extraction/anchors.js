// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Deterministic dialogue-tag anchor propagation (the port of justvoice/extraction/anchors.py,
// itself ported from JustWrite speakerAttribution.js:218-303 — the pre-LLM pass that catches
// "Sarah said" patterns and turn-taking before spending LLM cycles).
//
// Finds <Name> <said> patterns in narration, attaches the nearest dialogue segment to that
// name, then sweeps forward + backward through unanchored dialogue segments to fill in
// pronoun-only or bare turn-taking patterns.

import { B, cpIndex, pyEscapedLen, pySorted, reEscape } from "@delebash/llm-runner/platform/py";

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

/** A single deterministic attribution from the pre-LLM pass. */
export class Anchor {
  /**
   * `speaker`: character id. `source`: "tag" (Name + verb adjacency) | "propagated"
   * (forward/back fill). `words`: the book's own words that named the speaker, e.g. "said
   * Marius" — the name, the verb and anything between them, as written; a propagated anchor
   * carries the words of the tag it was propagated from. Script's "Decided by" shows them.
   */
  constructor({ speaker, source, words = "" }) {
    this.speaker = speaker;
    this.source = source;
    this.words = words;
  }
}

const labelsOf = (c) => [c.name, ...(c.aliases || [])];

/** Match any character's canonical name OR alias as a whole word. Sorted longest-first (by
 * the length Python's re.escape gives them) so "Mary Anne" wins over "Mary". */
export function _buildNameRegex(characters) {
  const fragments = [];
  for (const c of characters) for (const label of labelsOf(c)) if (label) fragments.push(label);
  // No characters at all — a pattern that matches nothing.
  if (!fragments.length) return /(?!x)x/gu;
  const sorted = pySorted(fragments, (f) => pyEscapedLen(f), true);
  return new RegExp(`${B}(${sorted.map(reEscape).join("|")})${B}`, "giu");
}

function _buildVerbRegex() {
  return new RegExp(`${B}(${DIALOGUE_VERBS.join("|")})${B}`, "giu");
}

function _nameToId(characters) {
  const out = new Map();
  for (const c of characters) {
    const cid = c.id;
    if (!cid) continue;
    for (const label of labelsOf(c)) if (label) out.set(label.toLowerCase(), cid);
  }
  return out;
}

const get = (o, k, d) => (Object.hasOwn(o, k) ? o[k] : d);

/**
 * Given a list of segments (each `{kind: "narration" | "dialogue", text, dialogue_id?}`),
 * return a Map `dialogue_id → Anchor` for every dialogue segment we could deterministically
 * attribute.
 *
 * Two passes:
 *   1. Tag pass — scan each narration for <Name> <verb> or <verb> <Name>; the adjacent dialogue
 *      segment (before or after) anchors to that name. Both adjacencies are eligible so "Mara
 *      said" before AND after both attach correctly.
 *   2. Propagation pass — forward sweep + backward sweep through dialogue segments.
 *      Unanchored dialogue inherits the nearest anchored speaker in the same paragraph. Source
 *      flips to "propagated".
 *
 * Per the JustWrite audit: anchors WIN over LLM on tie-break.
 */
export function findAnchors(segments, characters) {
  const nameRe = _buildNameRegex(characters);
  const verbRe = _buildVerbRegex();
  const nameToId = _nameToId(characters);

  const anchors = new Map();

  // ── Pass 1: tag adjacency ────────────────────────────────────
  segments.forEach((seg, i) => {
    if (seg.kind !== "narration") return;
    const text = get(seg, "text", "");
    if (!text) return;
    // Need both a name AND a dialogue verb in the same narration to treat it as a tag.
    const names = [...text.matchAll(nameRe)];
    const verbs = [...text.matchAll(verbRe)];
    if (!names.length || !verbs.length) return;
    // Use the name closest to a verb (within ~12 chars in either direction) — defends
    // against narration like "Mara stood up. Sarah said, 'Where?'". Distances count code
    // points, as Python's match positions do.
    let bestName = null;
    let bestWords = "";
    let bestDist = 1_000_000;
    for (const n of names) {
      const ns = n.index;
      const ne = ns + n[0].length;
      for (const v of verbs) {
        const vs = v.index;
        const ve = vs + v[0].length;
        const dist = Math.abs(cpIndex(text, ns) - cpIndex(text, vs));
        if (dist < bestDist) {
          bestDist = dist;
          bestName = n[0];
          bestWords = text.slice(Math.min(ns, vs), Math.max(ne, ve));
        }
      }
    }
    if (bestName === null || bestDist > 18) return;
    const speakerId = nameToId.get(bestName.toLowerCase());
    if (!speakerId) return;

    // Attach to the dialogue segment immediately before AND after, but only when the
    // neighbor is in the SAME paragraph. Cross-paragraph anchoring produces too many false
    // positives — turn-taking across paragraphs is a per-paragraph speaker change.
    const narrationPara = seg.paragraph_idx ?? null;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= segments.length) continue;
      const neighbor = segments[j];
      if (neighbor.kind !== "dialogue") continue;
      if ((neighbor.paragraph_idx ?? null) !== narrationPara) continue;
      const did = neighbor.dialogue_id ?? null;
      if (did === null || anchors.has(did)) continue;
      anchors.set(did, new Anchor({ speaker: speakerId, source: "tag", words: bestWords }));
    }
  });

  // ── Pass 2: forward + backward propagation (per paragraph) ───
  // Untagged dialogue inherits the most-recent tagged speaker WITHIN THE SAME PARAGRAPH —
  // paragraph boundaries are speaker-change cues in most narrative styles. Cross-paragraph
  // attribution is left to the LLM.
  const byPara = new Map();
  for (const s of segments) {
    if (s.kind !== "dialogue") continue;
    const p = get(s, "paragraph_idx", 0);
    if (!byPara.has(p)) byPara.set(p, []);
    byPara.get(p).push(s);
  }

  for (const paraSegs of byPara.values()) {
    // Forward sweep
    let last = null;
    for (const s of paraSegs) {
      const did = s.dialogue_id ?? null;
      if (anchors.has(did)) last = anchors.get(did);
      else if (last !== null) anchors.set(did, new Anchor({ speaker: last.speaker, source: "propagated", words: last.words }));
    }
    // Backward sweep — covers an unanchored dialogue BEFORE the first tag in the paragraph.
    last = null;
    for (const s of [...paraSegs].reverse()) {
      const did = s.dialogue_id ?? null;
      if (anchors.has(did)) last = anchors.get(did);
      else if (last !== null) anchors.set(did, new Anchor({ speaker: last.speaker, source: "propagated", words: last.words }));
    }
  }

  return anchors;
}
