// SPDX-License-Identifier: MIT
//
// useCopy() — terminology composable. The same underlying objects (a
// long-form narration, a script line, a voice profile) get different
// names depending on what the user said they were here for. Audiobook
// producers call them "books" and "chapters"; game devs call them
// "voice line sets" and "scenes"; podcasters use "episodes" and
// "segments". The renderer reads from this dict instead of hardcoding
// the audiobook vocabulary everywhere.
//
// Returns a reactive computed dict — components can destructure with
// `const { book, chapter } = useCopy()` and the bindings stay live as
// the primary-use-case selection changes (Settings → re-run welcome,
// for instance, swaps the whole vocabulary without a refresh).
//
// The people in a project are SPEAKERS for every kind (2026-09-29, "speakers
// everythwere") — no NPCs, Hosts or Characters — so there is no per-kind
// word for them here.

import { computed } from "vue";
import { useOnboarding } from "../stores/onboarding.js";
import { useActiveProject } from "../stores/activeProject.js";

const TERMS = {
  audiobook: {
    book:    { singular: "Book",    plural: "Books"    },
    chapter: { singular: "Chapter", plural: "Chapters" },
    line:    { singular: "Line",    plural: "Lines"    },
  },
  game: {
    book:    { singular: "Voice line set", plural: "Voice line sets" },
    chapter: { singular: "Scene",          plural: "Scenes"          },
    line:    { singular: "Voiceline",      plural: "Voicelines"      },
  },
  podcast: {
    book:    { singular: "Episode", plural: "Episodes" },
    chapter: { singular: "Segment", plural: "Segments" },
    line:    { singular: "Block",   plural: "Blocks"   },
  },
  dictation: {
    book:    { singular: "Capture", plural: "Captures" },
    chapter: { singular: "Session", plural: "Sessions" },
    line:    { singular: "Block",   plural: "Blocks"   },
  },
  accessibility: {
    book:    { singular: "Document", plural: "Documents" },
    chapter: { singular: "Section",  plural: "Sections"  },
    line:    { singular: "Line",     plural: "Lines"     },
  },
  // multiple + unset both fall back to neutral terminology so neither
  // alienates the producers who didn't pick a primary use case.
  multiple: {
    book:    { singular: "Project",   plural: "Projects"   },
    chapter: { singular: "Section",   plural: "Sections"   },
    line:    { singular: "Block",     plural: "Blocks"     },
  },
  unset: {
    book:    { singular: "Project",   plural: "Projects"   },
    chapter: { singular: "Section",   plural: "Sections"   },
    line:    { singular: "Block",     plural: "Blocks"     },
  },
};

function dictFor(useCase) {
  return TERMS[useCase] || TERMS.unset;
}

// The open project's kind outranks the install-time focus — when you're
// inside an audiobook, its sections are Chapters no matter what the
// workspace focus says (journeys nav contract).
const KIND_TO_USE_CASE = { audiobook: "audiobook", game: "game", podcast: "podcast", text: "multiple" };

export function useCopy() {
  const onboarding = useOnboarding();
  const activeProject = useActiveProject();
  return computed(() =>
    dictFor(KIND_TO_USE_CASE[activeProject.kind] || onboarding.primaryUseCase),
  );
}

/** What one kind calls its chapters — `{singular, plural}` — for a screen that
 *  lists projects of several kinds (Projects, Home): each row in ITS words, not
 *  the open project's (C2, 2026-10-06). `kind` is the nav kind. */
export function chapterWordForKind(kind) {
  return dictFor(KIND_TO_USE_CASE[kind] || "unset").chapter;
}

// Plain accessor for non-component contexts (e.g. router titles).
export function copyFor(useCase) {
  return dictFor(useCase);
}
