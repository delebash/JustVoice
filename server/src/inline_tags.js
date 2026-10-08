// SPDX-License-Identifier: MIT
// Inline expression tag parser — `[laugh]`, `[pause:0.5s]`, `[whisper]...[/whisper]`,
// `[speed:0.7]...[/speed]`, `[pitch:-3]...[/pitch]` (the port of justvoice/inline_tags.py).
//
// Produces a token stream for engines whose text format IS this markup (Chatterbox-Turbo,
// MOSS-TTSD). Every other engine strips instead, via `strip()` below, which is the only name
// render_core imports. (Qwen3 takes direction as prose in its instruct field and strips like
// Kokoro — corrected 2026-08-22; a real tag→prose translation is separate work.)
//
// Python's `\w` and `\d` are Unicode on str; the patterns use the kit's `W` class with the
// `u` flag.

import { splitWs } from "@delebash/llm-runner/platform/py";

export class TextToken {
  constructor(text) {
    this.text = text;
  }
}

export class TagToken {
  /** `name`: 'laugh', 'pause', 'whisper', … ; `arg`: '0.5s' for pause, '0.7' for speed;
   * `open`: true for [whisper], false for [/whisper], null for atomic. */
  constructor(name, arg = null, open = null) {
    this.name = name;
    this.arg = arg;
    this.open = open;
  }
}

// Atomic tags carry one inline cue; span tags wrap a region.
export const ATOMIC = new Set(["laugh", "sigh", "cough", "breath", "gasp", "chuckle", "pause"]);
export const SPANS = new Set(["whisper", "speed", "pitch"]);

const WORD = "[\\p{L}\\p{N}_]"; // Python's \w
const ARG = "[-.\\p{L}\\p{N}_]"; // Python's [-\d.\w]
// `\[(/?)(\w+)(?::([-\d.\w]+))?\]`
const TAG_RE = new RegExp(`\\[(\\/?)(${WORD}+)(?::(${ARG}+))?\\]`, "gu");

/** Tokenize `text` into a flat stream of literal-text + tag tokens. */
export function parse(text) {
  const tokens = [];
  let pos = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > pos) tokens.push(new TextToken(text.slice(pos, start)));
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    const arg = m[3] ?? null;
    if (ATOMIC.has(name)) tokens.push(new TagToken(name, arg, null));
    else if (SPANS.has(name)) tokens.push(new TagToken(name, arg, !closing));
    else tokens.push(new TextToken(m[0])); // unknown tag — pass through as literal text
    pos = end;
  }
  if (pos < text.length) tokens.push(new TextToken(text.slice(pos)));
  return tokens;
}

// What `strip` treats as a tag: TAG_RE's shape, but a name may be a few words — Chatterbox
// Turbo's `[clear throat]` is one tag, and on an engine without tags it must go like
// `[cough]` does rather than be read aloud.
// `\[(/?)([A-Za-z][\w ]{0,40}?)(?::([-\d.\w]+))?\]`
const STRIP_RE = new RegExp(`\\[(\\/?)([A-Za-z](?:${WORD}| ){0,40}?)(?::(${ARG}+))?\\]`, "gu");

const normName = (s) => splitWs(s).join(" ").toLowerCase();

/**
 * Drop every `[tag]` whose name is not in `keep` — known or not. A tag the rendering engine
 * does not list can never be performed, only spoken, so it goes (the podcast demo's "[warm]"
 * came out as the word "warm" until 2026-09-29). `keep` = the names the engine performs;
 * null or empty drops every tag. Bracketed text such as "[sic]" is a tag by this shape and
 * is dropped too — decided with the rule.
 */
export function strip(text, keep = null) {
  const k = keep && [...keep].length ? new Set([...keep].map(normName)) : new Set();
  return text.replace(STRIP_RE, (m0, _slash, name) => (k.has(normName(name)) ? m0 : ""));
}
