// SPDX-License-Identifier: MIT
// Settings storage — the typed operator/server config, in SQLite (the port of
// justvoice/storage/settings_store.py).
//
// Phase 1.5: folded off the legacy atomic `settings.json` into a singleton row of the
// `settings` table — SQLite is the one backend. On first load an existing `settings.json` is
// imported once and then removed, so existing installs (and restored pre-fold backups) don't
// lose config. Corrupt rows/files fall back to defaults with a logger warning; the server
// keeps running.
//
// The row's text is Python's `json.dumps(settings.model_dump())`: declaration order, floats
// as floats (`"loudness_target_lufs": -20.0` — floatify), `", "` / `": "` separators.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as session from "../database/session.js";
import { construct, floatify, modelDump, pyClone, Settings, SettingsPatch } from "../models.js";
import { settingsPath } from "../paths.js";

const log = getLogger("justvoice.storage.settings_store");

const ROW_ID = "singleton";

// ── Legacy LLM-config camelCase migration ────────────────────────────────
// The shared LLM-config models became camelCase-NATIVE on 2026-06-21 — no snake_case
// aliases. Settings persisted before that date stored `engines.llm[]` with snake_case keys;
// loading those into the camel-native model would silently DROP the renamed fields (a
// provider would lose its base_url / api_key / default_model). This one-time, idempotent
// migration renames the known snake keys to camelCase for the ONE surviving section
// (engines.llm[] — migrate_providers still reads it) before validation. Already-camel data
// passes through untouched. (Other retired sections — llm_roles, feature_pins,
// production_configs — are simply ignored at validation.)
const LLM_PROVIDER_RENAMES = {
  provider_type: "providerType",
  base_url: "baseUrl",
  api_key: "apiKey",
  default_model: "defaultModel",
  embedding_model: "embeddingModel",
  timeout_seconds: "timeoutSeconds",
};

/** Rename `obj`'s keys per `renames`, in place. Idempotent — if both the snake source and the
 * camel target coexist, the existing camel value wins (already-migrated data isn't
 * clobbered). The renamed key lands at the end, as a Python dict insert does. */
function renameKeys(obj, renames) {
  for (const [snake, camel] of Object.entries(renames)) {
    if (Object.hasOwn(obj, snake)) {
      if (!Object.hasOwn(obj, camel)) obj[camel] = obj[snake];
      delete obj[snake];
    }
  }
}

const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Rename legacy snake_case LLM-config keys to camelCase in a settings dict (mutates +
 * returns it). Tolerant of missing/oddly-typed sections — never raises. */
export function _migrateLlmCamel(data) {
  const engines = isDict(data) ? data.engines : null;
  if (!isDict(engines)) return data;
  const llm = engines.llm;
  for (const prov of Array.isArray(llm) ? llm : []) {
    if (isDict(prov)) renameKeys(prov, LLM_PROVIDER_RENAMES);
  }
  return data;
}

/** Recursively merge `update` into `base`. Dicts merge; everything else (scalars, lists)
 * replaces. */
export function _deepMerge(base, update) {
  for (const [key, value] of Object.entries(update)) {
    if (isDict(value) && isDict(base[key])) _deepMerge(base[key], value);
    else base[key] = value;
  }
}

/** In-memory + SQLite-backed settings store. */
export class SettingsStore {
  constructor(dataDir) {
    // Legacy atomic-JSON path — read once to seed the row, then retired.
    this._legacyPath = settingsPath(dataDir);
    this._current = this._load();
  }

  // ── SQLite plumbing ──────────────────────────────────────────────
  _session() {
    const h = session.cfg.handle;
    if (h === null) throw new RuntimeError("Database not initialized — call init_db() during boot");
    return h;
  }

  _readRow(h) {
    const row = h.get("settings", ROW_ID);
    if (!row) return null;
    try {
      return construct(Settings, _migrateLlmCamel(JSON.parse(row.data)));
    } catch (e) {
      // a corrupt row must not kill boot
      log.warning(`settings row failed to parse (error=${e?.message ?? e}); using defaults`);
      return construct(Settings, {});
    }
  }

