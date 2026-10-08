// SPDX-License-Identifier: MIT
// Persona storage — SQLite-primary (the port of justvoice/storage/personas.py; Phase 1.5
// flip, 2026-06-12).
//
// The file-per-persona JSON store kept a DB twin via a best-effort mirror, and the
// split-brain bit three separate times (preset creates 500'd on FK targets the DB never saw,
// factory reset left characters alive, re-imports self-healed twins that were never
// missing). SQLite is now the single source of truth. Legacy `$DATA_DIR/personas/*.json`
// files are imported once at store init (id-based) and renamed `*.json.migrated` so a
// persona deleted later doesn't resurrect on the next boot.
//
// The legacy `llm_rewrite_enabled` / `llm_model` fields are accepted but NOT persisted —
// nothing reads them (Rewrite is an explicit tool, not a render hook).
//
// Stored text is Python's: `default_delivery` is `json.dumps(delivery.model_dump(
// exclude_none=True))` minus empty model entries (floats as floats), `effects_chain` is
// `json.dumps(chain)` of the chain as parsed — read through pyJsonParse, so a whole-number
// float literal survives a rewrite (and the render-cache key that hashes the chain).

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError, truthy } from "@delebash/llm-runner/platform/py";
import { pyJson, pyClone, pyJsonParse } from "@delebash/llm-runner/platform/pyjson";
import * as session from "../database/session.js";
import { construct, dtIso, floatify, modelDump, Persona, PersonaDelivery, utcNow } from "../models.js";
import { personasRoot } from "../paths.js";

const log = getLogger("justvoice.storage.personas");

const isEmptyValue = (val) =>
  val === null ||
  val === undefined ||
  val === "" ||
  (typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0);

/** The stored form: only what is set, or NULL for nothing. */
export function _dumpDelivery(delivery) {
  const data = modelDump(PersonaDelivery, construct(PersonaDelivery, delivery ?? {}), { excludeNone: true });
  const models = {};
  for (const [k, v] of Object.entries(data.models || {})) {
    if (Object.values(v).some((val) => !isEmptyValue(val))) models[k] = v;
  }
  data.models = models;
  if (!Object.keys(data.models).length) delete data.models;
  return Object.keys(data).length ? pyJson(floatify(PersonaDelivery, data)) : null;
}

/** json.loads with a fallback of the expected type (a dict or a list). */
function loads(raw, fallback, parse = JSON.parse) {
  if (!raw) return fallback;
  try {
    const out = parse(raw);
    const want = Array.isArray(fallback) ? Array.isArray(out) : out !== null && typeof out === "object" && !Array.isArray(out);
    return want ? out : fallback;
  } catch {
    return fallback;
  }
}

export function _rowToPersona(row) {
  return construct(Persona, {
    id: row.id,
    name: row.name,
    voice_id: row.voice_id,
    language: row.language || "en",
    avatar_path: row.avatar_path,
    voice_instruct: row.voice_instruct,
    note: row.note,
    default_delivery: construct(PersonaDelivery, loads(row.default_delivery, {})),
    effects_chain: loads(row.effects_chain, [], pyJsonParse),
    lexicon_id: row.lexicon_id,
    imported_from: row.imported_from,
    imported_id: row.imported_id,
    created_at: row.created_at || utcNow(),
    updated_at: row.updated_at || utcNow(),
  });
}

/** Python's `sorted(dir.glob("*.json"))`. */
function jsonFiles(dir) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Five methods (list / get / create / update / delete); rows live in the `personas` table.
 * `handle` is injectable for tests; the default resolves the database module's handle lazily
 * at call time so factory reset's re-init and test reassignment both work.
 */
