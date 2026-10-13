// SPDX-License-Identifier: MIT
//
// The Speech engines list's words for an engine's licence and a model's memory — ONE vocabulary
// for AI Settings → Speech engines and its mock (decided 2026-10-11, TASKS "Every speech engine's
// licence in plain words" and "Speech engines: the real tab…"). The facts come from the server:
// an engine's `licence` {name, commercial, table, summary, url, checked}, a model's `need_gb`
// (audio.cpp's estimate or its download, whichever is more) and `measured_mb` (an earlier load
// on this machine).

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

const gb = (mb) => Math.round((mb / 1024) * 10) / 10;

/** A model's memory before it loads: what an earlier load measured here, else audio.cpp's
 * estimate, against this card (null = no card to fit). A measured size fits when it and the
 * safety margin (`marginMb`, the server's: /v1/engines/vram `safety_margin_mb`) are no more than
 * the card — the rule Auto loads by (manager.placementFor; the narrowings review, M4). `runsOn`
 * is where the server would load it now: a model too big by the estimate whose files fit the
 * card easily is tried on the card first (2026-10-12), and its Runs on line says why. →
 * {text, warn, gb, fits}; gb is null when neither is known, fits null when there's no card or
 * no number. */
export function memoryText({ measuredMb, needGb, runsOn = null }, cardMb, marginMb = 0) {
  const fitsCard = (mb) => (cardMb ? mb <= cardMb : null);
  const fitWords = (fits) => (fits === null ? "" : fits ? " · fits this card" : null);
  if (measuredMb) {
    const g = gb(measuredMb);
    const fits = fitsCard(measuredMb + marginMb);
    return { text: `about ${g} GB, measured here${fitWords(fits) ?? " · more than this card has"}`, warn: fits === false, gb: g, fits };
  }
  if (needGb) {
    const fits = fitsCard(needGb * 1024);
    if (fits !== false) return { text: `needs about ${needGb} GB${fitWords(fits)}`, warn: false, gb: needGb, fits };
    if (runsOn === "gpu") return { text: `needs about ${needGb} GB · more than this card has`, warn: true, gb: needGb, fits };
    return { text: `needs about ${needGb} GB · too big for this card — Load runs it on the CPU`, warn: true, gb: needGb, fits };
  }
  return { text: "memory not measured yet", warn: false, gb: null, fits: null };
}
