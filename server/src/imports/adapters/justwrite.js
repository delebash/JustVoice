// SPDX-License-Identifier: MIT
// JustWrite book import adapter — the `.zip` JustWrite actually exports (the port of
// justvoice/imports/adapters/justwrite.py).
//
// JustWrite exports a book as `<Title>.zip`, unzipping to `<Title>/book.json` plus a
// `<Title>/images/` folder (justwrite-app `api/book_transfer_api`). The zip exists only to carry
// image FILES; the content contract is `book.json`, the snapshot JustWrite's
// `book_io.assemble()` emits:
//
//     {
//       "project":    {"title", "author", "subtitle", "genre", "premise", ...},
//       "parts":      [{"id", "title", "chapters": [{"id", "num", "title", ...}]}],
//       "scenes":     {"<chapterId>": [{"id", "title", "body"}]},
//       "characters": [{"id", "name", "gender", "age", "pronouns", "role",
//                       "oneLiner", "aliases", ...}],
//       ...plus JustWrite planning data JustVoice ignores.
//     }
//
// A scene `body` is rich-editor HTML (TipTap StarterKit), one row per scene. The `* * *` a
// reader sees BETWEEN scenes is generated at display time by JustWrite's renderer and is never
// stored, so nothing here stitches chapters or strips separators — this reads the scene rows
// straight. A stray in-body `.scene-mark` paragraph is dropped by `skipClasses`.
//
// What JustVoice takes: chapter order and titles, the prose, and the character roster. What it
// cannot take is per-line speaker attribution — JustWrite does not compute it, and
// `docs/dev/design-decisions.md` §3 puts attribution on this side — so lines arrive speakerless
// and Script's Analyze discovers the speakers.

import { BadZipFile, ZipReader } from "@delebash/llm-runner/platform/zip";
import { strip, truthy } from "@delebash/llm-runner/platform/py";
import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { decodeUtf8, isDict, jsonLoads, pyStrOf } from "../../py_compat.js";
import { StandardImport } from "../standard_schema.js";
import { htmlBlocks } from "./book_prose.js";

export const SOURCE_ID = "justwrite";

// JustWrite's editor separator, when it survives inside a single scene's body.
const _SKIP_CLASSES = new Set(["scene-mark"]);

// How many chapter names a warning lists before it summarizes the rest.
const _WARN_NAME_CAP = 5;

/** `<folder>/book.json`, or a bare `book.json`. Shallowest match wins — mirrors JustWrite's
 * own reader so a nested stray cannot hijack it. (`min(names, key=len)`: the first of the
 * shortest.) */
function _findBookJson(zf) {
  const names = zf.names().filter((n) => n === "book.json" || (n.endsWith("/book.json") && n.split("/").length - 1 === 1));
  if (!names.length) return null;
  return names.reduce((best, n) => (n.length < best.length ? n : best));
}

const typeName = (v) => (Array.isArray(v) ? "list" : typeof v === "string" ? "str" : typeof v === "boolean" ? "bool" : typeof v === "number" && Number.isInteger(v) ? "int" : "float");

/** `d.get(k, dflt)` — on a value that isn't a dict, Python's AttributeError (a 500), as the
 * Python adapter raises on such a book. */
function pyGet(d, k, dflt = null) {
  if (!isDict(d)) {
    const e = new TypeError(`'${typeName(d)}' object has no attribute 'get'`);
    e.name = "AttributeError";
    throw e;
  }
  return Object.hasOwn(d, k) ? d[k] : dflt;
}

/** `for x in v` over parsed JSON: a list's items, a dict's keys, a str's characters; a number
 * or a bool is Python's TypeError (a 500). */
function _iter(v) {
  if (Array.isArray(v)) return v;
  if (isDict(v)) return Object.keys(v);
  if (typeof v === "string") return Array.from(v);
  throw new TypeError(`'${typeName(v)}' object is not iterable`);
}
const or = (v, dflt) => (truthy(v) ? v : dflt);

/** `[snapshot, ignoredImageCount]` from the exported zip or a bare `book.json` (someone who
 * unzipped it first). Zip detection is the `PK` magic, the same sniff book_prose uses. */
function _readBook(raw) {
  let payload;
  let images;
  if (raw[0] === 0x50 && raw[1] === 0x4b) {
    let zf;
    try {
      zf = ZipReader.fromBuffer(raw);
    } catch (e) {
      if (e instanceof BadZipFile) throw badRequest(`justwrite import: not a readable zip (${e.message})`);
      throw e;
    }
    const name = _findBookJson(zf);
    if (name === null) {
      throw badRequest("justwrite import: this zip has no book.json — export ONE BOOK from JustWrite, not a whole-server backup");
    }
    payload = zf.read(name);
    const imageDir = `${name.slice(0, -"book.json".length)}images/`;
    images = zf.entries.filter((e) => !e.name.endsWith("/") && e.name.startsWith(imageDir)).length;
  } else {
    payload = raw;
    images = 0;
  }

  let doc;
  try {
    doc = jsonLoads(decodeUtf8(payload, { sig: true }));
  } catch (e) {
    if (e?.name === "UnicodeDecodeError" || e?.name === "JSONDecodeError") {
      throw badRequest(`justwrite import: book.json is not valid UTF-8 JSON (${e.message})`);
    }
    throw e;
  }
  if (!isDict(doc)) throw badRequest("justwrite import: book.json must be a JSON object");
  if (!Object.hasOwn(doc, "parts") && !Object.hasOwn(doc, "scenes")) {
    throw badRequest(
      "justwrite import: this is not a JustWrite book — expected 'parts' and 'scenes'. A payload already in JustVoice's shape imports as 'justvoice_standard'.",
    );
  }
  return [doc, images];
}

