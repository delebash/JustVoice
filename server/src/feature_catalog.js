// SPDX-License-Identifier: MIT
// JustVoice's AI feature catalog — the per-app data `installLlm` registers (the port of
// justvoice/feature_catalog.py). The catalog + prefer-local set are INSTALL inputs, not
// dispatch-config concerns (the family shape, JustWrite's feature_catalog). Labels match the
// routing surface.

import { FeatureCatalogEntry } from "@delebash/llm-runner/llm";

const e = (key, label, hint, group) => FeatureCatalogEntry({ key, label, hint, group });

// Features that prefer the built-in llama.cpp runner when nothing more specific is
// configured (privacy-sensitive, accuracy-critical work). Passed to
// installLlm({preferLocalFeatures}). speaker_discovery reads the same manuscript text
// attribution does and keeps the preference with it, and so does direction (2026-10-16).
export const PREFER_LOCAL_FEATURES = new Set(["speaker_attribution", "speaker_discovery", "speaker_second_look", "direction"]);
// The one-click plan's slice 4 reads the same manuscript text (Discover's names and quotes, the
// lines around a group line) and keeps the preference with it.
PREFER_LOCAL_FEATURES.add("speaker_merge");
PREFER_LOCAL_FEATURES.add("speaker_group");
// Voices from the book (slice 3) reads the book's text about each speaker and keeps it too.
PREFER_LOCAL_FEATURES.add("book_voices");

export const FEATURE_CATALOG = [
  // ANALYSIS order (user QC 2026-08-06): the plain single cards FIRST, the SPEAKER
  // ATTRIBUTION-headed block LAST — a sub-heading's scope only ends at the next heading, so
  // cards after it would read as belonging to it. Discovery runs alone → its own card.
  e(
    "speaker_discovery",
    "Find new speakers",
    "Behind Discover speakers: lists characters who talk in the text but aren't in your cast yet.",
    "Analysis",
  ),
  e("smart_assign", "Smart assign", "Bulk-assign detected speakers to personas.", "Analysis"),
  e("show_notes", "Show notes", "Chapter summaries for podcast descriptions.", "Analysis"),
  // SPEAKER ATTRIBUTION is a plain heading; its two routes (Guided · Direct) are routed cards
  // under it, with the app's "Auto" panel row first (the boot file, src/boot/jv.js, registers it). Analyze's second
  // look (2026-10-05) is a plain card, so it sits ABOVE the attribution heading.
  e(
    "speaker_second_look",
    "Speaker attribution · second look",
    "Asks once more about a line Analyze left with no speaker, reading the chapters either side.",
    "Analysis",
  ),
  // The one-click plan's answer 7 (slice 4, 2026-10-16) — a plain card, beside the second look.
  e(
    "speaker_group",
    "Speaker attribution · lines with no single speaker",
    "Gives a line Analyze left with no speaker — often one several people say at once — to one of them, or to the narrator, and marks it to check.",
    "Analysis",
  ),
  // The one-click plan's slice 4 (2026-10-16): Discover's names across chapters, merged. A heading
  // with two routed cards under it, Local and Frontier — the recipes (merge_names.js) — so it sits
  // with the headed blocks, after the plain cards.
  e(
    "speaker_merge",
    "Merge found names",
    'Decides which names Discover found in different chapters are one person — "the Queen" and "Queen of Hearts" — before they become speakers.',
    "Analysis",
  ),
  e("speaker_attribution", "Speaker attribution", "Extracts who says what and what they say.", "Analysis"),
  // DIRECTION — the one-click audiobook's step 6 (slice 2, 2026-10-16): a heading of its own with
  // its two recipes as routed cards (Local · Frontier), after attribution's block for the same
  // reason that block is last.
  e(
    "direction",
    "Direction",
    "Marks how each spoken line should be said, where the text gives a reason — one of nine emotions and a few words of direction.",
    "Analysis",
  ),
  e("compose", "Compose", "Draft text from a prompt in the editor.", "Editing"),
  e(
    "refine",
    "Dictation cleanup",
    "Cleans your dictated text in one pass — what it fixes follows your Capture toggles.",
    "Editing",
  ),
  e("persona_rewrite", "Persona rewrite", "Rewrite text in a persona's voice.", "Editing"),
  e("voice_gender", "Voice gender guess", "Label fetched voices the dictionary doesn't know.", "Voices"),
  // The one-click run's step 5 (slice 3): its rows are the two recipes (book_voices/prompts.js).
  e(
    "book_voices",
    "Voices from the book",
    "Describes each main speaker's voice from how the book shows them, and the narrator's from the book's genre and tone.",
    "Voices",
  ),
];
