// SPDX-License-Identifier: MIT
// Projects, scenes, blocks and the multi-adapter import (the port of
// justvoice/api/projects_api.py).
//
// PARTIAL — the extraction/imports/MCP wave (wave D) ported only the import materializer
// (`_materializeStandard`, `_materializeLexicon`, `_KIND_TO_PROJECT_TYPE`): what turns an
// adapter's StandardImport into rows, which the import parity check writes through and the
// demo projects seed through. The API wave fills in the rest of this file (the routes, the
// update-in-place re-import `_updateProjectFromStandard`, the chapter-text edit plan …) under
// the same names.
//
// Sources are pluggable (`imports/`): the adapter registry produces a normalized
// StandardImport that the import endpoint materializes into rows. JustWrite is one adapter
// among several (book_prose, podcast_markdown, csv_lines, srt, audacity_labels,
// justvoice_standard).

import { randomUUID } from "node:crypto";
import { casefold, strip, truthy } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Block, Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry, Project, Scene } from "../database/models.js";
import { kindMaster } from "../mastering.js";
import { isDict } from "../py_compat.js";
import { adoptBookNarrator, ensureSpeaker } from "./_speaker_helpers.js";

export const _KIND_TO_PROJECT_TYPE = {
  audiobook: "audiobook",
  game_voicelines: "game_voicelines",
  podcast: "podcast",
  custom: "custom",
};

/** Insert one row and read it back (the ORM's flush → the row with its id and defaults). */
function insertRow(h, table, row) {
  h.insert(table, row);
  return h.one(`select * from ${table} where rowid = last_insert_rowid()`, [], table);
}

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
    mastering_preset: kindMaster(projectType),
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
