// SPDX-License-Identifier: MIT
//
// Script's chapter page, without Vue (Studio Slice 3, §8.24 3c): which lines
// show, which line is selected, what a key does, and the changes a set, a
// swap or a "Looks right" sends — plus the undo stack. State and an input go
// in; the new state and the requests to make come out. Pure, so it is tested
// without mounting anything: the renderer gate loads the page but never
// clicks it.
//
// A "line" is one row of GET /v1/scenes/{id}/script: {id, speaker_id, source,
// confidence, spoken, speakable, marker, flags: [group index], changed,
// prev_speaker_id, metadata, …}. A "group" is one of its flag_groups:
// {check, speaker, lines: [id], turns, other}.

import { facetCounts, facetOptions } from "../services/facets.js";

/** The PATCH fields a line is restored from — everything a change touches. */
function snapshot(line) {
  return {
    speaker_id: line.speaker_id ?? null,
    source: line.source ?? null,
    extraction_confidence: line.confidence ?? null,
    metadata: { ...(line.metadata || {}) },
  };
}

// ── What a line needs ─────────────────────────────────────────────────────

/** Spoken or narrated, not a marker — a line the render reads. */
export function isReadable(line) {
  return !!line.speakable && !line.marker;
}

/** A line the render stops on that someone has to look at. Narration in a book
 *  with no narrator is not one: it waits for the narrator (`waits_for_narrator`,
 *  the server's — one ＋ Add Narrator fixes all of it, decided 2026-10-05). */
export function hasNoSpeaker(line) {
  return isReadable(line) && !line.speaker_id && !line.waits_for_narrator;
}

/** "To check": a flagged line, or one with no speaker. */
export function toCheck(line) {
  return (line.flags || []).length > 0 || hasNoSpeaker(line);
}

// ── Filters ───────────────────────────────────────────────────────────────

export const FILTERS = ["all", "check", "none", "changed"];

function passes(line, filter) {
  if (filter === "check") return toCheck(line);
  if (filter === "none") return hasNoSpeaker(line);
  if (filter === "changed") return !!line.changed;
  return true;
}

/** Each filter's count — a filter's number is the number of rows it shows.
 *  "All" counts a chapter's scene-break markers too, because it lists them
 *  (until 2026-10-05 it skipped them, so "All 120" showed 120 + the breaks). */
export function filterCounts(lines) {
  const out = { all: 0, check: 0, none: 0, changed: 0 };
  for (const ln of lines) {
    for (const f of FILTERS) if (passes(ln, f)) out[f] += 1;
  }
  return out;
}

/**
 * The chips and the speaker filter, each counted under the other (decided
 * 2026-10-05: filters narrow each other) — "No speaker 12" under a speaker used
 * to show nothing, and a speaker's number was the chapter's, whatever the chip.
 * → { chips: {all, check, none, changed}, speakers: {speakerId: n} }
 */
export function lineFacets(lines, { filter = "all", speaker = "all" } = {}) {
  const fs = [
    { key: "chip", value: filter, empty: "all", test: passes },
    { key: "speaker", value: speaker, empty: "all", test: (ln, s) => ln.speaker_id === s },
  ];
  return {
    chips: facetCounts(lines, fs, "chip", FILTERS, passes),
    speakers: Object.fromEntries(
      facetOptions(lines, fs, "speaker", (ln) => ln.speaker_id, (id) => id).map((o) => [o.value, o.n])),
  };
}

/**
 * The rows shown, in reading order. `speaker` narrows to one persona ("all"
 * for everyone). `around` adds the line either side of each shown line —
 * "Show the lines around" for a filtered view.
 */
export function visibleLines(lines, { filter = "all", speaker = "all", around = false } = {}) {
  const hit = lines.map((ln) => passes(ln, filter) && (speaker === "all" || ln.speaker_id === speaker));
  if (!around || (filter === "all" && speaker === "all")) return lines.filter((_, i) => hit[i]);
  return lines.filter((_, i) => hit[i] || hit[i - 1] || hit[i + 1]);
}

