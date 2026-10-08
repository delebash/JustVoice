// SPDX-License-Identifier: MIT
// SRT subtitle import adapter (the port of justvoice/imports/adapters/srt.py).
//
// Parses SubRip (.srt) cue blocks of the form:
//
//     1
//     00:00:01,000 --> 00:00:04,000
//     NARRATOR: This is the line.
//
// Each cue becomes one StandardLine. If a "NAME:" prefix is present at the start of the text
// the name is lifted into a StandardCharacter and stripped from the line. All cues go into a
// single StandardScene.

import { decodeUtf8, digitsToInt, END, PY_WS, pyTitle, splitlines, strip } from "@delebash/llm-runner/platform/py";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { StandardImport } from "../standard_schema.js";
import { beforeLastDot } from "./book_prose.js";

export const SOURCE_ID = "srt";

const S = `[${PY_WS}]`;
const D = "\\p{Nd}";
const _TIMECODE_RE = new RegExp(
  `(${D}{1,2}):(${D}{2}):(${D}{2})[,.](${D}{1,3})${S}*-->${S}*(${D}{1,2}):(${D}{2}):(${D}{2})[,.](${D}{1,3})`,
  "u",
);
// Python's `.` (no DOTALL) is anything but "\n".
const _SPEAKER_RE = new RegExp(`^${S}*([A-Z][A-Z0-9 _'\\-]{0,40})${S}*:${S}*([^\\n]+)${END}`, "u");

function _tcToMs(h, m, s, ms) {
  return (digitsToInt(h) * 3600 + digitsToInt(m) * 60 + digitsToInt(s)) * 1000 + digitsToInt(Array.from(ms.padEnd(3, "0")).slice(0, 3).join(""));
}

function _slug(s) {
  return strip(s.toLowerCase().replace(/[^a-z0-9]+/g, "-"), "-") || "x";
}

export function parse(raw, { filename = null } = {}) {
  let text;
  try {
    text = decodeUtf8(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), { sig: true });
  } catch (e) {
    if (e?.name === "UnicodeDecodeError") throw badRequest(`srt import: not valid UTF-8 (${e.message})`);
    throw e;
  }

  // Normalize line endings, split on blank-line boundaries.
  const blocks = strip(text).split(/\r?\n\r?\n+/);
  const chars = new Map();
  const lines = [];
  let endPrevMs = null;

  for (const block of blocks) {
    const rows = splitlines(block).filter((r) => strip(r));
    if (rows.length < 2) continue;
    // First row is the cue index (optional). Find the timecode row.
    const tcRowIdx = _TIMECODE_RE.test(rows[0]) ? 0 : _TIMECODE_RE.test(rows.length > 1 ? rows[1] : "") ? 1 : null;
    if (tcRowIdx === null) continue;
    const match = _TIMECODE_RE.exec(rows[tcRowIdx]);
    if (!match) continue;
    const startMs = _tcToMs(match[1], match[2], match[3], match[4]);
    const endMs = _tcToMs(match[5], match[6], match[7], match[8]);
    let body = strip(rows.slice(tcRowIdx + 1).join("\n"));
    if (!body) continue;

    let charId = null;
    const sp = _SPEAKER_RE.exec(body);
    if (sp) {
      const speaker = strip(sp[1]);
      charId = _slug(speaker);
      if (!chars.has(charId)) chars.set(charId, { id: charId, name: pyTitle(speaker) });
      body = strip(sp[2]);
    }

    // `pause_after_ms` on the PREVIOUS line is the gap between the last cue's end and this
    // cue's start.
    if (endPrevMs !== null && lines.length) {
      const gap = Math.max(0, startMs - endPrevMs);
      if (gap > 0) lines[lines.length - 1].pause_after_ms = gap;
    }
    endPrevMs = endMs;

    lines.push({ character_id: charId, text: body, pause_after_ms: null, source_ref: `srt:${startMs}-${endMs}` });
  }

  if (!lines.length) throw badRequest("srt import: no cues found");

  const projectName = beforeLastDot(filename || "SRT import") || "SRT import";
  return construct(StandardImport, {
    source: SOURCE_ID,
    project: { name: projectName, kind: "custom" },
    characters: [...chars.values()],
    scenes: [{ id: "srt", title: projectName, kind: "cue_sheet", lines }],
  });
}
