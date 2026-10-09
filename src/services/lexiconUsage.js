// SPDX-License-Identifier: MIT
//
// Lexicons' "Used by" column — who actually reads a lexicon at render
// (decided 2026-09-30, docs/plans/2026-09-30-project-lexicon.md §6 item 3).
// A lexicon is read by the books that chose it on Overview → Pronunciation
// lexicon (`default_lexicon_id`) and by the personas that carry it
// (`lexicon_id`); anything else — a book lexicon nobody chose — does nothing,
// and before this column the page gave no sign of it.

// The kind icons of ProjectsView's KIND_ICON; 🎭 is the persona's own icon.
const KIND_ICON = { audiobook: "📖", game_voicelines: "🎮", podcast: "🎙️", custom: "📄" };

/**
 * @returns {string[]} the books it's chosen for, then the personas that use
 *   it — each with its icon. Empty = not in use.
 */
export function lexiconUsedBy(lexiconId, projects, personas) {
  const books = (projects || [])
    .filter((p) => p.default_lexicon_id === lexiconId)
    .map((p) => `${KIND_ICON[p.project_type] || "📖"} ${p.name}`);
  const voices = (personas || [])
    .filter((p) => p.lexicon_id === lexiconId)
    .map((p) => `🎭 ${p.name}`);
  return [...books, ...voices];
}
