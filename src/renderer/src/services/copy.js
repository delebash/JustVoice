// SPDX-License-Identifier: GPL-3.0-or-later
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

import { computed } from "vue";
import { useOnboarding } from "../stores/onboarding.js";

const TERMS = {
  audiobook: {
    book:    { singular: "Book",    plural: "Books"    },
    chapter: { singular: "Chapter", plural: "Chapters" },
    cast:    { singular: "Cast",    plural: "Cast"     },
    line:    { singular: "Line",    plural: "Lines"    },
  },
  game: {
    book:    { singular: "Voice line set", plural: "Voice line sets" },
    chapter: { singular: "Scene",          plural: "Scenes"          },
    cast:    { singular: "NPC",            plural: "NPCs"            },
    line:    { singular: "Voiceline",      plural: "Voicelines"      },
  },
  podcast: {
    book:    { singular: "Episode", plural: "Episodes" },
    chapter: { singular: "Segment", plural: "Segments" },
    cast:    { singular: "Host",    plural: "Hosts"    },
    line:    { singular: "Block",   plural: "Blocks"   },
  },
  dictation: {
    book:    { singular: "Capture", plural: "Captures" },
    chapter: { singular: "Session", plural: "Sessions" },
    cast:    { singular: "Voice",   plural: "Voices"   },
    line:    { singular: "Block",   plural: "Blocks"   },
  },
  // multiple + unset both fall back to neutral terminology so neither
  // alienates the producers who didn't pick a primary use case.
  multiple: {
    book:    { singular: "Project",   plural: "Projects"   },
    chapter: { singular: "Section",   plural: "Sections"   },
    cast:    { singular: "Character", plural: "Characters" },
    line:    { singular: "Block",     plural: "Blocks"     },
  },
  unset: {
    book:    { singular: "Project",   plural: "Projects"   },
    chapter: { singular: "Section",   plural: "Sections"   },
    cast:    { singular: "Character", plural: "Characters" },
    line:    { singular: "Block",     plural: "Blocks"     },
  },
};

function dictFor(useCase) {
  return TERMS[useCase] || TERMS.unset;
}

export function useCopy() {
  const onboarding = useOnboarding();
  return computed(() => dictFor(onboarding.primaryUseCase));
}

// Plain accessor for non-component contexts (e.g. router titles).
export function copyFor(useCase) {
  return dictFor(useCase);
}