// ── Selection and movement ────────────────────────────────────────────────

/** The line `delta` rows from the selected one among those shown (clamped). */
export function move(shown, selectedId, delta) {
  if (!shown.length) return null;
  const at = shown.findIndex((ln) => ln.id === selectedId);
  if (at < 0) return shown[delta < 0 ? shown.length - 1 : 0].id;
  return shown[Math.max(0, Math.min(shown.length - 1, at + delta))].id;
}

/**
 * The next (dir 1) or previous (dir -1) line to check from the selected one,
 * in reading order over EVERY line — "Next to check" walks the chapter, not
 * only what a filter shows. It wraps (decided 2026-09-29): past the last it
 * starts again from the top, going back past the first from the bottom — so a
 * chapter with one line to check always lands on it, even when it is the one
 * selected. Null only when the chapter has none.
 */
export function nextToCheck(lines, selectedId, dir = 1) {
  const n = lines.length;
  const at = lines.findIndex((ln) => ln.id === selectedId);
  const from = at >= 0 ? at : dir > 0 ? -1 : n;
  for (let step = 1; step <= n; step += 1) {
    const i = (((from + dir * step) % n) + n) % n;
    if (toCheck(lines[i])) return lines[i].id;
  }
  return null;
}

// ── Speakers ──────────────────────────────────────────────────────────────

/**
 * Keys 1–9: this chapter's speakers, most lines first (the Narrator is 0).
 * `speakers` is the page's list ({speaker_id, name, lines}).
 */
export function numberKeys(speakers, narratorId) {
  return speakers
    .filter((s) => s.speaker_id !== narratorId && s.lines > 0)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 9)
    .map((s) => s.speaker_id);
}

/**
 * The speaker dropdown's options: the narrator, then the book's speakers by
 * lines in this chapter. (A removed speaker takes their lines' speaker with
 * them since 2026-09-29, so no line points at someone outside this list.)
 */
export function speakerOptions(speakers, narratorId) {
  const narrator = speakers.filter((s) => s.speaker_id === narratorId);
  const rest = speakers.filter((s) => s.speaker_id !== narratorId)
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  return [...narrator, ...rest].map((s) => ({ value: s.speaker_id, label: s.name }));
}

// ── Changes ───────────────────────────────────────────────────────────────
//
// A change is {id, before, after}: `after` is the PATCH to send, `before` the
// PATCH that puts the line back. `fixId` is added once the server answers.

/** Give these lines to one speaker. Lines that already have them are skipped. */
export function setSpeaker(lines, ids, speakerId) {
  const want = new Set(ids);
  return lines
    .filter((ln) => want.has(ln.id) && isReadable(ln) && ln.speaker_id !== speakerId)
    .map((ln) => ({ id: ln.id, before: snapshot(ln), after: { speaker_id: speakerId, source: "corrected" } }));
}

/** Every line that shares a mark with this one ("✓ Looks right" takes the whole mark). */
export function markOf(groups, lines, id) {
  const line = lines.find((ln) => ln.id === id);
  const ids = new Set([id]);
  for (const gi of line?.flags || []) for (const other of groups[gi]?.lines || []) ids.add(other);
  return [...ids];
}

/** "Looks right": the lines become yours, speaker unchanged. */
export function confirm(lines, ids) {
  const want = new Set(ids);
  return lines
    .filter((ln) => want.has(ln.id) && isReadable(ln) && ln.speaker_id && ln.source !== "corrected")
    .map((ln) => ({ id: ln.id, before: snapshot(ln), after: { source: "corrected" } }));
}

/**
 * Can the ticked lines' speakers be swapped? Only when they are spoken by
 * exactly two speakers — {ok, a, b} or {ok: false, reason}.
 */
