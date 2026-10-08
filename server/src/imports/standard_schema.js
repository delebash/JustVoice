// SPDX-License-Identifier: MIT
// JustVoice import standard schema (the port of justvoice/imports/standard_schema.py).
//
// Every adapter normalizes its source format into a `StandardImport` shape, so the rest of the
// server only deals with one structure when materializing a project. The models are TypeBox
// schemas (pydantic in the kit's platform/models.js form); a value is built with
// `construct(Schema, {...})` from models.js, so defaults fill and fields keep declaration order.
//
// Versioning: bump `SCHEMA_VERSION` whenever a backwards-incompatible change to the shape lands.
// Old payloads can be migrated by the `justvoice_standard` adapter (which also validates
// incoming JSON that claims to already be in this shape).

import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";

export const SCHEMA_VERSION = "1.0";

export const ProjectKind = literal("audiobook", "game_voicelines", "podcast", "custom");

export const StandardLexiconEntry = T.Object({
  grapheme: T.String(),
  phoneme_ipa: opt(nullable(T.String()), null),
  alias: opt(nullable(T.String()), null),
});

/**
 * A speaking part. Maps to a speaker once the project is committed. `voice_hint` is a free-form
 * string the operator can use to bias voice assignment (e.g. "elderly male") — not binding.
 * `aliases`: other names the source knows them by (JustWrite `aliases`). `pronouns`: "he/him" |
 * "she/her" | "they/them" | "it/its", or null (JustWrite's character sheet, persona build P9).
 */
export const StandardCharacter = T.Object({
  id: T.String(),
  name: T.String(),
  voice_hint: opt(nullable(T.String()), null),
  notes: opt(nullable(T.String()), null),
  aliases: opt(T.Array(T.String()), []),
  pronouns: opt(nullable(T.String()), null),
});

/** One spoken line in a scene. The smallest renderable unit. */
export const StandardLine = T.Object({
  character_id: opt(nullable(T.String()), null),
  text: T.String(),
  delivery: opt(nullable(T.Record(T.String(), T.Any())), null), // free-form overlay (speed, emotion, pause_before, …)
  pause_after_ms: opt(nullable(T.Integer()), null),
  source_ref: opt(nullable(T.String()), null), // row/line/cue id in the source file
});

/** A scene (chapter / dialog tree node / podcast segment). `kind` is informational — adapters
 * set it to whatever best describes the source slice ("chapter", "cue", "segment"). */
export const StandardScene = T.Object({
  id: T.String(),
  title: opt(nullable(T.String()), null),
  kind: opt(nullable(T.String()), null),
  lines: opt(T.Array(StandardLine), []),
});

/** Top-level container. `kind` selects which use-case surface the GUI mounts when the project
 * is opened. */
export const StandardProject = T.Object({
  id: opt(nullable(T.String()), null), // filled in on commit
  name: T.String(),
  kind: opt(ProjectKind, "audiobook"),
  description: opt(nullable(T.String()), null),
  language: opt(T.String(), "en-US"),
});

/** Top-level normalized payload every adapter produces. */
export const StandardImport = T.Object({
  schema_version: opt(T.String(), SCHEMA_VERSION),
  source: T.String(), // the adapter id (justwrite, csv_lines, …)
  project: StandardProject,
  characters: opt(T.Array(StandardCharacter), []),
  scenes: opt(T.Array(StandardScene), []),
  lexicon_entries: opt(T.Array(StandardLexiconEntry), []),
  warnings: opt(T.Array(T.String()), []),
});

/** Describes an adapter for the UI picker. */
export const AdapterInfo = T.Object({
  id: T.String(),
  label: T.String(),
  description: T.String(),
  file_extensions: opt(T.Array(T.String()), []),
  implemented: opt(T.Boolean(), true),
  docs_anchor: opt(nullable(T.String()), null), // e.g. "import-justwrite" — feeds the help-bus key
});

export const AdapterListResponse = T.Object({
  adapters: T.Array(AdapterInfo),
  schema_version: opt(T.String(), SCHEMA_VERSION),
});

/** Returned from POST /v1/projects/import. On dry_run, `committed` is false and `project_id` is
 * null. The `standard` payload is included so the UI can show a preview. */
export const ImportRunResponse = T.Object({
  committed: T.Boolean(),
  project_id: nullable(T.String()),
  standard: StandardImport,
  warnings: opt(T.Array(T.String()), []),
});
