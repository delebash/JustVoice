// SPDX-License-Identifier: MIT
// Caption files from word timings — WebVTT and SRT (the port of justvoice/captions.py).
//
// The consumer half of word-level alignment (C1): timed words group into readable cues and
// format as the two caption dialects every player takes. Grouping is by readability, not by
// sentence detection: a cue closes at ~42 characters (the captioning industry's one-line
// limit), at 7 words, or at a pause longer than a second — whichever comes first.

import { floorDiv, pyMod, pyRound } from "@delebash/llm-runner/platform/py";

const MAX_CUE_CHARS = 42;
const MAX_CUE_WORDS = 7;
const GAP_BREAK_SECS = 1.0;

const plen = (s) => [...s].length; // len() counts code points

/** [{word,start,end}] → [{text,start,end}] cues. */
export function groupCues(words) {
  const cues = [];
  let cur = [];
  const flush = () => {
    if (cur.length) {
      cues.push({ text: cur.map((w) => w.word).join(" "), start: cur[0].start, end: cur[cur.length - 1].end });
      cur = [];
    }
  };
  for (const w of words) {
    if (cur.length) {
      const length = cur.reduce((s, x) => s + plen(x.word) + 1, 0) + plen(w.word);
      const gap = w.start - cur[cur.length - 1].end;
      if (length > MAX_CUE_CHARS || cur.length >= MAX_CUE_WORDS || gap > GAP_BREAK_SECS) flush();
    }
    cur.push(w);
  }
  flush();
  return cues;
}

const pad = (n, w) => (n < 0 ? `-${String(-n).padStart(w - 1, "0")}` : String(n).padStart(w, "0"));

function ts(seconds, sep) {
  let ms = pyRound(seconds * 1000);
  const h = floorDiv(ms, 3_600_000);
  let rem = pyMod(ms, 3_600_000);
  const m = floorDiv(rem, 60_000);
  rem = pyMod(rem, 60_000);
  const s = floorDiv(rem, 1000);
  ms = pyMod(rem, 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
}

export function toVtt(words) {
  const out = ["WEBVTT", ""];
  for (const cue of groupCues(words)) {
    out.push(`${ts(cue.start, ".")} --> ${ts(cue.end, ".")}`);
    out.push(cue.text);
    out.push("");
  }
  return out.join("\n");
}

export function toSrt(words) {
  const out = [];
  groupCues(words).forEach((cue, idx) => {
    out.push(String(idx + 1));
    out.push(`${ts(cue.start, ",")} --> ${ts(cue.end, ",")}`);
    out.push(cue.text);
    out.push("");
  });
  return out.join("\n");
}