export function swapState(lines, ids) {
  const want = new Set(ids);
  const picked = lines.filter((ln) => want.has(ln.id) && isReadable(ln));
  const who = [...new Set(picked.map((ln) => ln.speaker_id))];
  if (!picked.length) return { ok: false, reason: "Tick the lines to swap." };
  if (who.includes(null) || who.includes(undefined)) {
    return { ok: false, reason: "A ticked line has no speaker — give it one first." };
  }
  if (who.length !== 2) {
    return {
      ok: false,
      reason: who.length < 2
        ? "The ticked lines all have one speaker — swapping needs two."
        : `The ticked lines have ${who.length} speakers — swapping needs exactly two.`,
    };
  }
  return { ok: true, a: who[0], b: who[1] };
}

/** Swap the two speakers across the ticked lines: each line goes to the other one. */
export function swap(lines, ids) {
  const st = swapState(lines, ids);
  if (!st.ok) return [];
  const want = new Set(ids);
  return lines
    .filter((ln) => want.has(ln.id) && isReadable(ln))
    .map((ln) => ({
      id: ln.id,
      before: snapshot(ln),
      after: { speaker_id: ln.speaker_id === st.a ? st.b : st.a, source: "corrected" },
    }));
}

/**
 * "✎ Edit…" → Save: the line's new words, as one change Undo can take back.
 * Nothing when the words are blank or unchanged.
 */
export function editText(lines, id, text) {
  const line = lines.find((ln) => ln.id === id);
  const words = (text ?? "").trim();
  if (!line || !words || words === line.text) return [];
  // Only the words go back: a speaker Undo never re-sends a line's text.
  return [{ id, before: { text: line.text }, after: { text: words } }];
}

/**
 * Can the ticked lines merge? Two or more readable lines that sit next to each
 * other — {ok, ids, takes} with `ids` in reading order and `takes` the rendered
 * takes merging deletes (every line's but the first), or {ok: false, reason}.
 * `lines` is every line of the chapter, as the server orders them.
 */
