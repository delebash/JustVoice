// SPDX-License-Identifier: MIT
//
// Filters that narrow each other (decided 2026-10-05). A list narrowed by
// several filters lists, for each filter, only what the OTHER filters leave,
// with counts that match what the list will then show — so no choice can empty
// the list by surprise, and a count is the number of rows you get. An option
// nothing fits drops out, but the one you chose stays, with (0), so you can see
// it and change it (that is also what a remembered choice whose items are gone
// comes back as).
//
// Before this, every screen built a filter's options from the whole set: on
// Voices, Kokoro (54) + Written direction was an empty list; on a persona's
// page, Written direction + Built-in still offered Kokoro.
//
// A filter is { key, value, test(item, value), empty? } — `empty` is the value
// meaning "no filter" ("" unless given, e.g. "all").

const isOff = (f) => f.value === (f.empty ?? "") || f.value == null;

/** Does `item` pass every filter but `skip`? */
export function passesFilters(item, filters, skip = null) {
  return filters.every((f) => f.key === skip || isOff(f) || f.test(item, f.value));
}

/** The items every filter leaves. */
export function narrowed(items, filters) {
  return items.filter((it) => passesFilters(it, filters));
}

/**
 * One filter's options, grouped by a value: { value, n, label } for each value
 * the OTHER filters leave, counted. `keyOf(item)` is the item's value for this
 * filter (falsy = not counted); `labelOf(value, n)` names an option. The chosen
 * value stays with n = 0 when nothing fits it. Sorted by label.
 */
export function facetOptions(items, filters, key, keyOf, labelOf) {
  const chosen = filters.find((f) => f.key === key);
  const counts = new Map();
  for (const it of items) {
    if (!passesFilters(it, filters, key)) continue;
    const v = keyOf(it);
    if (v === "" || v == null) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (chosen && !isOff(chosen) && !counts.has(chosen.value)) counts.set(chosen.value, 0);
  return [...counts]
    .map(([value, n]) => ({ value, n, label: labelOf(value, n) }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/**
 * Counts for a filter whose options are tests rather than values (Script's and
 * Render's line chips): { [option]: how many items the other filters leave pass
 * `test(item, option)` }.
 */
export function facetCounts(items, filters, key, options, test) {
  const left = items.filter((it) => passesFilters(it, filters, key));
  return Object.fromEntries(options.map((o) => [o, left.filter((it) => test(it, o)).length]));
}

/** How many items the other filters leave — an "All …" option's count. */
export function facetTotal(items, filters, key) {
  return items.filter((it) => passesFilters(it, filters, key)).length;
}

/**
 * A fixed set of options ([{ value, label }], the "no filter" one included)
 * with counts from what the other filters leave: "Tags (3)". The "no filter"
 * option counts everything left; any other option nothing fits drops out,
 * unless it is the one chosen.
 */
export function facetChoices(items, filters, key, options, test) {
  const f = filters.find((x) => x.key === key);
  const empty = f?.empty ?? "";
  const left = items.filter((it) => passesFilters(it, filters, key));
  return options.flatMap((o) => {
    if (o.value === empty) return [{ ...o, label: `${o.label} (${left.length})` }];
    const n = left.filter((it) => test(it, o.value)).length;
    return n || (f && f.value === o.value) ? [{ ...o, label: `${o.label} (${n})` }] : [];
  });
}
