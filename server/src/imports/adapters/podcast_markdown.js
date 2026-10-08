// SPDX-License-Identifier: MIT
// Podcast script import — speaker-labeled markdown/text (the port of
// justvoice/imports/adapters/podcast_markdown.py).
//
// The podcast way-in (CONCEPTS §1/§3): a script where each paragraph names its speaker:
//
//     SARAH: Welcome back to Signal and Noise. [warm]
//     **JIN:** Mave, your team just shipped a codec...
//     — Mid-roll marker —
//
// Recognized label forms: `NAME:` / `**NAME:**` / `[NAME]:` at line start (1–3 words, allowing
// letters/digits/space/'/./-). Unknown labels become characters; consecutive unlabeled
// paragraphs continue the current speaker. `## Heading` lines split episodes/segments into
// scenes. Paralinguistic tags like [laughs] stay in the text — engines that support them
// perform them (CONCEPTS §17 keeps that contract).

import { decodeUtf8, END, PY_WS, pyIsUpper, pyTitle, splitlines, splitWs, strip } from "@delebash/llm-runner/platform/py";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { StandardImport } from "../standard_schema.js";
import { beforeLastDot } from "./book_prose.js";

export const SOURCE_ID = "podcast_markdown";

const S = `[${PY_WS}]`;
// SARAH:  /  **SARAH:**  /  [SARAH]:   — captures the name. (Python's `.` is anything but "\n".)
const _LABEL_RE = new RegExp(`^${S}*(?:\\*\\*|\\[)?([A-Za-z][A-Za-z0-9 .'\\-]{0,40}?)(?:\\]|\\*\\*)?${S}*:${S}*(?:\\*\\*)?${S}*([^\\n]*)${END}`, "u");
const _HEADING_RE = new RegExp(`^(#{1,3})${S}+([^\\n]*[^${PY_WS}])${S}*${END}`, "u");
// Lines that are clearly markers, not speech: — Intro theme —, --- etc.
const _MARKER_RE = new RegExp(`^${S}*(?:—|-{3,}|\\*{3,}|_{3,})`, "u");
const WS_RUN = new RegExp(`${S}+`, "gu");

function _slug(text) {
  const s = strip(text.toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_");
  return s.slice(0, 64) || "speaker";
}

/** Heuristic guard: 'SARAH' yes; 'The thing about codecs' no. Labels are short and either
 * ALL-CAPS or Title Case ≤3 words. */
function _looksLikeLabel(name) {
  const words = splitWs(name);
  if (!words.length || words.length > 3) return false;
  if (pyIsUpper(strip(name))) return true;
  return words.filter((w) => w).every((w) => pyIsUpper(Array.from(w)[0]));
}

export function parse(raw, { filename = null } = {}) {
  let text;
  try {
    text = decodeUtf8(Buffer.isBuffer(raw) ? raw : Buffer.from(raw), { sig: true });
  } catch (e) {
    if (e?.name === "UnicodeDecodeError") throw badRequest("podcast_markdown import: file is not UTF-8 text");
    throw e;
  }

  const characters = new Map();
  let scenes = [];
  let currentScene = null;
  let currentSpeaker = null;
  let sceneCount = 0;
  let lineNo = 0;

  const ensureScene = (title) => {
    sceneCount += 1;
    currentScene = { id: _slug(title || `segment_${sceneCount}`), title: title || `Segment ${sceneCount}`, kind: "segment", lines: [] };
    scenes.push(currentScene);
    return currentScene;
  };

  for (let para of text.split(new RegExp(`\\n${S}*\\n`, "u"))) {
    para = strip(para);
    if (!para) continue;
    lineNo += 1;

    const m = _HEADING_RE.exec(splitlines(para)[0]);
    if (m) {
      ensureScene(m[2]);
      const rest = strip(splitlines(para).slice(1).join("\n"));
      if (!rest) continue;
      para = rest;
    }

    if (_MARKER_RE.test(para)) {
      // Music/ad markers ride along as narrator-less direction lines.
      if (currentScene === null) ensureScene(null);
      currentScene.lines.push({ character_id: null, text: para, delivery: { marker: true }, source_ref: `md:p${lineNo}` });
      continue;
    }

    let body = strip(para.replace(WS_RUN, " "));
    const lm = _LABEL_RE.exec(para);
    if (lm && _looksLikeLabel(lm[1])) {
      const name = strip(lm[1].replace(WS_RUN, " "));
      const cid = _slug(name);
      if (!characters.has(cid)) characters.set(cid, { id: cid, name: pyIsUpper(name) ? pyTitle(name) : name });
      currentSpeaker = cid;
      body = strip(lm[2]);
      if (!body) continue;
    }

    if (currentScene === null) ensureScene(null);
    currentScene.lines.push({ character_id: currentSpeaker, text: body, source_ref: `md:p${lineNo}` });
  }

  scenes = scenes.filter((s) => s.lines.length);
  if (!scenes.length) throw badRequest("podcast_markdown import: no script content found");

  const warnings = [];
  if (!characters.size) {
    warnings.push("no speaker labels detected (NAME: / **NAME:** at paragraph start) — every line imported unattributed");
  }

  const name = filename ? beforeLastDot(filename.split("/").pop()) : "Imported episode";
  return construct(StandardImport, {
    source: SOURCE_ID,
    project: { name, kind: "podcast", language: "en-US" },
    characters: [...characters.values()],
    scenes,
    warnings,
  });
}
