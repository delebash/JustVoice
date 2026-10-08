// SPDX-License-Identifier: MIT
// Audacity label-track import adapter (the port of justvoice/imports/adapters/audacity_labels.py).
//
// Audacity exports label tracks as a tab-separated text file:
//
//     0.000000\t4.250000\tFirst label text
//     4.500000\t6.000000\tSecond label text
//
// The two-column form (point labels) is also accepted:
//
//     1.234567\tLabel text at this point
//
// Each row becomes one line. Pause-after is the gap to the next label's start, if known.

import { decodeUtf8, END, pyRound, splitlines, strip } from "@delebash/llm-runner/platform/py";
import { pyFloatOf } from "@delebash/llm-runner/platform/pyjson";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { StandardImport } from "../standard_schema.js";
import { beforeLastDot } from "./book_prose.js";

export const SOURCE_ID = "audacity_labels";

const _FLOAT_RE = new RegExp(`^-?\\p{Nd}+(?:\\.\\p{Nd}+)?${END}`, "u");

function _toMs(s) {
  if (!_FLOAT_RE.test(s)) return null;
  return pyRound(pyFloatOf(s) * 1000);
}

export function parse(raw, { filename = null } = {}) {
  let text;
  try {
    text = decodeUtf8(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), { sig: true });
  } catch (e) {
    if (e?.name === "UnicodeDecodeError") throw badRequest(`audacity_labels import: not valid UTF-8 (${e.message})`);
    throw e;
  }

  const rows = splitlines(text).filter((r) => strip(r));
  if (!rows.length) throw badRequest("audacity_labels import: empty file");

  const parsed = [];
  for (const row of rows) {
    const cols = row.split("\t");
    // Audacity writes two rows per region label (the second carries frequency bounds prefixed
    // with a backslash); skip rows whose first cell starts with "\".
    if (cols.length && cols[0].startsWith("\\")) continue;
    let start;
    let end;
    let label;
    if (cols.length >= 3) {
      start = _toMs(cols[0]);
      end = _toMs(cols[1]);
      label = strip(cols.slice(2).join("\t"));
    } else if (cols.length === 2) {
      start = _toMs(cols[0]);
      end = null;
      label = strip(cols[1]);
    } else continue;
    if (!label) continue;
    parsed.push([start, end, label]);
  }

  if (!parsed.length) throw badRequest("audacity_labels import: no label rows found");

  const lines = parsed.map(([start, end, label], i) => {
    let pauseMs = null;
    const nextStart = i + 1 < parsed.length ? parsed[i + 1][0] : null;
    const anchor = end !== null ? end : start;
    if (nextStart !== null && anchor !== null) {
      const gap = Math.max(0, nextStart - anchor);
      if (gap > 0) pauseMs = gap;
    }
    return { text: label, pause_after_ms: pauseMs, source_ref: `label:${i + 1}` };
  });

  const projectName = beforeLastDot(filename || "Audacity labels") || "Audacity labels";
  return construct(StandardImport, {
    source: SOURCE_ID,
    project: { name: projectName, kind: "custom" },
    scenes: [{ id: "labels", title: projectName, kind: "label_track", lines }],
  });
}
