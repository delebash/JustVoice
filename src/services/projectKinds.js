// SPDX-License-Identifier: MIT
//
// A project's kind — its icon and its name — in ONE map (decided 2026-10-06,
// the one-wording audit B9: it read *game* / *Game voicelines* / *Game
// dialogue* / *Games* and *Custom* / *Text* / *Plain text* across six
// screens). Keyed by the server's `project_type`; `kind` is the nav kind
// activeProject and copy.js use. What a kind calls its chapters is copy.js's
// (`chapterWordForKind`), never a second list.

export const PROJECT_KINDS = {
  audiobook: { kind: "audiobook", icon: "📖", name: "Audiobook", plural: "Audiobooks" },
  game_voicelines: { kind: "game", icon: "🎮", name: "Game", plural: "Games" },
  podcast: { kind: "podcast", icon: "🎙️", name: "Podcast", plural: "Podcasts" },
  custom: { kind: "text", icon: "📄", name: "Text", plural: "Text" },
};

/** A project_type's entry; an unknown type reads as Text. */
export const projectKind = (type) => PROJECT_KINDS[type] || PROJECT_KINDS.custom;

/** The same entry by nav kind (audiobook · game · podcast · text). */
export const projectKindByNav = (kind) => Object.values(PROJECT_KINDS).find((k) => k.kind === kind) || null;

/** "📖 Audiobook" — a kind as a label. */
export const kindLabel = (type) => `${projectKind(type).icon} ${projectKind(type).name}`;