export function mergeState(lines, ids) {
  const want = new Set(ids);
  const at = lines.map((ln, i) => (want.has(ln.id) ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return { ok: false, reason: "Tick two or more lines that sit next to each other." };
  if (at.some((i) => !isReadable(lines[i]))) return { ok: false, reason: "Only spoken or narrated lines can be merged." };
  if (at[at.length - 1] - at[0] !== at.length - 1) {
    return { ok: false, reason: "Only lines that sit next to each other can be merged." };
  }
  const picked = at.map((i) => lines[i]);
  return { ok: true, ids: picked.map((ln) => ln.id), takes: picked.slice(1).reduce((n, ln) => n + (ln.takes || 0), 0) };
}

/** The lines as they will read once `changes` land — the page shows them at once. */
export function applyLocally(lines, changes) {
  const byId = new Map(changes.map((c) => [c.id, c.after]));
  return lines.map((ln) => {
    const after = byId.get(ln.id);
    if (!after) return ln;
    const next = { ...ln };
    if ("text" in after) next.text = after.text;
    if ("speaker_id" in after) next.speaker_id = after.speaker_id;
    if ("source" in after) next.source = after.source;
    if (after.source === "corrected") {
      // Yours: no longer flagged, and no longer "changed by the last Analyze".
      next.flags = [];
      next.changed = false;
    }
    return next;
  });
}

// ── Undo ──────────────────────────────────────────────────────────────────
//
// Newest first, since the chapter was opened; leaving the chapter clears it,
// and so do an Analyze, a split and a merge — they change which lines exist.
// An entry is one action (a set, a swap, a "Looks right", an edit) and all
// its changes.

export function pushUndo(stack, changes, label) {
  return changes.length ? [{ label, changes }, ...stack] : stack;
}

/**
 * The newest entry and what undoing it takes: the PATCH bodies that put each
 * line back (never saving a fix — `no_fix`), and the fixes the change saved,
 * to delete.
 */
export function popUndo(stack) {
  if (!stack.length) return { entry: null, rest: stack, patches: [], fixIds: [] };
  const [entry, ...rest] = stack;
  return {
    entry,
    rest,
    patches: entry.changes.map((c) => ({ id: c.id, body: { ...c.before, no_fix: true } })),
    fixIds: entry.changes.map((c) => c.fixId).filter(Boolean),
  };
}

/** Who a line was before this session's latest change to it, if any ("You · was Marius"). */
export function wasBefore(stack, id) {
  for (const entry of stack) {
    const c = entry.changes.find((x) => x.id === id);
    if (c && "speaker_id" in c.after) return c.before.speaker_id;
  }
  return undefined;
}

// ── Keys ──────────────────────────────────────────────────────────────────
//
// An extra behind "Shortcuts", never the way to use the page. `ev` is a
// keydown's {key, shiftKey, ctrlKey, metaKey, altKey}; `inField` is true when
// focus is in a text field or a dropdown, where the page keeps its hands off.

export const KEYS = [
  ["j / k", "Next / previous line"],
  ["n / Shift+N", "Next / previous line to check"],
  ["1 – 9", "Give the line to that speaker (this chapter's, most lines first)"],
  ["0", "Give the line to the Narrator"],
  ["Enter", "This line looks right"],
  ["Shift+Enter", "Looks right, for every line sharing its mark"],
  ["Space", "Tick or untick the line"],
  ["[ / ]", "Previous / next chapter"],
  ["Ctrl+Z", "Undo your last change"],
];

export function keyAction(ev, inField = false) {
  if (!ev || ev.altKey) return null;
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod) return !inField && (ev.key === "z" || ev.key === "Z") && !ev.shiftKey ? { type: "undo" } : null;
  if (inField) return null;
  switch (ev.key) {
    case "j": return { type: "move", delta: 1 };
    case "k": return { type: "move", delta: -1 };
    case "n": return { type: "next", dir: 1 };
    case "N": return { type: "next", dir: -1 };
    case "Enter": return { type: "confirm", whole: !!ev.shiftKey };
    case " ": return { type: "tick" };
    case "[": return { type: "chapter", delta: -1 };
    case "]": return { type: "chapter", delta: 1 };
    default:
      if (/^[0-9]$/.test(ev.key)) return { type: "speaker", n: Number(ev.key) };
      return null;
  }
}

// ── The words on a row ────────────────────────────────────────────────────
//
// `nameOf(speakerId)` gives a speaker's name. Approved copy (§8.24, §8.25):
// "Decided by" shows the evidence, never a category; the Check column asks
// its question in terms of the conversation, naming the people.

const TIP = {
  narration: "Prose, not speech — the segmenter split it out and the model never saw it as a question.",
  tag: "The words next to the line name the speaker. Found by pattern, no AI involved.",
  propagated: "No name on this line, so it has the speaker named elsewhere in the same paragraph.",
  llm: "The AI worked it out from the lines around it, and was confident enough to keep.",
  floored: "The AI answered but was too unsure, so the answer was dropped and the line left with no speaker.",
  secondLook: "Analyze left this line with no speaker, so it asked once more with the chapters either side — a speaker unseen here is often named in the next. Worth checking.",
  noAnswer: "The AI's answer had no entry for this line.",
  noneInCast: "The AI's answer for this line wasn't anyone in the cast, so it has no speaker.",
  corrected: "You set or confirmed this one. Re-analyzing leaves it exactly as it is.",
  imported: "The speaker came with the import. Nothing has analyzed this line.",
  none: "Nothing has decided this line's speaker yet.",
};

/**
 * "Decided by": {text, sub, tip, quoted}. `quoted` means `text` is the book's
 * own words, shown in quote marks. A propagated line says whether its tag is
 * earlier or later in the paragraph.
 */
export function decidedBy(line, lines = []) {
  const src = line.source;
  if (line.marker) return { text: "♪ Marker", sub: "", tip: "Music or ad direction from the import — never spoken, never given a speaker" };
  if (src === "narration") return { text: "Narration", sub: "", tip: TIP.narration };
  if (src === "tag" || src === "propagated") {
    const words = line.anchor_words;
    let sub = "the book says so";
    if (src === "propagated") {
      const at = lines.findIndex((ln) => ln.id === line.id);
      const tagAt = lines.findIndex((ln) => ln.source === "tag" && ln.paragraph === line.paragraph
        && ln.paragraph != null && ln.anchor_words === words);
      sub = tagAt > at && at >= 0 ? "later in the same paragraph" : "earlier in the same paragraph";
    }
    return words
      ? { text: `“${words}”`, sub, tip: TIP[src], quoted: true }
      : { text: sub === "the book says so" ? "The book says so" : `Named ${sub}`, sub: "", tip: TIP[src] };
  }
  if (src === "llm") {
    // Kept above the floor but matched no one in the cast: the model named
    // someone who isn't in it (or said "unknown"), not "no answer".
    return line.speaker_id
      ? { text: "AI, from the story around it", sub: "", tip: TIP.llm }
      : { text: "AI named no one in the cast", sub: "", tip: TIP.noneInCast };
  }
  if (src === "floored") {
    return !line.floored_from || line.floored_from === "unknown"
      ? { text: "AI gave no answer", sub: "", tip: TIP.noAnswer }
      : { text: "AI wasn't sure", sub: "", tip: TIP.floored };
  }
  // The second look (2026-10-05): named from the chapters either side.
  if (src === "second_look") return { text: "AI, from the chapters around it", sub: "", tip: TIP.secondLook };
  if (src === "corrected") return { text: "You", sub: "", tip: TIP.corrected };
  return line.speaker_id
    ? { text: "From the import", sub: "", tip: TIP.imported }
    : { text: "Not analyzed yet", sub: "", tip: TIP.none };
}

/** The Check column's question for a line, or "" when it has none. */
export function checkQuestion(line, groups, nameOf, chapterWord = "chapter") {
  if (hasNoSpeaker(line)) {
    const guess = line.floored_from && line.floored_from !== "unknown" ? nameOf(line.floored_from) : "";
    if (line.source === "floored" && guess) {
      return `No speaker, so it can't render. The AI thought ${guess}, but wasn't sure.`;
    }
    if (line.source === "floored") {
      return "No speaker, so it can't render. The AI gave no answer.";
    }
    if (line.source === "llm") {
      return "No speaker, so it can't render. The AI didn't name anyone in the cast.";
    }
    return "No speaker, so it can't render.";
  }
  const g = groups[(line.flags || [])[0]];
  if (!g) return "";
  const who = nameOf(g.speaker);
  switch (g.check) {
    case "run":
      return `${who} speaks ${g.turns} times with no reply — is one of these the other person's?`;
    case "only":
      return `${who}'s only line in this ${chapterWord.toLowerCase()} — is it theirs?`;
    case "disagree":
      return `The book says ${who}, the AI says ${nameOf(g.other)} — whose line is it?`;
    case "nearby":
      return `Found in a nearby ${chapterWord.toLowerCase()} — is it ${who}?`;
    default:
      return "";
  }
}

/** The Confidence cell: {text, intent} — the app's colours (StudioView's old table). */
export function confidenceCell(line) {
  if (line.source === "corrected" || line.confidence == null || line.marker) return { text: "—", intent: null };
  // A line with no speaker shows the number only where it says why: the
  // floor dropped an answer that sure. Any other number belongs to a pick
  // that isn't on the line.
  if (hasNoSpeaker(line) && line.source !== "floored") return { text: "—", intent: null };
  const c = line.confidence;
  return { text: `${Math.round(c * 100)}%`, intent: c > 0.9 ? "success" : c > 0.8 ? "ghost" : "accent2" };
}
