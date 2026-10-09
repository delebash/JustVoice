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
// attribution does and keeps the preference with it.
export const PREFER_LOCAL_FEATURES = new Set(["speaker_attribution", "speaker_discovery", "speaker_second_look"]);

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
  e("speaker_attribution", "Speaker attribution", "Extracts who says what and what they say.", "Analysis"),
  e("compose", "Compose", "Draft text from a prompt in the editor.", "Editing"),
  e(
    "refine",
    "Dictation cleanup",
    "Cleans your dictated text in one pass — what it fixes follows your Capture toggles.",
    "Editing",
  ),
  e("persona_rewrite", "Persona rewrite", "Rewrite text in a persona's voice.", "Editing"),
  e("voice_gender", "Voice gender guess", "Label fetched voices the dictionary doesn't know.", "Voices"),
];