export class PersonaStore {
  constructor(dataDir, handle = null) {
    this._dir = personasRoot(dataDir);
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
      // DB not initialized yet (CLI tools) — leave the files for the next construction.
      log.warning("persona store: DB not ready — legacy file import deferred");
      return;
    }
    try {
      for (const f of files) {
        let p;
        try {
          p = construct(Persona, pyJsonParse(readFileSync(f, "utf8")));
        } catch (e) {
          log.warning(`persona file ${f} unreadable, left in place: ${e?.message ?? e}`);
          continue;
        }
        h.tx(() => {
          if (!h.one("select id from personas where id = ? limit 1", [p.id])) {
            h.insert("personas", PersonaStore._toRow(p));
            log.info(`persona ${p.id} imported from legacy file store`);
          }
        });
        renameSync(f, `${f}.migrated`);
      }
    } catch (e) {
      // boot must not die on this
      log.warning(`persona legacy-file import failed: ${e?.message ?? e}`);
    }
  }

  static _toRow(p) {
    return {
      id: p.id,
      name: p.name,
      voice_id: p.voice_id || null,
      language: p.language,
      avatar_path: p.avatar_path,
      voice_instruct: p.voice_instruct,
      note: p.note,
      default_delivery: _dumpDelivery(p.default_delivery),
      effects_chain: truthy(p.effects_chain) ? pyJson(p.effects_chain) : null,
      lexicon_id: p.lexicon_id,
      imported_from: p.imported_from,
      imported_id: p.imported_id,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }

  // ── public surface ────────────────────────────────────────────────

  list() {
    const h = this._open();
    if (h === null) return [];
    return h.all("select * from personas order by created_at", [], "personas").map(_rowToPersona);
  }

  get(id) {
    const h = this._open();
    if (h === null) return null;
    const row = h.one("select * from personas where id = ? limit 1", [id], "personas");
    return row ? _rowToPersona(row) : null;
  }

  /** Create a persona. `id` may be supplied for migrations that need to preserve the source
   * record's id. Keyword arguments keep their (wire) snake_case names. */
  create(
    name,
    {
      voice_id = null,
      default_delivery = null,
      voice_instruct = null,
      lexicon_id = null,
      llm_rewrite_enabled = false, // accepted, not persisted (legacy)
      llm_model = null, // accepted, not persisted (legacy)
      language = "en",
      avatar_path = null,
      note = null,
      effects_chain = null,
      imported_from = null,
      imported_id = null,
      id = null,
    } = {},
  ) {
    const persona = construct(Persona, {
      id: id || `persona_${randomUUID().replaceAll("-", "")}`,
      name,
      voice_id,
      language,
      avatar_path,
      voice_instruct,
      note,
      default_delivery: construct(PersonaDelivery, default_delivery || {}),
      effects_chain: truthy(effects_chain) ? effects_chain : [],
      lexicon_id,
      llm_rewrite_enabled,
      llm_model,
      imported_from,
      imported_id,
      created_at: utcNow(),
      updated_at: utcNow(),
    });
    const h = this._open();
    if (h === null) throw new RuntimeError("persona store: database not initialized");
    h.tx(() => h.insert("personas", PersonaStore._toRow(persona)));
    return persona;
  }

  /**
   * Set exactly the fields given — a null CLEARS that field (2026-10-03). The caller sends
   * only what changed (PATCH: a field left out is not passed at all). Until 2026-10-03 null
   * was skipped, so the editor could not empty a field while the page said "Persona saved".
   */
  update(id, fields) {
    const current = this.get(id);
    if (current === null) return null;
    const data = modelDump(Persona, current);
    // (An `undefined` is a field not passed — Python's kwargs can't carry one.)
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) data[k] = pyClone(v);
    if (data.default_delivery == null) data.default_delivery = {};
    if (data.effects_chain == null) data.effects_chain = [];
    data.updated_at = dtIso(utcNow());
    const next = construct(Persona, data);

    const h = this._open();
    if (h === null) throw new RuntimeError("persona store: database not initialized");
    const done = h.tx(() => {
      if (!h.one("select id from personas where id = ? limit 1", [id])) return false;
      h.update(
        "personas",
        {
          name: next.name,
          voice_id: next.voice_id || null,
          language: next.language,
          avatar_path: next.avatar_path,
          voice_instruct: next.voice_instruct,
          note: next.note,
          default_delivery: _dumpDelivery(next.default_delivery),
          effects_chain: truthy(next.effects_chain) ? pyJson(next.effects_chain) : null,
          lexicon_id: next.lexicon_id,
          imported_from: next.imported_from,
          imported_id: next.imported_id,
          updated_at: next.updated_at,
        },
        { id },
      );
      return true;
    });
    return done ? next : null;
  }

  delete(id) {
    const h = this._open();
    if (h === null) return false;
    const deleted = h.tx(() => h.delete("personas", { id }).changes);
    // Tidy any legacy artifacts so nothing can resurrect it.
    for (const suffix of [".json", ".json.migrated"]) rmSync(path.join(this._dir, `${id}${suffix}`), { force: true });
    return deleted > 0;
  }
}
