// SPDX-License-Identifier: MIT
// The people in a book — speakers (decided 2026-09-29) (the port of
// justvoice/api/_speaker_helpers.py).
//
// A speaker is a person in one book: a name, the other names the text uses and who they are.
// Cast gives each speaker a persona — the finished voice, from the library — and one persona
// can play many speakers. A line's voice is line → speaker → persona (`personaForBlock`).
//
// This module owns the rules every door that makes or renames a speaker shares — Discover's
// Add, the imports, + Add Narrator and Cast's ＋ Add — so none of them can drift:
//
// * names are unique within a book (case and extra spaces don't count), except that an import
//   keeps the book's characters exactly as the book has them;
// * a new speaker whose name exactly matches one persona in the library arrives already cast
//   with it ("Every new speaker");
// * a line's voice is line → speaker → persona (`personaForBlock`).
//
// Ported in parts: the render wave (wave C) `personaForBlock`; the import wave (wave D) what
// the import materializer calls (sameName … ensureSpeaker, adoptBookNarrator); API agent 2
// speakerLineCounts; API agent 3 narratorSpeakerId and moveNarration — the whole file now.
// `h` is the database handle wherever Python took a session. Python's `db.flush()` calls
// (speakers added earlier in the same request count too) need nothing here: every insert is
// written at once.

import { casefold, splitWs, strip } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Block, Persona, Scene, Speaker } from "../database/models.js";
import { conflict } from "../errors.js";
import { pyStrOf } from "../py_compat.js";

/** The form two names are compared in — case and extra spaces don't count. */
export function sameName(name) {
  return casefold(splitWs(name || "").join(" "));
}

/** Trimmed, de-duplicated (case-blind), never the speaker's own name. */
export function cleanAliases(aliases, name = "") {
  const out = [];
  const seen = new Set([sameName(name)]);
  for (const raw of aliases || []) {
    const a = splitWs(pyStrOf(raw)).join(" ");
    if (a && !seen.has(sameName(a))) {
      seen.add(sameName(a));
      out.push(a);
    }
  }
  return out;
}

