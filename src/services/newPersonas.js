// SPDX-License-Identifier: MIT
//
// ＋ New persona for the N with none (Cast, decided 2026-10-05) — the two
// rules the batch is made of, and who and what Smart-assign reads, kept out of
// the component so they're testable.

import { sameLanguage } from "./personaFacts.js";

/** Speakers with a library persona of exactly their name are cast with it (no
 *  new one); the rest need a new persona. → { byName: [{speaker, persona}], rest } */
export function splitByName(speakers, personas) {
  const byName = [];
  const rest = [];
  for (const speaker of speakers) {
    const persona = personas.find((p) => p.name === speaker.name);
    if (persona) byName.push({ speaker, persona });
    else rest.push(speaker);
  }
  return { byName, rest };
}

/** The installed voices that speak the book's language — every one when the
 *  book's language isn't set. A voice speaks what its model can speak it in
 *  (`speaks`), else its own language; region aside ("en-GB" speaks "en"). */
export function voicesForBook(voices, bookLanguage) {
  if (!bookLanguage) return voices;
  return voices.filter((v) => (v.speaks?.length ? v.speaks : [v.language]).some((c) => sameLanguage(c, bookLanguage)));
}

/** Cast's "Models to choose from" (2026-10-06): each model with voices in
 *  `voices`, most voices first — by the voice's model and its model's name, so
 *  Qwen3-TTS CustomVoice and Qwen3-TTS Base are two choices, not one Qwen3
 *  (the narrowings review C2, 2026-10-13: "list each model"). An online
 *  provider's model is its engine and its model name the raw id, so it keeps
 *  its engine's name ("My OpenAI"), as the per-engine list did.
 *  `engineNames`: {engine id: the engine's name}.
 *  → [{ value: model id, label: "Kokoro (28)" }] */
export function castModelChoices(voices, engineNames = {}) {
  const counts = new Map();
  const names = {};
  for (const v of voices) {
    if (!v.model) continue;
    counts.set(v.model, (counts.get(v.model) || 0) + 1);
    const own = v.model_name && v.model_name !== v.model ? v.model_name : null;
    names[v.model] = own || engineNames[v.engine] || v.model_name || v.model;
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ value: id, label: `${names[id]} (${n})` }));
}

/** Who Smart-assign reads: every speaker but a narrator who already has a
 *  persona — a narrator with none is matched like anyone, and a narrator's
 *  persona is never replaced (decided 2026-10-13, the narrowings review C1). */
export function smartAssignSpeakers(speakers) {
  return speakers.filter((s) => s.role_label !== "narrator" || !s.persona_id);
}

/** "A", "A and B", "A, B and C" — names in a sentence (Cast's footer, the batch). */
export function andList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
