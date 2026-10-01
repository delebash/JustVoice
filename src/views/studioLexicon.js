// SPDX-License-Identifier: MIT
//
// Overview's "Pronunciation lexicon" row — what it offers and what it shows
// as chosen. Extracted so it can be pinned by a test without mounting the
// view (as studioSteps.js and studioStatus.js are).
//
// The project's lexicon (`default_lexicon_id`) is read on every line of the
// book, before the lexicon of the persona that speaks the line (server:
// render_core.line_lexicons). Decided 2026-09-30,
// docs/plans/2026-09-30-project-lexicon.md.

/**
 * @param {Array<{id, name, scope?, project_id?}>} lexicons  the library
 * @param {{id, default_lexicon_id?}} project
 * @returns {{options: Array<{id, label}>, chosen: string}}  `chosen` is ""
 *   for None, and otherwise always the project's own id: the render reads it,
 *   so the row must never say None while it does.
 */
export function lexiconChoices(lexicons, project) {
  const all = lexicons || [];
  // This book's own first, then the reusable ones. A lexicon made for one
  // persona or for another book is not offered.
  const listed = [
    ...all.filter((l) => l.scope === "project" && l.project_id === project?.id),
    ...all.filter((l) => (l.scope || "global") === "global"),
  ];
  // …unless the project already points at it (a .justvoice.zip import can):
  // a live choice must never read as None.
  const chosen = project?.default_lexicon_id || "";
  const current = all.find((l) => l.id === chosen);
  if (current && !listed.includes(current)) listed.push(current);
  const options = [{ id: "", label: "None" }, ...listed.map((l) => ({ id: l.id, label: l.name }))];
  // Not in the list the page holds — the list is older than the project (an
  // import made the lexicon since) or failed to load. Say so; never an id.
  if (chosen && !current) options.push({ id: chosen, label: "(lexicon not found)" });
  return { options, chosen };
}