/** Casting bias from JustWrite's character sheet — advisory only; the operator picks the real
 * voice when the project is committed. */
function _voiceHint(c) {
  const parts = [strip(pyStrOf(or(pyGet(c, "gender"), "")))];
  const age = pyGet(c, "age");
  // isinstance(age, int): a bool counts, a float does not.
  if ((typeof age === "number" && Number.isInteger(age)) || typeof age === "boolean") {
    if (Number(age) > 0) parts.push(`age ${typeof age === "boolean" ? "True" : age}`);
  }
  parts.push(strip(pyStrOf(or(pyGet(c, "role"), ""))));
  return parts.filter((p) => p).join(", ") || null;
}

const _PRONOUNS = { he: "he/him", she: "she/her", they: "they/them", it: "it/its" };

/** The sheet's free-text `pronouns` ("he/him", "She/Her", "they") as one of the speaker's four
 * values; anything else is left unset rather than guessed. Gender stays in the voice hint. */
export function _pronouns(c) {
  const first = strip(strip(pyStrOf(or(pyGet(c, "pronouns"), ""))).toLowerCase().split("/")[0]);
  return Object.hasOwn(_PRONOUNS, first) ? _PRONOUNS[first] : null;
}

const _aliases = (c) =>
  _iter(or(pyGet(c, "aliases"), []))
    .map((a) => strip(pyStrOf(a)))
    .filter((a) => a);

/** The character's one-liner, plus aliases — aliases matter for narration because the same
 * person is addressed by several names in the prose. */
function _notes(c) {
  const bits = [];
  const oneLiner = strip(pyStrOf(or(pyGet(c, "oneLiner"), "")));
  if (oneLiner) bits.push(oneLiner);
  const aliases = _aliases(c);
  if (aliases.length) bits.push(`Also known as: ${aliases.join(", ")}`);
  return bits.join(" · ") || null;
}

export function parse(raw, { filename = null } = {}) {
  void filename;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const [doc, imageCount] = _readBook(buf);

  const proj = or(pyGet(doc, "project"), {});
  const project = {
    name: pyStrOf(or(pyGet(proj, "title"), "Untitled")),
    kind: "audiobook",
    description: strip(pyStrOf(or(pyGet(proj, "premise"), ""))) || null,
    // book.json carries no language field — the operator sets it per project.
    language: "en-US",
  };

  const characters = [];
  for (const c of _iter(or(pyGet(doc, "characters"), []))) {
    if (!isDict(c) || !truthy(c.id)) continue;
    characters.push({
      id: pyStrOf(c.id),
      name: pyStrOf(or(pyGet(c, "name"), c.id)),
      voice_hint: _voiceHint(c),
      notes: _notes(c),
      aliases: _aliases(c),
      pronouns: _pronouns(c),
    });
  }

  // One JustVoice scene per JustWrite CHAPTER, in `parts[].chapters[]` order: JustVoice has no
  // chapter entity (Project -> Scene -> Block) and renders per scene, so the chapter is the
  // deliverable unit. JustWrite's scenes become ordered runs of lines inside it, their
  // boundary preserved in source_ref.
  const scenesByChapter = or(pyGet(doc, "scenes"), {});
  const scenes = [];
  const emptyChapters = [];
  let seen = 0;
  for (const part of _iter(or(pyGet(doc, "parts"), []))) {
    if (!isDict(part)) continue;
    for (const ch of _iter(or(pyGet(part, "chapters"), []))) {
      if (!isDict(ch)) continue;
      seen += 1;
      const chapterId = pyStrOf(or(pyGet(ch, "id"), "")) || `chapter-${seen}`;
      const title = strip(pyStrOf(or(pyGet(ch, "title"), ""))) || `Chapter ${pyStrOf(or(pyGet(ch, "num"), seen))}`;
      const lines = [];
      for (const scene of _iter(or(pyGet(scenesByChapter, chapterId), []))) {
        if (!isDict(scene)) continue;
        const sceneId = pyStrOf(or(pyGet(scene, "id"), ""));
        // The scene TITLE is deliberately not narrated: it is a JustWrite planning label.
        const body = or(pyGet(scene, "body"), "");
        // html.parser's feed() of a body that isn't text is Python's TypeError (a 500).
        if (typeof body !== "string") throw new TypeError(`can only concatenate str (not "${typeName(body)}") to str`);
        const blocks = htmlBlocks(body, { skipClasses: _SKIP_CLASSES });
        blocks.forEach(([, text], index) => {
          lines.push({ character_id: null, text, source_ref: `chapter:${chapterId}#scene:${sceneId}#block:${index}` });
        });
      }
      if (!lines.length) {
        emptyChapters.push(title);
        continue;
      }
      scenes.push({ id: chapterId, title, kind: "chapter", lines });
    }
  }

  if (!scenes.length) throw badRequest("justwrite import: no readable text — every chapter in this book is empty");

  // Import states what it DID, never what to do next. Lines arriving without a speaker is the
  // normal, expected result — attribution is a separate step the operator runs from Script.
  const warnings = [];
  if (emptyChapters.length) {
    const shown = emptyChapters.slice(0, _WARN_NAME_CAP).join(", ");
    const extra = emptyChapters.length - _WARN_NAME_CAP;
    const more = extra > 0 ? ` (+${extra} more)` : "";
    warnings.push(`${emptyChapters.length} chapter(s) had no text and were skipped: ${shown}${more}`);
  }
  if (imageCount) {
    warnings.push(`${imageCount} image file(s) in the zip were ignored — JustVoice imports prose and cast, not JustWrite's planning images`);
  }

  return construct(StandardImport, {
    source: SOURCE_ID,
    project,
    characters,
    scenes,
    // A JustWrite book carries no pronunciation lexicon.
    lexicon_entries: [],
    warnings,
  });
}
