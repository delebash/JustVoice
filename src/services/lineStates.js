// SPDX-License-Identifier: MIT
//
// A line's state, and how many lines are in it — ONE set of words on every
// screen (decided 2026-10-06, the one-wording audit B5:
// docs/plans/2026-10-06-one-word-one-meaning-audit.md). The states come from
// the server (`line_takes.STATES`): needs a speaker · needs a voice · ready ·
// rendered · stale. **Rendered** means the line has a take that is current; a
// stale line has a take, but it isn't counted as rendered. A line that needs
// a speaker or a voice **can't render**. A count always names its unit — *12
// of 40 lines*, *2 of 5 chapters* — never a bare *12/40*.

/** The states a render stops on. */
export const CANT_RENDER_STATES = new Set(["needs a speaker", "needs a voice"]);

/** The word for a group of lines that can't render. */
export const CANT_RENDER = "can't render";

/** A line's state in words. A speaker with no persona at all reads *needs a
 *  persona* — the server's *needs a voice* covers both that and a persona
 *  with no voice, and they are fixed in different places (Cast · Personas). */
export function lineStateWord(state, { hasPersona = true } = {}) {
  if (state === "needs a voice" && !hasPersona) return "needs a persona";
  return state;
}

/** "1 line" · "12 lines" — the count with its unit. */
export function countOf(n, one, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "12 of 40 lines rendered" — a part of a whole, the unit always named. A
 *  grid cell under a heading that says the verb leaves it out: "12 of 40 lines". */
export function partOf(done, total, one, verb = "", many = `${one}s`) {
  return `${done.toLocaleString()} of ${countOf(total, one, many)}${verb ? ` ${verb}` : ""}`;
}

/** "1 line needs a speaker" · "3 lines need a speaker". */
export function needSpeaker(n) {
  return `${countOf(n, "line")} ${n === 1 ? "needs" : "need"} a speaker`;
}

/** A chapter is rendered when every line in it is (a stale line isn't). */
export function chapterRendered(c) {
  return c.lines > 0 && c.rendered === c.lines;
}
