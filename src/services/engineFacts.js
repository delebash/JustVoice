// SPDX-License-Identifier: MIT
//
// The Speech tab's words for an engine's licence — ONE vocabulary for AI Settings → Speech (the
// kit's audio.cpp tab, JustVoice's engine heads and filters in its slots — round E) and the one-click
// run's licence chips (decided 2026-10-11, TASKS "Every speech engine's licence in plain words").
// The facts come from the server: an engine's `licence` {name, commercial, table, summary, url,
// checked}. A model's memory before it loads is the kit's fit word now (its model rows' `fit`).

/** Commercial use: audio.cpp's four words (decided 2026-10-11, answer 1) and "Separate licence"
 * (TASKS "A fifth commercial-use word"). */
export const COMMERCIAL_USE = ["Yes", "Conditional", "Separate licence", "No", "Unclear"];

/** What each word means, under it in the filter's open list. */
export const COMMERCIAL_HINTS = {
  Yes: "Sell what you make with it — no conditions.",
  Conditional: "Sell what you make if you meet its conditions — credit, a revenue cap. Hover a model's licence to see them.",
  "Separate licence": "Not under the free licence — its makers sell or grant a separate one for commercial use. The plain words say who to ask.",
  No: "Personal and research use only — don't sell what you make.",
  Unclear: "The licence doesn't say, or its makers contradict it. Treat it as No until it's checked.",
};

export const COMMERCIAL_OPTIONS = [
  { label: "Any commercial use", value: "all" },
  ...COMMERCIAL_USE.map((c) => ({ label: `Commercial use: ${c}`, value: c, hint: COMMERCIAL_HINTS[c] })),
];

/** The Speech tab's sort (the engine list's, decided 2026-10-11): services/speechTab.js orders by it. */
export const SORTS = [
  { label: "Sort: name", value: "name" },
  { label: "Sort: download size", value: "size" },
  { label: "Sort: memory needed", value: "memory" },
  { label: "Sort: commercial use", value: "commercial" },
];

/** The chip's colour class for a commercial-use word. */
export const licClass = (c) =>
  ({ Conditional: "ev-lic--warn", "Separate licence": "ev-lic--separate", No: "ev-lic--no", Unclear: "ev-lic--unclear" })[c] || "";

/** Whose reading the summary is, and audio.cpp's word where ours differs (the server's TERMS
 * `reading` says the same — engines/audiocpp/generated.js readingOf). */
export const reading = (l) =>
  `${l.name} · JustVoice's reading, checked ${l.checked}${l.table !== l.commercial ? ` — audio.cpp's licence table says "${l.table}"` : ""}`;

/** The commercial-use chip's hover. */
export const licTitle = (l) => `${l.summary}\n\n${reading(l)}. The licence text at its source is what counts.`;