  _writeRow(h, settings) {
    const payload = pyJson(floatify(Settings, modelDump(Settings, settings)));
    if (h.get("settings", ROW_ID)) h.update("settings", { data: payload }, { id: ROW_ID });
    else h.insert("settings", { id: ROW_ID, data: payload });
  }

  _load() {
    const h = this._session();
    const current = this._readRow(h);
    if (current !== null) return current;
    // No row yet — seed once from a legacy settings.json (existing install or a restored
    // pre-fold backup) or defaults, persist it, then retire the file so the DB is the sole
    // source.
    const seed = this._loadLegacy() ?? construct(Settings, {});
    this._writeRow(h, seed);
    this._retireLegacy();
    return seed;
  }

  _loadLegacy() {
    if (!existsSync(this._legacyPath)) return null;
    try {
      const data = JSON.parse(readFileSync(this._legacyPath, "utf8"));
      log.info(`Migrating settings.json → SQLite (path=${this._legacyPath})`);
      return construct(Settings, _migrateLlmCamel(data));
    } catch (e) {
      log.warning(`settings.json failed to parse (error=${e?.message ?? e}); using defaults`);
      return null;
    }
  }

  _retireLegacy() {
    try {
      if (existsSync(this._legacyPath)) rmSync(this._legacyPath);
    } catch (e) {
      log.warning(`couldn't remove migrated settings.json: ${e?.message ?? e}`);
    }
  }

  // ── Public API (unchanged shape) ─────────────────────────────────

  /** A deep copy of the current settings (`model_copy(deep=True)`). */
  get() {
    return pyClone(this._current);
  }

  /** Replace the whole settings tree. Returns a deep copy of what is now current. */
  set(newSettings) {
    const s = construct(Settings, newSettings);
    this._writeRow(this._session(), s);
    this._current = s;
    return pyClone(this._current);
  }

  /**
   * Apply a partial update. Returns `[newSettings, restartRequiredFields]`.
   *
   * `patch` is the SettingsPatch as the client SENT it (the request body before defaults
   * are filled): only fields the caller actually sent participate (pydantic's
   * exclude_unset), and fields sent as null are dropped (exclude_none). Deep-merges dicts so
   * `PATCH {"engines": {"external": [...]}}` only touches `engines.external` — a shallow
   * top-level assignment used to replace the WHOLE engines subtree with defaults. Lists
   * replace wholesale. Throws the model's validation error when the patch doesn't fit.
   */
  patch(patch) {
    construct(SettingsPatch, patch); // validate — pydantic raised before the store ran
    const base = modelDump(Settings, this._current);
    const update = modelDump(SettingsPatch, patch ?? {}, { excludeNone: true });
    _deepMerge(base, update);
    const next = construct(Settings, base);
    this._writeRow(this._session(), next);
    const restartRequired = SettingsStore._restartRequired(this._current, next);
    this._current = next;
    return [pyClone(this._current), restartRequired];
  }

  /** Which changed fields need a server restart. */
  static _restartRequired(prev, next) {
    const out = [];
    const eq = isDeepStrictEqual;
    if (!eq(prev.server, next.server)) {
      if (prev.server.host !== next.server.host) out.push("server.host");
      if (prev.server.port !== next.server.port) out.push("server.port");
      if (prev.server.docs_enabled !== next.server.docs_enabled) out.push("server.docs_enabled");
    }
    if (!eq(prev.logging, next.logging)) {
      out.push("logging.level");
      out.push("logging.format");
    }
    if (!eq(prev.cors, next.cors)) out.push("cors.origins");
    if (prev.limits.request_body_max_bytes !== next.limits.request_body_max_bytes) {
      out.push("limits.request_body_max_bytes");
    }
    return out;
  }
}
