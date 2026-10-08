// SPDX-License-Identifier: MIT
// Seed data for the SHARED `feature_prompts` table — every JustVoice AI action as a template
// row (the port of justvoice/seed_feature_prompts.py; ruling 9, 2026-08-05: EVERYTHING is a
// template row, nothing hardcoded — code computes variable VALUES, rows own the WORDING,
// presets own every tunable).
//
// Passed to `installLlm({featurePrompts})`. Same shape as JustWrite's: keyed by ACTION id,
// carrying feature / system / user_template / the JSON CONTRACT (json_mode; tunables live on
// presets — seed_presets). Insert-if-missing; a row the user edited in the Lab is never
// clobbered, and rows migrated from the retired `jv_feature_prompts` table land FIRST
// (engines/llm/migrate_prompts) so edits win over these defaults. Placeholder style is the
// shared renderer's `{{var}}` (fail-loud on absence).
//
// System texts import from their measured homes (extraction/prompts, extraction/identify,
// extraction/second_look, refinement) — one source, no text forks. Those modules are other
// slices' ports: this file loads once they exist, under exactly these export names.

import { IDENTIFY_SYSTEM } from "./extraction/identify.js";
import { DIRECT_SYSTEM, GUIDED_SYSTEM } from "./extraction/prompts.js";
import { SYSTEM as SECOND_LOOK_SYSTEM, USER_TEMPLATE as SECOND_LOOK_USER } from "./extraction/second_look.js";
import { _BASE_INSTRUCTIONS, _PRESERVE_TECHNICAL, _SELF_CORRECTION, _SMART_CLEANUP } from "./refinement.js";

// The one-shot analysis systems — moved here from database/seed.py when the legacy
// jv_feature_prompts seeder died (F1 Phase 2); this file is their home.
const SMART_ASSIGN_SYSTEM = `You are a casting director for an audiobook producer.

Given a list of characters with descriptions and a list of available voices
with descriptors, pick the best voice for each character. Return a JSON
object mapping characterId -> voiceId. Match on age, gender, tone, and
accent. Do not invent ids. If no voice fits, omit that character.

Return only the JSON object. No prose, no preamble.
`;

const SHOW_NOTES_SYSTEM = `You write podcast show notes. Given a transcript-style
script (segments with speaker names), produce concise markdown:

## Episode summary
2-3 sentences.

## Chapters
- One bullet per segment/topic, naming who speaks.

## Pull quotes
2 short verbatim quotes, attributed.

Return ONLY the markdown.`;

// The attribution user template — extraction/prompts' USER_TEMPLATE with the three .replace
// tokens converted to the shared {{var}} form (the pipeline passes format_characters /
// format_corrections / format_paragraphs output as variables). The placeholders are named for
// the book's speakers (2026-09-29); the words the model reads are unchanged.
const ATTR_USER_TEMPLATE = `Characters in this scene:
{{speakers}}
{{corrections}}
Paragraphs (dialogue segments tagged inline):

{{paragraphs}}

Return only the JSON array, one entry per [D#] in the order they appear.
`;

// refine.base is the TEMPLATE (the 2026-08-08 sectioned redesign): its {{…}} markers place
// the section rows' texts — each fills only when its Capture toggle is on, empty otherwise —
// so the paste order is visible in the row and the user's to change. Marker names == Capture
// flag names == row-key suffixes. The no-sections fallback line stays IN the row (ruling 9).
const REFINE_BASE_SYSTEM = `${_BASE_INSTRUCTIONS}

If no transformation sections follow, return the transcript unchanged.

{{smart_cleanup}}

{{self_correction}}

{{preserve_technical}}`;

// compose / persona_rewrite — verbatim from personas_api's f-strings (2026-08-05), the
// persona's personality lifted to a {{personality}} slot.
const COMPOSE_SYSTEM = `You are voicing a character. Their personality:

{{personality}}

Write a single, fresh in-character line they would say. Reply with the line only — no quotes, no preamble, no narration.`;

const PERSONA_REWRITE_SYSTEM = `Rewrite the user's line in this character's voice.

Character personality:
{{personality}}

Rules:
- Preserve the line's meaning.
- Match the character's diction, rhythm, vocabulary, accent markers.
- Reply with the rewritten line only — no quotes, no preamble, no narration, no explanation.`;

// voice_gender — object output → json_mode on.
const VOICE_GENDER_SYSTEM = `You label voice names by apparent gender for a text-to-speech catalog.

Given voice names (each with any description the catalog carries), return a JSON object mapping each EXACT input name to "male", "female", or "unknown". Use widely known name conventions; when a name is ambiguous, invented, or not a personal name, return "unknown" — never guess from how a word sounds.

Return only the JSON object. No prose, no preamble.`;

