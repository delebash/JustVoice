// SPDX-License-Identifier: MIT
// Lexicon storage — SQLite-primary (the port of justvoice/storage/lexicons.py; Phase 1.5
// flip, 2026-06-12).
//
// The file-per-lexicon JSON store kept a DB twin (lexicons / lexicon_entries are FK targets
// — `projects.default_lexicon_id`, `personas.lexicon_id`), so the import path had to
// dual-write or the commit died on the FK. SQLite is now the single source of truth.
// Legacy `$DATA_DIR/lexicons/*.json` files import once at store init (id-based) and rename
// `*.json.migrated` so deletes don't resurrect.
//
// Field mapping (wire ↔ DB rows): `grapheme` ↔ `word`; `phoneme_ipa`/`alias` ↔
// `pronunciation` + `notation` ("ipa"/"phonetic").
//
// Two time forms, as Python answered (RESEARCH §6): `create` returns the zone-aware times it
// made (`…Z`); `get`, `list`, `update` and `appendEntry` read them back from the database
// and return them naive (no `Z`).

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError, strip } from "@delebash/llm-runner/platform/py";
import * as session from "../database/session.js";
import { construct, Lexicon, utcNow } from "../models.js";
import { lexiconsRoot } from "../paths.js";

const log = getLogger("justvoice.storage.lexicons");

function entryToRowFields(e) {
  return {
    word: e.grapheme,
    pronunciation: e.phoneme_ipa || e.alias || "",
    notation: e.phoneme_ipa ? "ipa" : "phonetic",
  };
}

function rowToEntry(row) {
  if (row.notation === "ipa") return { grapheme: row.word, phoneme_ipa: row.pronunciation, alias: null };
  return { grapheme: row.word, phoneme_ipa: null, alias: row.pronunciation };
}

/** Python's `sorted(dir.glob("*.json"))` — the files ending in ".json", by name. */
function jsonFiles(dir) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Method surface: list / get / create / update / appendEntry / delete; rows live in lexicons
 * + lexicon_entries. `handle` is injectable for tests; the default resolves the database
 * module's handle lazily at call time (so a factory reset's re-init is followed).
 */
export class LexiconStore {
  constructor(dataDir, handle = null) {
    this._dir = lexiconsRoot(dataDir);
    mkdirSync(this._dir, { recursive: true });
    this._handle = handle;
    this._importLegacyFiles();
  }

  _open() {
    return this._handle ?? session.cfg.handle;
  }

  // ── legacy file import (one-shot, idempotent) ─────────────────────

  _importLegacyFiles() {
    const files = jsonFiles(this._dir);
    if (!files.length) return;
    const h = this._open();
    if (h === null) {
      log.warning("lexicon store: DB not ready — legacy file import deferred");
      return;
    }
    try {
      for (const f of files) {
        let lex;
        try {
          lex = construct(Lexicon, JSON.parse(readFileSync(f, "utf8")));
        } catch (e) {
          log.warning(`lexicon file ${f} unreadable, left in place: ${e?.message ?? e}`);
          continue;
        }
        h.tx(() => {
          if (!h.one("select id from lexicons where id = ? limit 1", [lex.id])) {
            h.insert("lexicons", {
              id: lex.id,
              name: lex.name,
              description: lex.description,
              scope: lex.scope,
              project_id: lex.project_id,
              persona_id: lex.persona_id,
              created_at: lex.created_at,
              updated_at: lex.updated_at,
            });
            for (const e of lex.entries) h.insert("lexicon_entries", { lexicon_id: lex.id, ...entryToRowFields(e) });
            log.info(`lexicon ${lex.id} imported from legacy file store`);
          }
        });
        renameSync(f, `${f}.migrated`);
      }
    } catch (e) {
      // boot must not die on this
      log.warning(`lexicon legacy-file import failed: ${e?.message ?? e}`);
    }
  }

  // ── row → wire ────────────────────────────────────────────────────

