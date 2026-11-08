// SPDX-License-Identifier: MIT
//
// The best picks every model picker marks (docs/plans/2026-11-08-latest-models.md D12): the voice
// sets' "Best voices you can sell" and "Best acting — not for sale", from the server
// (GET /v1/book-voices/picks — book_run.js `modelPicks`, read from book_voices.sets, the settings the
// one-click card's Voices uses). The words are the sets' own labels, so a mark reads the same as the
// card; the parts a model plays are said after it.

/** "plays the characters", "narrates", or both. */
export function rolesText(roles = []) {
  const plays = roles.includes("characters");
  const narrates = roles.includes("narrator");
  if (plays && narrates) return "plays the characters and narrates";
  if (narrates) return "narrates";
  return plays ? "plays the characters" : "";
}

/** A pick's mark: "Best voices you can sell · plays the characters". */
export const markText = (p) => [p.label, rolesText(p.roles)].filter(Boolean).join(" · ");

/** The pick for model `model` (a capability row id, as voices and personas carry), or null. A model in
 * both sets (it can't be: a set is sellable or not) would give its first. */
export const pickOf = (picks, model) => (picks || []).find((p) => p.model === model) ?? null;

/** The picks for engine `engine` (AI Settings → Speech's engine heads). */
export const picksOfEngine = (picks, engine) => (picks || []).filter((p) => p.engine === engine);

/** The models a maker starts on, before its own order: the sellable picks that play the characters. */
export const sellableFirst = (picks) => (picks || []).filter((p) => p.sellable && p.roles.includes("characters")).map((p) => p.model);

// A pick's row says its whole mark, not only its part: the list opens scrolled to the chosen model, which
// can hide its group's label (seen in the real window, 2026-11-08 — latest-models D24).
const second = (pick, o) =>
  [pick ? markText(pick) : "", o.hint, o.commercial ? `Commercial use: ${o.commercial}` : ""]
    .filter(Boolean)
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(" · ");

/**
 * A model picker's options (`[{label, value, hint?, commercial?}]`, `value` a model id) for the kit's
 * UiSelect: the picks first, each set under its own label ("Best voices you can sell", then "Best
 * acting — not for sale"), then the rest under "Other models"; every option's second line says the part
 * a pick plays, what the option said before and its commercial use. With no pick among them: the
 * options as they were, their commercial use added.
 */
export function groupedByPicks(options, picks) {
  const one = (o, pick) => {
    const hint = second(pick, o);
    return hint ? { label: o.label, value: o.value, hint } : { label: o.label, value: o.value };
  };
  const used = new Set();
  const groups = [];
  for (const label of [...new Set((picks || []).map((p) => p.label))]) {
    const inSet = picks.filter((p) => p.label === label);
    const opts = options.filter((o) => inSet.some((p) => p.model === o.value));
    if (!opts.length) continue;
    for (const o of opts) used.add(o.value);
    groups.push({ label, options: opts.map((o) => one(o, inSet.find((p) => p.model === o.value))) });
  }
  const rest = options.filter((o) => !used.has(o.value)).map((o) => one(o, null));
  if (!groups.length) return rest;
  return rest.length ? [...groups, { label: "Other models", options: rest }] : groups;
}

/**
 * A model filter's options with each pick's mark as its second line (the filters keep their own
 * order — by how many voices or personas use each model). `modelOf(option)` gives the option's model
 * id (the Voices page filters by model name, the others by id).
 */
export function hintedByPicks(options, picks, modelOf = (o) => o.value) {
  return options.map((o) => {
    const pick = pickOf(picks, modelOf(o));
    return pick ? { ...o, hint: [o.hint, markText(pick)].filter(Boolean).join(" · ") } : o;
  });
}

/** A multi-select's label with a pick's mark after it (the kit's UiMultiSelect shows a label only). */
export const labelWithPick = (label, pick) => (pick ? `${label} — ${markText(pick)}` : label);
