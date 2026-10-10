// SPDX-License-Identifier: MIT
// /v1/projects — Books, game-voicelines, podcasts, custom projects (the port of
// justvoice/api/projects_api.py).
//
// Use-case-generalized Project → Scene → Block model from DESIGN_FREEZE §4.4. Audiobook =
// chapters + paragraphs; game = dialogue trees + NPC lines; podcast = episodes + segments. Same
// data model, different metadata + export pipelines.
//
// Also: POST /v1/projects/import?source=justwrite ingests a JustWrite book JSON and auto-creates
// Project + Scenes + Blocks + Speakers. Sources are pluggable (`imports/`): the adapter registry
// produces a normalized StandardImport that the import endpoint materializes into rows.
// JustWrite is one adapter among several (book_prose, podcast_markdown, csv_lines, srt,
// audacity_labels, justvoice_standard).
//
// Ported in two parts: the import materializer (`_materializeStandard`, `_materializeLexicon`)
// with the imports (wave D), the routes and the rest with the API wave (agent 3).
//
// Python's session ran with autoflush OFF and committed once per request; here every change of
// a request is written in one `h.tx`, after every check that could refuse it (a refusal leaves
// the database as it was, as Python's rollback did). Where rows were deleted and inserted in one
// flush, the JS keeps SQLAlchemy's order — a table's INSERTs before its DELETEs — so the rowids
// come out the same. An attribute set to the value it already had wrote nothing in Python (no
// UPDATE, so no `updated_at` stamp): `_dirtyUpdate` keeps that.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { Hono, input } from "@delebash/llm-runner/platform";
import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import {
  casefold,
  cpSlice,
  isDict,
  KeyError,
  lstrip,
  PY_WS,
  pyIntOfStr,
  rstrip,
  splitWs,
  strip,
  strRepr,
  truthy,
  ValueError,
} from "@delebash/llm-runner/platform/py";
import { jsonLoads, pyJson, pyStrOf } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { SequenceMatcher } from "../difflib.js";
import { Block, Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry, Project, Scene, Speaker, Take } from "../database/models.js";
import * as session from "../database/session.js";
import * as demoProjects from "../demo_projects.js";
import * as run from "../engines/llm/run.js";
import { ApiError, badRequest, HttpError, notFound } from "../errors.js";
import * as exportAudiobook from "../export_audiobook.js";
import * as exportVoicelines from "../export_voicelines.js";
import { listAdapters, runAdapter } from "../imports/index.js";
import { AdapterListResponse, ImportRunResponse } from "../imports/standard_schema.js";
import * as lineTakes from "../line_takes.js";
import * as mastering from "../mastering.js";
import { construct, DateTime } from "../models.js";
import * as synthScheduler from "../synth_scheduler.js";
import { adoptBookNarrator, ensureSpeaker } from "./_speaker_helpers.js";
import * as captures from "./captures_api.js";
import * as extraction from "./extraction_api.js";
import { RunUsage } from "./extraction_api.js";
import { clientGone } from "./generate_api.js";
import * as renderChapterApi from "./render_chapter_api.js";
import { sentBody } from "./settings_api.js";

export const ProjectType = literal("audiobook", "game_voicelines", "podcast", "custom");

const errText = (e) => e?.message ?? String(e);
const marks = (n) => Array.from({ length: n }, () => "?").join(", ");

// ── Small helpers ───────────────────────────────────────────────────────

/** `json.loads(text)` of a stored JSON column (Python's floats kept as PyFloats). */
export const loadsJson = (text) => jsonLoads(text);

/** `d.get(k)` on a parsed JSON value — an AttributeError (a 500) when it is not a dict, as in
 * Python. */
function dget(d, k, dflt = null) {
  if (!isDict(d)) throw new TypeError(`'${Array.isArray(d) ? "list" : typeof d === "string" ? "str" : d === null ? "NoneType" : "int"}' object has no attribute 'get'`);
  return Object.hasOwn(d, k) ? d[k] : dflt;
}

/**
 * Write only the columns whose value changed — SQLAlchemy issues no UPDATE (and so no
 * `onupdate` stamp) for an attribute set to the value it already had. `row` is the row as read;
 * it is updated in place. → whether anything was written. Candidate for platform/sql.js.
 */
export function _dirtyUpdate(h, table, row, changes) {
  const diff = {};
  for (const [k, v] of Object.entries(changes)) if (row[k] !== v) diff[k] = v;
  if (!Object.keys(diff).length) return false;
  h.update(table, diff, { id: row.id });
  Object.assign(row, diff);
  return true;
}

/** Insert one row and read it back (the ORM's flush → the row with its id and defaults). */
function insertRow(h, table, row) {
  h.insert(table, row);
  return h.one(`select * from ${table} where rowid = last_insert_rowid()`, [], table);
}

const projectById = (h, id) => h.one(`select * from ${Project} where id = ? limit 1`, [id], Project);
const sceneById = (h, id) => h.one(`select * from ${Scene} where id = ? limit 1`, [id], Scene);
const blockById = (h, id) => h.one(`select * from ${Block} where id = ? limit 1`, [id], Block);
const blocksOf = (h, sceneId) => h.all(`select * from ${Block} where scene_id = ? order by position`, [sceneId], Block);

// ── Response shapes ──────────────────────────────────────────────────────

export const ProjectResponse = T.Object({
  id: T.String(),
  name: T.String(),
  description: nullable(T.String()),
  project_type: ProjectType,
  metadata: T.Record(T.String(), T.Any()),
  default_lexicon_id: nullable(T.String()),
  mastering_preset: nullable(T.String()),
  imported_from: nullable(T.String()),
  // The book's language (2026-10-03): what its text is written in, so Cast can say when a
  // persona speaks another. Kept in the project's metadata, where an import already wrote it.
  // null = not set.
  language: opt(nullable(T.String()), null),
  scene_count: opt(T.Integer(), 0),
  // Names Discover was told to ignore here (2026-09-27, fix 4).
  discover_ignored: opt(T.Array(T.String()), []),
  created_at: DateTime(),
  updated_at: DateTime(),
});