  _hydrate(h, row) {
    const entryRows = h.all(
      "select * from lexicon_entries where lexicon_id = ? order by created_at",
      [row.id],
      "lexicon_entries",
    );
    return construct(Lexicon, {
      id: row.id,
      name: row.name,
      entries: entryRows.map(rowToEntry),
      scope: row.scope || "global",
      description: row.description,
      project_id: row.project_id,
      persona_id: row.persona_id,
      created_at: row.created_at || utcNow(),
      updated_at: row.updated_at || utcNow(),
    });
  }

  // ── public surface ────────────────────────────────────────────────

  list() {
    const h = this._open();
    if (h === null) return [];
    const rows = h.all("select * from lexicons order by created_at", [], "lexicons");
    return rows.map((r) => this._hydrate(h, r));
  }

  get(id) {
    const h = this._open();
    if (h === null) return null;
    const row = h.one("select * from lexicons where id = ? limit 1", [id], "lexicons");
    return row ? this._hydrate(h, row) : null;
  }

  /** Create a lexicon. `entries` are LexiconEntry objects; `id` may be supplied. */
  create(
    name,
    { entries = null, scope = "global", description = null, project_id = null, persona_id = null, id = null } = {},
  ) {
    const lex = construct(Lexicon, {
      id: id || `lex_${randomUUID().replaceAll("-", "")}`,
      name,
      entries: entries || [],
      scope,
      description,
      project_id,
      persona_id,
      created_at: utcNow(),
      updated_at: utcNow(),
    });
    const h = this._open();
    if (h === null) throw new RuntimeError("lexicon store: database not initialized");
    h.tx(() => {
      h.insert("lexicons", {
        id: lex.id,
        name: lex.name,
        description: lex.description,
        scope: lex.scope,
        project_id: lex.project_id,
        persona_id: lex.persona_id,
        created_at: lex.created_at,
        updated_at: lex.updated_at,
      });
      for (const e of lex.entries) h.insert("lexicon_entries", { lexicon_id: lex.id, ...entryToRowFields(e) });
    });
    return lex;
  }

  /**
   * Replace the entry list wholesale (the API's PUT semantics). `name`, when given, also
   * renames the lexicon — so the editor's rename + per-entry edit/delete both route through
   * one PUT. Null when the lexicon is unknown.
   */
  update(id, entries, name = null) {
    const h = this._open();
    if (h === null) throw new RuntimeError("lexicon store: database not initialized");
    return h.tx(() => {
      const row = h.one("select * from lexicons where id = ? limit 1", [id], "lexicons");
      if (!row) return null;
      const set = { updated_at: utcNow() };
      if (name !== null && name !== undefined && strip(name)) set.name = strip(name);
      h.delete("lexicon_entries", { lexicon_id: id });
      h.update("lexicons", set, { id });
      for (const e of entries) h.insert("lexicon_entries", { lexicon_id: id, ...entryToRowFields(e) });
      return this._hydrate(h, h.one("select * from lexicons where id = ? limit 1", [id], "lexicons"));
    });
  }

  appendEntry(id, entry) {
    const h = this._open();
    if (h === null) throw new RuntimeError("lexicon store: database not initialized");
    return h.tx(() => {
      const row = h.one("select * from lexicons where id = ? limit 1", [id], "lexicons");
      if (!row) return null;
      h.update("lexicons", { updated_at: utcNow() }, { id });
      h.insert("lexicon_entries", { lexicon_id: id, ...entryToRowFields(entry) });
      return this._hydrate(h, h.one("select * from lexicons where id = ? limit 1", [id], "lexicons"));
    });
  }

  delete(id) {
    const h = this._open();
    if (h === null) return false;
    const deleted = h.tx(() => {
      // Entries go explicitly so the behaviour doesn't depend on the FK cascade.
      h.delete("lexicon_entries", { lexicon_id: id });
      return h.delete("lexicons", { id }).changes;
    });
    for (const suffix of [".json", ".json.migrated"]) rmSync(path.join(this._dir, `${id}${suffix}`), { force: true });
    return deleted > 0;
  }
}