/** A speaker row's "Also called" names. */
export function speakerAliases(s) {
  const raw = s?.aliases;
  let out;
  try {
    out = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  return Array.isArray(out) ? out.map((a) => pyStrOf(a)).filter((a) => a.trim()) : [];
}

/** This book's speaker already called `name` (their name as stored), or null. `besides` is the
 * speaker being renamed. */
export function speakerNamed(h, projectId, name, { besides = null } = {}) {
  const want = sameName(name);
  for (const { id, name: stored } of h.all(`select id, name from ${Speaker} where project_id = ?`, [projectId])) {
    if (id !== besides && sameName(stored) === want) return stored;
  }
  return null;
}

export function refuseSameName(h, projectId, name, { besides = null } = {}) {
  const taken = speakerNamed(h, projectId, name, { besides });
  if (taken !== null) {
    throw conflict(`This book already has a speaker called "${taken}". Names are unique within a book — rename one of them first.`);
  }
}

/** The one persona whose name is exactly `name` (case and extra spaces aside), or null — also
 * null when two personas share it: ambiguity is refused, never guessed. */
export function personaNamed(h, name) {
  const want = sameName(name);
  if (!want) return null;
  const hits = h
    .all(`select id, name from ${Persona}`)
    .filter((r) => sameName(r.name) === want)
    .map((r) => r.id);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Create-or-reuse a speaker in this book → `[speaker, created]`.
 *
 * A re-import reuses the speaker its (imported_from, imported_id) made, so a book's characters
 * are never duplicated. `unique` refuses a name the book already has — every door but the
 * imports passes it. A new speaker is cast with the persona of exactly its name, when there is
 * one.
 */
export function ensureSpeaker(
  h,
  projectId,
  { name, description = null, aliases = null, importedFrom = null, importedId = null, unique = false, pronouns = null },
) {
  if (importedFrom && importedId) {
    const existing = h.one(
      `select * from ${Speaker} where project_id = ? and imported_from = ? and imported_id = ? limit 1`,
      [projectId, importedFrom, importedId],
      Speaker,
    );
    if (existing !== null) return [existing, false];
  }
  const clean = splitWs(name || "").join(" ");
  if (unique) refuseSameName(h, projectId, clean);
  const kept = cleanAliases(aliases, clean);
  const row = {
    project_id: projectId,
    name: clean,
    description: strip(description || "") || null,
    aliases: kept.length ? pyJson(kept) : null,
    persona_id: personaNamed(h, clean),
    pronouns: pronouns || null,
    imported_from: importedFrom,
    imported_id: importedId,
  };
  h.insert(Speaker, row);
  const created = h.one(`select * from ${Speaker} where rowid = last_insert_rowid()`, [], Speaker);
  return [created, true];
}

/** {speaker_id: lines with text} across the book (a Map) — Cast's "61 lines", and what a
 * removal says it will leave with no speaker. (API agent 2, for personas_api's "Used by".) */
export function speakerLineCounts(h, projectId) {
  const rows = h.all(
    `select ${Block}.speaker_id as sid, count(${Block}.id) as n from ${Block} join ${Scene} on ${Scene}.id = ${Block}.scene_id ` +
      `where ${Scene}.project_id = ? and ${Block}.speaker_id is not null and trim(${Block}.text) != '' group by ${Block}.speaker_id`,
    [projectId],
  );
  return new Map(rows.map((r) => [r.sid, r.n]));
}

/**
 * The book's narrator — the speaker holding the "narrator" role. null when the book has none yet
 * (nothing makes one on its own): Analyze then leaves narration with no speaker.
 *
 * The role only, as Studio and Cast read it (2026-09-30, one narrator rule). A speaker merely
 * CALLED Narrator used to count here too, so the server and the app could disagree on who
 * narrates; an imported "Narrator" character gets the role at import (`adoptBookNarrator`).
 */
export function narratorSpeakerId(h, projectId) {
  const row = h.one(`select id from ${Speaker} where project_id = ? and role_label = 'narrator' limit 1`, [projectId]);
  return row ? row.id : null;
}

/**
 * Narration follows the narrator: every line Analyze decided is narration (`source ==
 * "narration"`) that belonged to the old narrator, or to nobody, moves to the new one. Lines you
 * set yourself (`corrected`) stay. → how many moved. The caller runs it in its transaction.
 */
export function moveNarration(h, projectId, newId, oldId) {
  const sceneIds = h.all(`select id from ${Scene} where project_id = ?`, [projectId]).map((r) => r.id);
  if (!sceneIds.length) return 0;
  const owners = ["speaker_id is null"];
  const params = [];
  if (oldId && oldId !== newId) {
    owners.push("speaker_id = ?");
    params.push(oldId);
  }
  // One bulk UPDATE, as SQLAlchemy's query.update(synchronize_session=False) emitted.
  const r = h.run(
    `update ${Block} set speaker_id = ? where scene_id in (${sceneIds.map(() => "?").join(", ")}) and source = 'narration' and (${owners.join(" or ")})`,
    [newId, ...sceneIds, ...params],
  );
  return r.changes;
}

/** The persona row that voices a line: line → speaker → persona. null when the line has no
 * speaker, or its speaker has no persona yet. */
export function personaForBlock(h, block) {
  if (!block?.speaker_id) return null;
  const speaker = h.get(Speaker, block.speaker_id);
  if (speaker === null || !speaker.persona_id) return null;
  return h.get(Persona, speaker.persona_id);
}

// Project kinds whose import adopts the book's own "Narrator" character — every prose kind
// (custom joined 2026-09-30: an SRT or plain-text import can name one too). A game sheet has
// no prose voice.
export const NARRATOR_KINDS = new Set(["audiobook", "podcast", "custom"]);

/**
 * An imported book that has its own speaker called "Narrator": that speaker is the narrator.
 * Nothing is ever CREATED here (decided 2026-09-29). Runs AFTER the speakers — a manuscript may
 * name its own narrator (`docs/import-and-export.md`).
 */
export function adoptBookNarrator(h, project) {
  if (!NARRATOR_KINDS.has(project.project_type)) return;
  if (h.one(`select id from ${Speaker} where project_id = ? and role_label = 'narrator' limit 1`, [project.id])) return;
  for (const s of h.all(`select id, name from ${Speaker} where project_id = ?`, [project.id])) {
    if (sameName(s.name) === "narrator") {
      h.update(Speaker, { role_label: "narrator" }, { id: s.id });
      return;
    }
  }
}
