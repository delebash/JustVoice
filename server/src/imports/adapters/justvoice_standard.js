// SPDX-License-Identifier: MIT
// JustVoice-standard import adapter (the port of justvoice/imports/adapters/justvoice_standard.py).
//
// Pass-through for payloads already in the StandardImport shape (e.g. re-importing a
// previously-exported project, or hand-authored adapter-pipeline output). Validates the JSON
// against the model and stamps `source = "justvoice_standard"`.
//
// pydantic's first error is what the 400 names, so the check walks the model as pydantic does —
// fields in declaration order, items in order — and words it as pydantic does
// (`firstError`); the value itself is built by `construct` (pydantic's lax conversions).

import { badRequest } from "../../errors.js";
import { construct } from "../../models.js";
import { decodeUtf8, isDict, jsonLoads } from "../../py_compat.js";
import { PyFloat } from "@delebash/llm-runner/platform/pyjson";
import { SCHEMA_VERSION, StandardImport } from "../standard_schema.js";

export const SOURCE_ID = "justvoice_standard";

// ── pydantic's words for the first error of a StandardImport ─────────────────

const STR = { kind: "str" };
const STR_OR_NONE = { kind: "str", nullable: true };
const INT_OR_NONE = { kind: "int", nullable: true };
const DICT_OR_NONE = { kind: "dict", nullable: true };
const list = (items) => ({ kind: "list", items });
const model = (name, fields) => ({ kind: "model", name, fields });

const LINE = model("StandardLine", [
  ["character_id", STR_OR_NONE, false],
  ["text", STR, true],
  ["delivery", DICT_OR_NONE, false],
  ["pause_after_ms", INT_OR_NONE, false],
  ["source_ref", STR_OR_NONE, false],
]);
const SPEC = model("StandardImport", [
  ["schema_version", STR, false],
  ["source", STR, true],
  [
    "project",
    model("StandardProject", [
      ["id", STR_OR_NONE, false],
      ["name", STR, true],
      ["kind", { kind: "literal", values: ["audiobook", "game_voicelines", "podcast", "custom"] }, false],
      ["description", STR_OR_NONE, false],
      ["language", STR, false],
    ]),
    true,
  ],
  [
    "characters",
    list(
      model("StandardCharacter", [
        ["id", STR, true],
        ["name", STR, true],
        ["voice_hint", STR_OR_NONE, false],
        ["notes", STR_OR_NONE, false],
        ["aliases", list(STR), false],
        ["pronouns", STR_OR_NONE, false],
      ]),
    ),
    false,
  ],
  [
    "scenes",
    list(
      model("StandardScene", [
        ["id", STR, true],
        ["title", STR_OR_NONE, false],
        ["kind", STR_OR_NONE, false],
        ["lines", list(LINE), false],
      ]),
    ),
    false,
  ],
  [
    "lexicon_entries",
    list(
      model("StandardLexiconEntry", [
        ["grapheme", STR, true],
        ["phoneme_ipa", STR_OR_NONE, false],
        ["alias", STR_OR_NONE, false],
      ]),
    ),
    false,
  ],
  ["warnings", list(STR), false],
]);

/** The message of pydantic's first error for `v` against `spec`, or null when it fits. */
function firstError(spec, v) {
  if (v === null || v === undefined) {
    if (spec.nullable) return null;
  }
  switch (spec.kind) {
    case "str":
      return typeof v === "string" ? null : "Input should be a valid string";
    case "int": {
      if (typeof v === "boolean") return null;
      if (typeof v === "number") return Number.isInteger(v) ? null : "Input should be a valid integer, got a number with a fractional part";
      if (v instanceof PyFloat) {
        if (!Number.isFinite(v.v)) return "Input should be a finite number";
        return Number.isInteger(v.v) ? null : "Input should be a valid integer, got a number with a fractional part";
      }
      if (typeof v === "string") {
        const t = v.trim();
        if (/^[-+]?\d+(?:_\d+)*$/.test(t) || /^[-+]?\d+(?:_\d+)*\.0*$/.test(t)) return null;
        if (/^[-+]?(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return "Input should be a valid integer, got a number with a fractional part";
        return "Input should be a valid integer, unable to parse string as an integer";
      }
      return "Input should be a valid integer";
    }
    case "dict":
      return isDict(v) ? null : "Input should be a valid dictionary";
    case "literal":
      return spec.values.includes(v) ? null : `Input should be ${spec.values.slice(0, -1).map((x) => `'${x}'`).join(", ")} or '${spec.values.at(-1)}'`;
    case "list": {
      if (!Array.isArray(v)) return "Input should be a valid list";
      for (const x of v) {
        const e = firstError(spec.items, x);
        if (e) return e;
      }
      return null;
    }
    case "model": {
      if (!isDict(v)) return `Input should be a valid dictionary or instance of ${spec.name}`;
      for (const [name, f, required] of spec.fields) {
        if (!Object.hasOwn(v, name)) {
          if (required) return "Field required";
          continue;
        }
        const e = firstError(f, v[name]);
        if (e) return e;
      }
      return null;
    }
    default:
      return null;
  }
}

export function parse(raw, { filename = null } = {}) {
  void filename;
  let doc;
  try {
    doc = jsonLoads(decodeUtf8(Buffer.isBuffer(raw) ? raw : Buffer.from(raw)));
  } catch (e) {
    if (e?.name === "UnicodeDecodeError" || e?.name === "JSONDecodeError") {
      throw badRequest(`justvoice_standard import: not valid UTF-8 JSON (${e.message})`);
    }
    throw e;
  }

  const err = firstError(SPEC, doc);
  if (err) throw badRequest(`justvoice_standard import: schema mismatch — ${err}`);
  const std = construct(StandardImport, doc);

  // Preserve the inbound `source` if it's been routed through another adapter previously;
  // otherwise stamp our own.
  if (!std.source) std.source = SOURCE_ID;
  if (std.schema_version !== SCHEMA_VERSION) {
    std.warnings.push(`schema_version mismatch (file=${std.schema_version}, server=${SCHEMA_VERSION})`);
  }
  return std;
}
