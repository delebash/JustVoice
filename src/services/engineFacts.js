// SPDX-License-Identifier: MIT
//
// The Speech engines list's words for an engine's licence and a model's memory — ONE vocabulary
// for AI Settings → Speech engines and its mock (decided 2026-10-11, TASKS "Every speech engine's
// licence in plain words" and "Speech engines: the real tab…"). The facts come from the server:
// an engine's `licence` {name, commercial, table, summary, url, checked}, a model's `min_vram_gb`
// (audio.cpp's estimate) and `measured_mb` (an earlier load on this machine).

/** Commercial use, in audio.cpp's words (decided 2026-10-11, answer 1). */
export const COMMERCIAL_USE = ["Yes", "Conditional", "No", "Unclear"];

/** What each word means, under it in the filter's open list. */
export const COMMERCIAL_HINTS = {
  Yes: "Sell what you make with it — no conditions.",
  Conditional: "Sell what you make if you meet its conditions — credit, a revenue cap. Hover a model's licence to see them.",
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
export const licClass = (c) => ({ Conditional: "ev-lic--warn", No: "ev-lic--no", Unclear: "ev-lic--unclear" })[c] || "";

/** Whose reading the summary is, and audio.cpp's word where ours differs (the server's TERMS
 * `reading` says the same — engines/audiocpp/generated.js readingOf). */
export const reading = (l) =>
  `${l.name} · JustVoice's reading, checked ${l.checked}${l.table !== l.commercial ? ` — audio.cpp's licence table says "${l.table}"` : ""}`;

/** The commercial-use chip's hover. */
export const licTitle = (l) => `${l.summary}\n\n${reading(l)}. The licence text at its source is what counts.`;

const gb = (mb) => Math.round((mb / 1024) * 10) / 10;

/** A model's memory before it loads: what an earlier load measured here, else audio.cpp's
 * estimate, against this card (null = no card to fit). → {text, warn, gb}; gb is null when
 * neither is known. */
export function memoryText({ measuredMb, needGb }, cardMb) {
  const fitWords = (g) => (cardMb ? (g * 1024 <= cardMb ? " · fits this card" : null) : "");
  if (measuredMb) {
    const g = gb(measuredMb);
    return { text: `about ${g} GB, measured here${fitWords(g) ?? " · more than this card has"}`, warn: fitWords(g) === null, gb: g };
  }
  if (needGb) {
    const f = fitWords(needGb);
    return f === null
      ? { text: `needs about ${needGb} GB · too big for this card — Load runs it on the CPU`, warn: true, gb: needGb }
      : { text: `needs about ${needGb} GB${f}`, warn: false, gb: needGb };
  }
  return { text: "memory not measured yet", warn: false, gb: null };
}
