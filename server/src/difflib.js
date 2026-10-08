// SPDX-License-Identifier: MIT
// Python's `difflib.SequenceMatcher` (CPython 3.12 Lib/difflib.py), ported line for line so
// the matching blocks, opcodes and ratios are exactly Python's — alignment.js times a
// line's known words through it, and projects_api's chapter-text edit plans lines with it.
// Elements are compared with `===` (strings, numbers); a sequence is an array or a string.
// Candidate for platform/ (a stdlib port, as py.js is).

/** A matching block: `a[i:i+size] == b[j:j+size]` (Python's `Match(a, b, size)`). */
export class Match {
  constructor(a, b, size) {
    this.a = a;
    this.b = b;
    this.size = size;
  }

  /** The tuple form `(a, b, size)`. */
  toArray() {
    return [this.a, this.b, this.size];
  }
}

const calculateRatio = (matches, length) => (length ? (2.0 * matches) / length : 1.0);

export class SequenceMatcher {
  /**
   * `isjunk(elt)` marks junk elements of b (or null); `autojunk` drops "popular" elements
   * of b (more than 1% + 1 of a b of 200 or more) as Python does by default.
   */
  constructor(isjunk = null, a = "", b = "", autojunk = true) {
    this.isjunk = isjunk;
    this.a = null;
    this.b = null;
    this.autojunk = autojunk;
    this.setSeqs(a, b);
  }

  setSeqs(a, b) {
    this.setSeq1(a);
    this.setSeq2(b);
  }

  setSeq1(a) {
    if (a === this.a) return;
    this.a = a;
    this.matchingBlocks = null;
    this.opcodes = null;
  }

  setSeq2(b) {
    if (b === this.b) return;
    this.b = b;
    this.matchingBlocks = null;
    this.opcodes = null;
    this.fullbcount = null;
    this._chainB();
  }

  _chainB() {
    const b = this.b;
    const b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let indices = b2j.get(elt);
      if (!indices) b2j.set(elt, (indices = []));
      indices.push(i);
    }
    // Purge junk elements
    const junk = new Set();
    if (this.isjunk) {
      for (const elt of b2j.keys()) if (this.isjunk(elt)) junk.add(elt);
      for (const elt of junk) b2j.delete(elt);
    }
    // Purge popular elements that are not junk
    const popular = new Set();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.add(elt);
      for (const elt of popular) b2j.delete(elt);
    }
    this.b2j = b2j;
    this.bjunk = junk;
    this.bpopular = popular;
  }

  /** The longest matching block in a[alo:ahi] and b[blo:bhi] (earliest in a, then in b). */
  findLongestMatch(alo = 0, ahi = null, blo = 0, bhi = null) {
    const { a, b, b2j } = this;
    const isbjunk = (x) => this.bjunk.has(x);
    if (ahi === null) ahi = a.length;
    if (bhi === null) bhi = b.length;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    const nothing = [];
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) ?? nothing) {
        // a[i] matches b[j]
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // Extend the best by non-junk elements on each end.
    while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      !isbjunk(b[bestj + bestsize]) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    // Then suck up matching junk on each side.
    while (besti > alo && bestj > blo && isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      isbjunk(b[bestj + bestsize]) &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }
    return new Match(besti, bestj, bestsize);
  }

  /** Every matching block, ascending, adjacent ones collapsed, ending with `(len(a), len(b), 0)`. */
  getMatchingBlocks() {
    if (this.matchingBlocks !== null) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const { a: i, b: j, size: k } = x;
      if (k) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    // collapse adjacent blocks
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);
    this.matchingBlocks = nonAdjacent.map(([i, j, k]) => new Match(i, j, k));
    return this.matchingBlocks;
  }

  /** `[tag, i1, i2, j1, j2]` tuples ("replace" | "delete" | "insert" | "equal"). */
  getOpcodes() {
    if (this.opcodes !== null) return this.opcodes;
    let i = 0;
    let j = 0;
    const answer = [];
    for (const { a: ai, b: bj, size } of this.getMatchingBlocks()) {
      let tag = "";
      if (i < ai && j < bj) tag = "replace";
      else if (i < ai) tag = "delete";
      else if (j < bj) tag = "insert";
      if (tag) answer.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      // the list of matching blocks is terminated by a sentinel with size 0
      if (size) answer.push(["equal", ai, i, bj, j]);
    }
    this.opcodes = answer;
    return answer;
  }

  /** 2.0 * M / T — M matches, T total elements of both sequences; 1.0 for two empties. */
  ratio() {
    const matches = this.getMatchingBlocks().reduce((s, m) => s + m.size, 0);
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  /** An upper bound on ratio(), relatively quickly. */
  quickRatio() {
    if (this.fullbcount === null) {
      this.fullbcount = new Map();
      for (const elt of this.b) this.fullbcount.set(elt, (this.fullbcount.get(elt) ?? 0) + 1);
    }
    const avail = new Map();
    let matches = 0;
    for (const elt of this.a) {
      const numb = avail.has(elt) ? avail.get(elt) : (this.fullbcount.get(elt) ?? 0);
      avail.set(elt, numb - 1);
      if (numb > 0) matches += 1;
    }
    return calculateRatio(matches, this.a.length + this.b.length);
  }

  /** An upper bound on ratio(), very quickly. */
  realQuickRatio() {
    const la = this.a.length;
    const lb = this.b.length;
    return calculateRatio(Math.min(la, lb), la + lb);
  }
}