export const DEFAULT_FEATURE_PROMPTS = {
  // ── speaker_attribution — TWO ROUTED FEATURES (the attribution restore, approved
  // 2026-08-06). Each row routes on its own card under the SPEAKER ATTRIBUTION heading; the
  // Auto row above them picks which one runs. Array outputs → json_mode stays OFF
  // (json_object constrains to an OBJECT; the tolerant array extraction is the measured
  // contract). Positions pin the approved order Guided · Direct. Row labels live here in the
  // seed (vue-i18n cannot reach DB rows).
  "speaker_attribution.guided": {
    feature: "speaker_attribution",
    label: "Guided",
    description:
      "For small models — its system prompt carries the rules plus worked examples; small models follow better when shown. Below 0.7 confidence a pick becomes unknown.",
    system: GUIDED_SYSTEM,
    user_template: ATTR_USER_TEMPLATE,
    position: 1,
  },
  "speaker_attribution.direct": {
    feature: "speaker_attribution",
    label: "Direct",
    description:
      "For big models — the same system-prompt rules without the examples. Below 0.5 confidence a pick becomes unknown.",
    system: DIRECT_SYSTEM,
    user_template: ATTR_USER_TEMPLATE,
    position: 2,
  },
  // Discovery ("who exists?") — its own thing that runs alone, so its own FEATURE in the
  // routing list (the action key stays for its callers).
  "speaker_attribution.identify": {
    feature: "speaker_discovery",
    label: "Find new speakers",
    description: "Behind Discover: lists the speakers who talk in the text but aren't in the cast yet.",
    system: IDENTIFY_SYSTEM,
    user_template: `Known characters:
{{known_speakers}}

Manuscript text:
{{manuscript}}`,
  },
  // ── casting / production helpers ────────────────────────────────────────
  smart_assign: {
    feature: "smart_assign",
    description:
      "Matches each speaker to a persona from your library, judging age, gender and tone — the Smart-assign button on Cast.",
    system: SMART_ASSIGN_SYSTEM,
    user_template: `Characters:
{{speakers}}

Available voices:
{{personas}}

Return only the JSON object.`,
    json_mode: true,
  },
  show_notes: {
    feature: "show_notes",
    description: "Writes podcast show notes from your episode: a summary, chapter list, and pull quotes.",
    system: SHOW_NOTES_SYSTEM,
    user_template: "{{script}}",
  },
  // ── persona voice features ──────────────────────────────────────────────
  compose: {
    feature: "compose",
    description:
      "Writes a fresh line in a persona's voice, from its note on how it sounds — 🎲 Compose on a persona's page.",
    system: COMPOSE_SYSTEM,
    user_template: "Compose a line.",
  },
  persona_rewrite: {
    feature: "persona_rewrite",
    description:
      'Rewrites a line in character — from the speaker\'s "who they are" on Render, or the persona\'s note on its page. You see the result first and keep it or toss it.',
    system: PERSONA_REWRITE_SYSTEM,
    user_template: "{{text}}",
  },
  // ── dictation cleanup — SECTIONED (the 2026-08-08 redesign) ─────────────
  // The base row is the template (markers above); the three section rows are the texts its
  // markers place. They never run alone — one composed call — so only the base carries a
  // {{transcript}} user half.
  "refine.base": {
    feature: "refine",
    label: "The ground rules",
    description: "Fix punctuation, never answer back, never add words you didn't say.",
    system: REFINE_BASE_SYSTEM,
    user_template: "{{transcript}}",
  },
  "refine.smart_cleanup": {
    feature: "refine",
    label: "Remove filler",
    description: 'Drops the ums, uhs and "you know"s, adds sentence punctuation.',
    system: _SMART_CLEANUP,
  },
  "refine.self_correction": {
    feature: "refine",
    label: "Take your corrections",
    description: 'Say "no wait — make that Tuesday" and only Tuesday survives.',
    system: _SELF_CORRECTION,
  },
  "refine.preserve_technical": {
    feature: "refine",
    label: "Keep technical words",
    description: '"index dot tsx" comes out as index.tsx, exactly as spoken.',
    system: _PRESERVE_TECHNICAL,
  },
  // ── Analyze's second look (2026-10-05) — its own card, so its Lab column runs this prompt
  // (under speaker_attribution the attribution Lab adapter would run it as the main call).
  speaker_second_look: {
    feature: "speaker_second_look",
    description:
      "Asks once more about a spoken line Analyze left with no speaker, with the " +
      "chapters either side — a speaker unseen in one chapter is often named in " +
      "the next. Its answers are marked to check.",
    system: SECOND_LOOK_SYSTEM,
    user_template: SECOND_LOOK_USER,
    json_mode: true,
  },
  // ── voices ──────────────────────────────────────────────────────────────
  voice_gender: {
    feature: "voice_gender",
    description:
      "Labels voices male or female when the name alone doesn't tell you — runs only when you click the ✨ button on Voices.",
    system: VOICE_GENDER_SYSTEM,
    user_template: `Voices:
{{voices}}

Return only the JSON object.`,
    json_mode: true,
  },
};
