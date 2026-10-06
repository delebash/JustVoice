// SPDX-License-Identifier: MIT
//
// ＋ New persona for the N with none (Cast, decided 2026-10-05) — the two
// rules the batch is made of, kept out of the component so they're testable.

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

/** "A", "A and B", "A, B and C" — names in a sentence (Cast's footer, the batch). */
export function andList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
