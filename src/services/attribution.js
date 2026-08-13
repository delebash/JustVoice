// SPDX-License-Identifier: MIT
/**
 * The words and shapes speaker attribution is described with — ONE copy, read
 * by both surfaces that render a pipeline result: Studio · Script (the
 * chapter's real blocks) and the attribution Lab's AttributionResult (a
 * throwaway run against pasted or borrowed text).
 *
 * The two surfaces keep their own containers — a full-width table with a
 * header vs a narrow scrolling column — because those are genuinely different
 * jobs. What must never differ is the vocabulary: the same chip for the same
 * `source`, the same human words for the same route, the same explanation of
 * what either one means. Before this module the two had drifted (Studio grew a
 * `manual` chip the Lab never had; the Lab wrote a `corrected` source with no
 * chip at all; Studio printed the raw route key where the Lab printed the
 * approved words), and neither offered any legend at all.
 *
 * Design law: the chip CLASSES are canonical in styles.css (`.jv-source-chip`),
 * not scoped to either component.
 */

// ── The route the run took ────────────────────────────────────────────────
// The pipeline reports "guided" / "direct". Those are internal keys and the
// copy law (design-law checklist #5) keeps them off the screen.
const ROUTE_WORDS = { guided: "with examples", direct: "rules only" };

export function routeWords(route) {
  return ROUTE_WORDS[route] || route || "";
}

// ── Who decided a row's speaker ───────────────────────────────────────────
// `source` is the audit trail of a four-step pipeline, and it is the only
// thing recording that a chapter was analyzed at all. Order matches the order
// the pipeline decides in.
export const SOURCE_LEGEND = [
  ["narration", "Prose, not speech — the segmenter split it out and the model never saw it as a question."],
  ["tag", "A dialogue tag next to the line named the speaker (“…,” said Hale). Found by pattern, no model involved."],
  ["propagated", "No tag on this line, so it inherited the speaker from the nearest tagged line in the same paragraph."],
  ["llm", "The model worked it out from context, and was confident enough to keep."],
  ["floored", "The model answered but was too unsure, so the answer was dropped and the line left with no speaker."],
  ["corrected", "You set this one. Re-analyzing leaves it exactly as it is."],
  ["manual", "A block you wrote or pasted yourself — nothing has attributed it."],
];

const SOURCE_MEANINGS = Object.fromEntries(SOURCE_LEGEND);

export function sourceMeaning(source) {
  return SOURCE_MEANINGS[source] || "";
}

export function sourceChipClass(source) {
  return SOURCE_MEANINGS[source]
    ? `jv-source-chip jv-source-chip--${source}`
    : "jv-source-chip";
}

// ── What counts as a line, and what counts as attributed ──────────────────
// These four questions were being answered in three places with three
// different rules, and they had already drifted: Studio called a chapter
// analyzed when any block carried a pipeline `source`, ChapterView called it
// attributed when every non-marker block had a persona, and the render
// resolver skipped markers and blank text that Studio's own "unplaced"
// counter went on counting. The counters disagreed on screen.

/**
 * A music/ad direction line from a podcast import. Speaker-less BY DESIGN —
 * it is direction, not speech. Nothing may count it as unplaced, offer it a
 * voice, or refuse a render over it.
 */
export function isMarker(block) {
  return !!block?.metadata?.marker;
}

/** A line that will actually be spoken, and so needs a speaker. */
export function isSpeakable(block) {
  return !isMarker(block) && !!(block?.text || "").trim();
}

/**
 * Does this block carry speaker information at all? `source` means the
 * pipeline decided it; `persona_id` alone means an IMPORT did — podcast
 * markdown assigns every line from its `HOST:` labels, and calling those
 * chapters "not analyzed" invited one click that discarded known-correct
 * speakers and replaced them with model guesses.
 */
export function hasSpeakerInfo(block) {
  return !!block?.source || !!block?.persona_id;
}

/** Finished: every line that will be spoken knows who speaks it. */
export function isFullyAttributed(blocks) {
  const speech = (blocks || []).filter(isSpeakable);
  return speech.length > 0 && speech.every((b) => !!b.persona_id);
}

/** The lines standing between this chapter and a render. */
export function unplacedBlocks(blocks) {
  return (blocks || []).filter((b) => isSpeakable(b) && !b.persona_id);
}

// ── Shared reads ──────────────────────────────────────────────────────────

/**
 * A chapter's prose = its blocks' text in order. Studio builds this to feed
 * Analyze; the Lab builds it to fill its chapters picker. Same function, and
 * it was written twice.
 */
export function proseFromBlocks(blocks) {
  return (blocks || []).map((b) => b.text).filter(Boolean).join("\n\n").trim();
}