/** `ProjectResponse.from_orm(row, scene_count)`. */
export function projectOut(row, sceneCount = 0) {
  const metadata = loadsJson(row.metadata_json || "{}");
  return construct(ProjectResponse, {
    id: row.id,
    name: row.name,
    description: row.description,
    project_type: row.project_type,
    metadata,
    language: isDict(metadata) ? (truthy(dget(metadata, "language")) ? dget(metadata, "language") : null) : null,
    default_lexicon_id: row.default_lexicon_id,
    mastering_preset: row.mastering_preset,
    imported_from: row.imported_from,
    scene_count: sceneCount,
    discover_ignored: extraction.projectIgnored(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export const ProjectList = T.Object({ projects: T.Array(ProjectResponse) });

export const SceneResponse = T.Object({
  id: T.String(),
  project_id: T.String(),
  position: T.Integer(),
  title: nullable(T.String()),
  description: nullable(T.String()),
  metadata: T.Record(T.String(), T.Any()),
  block_count: opt(T.Integer(), 0),
  created_at: DateTime(),
});

/** `SceneResponse.from_orm(row, block_count)`. */
export function sceneOut(row, blockCount = 0) {
  return construct(SceneResponse, {
    id: row.id,
    project_id: row.project_id,
    position: row.position,
    title: row.title,
    description: row.description,
    metadata: loadsJson(row.metadata_json || "{}"),
    block_count: blockCount,
    created_at: row.created_at,
  });
}

export const BlockResponse = T.Object({
  id: T.String(),
  scene_id: T.String(),
  position: T.Integer(),
  text: T.String(),
  speaker_id: nullable(T.String()),
  direction: nullable(T.String()),
  metadata: T.Record(T.String(), T.Any()),
  // Phase 3 / Slice 2 — extraction telemetry surfaced to the Studio Script tab. Null on blocks
  // created manually (source="manual" or left null pre-extraction).
  extraction_confidence: opt(nullable(T.Number()), null),
  source: opt(nullable(T.String()), null),
  created_at: DateTime(),
  // Set by the block PATCH when the change saved a speaker fix for the attribution prompt —
  // Script's Undo deletes exactly that fix.
  fix_id: opt(nullable(T.String()), null),
});

/** `BlockResponse.from_orm(row)` (+ `fix_id`). */
export function blockOut(row, fixId = null) {
  return construct(BlockResponse, {
    id: row.id,
    scene_id: row.scene_id,
    position: row.position,
    text: row.text,
    speaker_id: row.speaker_id,
    direction: row.direction,
    metadata: loadsJson(row.metadata_json || "{}"),
    extraction_confidence: row.extraction_confidence,
    source: row.source,
    created_at: row.created_at,
    fix_id: fixId,
  });
}

// ── Request shapes ──────────────────────────────────────────────────────

export const CreateProjectRequest = T.Object({
  name: T.String({ minLength: 1, maxLength: 200 }),
  description: opt(nullable(T.String()), null),
  project_type: ProjectType,
  metadata: opt(T.Record(T.String(), T.Any()), {}),
  default_lexicon_id: opt(nullable(T.String()), null),
  mastering_preset: opt(nullable(T.String()), null),
  // The book's language (New project's Language), e.g. "en" or "ja".
  language: opt(nullable(T.String()), null),
});

export const UpdateProjectRequest = T.Object({
  name: opt(nullable(T.String()), null),
  description: opt(nullable(T.String()), null),
  metadata: opt(nullable(T.Record(T.String(), T.Any())), null),
  default_lexicon_id: opt(nullable(T.String()), null),
  mastering_preset: opt(nullable(T.String()), null),
  // Overview's Language. Left out = unchanged; null = not set.
  language: opt(nullable(T.String()), null),
});

export const CreateSceneRequest = T.Object({
  position: opt(T.Integer(), 0),
  title: opt(nullable(T.String()), null),
  description: opt(nullable(T.String()), null),
  metadata: opt(T.Record(T.String(), T.Any()), {}),
});

export const CreateBlockRequest = T.Object({
  position: opt(T.Integer(), 0),
  text: T.String({ minLength: 1 }),
  speaker_id: opt(nullable(T.String()), null),
  direction: opt(nullable(T.String()), null),
  metadata: opt(T.Record(T.String(), T.Any()), {}),
  // Phase 3 / Slice 2 — extraction telemetry. Analyze runs write these itself now; manual block
  // creation leaves them null + source="manual".
  extraction_confidence: opt(nullable(T.Number()), null),
  source: opt(nullable(T.String()), "manual"),
});

export const UpdateBlockRequest = T.Object({
  position: opt(nullable(T.Integer()), null),
  text: opt(nullable(T.String()), null),
  // Left out = unchanged. `speaker_id`, `source` and `extraction_confidence` sent as null =
  // cleared: Script's Undo puts back a line exactly as it was.
  speaker_id: opt(nullable(T.String()), null),
  direction: opt(nullable(T.String()), null),
  metadata: opt(nullable(T.Record(T.String(), T.Any())), null),
  // Render's ⚙ hatch (Studio Slice 4, D3): the line's own speed, pitch, gain_db and
  // pause_after_ms, merged into its metadata — a value sets it, null clears it, a field left
  // out is kept (line_takes.mergeOverride). `metadata` replaces the whole JSON.
  line_override: opt(nullable(T.Record(T.String(), T.Any())), null),
  extraction_confidence: opt(nullable(T.Number()), null),
  source: opt(nullable(T.String()), null),
  // A speaker change normally saves a fix the next Analyze learns from. Undo sends this: taking
  // a change back is not a fix.
  no_fix: opt(T.Boolean(), false),
});

export const UpdateSceneRequest = T.Object({
  title: opt(nullable(T.String()), null),
  position: opt(nullable(T.Integer()), null),
});

// ── Split and merge a line — Script's "✎ Edit…" and "⇲ Merge" (2026-09-30) ──
//
// docs/plans/2026-09-30-script-leftovers.md, B1. The only way to fix a line the segmenter cut
// wrong. Both change how many lines the chapter has, so both drop its analyzed text: from then
// on Analyze reads it as its lines (`extraction_api._linesToKeep`) and never re-cuts what was
// cut by hand. Neither has an Undo — each undoes the other.

export const SplitBlockRequest = T.Object({
  // Where the new line starts, as a character offset into `text`.
  at: T.Integer(),
  // The words to split, when the editor changed them first; left out = the line's own.
  text: opt(nullable(T.String()), null),
});

export const MergeBlocksRequest = T.Object({ ids: T.Array(T.String(), { minItems: 2 }) });

export const BlockListResponse = T.Object({ blocks: T.Array(BlockResponse) });

// ── A chapter's text, edited from its row — Script's "✎ Edit text" (2026-10-05) ──
//
// TASKS "A chapter's text can be edited from its row, and a chapter opens before Analyze". The
// chapter's lines open as one text, a paragraph each; saving matches the new paragraphs to the
// old lines, in order. A line whose words are unchanged keeps everything — its speaker, marks
// and takes. A changed or new paragraph becomes a new line with no speaker (source "manual", as
// ＋ Add text makes them), which Script counts "changed since" until an Analyze decides it. A
// line that goes takes its takes with it; a `dry_run` says how many lines with takes would go,
// so Script asks first. Spacing never counts as a change.

export const ChapterTextResponse = T.Object({ text: T.String() });

export const EditChapterTextRequest = T.Object({ text: T.String(), dry_run: opt(T.Boolean(), false) });

export const EditChapterTextResponse = T.Object({
  kept: opt(T.Integer(), 0),
  changed: opt(T.Integer(), 0),
  added: opt(T.Integer(), 0),
  removed: opt(T.Integer(), 0),
  // Lines with takes that would go — changed or removed.
  takes_lost: opt(T.Integer(), 0),
});

const PARAGRAPH_BREAK = new RegExp(`\\n[${PY_WS}]*\\n`, "u");
const PARAGRAPH_BREAKS = new RegExp(`\\n[${PY_WS}]*\\n`, "gu");

/** `[p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]`. */
export function _textParagraphs(text) {
  return (text || "")
    .split(PARAGRAPH_BREAK)
    .map((p) => strip(p))
    .filter((p) => p);
}

const _sameWords = (text) => splitWs(text || "").join(" ");

/**
 * How new paragraphs replace old lines, matched in order (difflib) → `[steps, counts]`. `steps`
 * is the chapter in its new order — ["keep", i] for old line i, ["new", j] for paragraph j —
 * with ["drop", i] at the place each old line leaves; `counts` is {kept, changed, added,
 * removed}.
 */
export function textEditPlan(old, neu) {
  const sm = new SequenceMatcher(null, old.map(_sameWords), neu.map(_sameWords), false);
  const steps = [];
  const counts = { kept: 0, changed: 0, added: 0, removed: 0 };
  for (const [tag, i1, i2, j1, j2] of sm.getOpcodes()) {
    if (tag === "equal") {
      for (let i = i1; i < i2; i++) steps.push(["keep", i]);
      counts.kept += i2 - i1;
      continue;
    }
    for (let j = j1; j < j2; j++) steps.push(["new", j]);
    for (let i = i1; i < i2; i++) steps.push(["drop", i]);
    const both = Math.min(i2 - i1, j2 - j1);
    counts.changed += both;
    counts.added += j2 - j1 - both;
    counts.removed += i2 - i1 - both;
  }
  return [steps, counts];
}

/**
 * Forget the prose an analyze run was made from, because the blocks no longer match it.
 *
 * extraction_api stores the analyzed text on the scene so re-analyze feeds the pipeline the
 * identical input and the split stays reproducible (the Script-tab restore, decision 3). The
 * moment a block's text is edited or a block is added/removed, that stored copy describes a
 * chapter that no longer exists — keeping it would attribute the OLD wording onto the new
 * blocks. Dropping it makes the next analyze fall back to the blocks themselves, which is why
 * dialogue blocks keep their quote marks.
 */
export function _dropSceneSourceText(h, sceneId) {
  const sc = sceneById(h, sceneId);
  if (sc === null || !sc.metadata_json) return;
  let meta;
  try {
    meta = jsonLoads(sc.metadata_json);
  } catch {
    return;
  }
  // `meta.pop("source_text", None) is not None` (an AttributeError on a non-dict, as Python).
  const had = dget(meta, "source_text");
  delete meta.source_text;
  if (had !== null) h.update(Scene, { metadata_json: pyJson(meta) }, { id: sceneId });
}

/** `blk.position = i` for each, in order — only the positions that move are written, and none
 * of `inserted` (new rows, written at their place already). */
function _renumber(h, ordered, inserted = new Set()) {
  ordered.forEach((blk, i) => {
    if (!inserted.has(blk) && blk.position !== i) {
      h.update(Block, { position: i }, { id: blk.id });
      blk.position = i;
    }
  });
}

/** `text[a:]` / `text[:a]` with Python's slice rules (code points, negative from the end). */
function pySplitAt(text, at) {
  const cps = Array.from(text);
  const n = cps.length;
  let k = at < 0 ? Math.max(0, n + at) : Math.min(at, n);
  if (k < 0) k = 0;
  return [cps.slice(0, k).join(""), cps.slice(k).join("")];
}

// ── Multi-adapter import pipeline ─────────────────────────────────────────

export const _KIND_TO_PROJECT_TYPE = {
  audiobook: "audiobook",
  game_voicelines: "game_voicelines",
  podcast: "podcast",
  custom: "custom",
};

/**
 * Turn a StandardImport into rows → `[project, sceneCount, blockCount, createdSpeakers,
 * reusedSpeakers]`. The caller runs it (with `_materializeLexicon`) inside one `h.tx`, as
 * Python committed once after both.
 */
export function _materializeStandard(standard, h) {
  const projectType = Object.hasOwn(_KIND_TO_PROJECT_TYPE, standard.project.kind) ? _KIND_TO_PROJECT_TYPE[standard.project.kind] : "custom";

  const p = insertRow(h, Project, {
    name: standard.project.name,
    description: standard.project.description,
    project_type: projectType,
    metadata_json: pyJson({ language: standard.project.language, schema_version: standard.schema_version }),
    mastering_preset: mastering.kindMaster(projectType),
    imported_from: standard.source,
  });

  // The book's characters become its speakers (2026-09-29). Everything the source knows about
  // one is "Who they are" material: the one-liner and the casting hint (voice_hint). An import
  // keeps the characters exactly as the book has them — two with one name stay two; each is
  // cast with the persona of exactly its name when the library has one.
  const createdSpeakers = [];
  const reusedSpeakers = [];
  const charToSpeakerId = new Map();
  for (const char of standard.characters) {
    let sheet = char.notes || "";
    if (char.voice_hint) sheet = strip(`${sheet}\n\nVoice hint:\n${char.voice_hint}`);
    const [speaker, created] = ensureSpeaker(h, p.id, {
      name: char.name,
      description: sheet || null,
      aliases: char.aliases,
      pronouns: char.pronouns,
      importedFrom: standard.source,
      importedId: char.id,
    });
    charToSpeakerId.set(char.id, speaker.id);
    (created ? createdSpeakers : reusedSpeakers).push(speaker.id);
  }

  // After the speakers, never before — see adoptBookNarrator.
  adoptBookNarrator(h, p);

  // Scenes + Blocks.
  let totalBlocks = 0;
  standard.scenes.forEach((scene, sceneIdx) => {
    const s = insertRow(h, Scene, {
      project_id: p.id,
      position: sceneIdx,
      title: scene.title,
      description: null,
      metadata_json: pyJson({ kind: scene.kind, source_id: scene.id, index_one_based: sceneIdx + 1 }),
    });
    scene.lines.forEach((line, blockIdx) => {
      const speakerId = line.character_id ? (charToSpeakerId.get(line.character_id) ?? null) : null;
      // delivery → direction: best-effort surface a short tag for the UI
      let direction = null;
      let isMarker = false;
      if (truthy(line.delivery) && isDict(line.delivery)) {
        const get = (k) => (Object.hasOwn(line.delivery, k) ? line.delivery[k] : null);
        direction = truthy(get("emotion")) ? get("emotion") : get("style"); // `a or b`
        isMarker = truthy(get("marker"));
      }
      // source_ref = the import's stable line id (game CSV dialogue ids, epub paragraph refs) —
      // re-imports + voiceline export key on it. marker = music/ad direction lines (podcast):
      // legitimately speaker-less, so attribution checks skip them.
      const meta = {};
      if (line.source_ref) meta.source_ref = line.source_ref;
      if (isMarker) meta.marker = true;
      // Every adapter parses `pause_after_ms` and it is a documented import field — kept on the
      // metadata rather than a new column; render_chapter_api reads it back.
      if (line.pause_after_ms) meta.pause_after_ms = Math.trunc(line.pause_after_ms);
      h.insert(Block, {
        scene_id: s.id,
        position: blockIdx,
        text: line.text,
        speaker_id: speakerId,
        direction,
        metadata_json: Object.keys(meta).length ? pyJson(meta) : null,
      });
      totalBlocks += 1;
    });
  });

  return [p, standard.scenes.length, totalBlocks, createdSpeakers, reusedSpeakers];
}

/**
 * Create a project-scoped lexicon from the import's entries → the new lexicon id (also written
 * to project.default_lexicon_id), or null when the import carries neither lexicon entries nor
 * characters. Character names land as blank-pronunciation rows — the book's pronunciation
 * worklist, seeded free at import (decided 2026-08-21): an empty entry is inert at render.
 */
export function _materializeLexicon(standard, project, h) {
  const seen = new Set();
  const nameRows = [];
  for (const char of standard.characters) {
    const name = strip(char.name || "");
    if (!name || casefold(name) === "narrator" || seen.has(casefold(name))) continue;
    seen.add(casefold(name));
    nameRows.push(name);
  }

  if (!standard.lexicon_entries.length && !nameRows.length) return null;

  const lexId = `lex_${randomUUID().replaceAll("-", "")}`;
  h.insert(DbLexicon, {
    id: lexId,
    name: `${project.name} (imported)`,
    description: `Materialized from ${standard.source} import`,
    scope: "project",
    project_id: project.id,
  });
  const explicit = new Set();
  for (const e of standard.lexicon_entries) {
    explicit.add(casefold(e.grapheme));
    h.insert(DbLexiconEntry, {
      lexicon_id: lexId,
      word: e.grapheme,
      pronunciation: e.phoneme_ipa || e.alias || "",
      notation: e.phoneme_ipa ? "ipa" : "phonetic",
    });
  }
  for (const name of nameRows) {
    if (explicit.has(casefold(name))) continue; // the import's own entry wins over the blank seed
    h.insert(DbLexiconEntry, { lexicon_id: lexId, word: name, pronunciation: "", notation: "phonetic" });
  }
  h.update(Project, { default_lexicon_id: lexId }, { id: project.id });
  project.default_lexicon_id = lexId; // the caller's row object, as the ORM's attribute
  return lexId;
}

// ── Game re-import (update-in-place) + line status (Phase B3/B5) ─────────

/**
 * Update an existing project from a re-imported StandardImport, matching scenes by source_id
 * and blocks by stable line id (source_ref) → the summary {scenes_added, added, updated,
 * removed, unchanged}. Changed text updates in place — staleness is derived later (block text vs
 * latest take's generation text), so only the truly-changed lines lose their rendered status
 * (CONCEPTS §3). Requires every incoming line to carry a source_ref; without stable ids an
 * update merge would be guesswork. The caller runs it in its transaction.
 *
 * Python's session flushed when a new scene was added (and at the commit): the new lines and the
 * removed ones waiting until then went in that flush's order — the INSERTs, then the DELETEs —
 * which `flush()` here keeps.
 */
export function _updateProjectFromStandard(standard, project, h) {
  for (const scene of standard.scenes) {
    for (const line of scene.lines) {
      if (!line.source_ref || line.source_ref.startsWith("row:")) {
        // row:N fallbacks are positional, not stable — reordering the sheet would silently
        // mismatch every line.
        throw badRequest("update re-import requires a stable line id on every row (id / line_id / dialogue_id column)");
      }
    }
  }

  // Speakers create-or-reuse, as on first import.
  const charToSpeakerId = new Map();
  for (const char of standard.characters) {
    let sheet = char.notes || "";
    if (char.voice_hint) sheet = strip(`${sheet}\n\nVoice hint:\n${char.voice_hint}`);
    const [speaker] = ensureSpeaker(h, project.id, {
      name: char.name,
      description: sheet || null,
      aliases: char.aliases,
      pronouns: char.pronouns,
      importedFrom: standard.source,
      importedId: char.id,
    });
    charToSpeakerId.set(char.id, speaker.id);
  }

  const existingScenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [project.id], Scene);

  const sceneKey = (sc) => {
    if (sc.metadata_json) {
      let meta;
      try {
        meta = jsonLoads(sc.metadata_json);
      } catch {
        return sc.title;
      }
      const sid = dget(meta, "source_id");
      return truthy(sid) ? sid : sc.title;
    }
    return sc.title;
  };

  const byKey = new Map();
  for (const sc of existingScenes) byKey.set(sceneKey(sc), sc);
  const summary = { scenes_added: 0, added: 0, updated: 0, removed: 0, unchanged: 0 };

  // The writes waiting for the next flush.
  const pendingInserts = [];
  const pendingDeletes = [];
  const flush = () => {
    for (const row of pendingInserts.splice(0)) h.insert(Block, row);
    for (const id of pendingDeletes.splice(0)) h.delete(Block, { id });
  };

  let nextScenePos = existingScenes.length;
  for (const stdScene of standard.scenes) {
    let scene = byKey.get(stdScene.id) ?? null;
    if (!truthy(scene)) scene = byKey.get(stdScene.title) ?? null;
    if (scene === null) {
      flush(); // db.add(scene); db.flush()
      scene = insertRow(h, Scene, {
        project_id: project.id,
        position: nextScenePos,
        title: stdScene.title,
        metadata_json: pyJson({ kind: stdScene.kind, source_id: stdScene.id, index_one_based: nextScenePos + 1 }),
      });
      nextScenePos += 1;
      summary.scenes_added += 1;
    }

    const blocks = blocksOf(h, scene.id);
    const blockRef = (b) => {
      if (b.metadata_json) {
        let meta;
        try {
          meta = jsonLoads(b.metadata_json);
        } catch {
          return null;
        }
        return dget(meta, "source_ref");
      }
      return null;
    };
    const byRef = new Map();
    for (const b of blocks) {
      const ref = blockRef(b);
      if (truthy(ref)) byRef.set(ref, b);
    }
    const incomingRefs = new Set();
    let nextPos = blocks.length;
    for (const line of stdScene.lines) {
      incomingRefs.add(line.source_ref);
      const speakerId = line.character_id ? (charToSpeakerId.get(line.character_id) ?? null) : null;
      const existing = byRef.get(line.source_ref) ?? null;
      if (existing === null) {
        pendingInserts.push({
          id: randomUUID(),
          scene_id: scene.id,
          position: nextPos,
          text: line.text,
          speaker_id: speakerId,
          metadata_json: pyJson({ source_ref: line.source_ref }),
        });
        nextPos += 1;
        summary.added += 1;
      } else if (existing.text !== line.text || existing.speaker_id !== speakerId) {
        h.update(Block, { text: line.text, speaker_id: speakerId }, { id: existing.id });
        existing.text = line.text;
        existing.speaker_id = speakerId;
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
    }
    // Lines that vanished from the sheet are removed (takes cascade).
    for (const [ref, b] of byRef) {
      if (!incomingRefs.has(ref)) {
        pendingDeletes.push(b.id);
        summary.removed += 1;
      }
    }
  }
  flush(); // the commit's flush
  return summary;
}

// ── Audiobook export + QC (mock #audiobook/7) ────────────────────────────

export const ChapterQCOut = T.Object({
  scene_id: T.String(),
  title: T.String(),
  duration_s: T.Number(),
  rms_dbfs: T.Number(),
  peak_dbfs: T.Number(),
  rms_ok: T.Boolean(),
  peak_ok: T.Boolean(),
  ok: T.Boolean(),
  // Why a chapter fails for a reason the loudness numbers can't express — today: it has lines
  // nobody speaks, so what was measured is not the whole chapter. Null when render-ready.
  note: opt(nullable(T.String()), null),
});

export const ProjectQCResponse = T.Object({
  project_id: T.String(),
  chapters: T.Array(ChapterQCOut),
  all_ok: T.Boolean(),
  limits: T.Record(T.String(), T.Any()),
  // What the numbers were measured ON. An ACX verdict computed over raw TTS output is a wrong
  // answer, so QC says which it did: `mastered` false with a `master_preset` set means ffmpeg
  // is missing and these are raw numbers.
  master_preset: opt(nullable(T.String()), null),
  mastered: opt(T.Boolean(), false),
  note: opt(nullable(T.String()), null),
});

/**
 * The M4B `artist` tag. The project's Author field (Studio · Overview, saved as
 * `metadata.author`) wins; before that field reached the export, the only source was a
 * description starting "by ", which stays as the fallback.
 */
export function m4bAuthor(project) {
  let meta;
  try {
    meta = project.metadata_json ? jsonLoads(project.metadata_json) : {};
  } catch {
    meta = {};
  }
  const raw = isDict(meta) ? dget(meta, "author") : null;
  const author = isDict(meta) ? strip(pyStrOf(truthy(raw) ? raw : "")) : "";
  if (author) return author;
  if (project.description?.startsWith("by ")) return cpSlice(project.description, 3);
  return null;
}

export const ProjectLineOut = T.Object({
  block_id: T.String(),
  line_id: nullable(T.String()),
  scene_id: T.String(),
  scene_title: nullable(T.String()),
  speaker: nullable(T.String()),
  text: T.String(),
  // "none" (no take, or it can't render yet) | "rendered" | "stale" — Render's rule
  // (line_takes, G9 2026-10-04): stale = something the ★ take was made from changed since.
  take_status: T.String(),
  // §8.16's word for the line: needs a speaker · needs a voice · ready · rendered · stale (null
  // for a line that is not heard — a marker).
  state: opt(nullable(T.String()), null),
});

export const ProjectLinesResponse = T.Object({
  project_id: T.String(),
  lines: T.Array(ProjectLineOut),
  counts: T.Record(T.String(), T.Any()),
});

export const CreateDemoRequest = T.Object({ kind: T.String() }); // "audiobook" | "game_voicelines" | "podcast"

export const ShowNotesResponse = T.Object({
  project_id: T.String(),
  markdown: T.String(),
  // §16: every AI response carries the run's usage.
  usage: opt(nullable(RunUsage), null),
});

const IMPORT_SAFE = /[^A-Za-z0-9._-]+/g;

/** The name of a speaker row, or null (`db.query(Speaker.name).filter(...).first()`). */
const speakerName = (h, id) => h.one(`select name from ${Speaker} where id = ? limit 1`, [id])?.name ?? null;

// ── The import's request, as FastAPI reads it ─────────────────────────────

/** pydantic's bool of a form or query value (`loc` for the 422), null when not sent. */
function boolParam(raw, loc, errors) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).toLowerCase();
  if (["1", "true", "yes", "on", "t", "y"].includes(s)) return true;
  if (["0", "false", "no", "off", "f", "n"].includes(s)) return false;
  errors.push({ loc, msg: "Input should be a valid boolean, unable to interpret input", type: "bool_parsing" });
  return null;
}

/** A query parameter's value (the last one, as Starlette's QueryParams gives it). */
const queryValue = (c, name) => {
  const v = c.req.queries(name);
  return v ? v[v.length - 1] : undefined;
};

/**
 * The import's form, file and raw body. A multipart request is read as Starlette reads one (the
 * body is then consumed); an url-encoded one gives fields and no body; anything else has no form
 * and its raw bytes are the body.
 */
async function readImportRequest(c) {
  const ctype = String(c.req.header("content-type") || "").toLowerCase();
  if (/^multipart\//i.test(ctype)) {
    const form = await captures._readForm(c);
    return { fields: form.fields, file: form.files.file ?? null, raw: Buffer.alloc(0) };
  }
  const body = Buffer.from(await c.req.arrayBuffer());
  if (ctype.startsWith("application/x-www-form-urlencoded")) {
    const fields = {};
    for (const [k, v] of new URLSearchParams(body.toString("utf8"))) fields[k] = v;
    return { fields, file: null, raw: Buffer.alloc(0) };
  }
  return { fields: {}, file: null, raw: body };
}

/** `name: Optional[str] = Form(None)` — an empty value reads as not sent. */
const formValue = (fields, name) => {
  const v = fields[name];
  return v === undefined || v === "" ? null : v;
};

// ── The routes ─────────────────────────────────────────────────────────────

export function router() {
  const app = new Hono();
  // ── Project CRUD ──

  app.get("/v1/projects", input({ querystring: T.Object({ project_type: opt(nullable(ProjectType), null) }) }), (c) => {
    const h = session.getDb();
    const projectType = c.req.valid("query").project_type;
    const rows =
      projectType !== null
        ? h.all(`select * from ${Project} where project_type = ? order by created_at desc`, [projectType], Project)
        : h.all(`select * from ${Project} order by created_at desc`, [], Project);
    // One GROUP BY instead of a COUNT query per project (N+1 — the list endpoint is on every
    // view's load path).
    const counts = new Map(h.all(`select project_id as pid, count(id) as n from ${Scene} group by project_id`).map((r) => [r.pid, r.n]));
    return c.json(construct(ProjectList, { projects: rows.map((row) => projectOut(row, counts.get(row.id) ?? 0)) }));
  });

  app.post("/v1/projects", input({ body: CreateProjectRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const body = c.req.valid("json");
    const metadata = { ...body.metadata };
    if (body.language) metadata.language = strip(body.language);
    const p = insertRow(h, Project, {
      name: body.name,
      description: body.description,
      project_type: body.project_type,
      metadata_json: pyJson(metadata),
      default_lexicon_id: body.default_lexicon_id,
      mastering_preset: body.mastering_preset || mastering.kindMaster(body.project_type),
    });
    return c.json(projectOut(p), 201);
  });

  app.get("/v1/projects/:project_id", (c) => {
    const h = session.getDb();
    const id = c.req.param("project_id");
    const p = projectById(h, id);
    if (!p) throw notFound(`project ${id}`);
    return c.json(projectOut(p, h.count(Scene, { project_id: p.id })));
  });

  app.patch("/v1/projects/:project_id", input({ body: UpdateProjectRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const id = c.req.param("project_id");
    const body = c.req.valid("json");
    const sent = new Set(Object.keys(sentBody(c) || {}));
    const p = projectById(h, id);
    if (!p) throw notFound(`project ${id}`);
    const changes = {};
    if (body.name !== null) changes.name = body.name;
    if (body.description !== null) changes.description = body.description;
    if (body.metadata !== null) changes.metadata_json = pyJson(body.metadata);
    // Overview's "Pronunciation lexicon". Left out = unchanged; sent as null = "None" (it could
    // not be cleared before 2026-09-30). An id that names no lexicon is refused here, not left
    // to the foreign key.
    if (sent.has("default_lexicon_id")) {
      const lexiconId = body.default_lexicon_id || null;
      if (lexiconId && h.get(DbLexicon, lexiconId) === null) throw notFound(`lexicon ${lexiconId}`);
      changes.default_lexicon_id = lexiconId;
    }
    if (body.mastering_preset !== null) changes.mastering_preset = body.mastering_preset;
    if (sent.has("language")) {
      let metadata;
      try {
        metadata = jsonLoads(changes.metadata_json ?? (p.metadata_json || "{}"));
      } catch {
        metadata = {};
      }
      const language = strip(body.language || "");
      if (!isDict(metadata)) throw new TypeError("'list' object does not support item assignment");
      if (language) metadata.language = language;
      else delete metadata.language;
      changes.metadata_json = pyJson(metadata);
    }
    h.tx(() => _dirtyUpdate(h, Project, p, changes));
    return c.json(projectOut(projectById(h, id)));
  });

  app.delete("/v1/projects/:project_id", (c) => {
    const h = session.getDb();
    const id = c.req.param("project_id");
    const p = projectById(h, id);
    if (!p) throw notFound(`project ${id}`);
    h.delete(Project, { id });
    lineTakes.sweepOrphanTakes(h); // its takes' audio goes with them (Slice 4)
    return c.json({ deleted: true });
  });

  // ── Scene CRUD ──

  app.get("/v1/projects/:project_id/scenes", (c) => {
    const h = session.getDb();
    const id = c.req.param("project_id");
    if (!projectById(h, id)) throw notFound(`project ${id}`);
    const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [id], Scene);
    return c.json(scenes.map((s) => sceneOut(s, h.count(Block, { scene_id: s.id }))));
  });

  app.post("/v1/projects/:project_id/scenes", input({ body: CreateSceneRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const id = c.req.param("project_id");
    if (!projectById(h, id)) throw notFound(`project ${id}`);
    const body = c.req.valid("json");
    const s = insertRow(h, Scene, {
      project_id: id,
      position: body.position,
      title: body.title,
      description: body.description,
      metadata_json: pyJson(body.metadata),
    });
    return c.json(sceneOut(s), 201);
  });

  /** Rename / reorder a chapter (Chapters management, 2026-06-12). Position moves swap with the
   * displaced neighbor so ordering stays dense. */
  app.patch("/v1/scenes/:scene_id", input({ body: UpdateSceneRequest }), (c) => {
    const h = session.getDb();
    const id = c.req.param("scene_id");
    const sc = sceneById(h, id);
    if (!sc) throw notFound(`scene ${id}`);
    const body = c.req.valid("json");
    h.tx(() => {
      const changes = {};
      if (body.title !== null) changes.title = body.title;
      if (body.position !== null && body.position !== sc.position) {
        const other = h.one(`select * from ${Scene} where project_id = ? and position = ? limit 1`, [sc.project_id, body.position], Scene);
        if (other) _dirtyUpdate(h, Scene, other, { position: sc.position });
        changes.position = body.position;
      }
      _dirtyUpdate(h, Scene, sc, changes);
    });
    return c.json(sceneOut(sceneById(h, id)));
  });

  /** Delete a chapter and its blocks/takes (FK cascade) — and the takes' audio (Studio Slice 4).
   * Script's ⋯ → Delete. */
  app.delete("/v1/scenes/:scene_id", (c) => {
    const h = session.getDb();
    const id = c.req.param("scene_id");
    const sc = sceneById(h, id);
    if (!sc) throw notFound(`scene ${id}`);
    const [projectId, position] = [sc.project_id, sc.position];
    h.tx(() => {
      h.delete(Scene, { id });
      // The chapters after it move up, so the order stays dense and ⋯ Move (which swaps with the
      // chapter at the target position) keeps working.
      for (const later of h.all(`select * from ${Scene} where project_id = ? and position > ? order by position`, [projectId, position], Scene)) {
        h.update(Scene, { position: later.position - 1 }, { id: later.id });
      }
    });
    lineTakes.sweepOrphanTakes(h);
    return c.json({ deleted: true, scene_id: id });
  });

  app.get("/v1/scenes/:scene_id/blocks", (c) => {
    const h = session.getDb();
    const id = c.req.param("scene_id");
    if (!sceneById(h, id)) throw notFound(`scene ${id}`);
    return c.json(blocksOf(h, id).map((b) => blockOut(b)));
  });

  app.post("/v1/scenes/:scene_id/blocks", input({ body: CreateBlockRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const id = c.req.param("scene_id");
    if (!sceneById(h, id)) throw notFound(`scene ${id}`);
    const body = c.req.valid("json");
    const b = h.tx(() => {
      const row = insertRow(h, Block, {
        scene_id: id,
        position: body.position,
        text: body.text,
        speaker_id: body.speaker_id,
        direction: body.direction,
        metadata_json: pyJson(body.metadata),
        extraction_confidence: body.extraction_confidence,
        source: body.source,
      });
      _dropSceneSourceText(h, id);
      return row;
    });
    return c.json(blockOut(b), 201);
  });

  app.patch("/v1/blocks/:block_id", input({ body: UpdateBlockRequest, pyFloats: true }), (c) => {
    const h = session.getDb();
    const id = c.req.param("block_id");
    const body = c.req.valid("json");
    const sent = new Set(Object.keys(sentBody(c) || {}));
    const b = blockById(h, id);
    if (!b) throw notFound(`block ${id}`);

    // Phase 5: capture speaker corrections — when speaker_id changes from the existing value to
    // a new one AND the existing value wasn't null (manual reassignment, not "first
    // assignment"), write a SpeakerCorrection row for the future analyze pipeline to learn from.
    const speakerChanged = body.speaker_id !== null && b.speaker_id !== null && body.speaker_id !== b.speaker_id && !body.no_fix;

    // Every change is worked out first (a refusal below writes nothing), then written at once.
    const cur = { ...b };
    let dropSourceText = false;
    if (body.position !== null) cur.position = body.position;
    if (body.text !== null) {
      if (body.text !== cur.text) dropSourceText = true;
      cur.text = body.text;
    }
    if (body.speaker_id !== null || sent.has("speaker_id")) cur.speaker_id = body.speaker_id;
    if (body.direction !== null) cur.direction = body.direction;
    if (body.metadata !== null) cur.metadata_json = pyJson(body.metadata);
    if (body.line_override !== null) {
      try {
        cur.metadata_json = pyJson(lineTakes.mergeOverride(lineTakes.blockMeta(cur), body.line_override));
      } catch (e) {
        if (e instanceof ValueError) throw badRequest(errText(e));
        throw e;
      }
    }
    if (body.extraction_confidence !== null || sent.has("extraction_confidence")) cur.extraction_confidence = body.extraction_confidence;
    if (body.source !== null || sent.has("source")) {
      cur.source = body.source;
      // Setting or confirming a line clears Script's "changed by the last Analyze" mark —
      // unless the caller is restoring metadata (Undo).
      if (body.source === "corrected" && body.metadata === null) {
        const meta = jsonLoads(cur.metadata_json || "{}");
        if (isDict(meta) && Object.hasOwn(meta, "prev_speaker_id")) {
          delete meta.prev_speaker_id;
          cur.metadata_json = pyJson(meta);
        }
      }
    }

    let fixId = null;
    h.tx(() => {
      if (dropSourceText) _dropSceneSourceText(h, b.scene_id);
      const changes = {};
      for (const k of ["position", "text", "speaker_id", "direction", "metadata_json", "extraction_confidence", "source"]) changes[k] = cur[k];
      _dirtyUpdate(h, Block, b, changes);
      if (speakerChanged) {
        // Look up the parent project via the scene, then write through THE one correction
        // writer (extraction_api.recordCorrection — the Lab's reassign shares it).
        const scene = sceneById(h, b.scene_id);
        if (scene) fixId = extraction.recordCorrection(h, scene.project_id, b.text, body.speaker_id);
      }
    });
    return c.json(blockOut(blockById(h, id), fixId));
  });

  app.delete("/v1/blocks/:block_id", (c) => {
    const h = session.getDb();
    const id = c.req.param("block_id");
    const b = blockById(h, id);
    if (!b) throw notFound(`block ${id}`);
    h.tx(() => {
      _dropSceneSourceText(h, b.scene_id);
      h.delete(Block, { id });
    });
    lineTakes.sweepOrphanTakes(h); // its takes' audio goes with them (Slice 4)
    return c.json({ deleted: true });
  });

  /**
   * One line becomes two, cut at `at`. Both keep the speaker and how it was decided. The first
   * keeps the line's id, and with it its rendered takes — its words changed, so they are out of
   * date and it re-renders. The second is new, with no takes, and does not carry the import's
   * line id (`source_ref`): one line of the source can only be one line here.
   */
  app.post("/v1/blocks/:block_id/split", input({ body: SplitBlockRequest }), (c) => {
    const h = session.getDb();
    const id = c.req.param("block_id");
    const body = c.req.valid("json");
    const b = blockById(h, id);
    if (!b) throw notFound(`block ${id}`);
    const text = body.text === null ? b.text : body.text;
    const [head, tail] = pySplitAt(text, body.at);
    const first = rstrip(head);
    const second = lstrip(tail);
    if (!first || !second) throw badRequest("Put the cursor inside the words — both new lines need some.");

    const ordered = blocksOf(h, b.scene_id);
    const meta = jsonLoads(b.metadata_json || "{}");
    if (!isDict(meta)) throw new TypeError(`'${Array.isArray(meta) ? "list" : "int"}' object has no attribute 'pop'`);
    delete meta.source_ref;
    const newId = randomUUID();
    h.tx(() => {
      _dirtyUpdate(h, Block, b, { text: first });
      const at = ordered.findIndex((blk) => blk.id === b.id);
      const neu = {
        id: newId,
        scene_id: b.scene_id,
        position: b.position + 1,
        text: second,
        speaker_id: b.speaker_id,
        direction: b.direction,
        metadata_json: Object.keys(meta).length ? pyJson(meta) : null,
        extraction_confidence: b.extraction_confidence,
        source: b.source,
      };
      const order = [...ordered.slice(0, at + 1), neu, ...ordered.slice(at + 1)];
      // `_renumber` with the new line in its place: it is written at its position.
      neu.position = order.indexOf(neu);
      h.insert(Block, neu);
      _renumber(h, order, new Set([neu]));
      _dropSceneSourceText(h, b.scene_id);
    });
    return c.json(construct(BlockListResponse, { blocks: [blockOut(blockById(h, id)), blockOut(blockById(h, newId))] }));
  });

  /**
   * Lines that sit next to each other become one: their words joined with a space, on the first
   * line — its id, speaker, takes and everything it carries. The others are deleted, and their
   * rendered takes with them (Take.block_id is ON DELETE CASCADE); Script asks before it sends
   * this when there are any.
   */
  app.post("/v1/scenes/:scene_id/blocks/merge", input({ body: MergeBlocksRequest }), (c) => {
    const h = session.getDb();
    const sceneId = c.req.param("scene_id");
    if (!sceneById(h, sceneId)) throw notFound(`scene ${sceneId}`);
    const ids = c.req.valid("json").ids;
    const ordered = blocksOf(h, sceneId);
    const index = new Map(ordered.map((blk, i) => [blk.id, i]));
    if (new Set(ids).size !== ids.length || ids.some((i) => !index.has(i))) {
      throw badRequest("Merge takes two or more different lines of this chapter.");
    }
    const picked = ids.map((i) => index.get(i)).sort((a, b) => a - b);
    if (picked.some((p, k) => p !== picked[0] + k)) throw badRequest("Only lines that sit next to each other can be merged.");

    const [keep, ...gone] = picked.map((i) => ordered[i]);
    const goneIds = new Set(gone.map((g) => g.id));
    h.tx(() => {
      const text = [keep, ...gone]
        .map((blk) => strip(blk.text))
        .filter((t) => t)
        .join(" ");
      _dirtyUpdate(h, Block, keep, { text });
      for (const blk of gone) h.delete(Block, { id: blk.id });
      _renumber(
        h,
        ordered.filter((blk) => !goneIds.has(blk.id)),
      );
      _dropSceneSourceText(h, sceneId);
    });
    lineTakes.sweepOrphanTakes(h); // the merged-away lines' takes' audio (Slice 4)
    return c.json(blockOut(blockById(h, keep.id)));
  });

  /** The chapter's lines as one text, a paragraph each (a line's own blank lines close up, so it
   * stays one paragraph). */
  app.get("/v1/scenes/:scene_id/text", (c) => {
    const h = session.getDb();
    const id = c.req.param("scene_id");
    if (!sceneById(h, id)) throw notFound(`scene ${id}`);
    const paras = blocksOf(h, id)
      .filter((b) => strip(b.text || ""))
      .map((b) => strip(b.text).replace(PARAGRAPH_BREAKS, "\n"));
    return c.json(construct(ChapterTextResponse, { text: paras.join("\n\n") }));
  });

  app.put("/v1/scenes/:scene_id/text", input({ body: EditChapterTextRequest }), (c) => {
    const h = session.getDb();
    const sceneId = c.req.param("scene_id");
    const body = c.req.valid("json");
    if (!sceneById(h, sceneId)) throw notFound(`scene ${sceneId}`);
    const paras = _textParagraphs(body.text);
    if (!paras.length) throw badRequest("A chapter needs some text. To remove it, use Delete.");
    const blocks = blocksOf(h, sceneId);
    const worded = blocks.filter((b) => strip(b.text || ""));
    // A line with no words isn't in the text; it stays after the line before it.
    const after = new Map();
    let prev = null;
    for (const b of blocks) {
      if (strip(b.text || "")) prev = b.id;
      else {
        if (!after.has(prev)) after.set(prev, []);
        after.get(prev).push(b);
      }
    }

    const [steps, counts] = textEditPlan(
      worded.map((b) => b.text),
      paras,
    );
    const gone = steps.filter(([kind]) => kind === "drop").map(([, i]) => worded[i]);
    let lost = 0;
    if (gone.length) {
      lost = h.value(`select count(distinct block_id) from ${Take} where block_id in (${marks(gone.length)})`, gone.map((b) => b.id));
    }
    const out = construct(EditChapterTextResponse, { ...counts, takes_lost: lost });
    if (body.dry_run || !(counts.changed || counts.added || counts.removed)) return c.json(out);

    h.tx(() => {
      const ordered = [...(after.get(null) ?? [])];
      const inserts = [];
      for (const [kind, i] of steps) {
        if (kind === "new") {
          const nb = { id: randomUUID(), scene_id: sceneId, position: 0, text: paras[i], source: "manual" };
          inserts.push(nb);
          ordered.push(nb);
          continue;
        }
        if (kind === "keep") ordered.push(worded[i]);
        ordered.push(...(after.get(worded[i].id) ?? []));
      }
      // One flush: the new lines' INSERTs, then the gone lines' DELETEs (SQLAlchemy's order).
      const fresh = new Set(inserts);
      for (const nb of inserts) {
        nb.position = ordered.indexOf(nb);
        h.insert(Block, nb);
      }
      for (const b of gone) h.delete(Block, { id: b.id });
      _renumber(h, ordered, fresh);
      _dropSceneSourceText(h, sceneId);
    });
    if (gone.length) lineTakes.sweepOrphanTakes(h); // the gone lines' takes' audio
    return c.json(out);
  });

  // ── The import pipeline ──

  /** List the import adapters the UI's format picker can choose from. */
  app.get("/v1/projects/import/adapters", (c) => c.json(construct(AdapterListResponse, { adapters: listAdapters() })));

  /**
   * Run an import adapter.
   *
   * Multipart shape (preferred — what ImportModal sends): `source` = adapter id, `file` = the
   * source file, `dry_run` = "true" to parse + return the preview without committing. The
   * query-string shape (JustWrite's client): POST /v1/projects/import?source=justwrite[&dry_run=
   * true] with the raw body as the payload (a book zip's bytes, a JSON document). The route reads
   * its own body (readImportRequest): any body as bytes, multipart as a form.
   */
  app.post("/v1/projects/import", captures._formSpool, async (c) => {
    const h = session.getDb();
    const { fields, file, raw: rawBody } = await readImportRequest(c);
    const errors = [];
    const dryRunQ = boolParam(queryValue(c, "dry_run"), ["query", "dry_run"], errors);
    const dryRun = boolParam(formValue(fields, "dry_run"), ["body", "dry_run"], errors);
    if (errors.length) throw new RequestValidationError(errors);
    const source = formValue(fields, "source");
    const sourceQ = queryValue(c, "source") ?? null;
    const projectId = formValue(fields, "project_id");
    const projectIdQ = queryValue(c, "project_id") ?? null;
    const includeScenes = formValue(fields, "include_scenes");
    // Chapter-split strategy (book_prose: auto | h1 | h1_h2 | none) — the import-review "Split
    // chapters on" selector re-runs the dry run with this; adapters that don't take it ignore it.
    const splitOn = formValue(fields, "split_on");

    const effectiveSource = strip(source || sourceQ || "");
    if (!effectiveSource) throw badRequest("import: missing 'source' — pass as multipart form field or ?source= query param");
    const effectiveDryRun = Boolean(dryRun !== null ? dryRun : dryRunQ);

    let filename = null;
    let raw;
    if (file !== null) {
      raw = readFileSync(file.path);
      filename = file.filename;
    } else {
      raw = rawBody;
      if (!raw.length) throw badRequest("import: no file uploaded and no raw request body");
    }

    const standard = await runAdapter(effectiveSource, raw, { filename, split_on: splitOn });

    // New project's dialog names the project, picks its kind and its language, and they win over
    // what the file says — one request creates and imports (the user's word, 2026-10-09: the
    // dialog takes an optional file). A re-import into a project (`project_id`) ignores them.
    if (!strip(projectId || projectIdQ || "")) {
      const nameOver = strip(formValue(fields, "name") || "");
      const kindOver = strip(formValue(fields, "project_type") || "");
      const languageOver = strip(formValue(fields, "language") || "");
      if (kindOver && !Object.hasOwn(_KIND_TO_PROJECT_TYPE, kindOver)) throw badRequest(`import: unknown project_type '${kindOver}'`);
      if (nameOver) standard.project.name = nameOver;
      if (kindOver) standard.project.kind = kindOver;
      if (languageOver) standard.project.language = languageOver;
    }

    // Per-chapter include list (import-page checkboxes): comma-separated scene indices from
    // the dry-run preview. Unlisted scenes don't materialize. Dry runs ignore it — the preview
    // always shows all.
    if (includeScenes !== null && !effectiveDryRun) {
      let keep;
      try {
        keep = new Set(
          includeScenes
            .split(",")
            .filter((i) => strip(i) !== "")
            .map((i) => pyIntOfStr(i)),
        );
      } catch (e) {
        if (e instanceof ValueError) throw badRequest("import: include_scenes must be comma-separated indices");
        throw e;
      }
      standard.scenes = standard.scenes.filter((_sc, i) => keep.has(i));
      if (!standard.scenes.length) throw badRequest("import: include_scenes excluded every chapter");
    }

    // Update mode — re-import INTO an existing project, matching by stable line ids (game
    // workflow: writers' next CSV revision).
    const effectiveProjectId = strip(projectId || projectIdQ || "") || null;
    if (effectiveProjectId && !effectiveDryRun) {
      const project = projectById(h, effectiveProjectId);
      if (project === null) throw notFound(`project ${effectiveProjectId}`);
      const summary = h.tx(() => _updateProjectFromStandard(standard, project, h));
      lineTakes.sweepOrphanTakes(h); // removed lines' takes' audio (Slice 4)
      standard.project.id = project.id;
      standard.warnings.push(
        `updated in place: ${Object.entries(summary)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
      );
      return c.json(construct(ImportRunResponse, { committed: true, project_id: project.id, standard, warnings: standard.warnings }));
    }

    if (effectiveDryRun) return c.json(construct(ImportRunResponse, { committed: false, project_id: null, standard, warnings: standard.warnings }));

    const project = h.tx(() => {
      const [p] = _materializeStandard(standard, h);
      _materializeLexicon(standard, p, h);
      return p;
    });
    standard.project.id = project.id;
    return c.json(construct(ImportRunResponse, { committed: true, project_id: project.id, standard, warnings: standard.warnings }));
  });

  // ── Audiobook export + QC ──

  /** Render every chapter (cache-served when unchanged) and run the ACX technical checks — RMS
   * window + peak ceiling — per chapter. */
  app.get("/v1/projects/:project_id/qc", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    if (projectById(h, projectId) === null) throw notFound(`project ${projectId}`);
    const st = getState();
    // Whole-book warm, engine-grouped (§7 of the 2026-08-08 plan); the assembly below re-reads
    // the cache and stays the error surface. QC mode: warm the renderable subset of every
    // scene, skipping refusals, exactly like the measuring assembly below.
    await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId, { skipUnrenderable: true }), {
      owner: synthScheduler.workOwner("the ACX check"),
      signal: clientGone(c),
    });

    // QC MEASURES — it does not ship. The render refusal on unplaced lines (Script-tab restore,
    // decision 5) is right for the M4B export and wrong here: refusing the whole book because
    // chapter 40 has no speakers yet would leave you unable to check chapters 1-39. Measure what
    // renders; the chapters that can't are reported as failing with the reason, never passing.
    const measure = (state, sceneId) => renderChapterApi.renderSceneToWav(state, sceneId, { strict: false });
    /** The refusal a real render would raise, as a note instead. Same door, so QC can never
     * disagree with what export will do. */
    const notReady = async (sceneId) => {
      try {
        await renderChapterApi._resolveSceneToLines(sceneId, st, { strict: true });
        return null;
      } catch (e) {
        if (e instanceof ApiError) return typeof e.detail === "string" ? e.detail : String(e.detail);
        throw e;
      }
    };

    const chapters = await exportAudiobook.assembleProject(st, projectId, { renderSceneFn: measure, skipUnrenderable: true });
    const scenes = exportAudiobook.projectScenes(projectId);
    if (!scenes.length) throw badRequest("project has no scenes to check");
    const measured = new Map((await exportAudiobook.qcReport(chapters)).map((ch) => [ch.sceneId, ch]));
    const out = [];
    for (const scene of scenes) {
      const note = await notReady(scene.id);
      const ch = measured.get(scene.id);
      if (ch === undefined) {
        // Nothing renderable in it at all — report the reason instead of killing the whole run,
        // which is what a book mid-production looks like for most of its life.
        out.push({
          scene_id: scene.id,
          title: scene.title || "",
          duration_s: 0.0,
          rms_dbfs: 0.0,
          peak_dbfs: 0.0,
          rms_ok: false,
          peak_ok: false,
          ok: false,
          note: note || "Nothing in this chapter could be rendered.",
        });
        continue;
      }
      out.push({
        scene_id: ch.sceneId,
        title: ch.title,
        duration_s: ch.durationS,
        rms_dbfs: ch.rmsDbfs,
        peak_dbfs: ch.peakDbfs,
        rms_ok: ch.rmsOk,
        peak_ok: ch.peakOk,
        // A chapter measured without the lines it's missing has not passed anything — never
        // report that as ok.
        ok: ch.ok && note === null,
        note,
      });
    }
    // Say what was measured. `measure` masters when it can; when the target exists but ffmpeg
    // does not, these are raw-render numbers and the ACX verdict is not the finished book's.
    const target = scenes.length ? renderChapterApi._sceneMasterTarget(scenes[0].id, null)[0] : null;
    const mastered = Boolean(target) && mastering.haveFfmpeg();
    let qcNote = null;
    if (target && !mastered) {
      qcNote =
        `Measured without the ${target} master — ffmpeg is not installed, so these are raw-render numbers, ` +
        "not what the finished book would measure. Install ffmpeg and re-run.";
    }
    return c.json(
      construct(ProjectQCResponse, {
        project_id: projectId,
        chapters: out,
        all_ok: out.every((ch) => ch.ok),
        limits: {
          rms_min_db: exportAudiobook.ACX_RMS_MIN_DB,
          rms_max_db: exportAudiobook.ACX_RMS_MAX_DB,
          peak_max_db: exportAudiobook.ACX_PEAK_MAX_DB,
        },
        master_preset: target,
        mastered,
        note: qcNote,
      }),
    );
  });

  /** Assemble all chapters into one .m4b with chapter markers. */
  app.post("/v1/projects/:project_id/export_m4b", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    const project = projectById(h, projectId);
    if (project === null) throw notFound(`project ${projectId}`);
    if (!exportAudiobook.haveFfmpeg()) {
      throw new HttpError(503, "ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server.");
    }
    const st = getState();
    // Whole-book warm, engine-grouped (§7 of the 2026-08-08 plan); the assembly below re-reads
    // the cache and stays the error surface.
    await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), {
      owner: synthScheduler.workOwner("the M4B export"),
      signal: clientGone(c),
    });
    const chapters = await exportAudiobook.assembleProject(st, projectId);
    if (!chapters.length) throw badRequest("project has no scenes to export");
    const m4b = await exportAudiobook.muxM4b(chapters, project.name, m4bAuthor(project));
    const safe = project.name.replace(IMPORT_SAFE, "_") || "book";
    return c.body(m4b, 200, { "content-type": "audio/mp4", "content-disposition": `attachment; filename="${safe}.m4b"` });
  });

  /** Game export — zip of per-line WAVs named by stable line id, grouped by scene, plus a
   * diffable manifest.json (mock #game/6). */
  app.post("/v1/projects/:project_id/export_voicelines", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    const project = projectById(h, projectId);
    if (project === null) throw notFound(`project ${projectId}`);
    const st = getState();
    // Whole-project warm, engine-grouped (§7 of the 2026-08-08 plan); the export below re-reads
    // the cache and stays the error surface.
    await synthScheduler.warmSpecs(await exportVoicelines.collectBlockSpecs(st, projectId), {
      owner: synthScheduler.workOwner("the voice-line export"),
      signal: clientGone(c),
    });
    const data = await exportVoicelines.exportVoicelines(st, projectId);
    const safe = project.name.replace(IMPORT_SAFE, "_") || "voicelines";
    return c.body(data, 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${safe}_VO.zip"` });
  });

  /**
   * Flat per-line view for the game Lines grid (mock #game/3). The state is Render's — the same
   * function (line_takes.sceneLines, G9 2026-10-04): stale = something the ★ take was made from
   * changed since.
   */
  app.get("/v1/projects/:project_id/lines", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    if (projectById(h, projectId) === null) throw notFound(`project ${projectId}`);
    const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
    const st = getState();
    const out = [];
    const counts = { none: 0, rendered: 0, stale: 0 };
    for (const scene of scenes) {
      const rows = blocksOf(h, scene.id);
      const states = new Map((await lineTakes.sceneLines(h, st, scene.id)).lines.map((line) => [line.block_id, line.state]));
      for (const b of rows) {
        const state = states.get(b.id) ?? null;
        const status = state === "rendered" || state === "stale" ? state : "none";
        counts[status] += 1;
        let lineId = null;
        if (b.metadata_json) {
          let meta;
          try {
            meta = jsonLoads(b.metadata_json);
          } catch {
            meta = undefined;
          }
          if (meta !== undefined) lineId = dget(meta, "source_ref");
        }
        out.push({
          block_id: b.id,
          line_id: lineId,
          scene_id: scene.id,
          scene_title: scene.title,
          speaker: b.speaker_id ? speakerName(h, b.speaker_id) : null,
          text: b.text,
          take_status: status,
          state,
        });
      }
    }
    return c.json(construct(ProjectLinesResponse, { project_id: projectId, lines: out, counts }));
  });

  /** Seed a demo project for the kind — runs through the same materializer as a real import
   * (CONCEPTS §13.7), so speakers and line ids behave exactly like production data. */
  app.post("/v1/projects/demo", input({ body: CreateDemoRequest }), async (c) => {
    const h = session.getDb();
    const kind = c.req.valid("json").kind;
    let standard;
    try {
      standard = await demoProjects.demoStandard(kind);
    } catch (e) {
      if (e instanceof KeyError) throw badRequest(`unknown demo kind ${strRepr(kind)} — one of: audiobook, game_voicelines, podcast`);
      throw e;
    }
    const project = h.tx(() => _materializeStandard(standard, h)[0]);
    standard.project.id = project.id;
    return c.json(construct(ImportRunResponse, { committed: true, project_id: project.id, standard, warnings: [] }));
  });

  /** LLM show notes from the project's segments (CONCEPTS §14.4). 501 when no provider is
   * configured, same contract as analyze. */
  app.post("/v1/projects/:project_id/show-notes", async (c) => {
    const h = session.getDb();
    const projectId = c.req.param("project_id");
    if (projectById(h, projectId) === null) throw notFound(`project ${projectId}`);
    const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
    const parts = [];
    for (const scene of scenes) {
      parts.push(`## ${scene.title || "Segment"}`);
      for (const b of blocksOf(h, scene.id)) {
        const who = b.speaker_id ? speakerName(h, b.speaker_id) : null;
        parts.push(`${who || "NARRATION"}: ${b.text}`);
      }
    }
    const script = parts.join("\n");
    if (!strip(script)) throw badRequest("project has no segments to summarize");

    // The template row owns the wording (user half = {{script}}); the cap on the script sample
    // stays code-side (a computed VALUE).
    let resp;
    try {
      resp = await run.runFeature("show_notes", { script: cpSlice(script, 0, 24000) });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      throw e;
    }
    return c.json(
      construct(ShowNotesResponse, {
        project_id: projectId,
        markdown: strip(resp.text),
        usage: { prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model },
      }),
    );
  });
  return app;
}
