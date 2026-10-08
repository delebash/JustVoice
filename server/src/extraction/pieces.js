// SPDX-License-Identifier: MIT
// Cut a chapter too long for the model into pieces (2026-09-28) — the port of
// justvoice/extraction/pieces.py.
//
// The plan is `docs/plans/2026-09-28-chapter-splitting.md`. A piece is a range of whole
// paragraphs — a paragraph is a speaking turn and its tag ("…," said Hale) must stay with its
// line, so a cut never falls inside one. Each piece after the first starts with a LEAD-IN: the
// last few paragraphs of the piece before, sent for context (who spoke last, who "she" is).
// The lead-in's lines are answered again by the model and thrown away — the earlier piece OWNS
// them.
//
// Pure: the caller measures what each paragraph costs (its text plus the answer it will need)
// and how much room one call has; this module only decides where the cuts go.

import { PY_WS, strip, ValueError } from "@delebash/llm-runner/platform/py";

// A paragraph that is only a scene-break mark: "***", "* * *", "---", "#", "~" (fullmatch).
const _BREAK = new RegExp(`^[${PY_WS}*#~=_\\-–—•·.]+$`, "u");

/** A range of paragraphs: `lead` = the first paragraph sent (the lead-in starts here), `start`
 * = the first this piece owns, `end` = one past the last it owns. Compared by value. */
export class Piece {
  constructor(lead, start, end) {
    this.lead = lead;
    this.start = start;
    this.end = end;
    Object.freeze(this);
  }
  /** A key for sets (Python's frozen dataclass hashes by value). */
  get key() {
    return `${this.lead}:${this.start}:${this.end}`;
  }
}

/** One paragraph alone does not fit the room a call has. */
export class ParagraphTooBig extends ValueError {
  constructor(index) {
    super(`paragraph ${index} does not fit on its own`);
    this.name = "ParagraphTooBig";
    this.index = index;
  }
}

export function isBreak(paragraph) {
  return strip(paragraph) !== "" && _BREAK.test(paragraph);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * Cut paragraphs with these `costs` into pieces that each fit `room`.
 *
 * Greedy from the front: a piece takes as many paragraphs as fit alongside its lead-in. When a
 * scene break falls in the last quarter of a piece, the cut moves to just after it — a scene
 * change is the one place a reader loses nothing. A lead-in that leaves no room for even one
 * paragraph is dropped; a paragraph that does not fit on its own throws ParagraphTooBig.
 */
export function planPieces(costs, room, leadIn, breaks = null) {
  const brk = breaks instanceof Set ? breaks : new Set(breaks || []);
  const n = costs.length;
  const pieces = [];
  let start = 0;
  while (start < n) {
    let lead = pieces.length ? Math.max(start - leadIn, 0) : 0;
    if (sum(costs.slice(lead, start)) + costs[start] > room) {
      lead = start; // the lead-in is a nicety, the paragraph is not
      if (costs[start] > room) throw new ParagraphTooBig(start);
    }
    let used = sum(costs.slice(lead, start));
    let end = start;
    while (end < n && used + costs[end] <= room) {
      used += costs[end];
      end += 1;
    }
    if (end < n) {
      const floor = start + Math.max(1, Math.floor((3 * (end - start)) / 4));
      let cut = null;
      for (let i = end - 1; i >= floor; i--) {
        if (brk.has(i)) {
          cut = i + 1;
          break;
        }
      }
      if (cut !== null) end = cut;
    }
    pieces.push(new Piece(lead, start, end));
    start = end;
  }
  return pieces;
}
