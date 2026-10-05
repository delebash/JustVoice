// SPDX-License-Identifier: MIT
//
// The words the app uses for a voice's kind and how its model can be
// directed — ONE vocabulary for the persona's page, the Personas list, and
// (next) Voices and Cast (the persona redesign, 2026-10-03; plan
// docs/plans/2026-10-03-persona-redesign.md §5.5 and §6.1). The facts
// themselves come from the server: a voice's or persona's `directed_by`
// (`words` · `tags` · `sliders`) and `model_name`.

import { languageName } from "@delebash/llm-ui";
import { voiceGenderWord } from "./voiceGender.js";

/** Every voice dropdown's label (decided 2026-10-03): "Sohee · Female ·
 *  Korean · Qwen3-TTS CustomVoice" — name, gender, the voice's own language
 *  and the model that speaks it. */
export function voiceLabel(v) {
  if (!v) return "";
  return [v.name, voiceGenderWord(v), languageName(v.language) || v.language, v.model_name || v.engine]
    .filter((x) => x && x !== "?").join(" · ");
}

/** The "Can be directed" filter, each choice with its one-line example (the
 *  hint shows in the open list; the closed select shows the label). */
export const DIRECTION_OPTIONS = [
  { value: "", label: "Any direction" },
  { value: "words", label: "Written direction", hint: "describe it: clipped, world-weary" },
  { value: "tags", label: "Tags", hint: "pick from the model's list: [fear] [sigh]" },
  { value: "sliders", label: "Sliders only", hint: "pace, pitch, gain — no words" },
];

/** A row's "Can be directed" cell: {label, intent, title}. `tagCount` is the
 *  model's own tags, when known. */
export function directionCell(directedBy, tagCount = 0) {
  if (directedBy === "words") {
    return { label: "✓ written direction", intent: "success", title: "Describe how it speaks, in words" };
  }
  if (directedBy === "tags") {
    return {
      label: tagCount ? `✓ ${tagCount} tags` : "✓ tags",
      intent: "success",
      title: "Pick from the model's own tags — it doesn't read written direction",
    };
  }
  if (directedBy === "sliders") {
    return { label: "sliders only", intent: "secondary", title: "Pace, pitch and gain — no words, no tags" };
  }
  return { label: "—", intent: "secondary", title: "No voice yet" };
}

/** How many tags a capability row lists, across its kinds. */
export function tagCount(row) {
  return (row?.inline_tags || []).reduce((n, set) => n + (set.tags?.length || 0), 0);
}

/** How a voice was made — ONE set of words on every screen (decided 2026-10-05,
 *  "unify them go"): Built-in · Cloned · Designed · Blended. Voices said Preset
 *  and listed Imported apart; the persona page said Clone from audio, Design
 *  from words, Blend. An imported voice is a clone that came in from a voice
 *  file (it carries a reference clip), so it is Cloned. The persona page's
 *  Made by row uses these labels too. */
export const VOICE_KINDS = [
  { value: "builtin", label: "Built-in" },
  { value: "clone", label: "Cloned" },
  { value: "design", label: "Designed" },
  { value: "blend", label: "Blended" },
  { value: "lora", label: "Trained LoRA", disabled: true, title: "Needs voice training, which isn't rebuilt yet." },
];

const KIND_OF_SOURCE = { preset: "builtin", cloned: "clone", imported: "clone", designed: "design", blended: "blend" };
const KIND_WORD = { builtin: "built-in", clone: "cloned", design: "designed", blend: "blended" };
const KIND_LABEL = Object.fromEntries(VOICE_KINDS.map((k) => [k.value, k.label]));

/** "Built-in" · "Cloned" · "Designed" · "Blended" — a voice's type as a column or chip shows it. */
export function voiceKindLabel(voice) {
  return KIND_LABEL[voiceKind(voice)];
}

/** builtin · clone · design · blend — from a voice's `source`. */
export function voiceKind(voice) {
  return KIND_OF_SOURCE[voice?.source] || "builtin";
}

/** The short word a list shows beside a voice's name: "Sohee built-in". */
export function voiceKindWord(voice) {
  return KIND_WORD[voiceKind(voice)];
}

// ── The book's language (decided 2026-10-03: "so Cast can warn on a
// mismatch") ──────────────────────────────────────────────────────────────
const baseLang = (code) => String(code || "").split(/[-_]/)[0].toLowerCase();

/** Same language, region aside: "en-GB" and "en" match; "ko" and "en" don't. */
export function sameLanguage(a, b) {
  return !!a && !!b && baseLang(a) === baseLang(b);
}

/** The languages a book can be set to: every language your voices' models
 *  speak, by its plain name ("English", not "American English"), plus the
 *  book's own when it's something else (an import may have set it). */
export function bookLanguageOptions(voices, current = "") {
  const codes = new Set();
  for (const v of voices || []) {
    for (const c of v.speaks?.length ? v.speaks : [v.language]) if (c) codes.add(baseLang(c));
  }
  if (current) codes.add(current);
  return [
    { value: "", label: "Not set" },
    ...[...codes].map((c) => ({ value: c, label: languageName(c) || c }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}
