// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Deterministic dialogue-tag anchor propagation (the port of justvoice/extraction/anchors.py,
// itself ported from JustWrite speakerAttribution.js:218-303 — the pre-LLM pass that catches
// "Sarah said" patterns and turn-taking before spending LLM cycles).
//
// Finds speech tags — <Name> <said> or <said> <Name> — that open or close a narration, attaches
// the dialogue segment the tag touches, then sweeps forward + backward through unanchored
// dialogue segments in the same paragraph to fill in pronoun-only or bare turn-taking patterns.

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
  const alt = _nameAlternation(characters);
  // No characters at all — a pattern that matches nothing.
  if (alt === null) return /(?!x)x/gu;
  return new RegExp(`${B}(${alt})${B}`, "giu");
}

/** Every name and alias, escaped and longest-first, as one alternation; null when there are none. */
function _nameAlternation(characters) {
  const fragments = [];
  for (const c of characters) for (const label of labelsOf(c)) if (label) fragments.push(label);
  if (!fragments.length) return null;
  return pySorted(fragments, (f) => pyEscapedLen(f), true)
    .map(reEscape)
    .join("|");
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

// A speech tag has two shapes (2026-10-10): the name, then the verb ("Alice said", "the Dormouse
// sulkily remarked"), or the verb, then the name ("said Alice", "shouted the Queen", "sighed
// the Hatter"), with at most one -ly adverb between and, after the verb, an optional "the".
// "said to Alice", "turning to Alice", "said nothing" and "he said" are not tags: the name there
// is who is spoken to, or no name says who speaks, and the line is the model's to decide.
const ADVERB = "(?:\\p{L}+ly\\s+)?";
// Punctuation that may close the narration right before the quote it tags ("said Alice," “…”),
// or open it right after one (“…”—said the Hatter).
const TRAILING = /[\s.;:!?…—–,]*$/u;
const LEADING = /^[\s.;:!?…—–,(]*/u;
// What may follow a tag that closes its narration: nothing, or one -ly adverb.
const TAIL_OK = /^(?:\s*\p{L}+ly)?$/u;

function _buildTagRegexes(nameAlt, verbAlt) {
  return [
    new RegExp(`${B}(${nameAlt})\\s+${ADVERB}(${verbAlt})${B}`, "giu"), // Alice said
    new RegExp(`${B}(${verbAlt})\\s+${ADVERB}(?:the\\s+)?(${nameAlt})${B}`, "giu"), // said Alice
  ];
}

/** Every speech tag in a narration: `{at, stop, name, words}`, `at..stop` the tag's own span. */
function _tags(text, tagRes) {
  const out = [];
  const [nameFirst, verbFirst] = tagRes;
  for (const m of text.matchAll(nameFirst)) out.push({ at: m.index, stop: m.index + m[0].length, name: m[1], words: m[0] });
  for (const m of text.matchAll(verbFirst)) out.push({ at: m.index, stop: m.index + m[0].length, name: m[2], words: m[0] });
  return out.sort((a, b) => a.at - b.at);
}

/** The text with every character name blanked out, so what sits beside a tag is read without
 * a name's own full stop ("Mr. Holmes") or words. Lengths are kept. */
const _masked = (text, nameRe) => text.replace(nameRe, (s) => "x".repeat(s.length));

/**
 * Given a list of segments (each `{kind: "narration" | "dialogue", text, dialogue_id?}`),
 * return a Map `dialogue_id → Anchor` for every dialogue segment we could deterministically
 * attribute.
 *
 * Two passes:
 *   1. Tag pass — a tag that OPENS a narration tags the speech just before it ("said Alice,
 *      and she sat down"); a tag that CLOSES one, at most an -ly adverb after it, tags the
 *      speech just after it ("and the Dormouse sulkily remarked,") — same paragraph only, and
 *      only in one of the two shapes above. A tag anywhere else in the narration ("Alice
 *      thought this a very curious thing … she heard one of them say") tags nothing.
 *   2. Propagation pass — forward sweep + backward sweep through each paragraph. Untagged
 *      dialogue inherits the nearest tagged speaker in the same paragraph, unless narration
 *      between them has a speech verb of its own or names someone else ("they cried out",
 *      "Five … called out"). Source flips to "propagated".
 *
 * Measured on Alice VII–VIII (2026-10-10, RESEARCH §10.4): the old pass took any name within
 * 18 characters of any verb anywhere in the narration, and it and propagation made 9 of the
 * 10 misses. Per the JustWrite audit: anchors WIN over LLM on tie-break.
 */
export function findAnchors(segments, characters) {
  const nameRe = _buildNameRegex(characters);
  const verbRe = _buildVerbRegex();
  const nameToId = _nameToId(characters);
  const nameAlt = _nameAlternation(characters);
  const tagRes = nameAlt === null ? null : _buildTagRegexes(nameAlt, DIALOGUE_VERBS.join("|"));

  const anchors = new Map();
  const attach = (seg, tag) => {
    if (!seg || seg.kind !== "dialogue") return;
    const did = seg.dialogue_id ?? null;
    if (did === null || anchors.has(did)) return;
    const speakerId = nameToId.get(tag.name.toLowerCase());
    if (speakerId) anchors.set(did, new Anchor({ speaker: speakerId, source: "tag", words: tag.words }));
  };

  // ── Pass 1: the clause that touches the quote ────────────────
  segments.forEach((seg, i) => {
    if (seg.kind !== "narration" || !tagRes) return;
    const text = get(seg, "text", "");
    if (!text) return;
    const tags = _tags(text, tagRes);
    if (!tags.length) return;
    const masked = _masked(text, nameRe);
    const para = seg.paragraph_idx ?? null;
    const before = segments[i - 1];
    const after = segments[i + 1];
    // The speech before: a tag that opens the narration ("said Alice", "the March Hare said to
    // Alice") — words before it ("and the Dormouse sulkily remarked") start a new clause that
    // belongs to the speech after.
    if (before && (before.paragraph_idx ?? null) === para) {
      const t = tags[0];
      if (masked.slice(0, t.at).replace(LEADING, "") === "") attach(before, t);
    }
    // The speech after: a tag that closes the narration, at most an -ly adverb after it ("the
    // Queen said severely"), bar the punctuation before the quote.
    if (after && (after.paragraph_idx ?? null) === para) {
      const t = tags[tags.length - 1];
      if (TAIL_OK.test(masked.slice(t.stop).replace(TRAILING, ""))) attach(after, t);
    }
  });

  // ── Pass 2: forward + backward propagation (per paragraph) ───
  // Untagged dialogue inherits the most-recent tagged speaker WITHIN THE SAME PARAGRAPH —
  // paragraph boundaries are speaker-change cues in most narrative styles — but never across
  // narration that tags a speech of its own (a speech verb) or names someone else.
  // Cross-paragraph attribution is left to the LLM.
  const byPara = new Map();
  for (const s of segments) {
    const p = get(s, "paragraph_idx", 0);
    if (!byPara.has(p)) byPara.set(p, []);
    byPara.get(p).push(s);
  }
  // Narration breaks the chain when it names someone else, or has a speech verb — except,
  // going forward, a verb in a tag naming the same speaker ("the Rabbit whispered in a
  // frightened tone" carries the Rabbit on to his next words). Going back, any tag breaks it: a
  // tag that closes its narration brings in the speech after it ("“Sh! sh!” and the Dormouse
  // sulkily remarked, “If you can't…”" — the "Sh! sh!" isn't his).
  const breaks = (narration, speaker, forward) => {
    const text = get(narration, "text", "");
    for (const m of text.matchAll(nameRe)) if (nameToId.get(m[0].toLowerCase()) !== speaker) return true;
    let rest = text;
    if (forward && tagRes) {
      for (const t of _tags(text, tagRes)) {
        if (nameToId.get(t.name.toLowerCase()) === speaker) rest = rest.slice(0, t.at) + " ".repeat(t.stop - t.at) + rest.slice(t.stop);
      }
    }
    return new RegExp(verbRe.source, "iu").test(rest);
  };
  const sweep = (paraSegs, forward) => {
    let last = null;
    for (const s of paraSegs) {
      if (s.kind === "narration") {
        if (last !== null && breaks(s, last.speaker, forward)) last = null;
        continue;
      }
      const did = s.dialogue_id ?? null;
      if (anchors.has(did)) last = anchors.get(did);
      else if (last !== null) anchors.set(did, new Anchor({ speaker: last.speaker, source: "propagated", words: last.words }));
    }
  };
  for (const paraSegs of byPara.values()) {
    sweep(paraSegs, true); // forward
    sweep([...paraSegs].reverse(), false); // backward — covers dialogue BEFORE the first tag
  }

  return anchors;
}
