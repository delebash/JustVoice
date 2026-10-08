// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/backend/database/migrations.py
// (commit pinned in voicebox-pin.txt at repo root). Adapted to JustVoice's schema on
// 2026-06-08; ported to JavaScript (the port of justvoice/database/migrations.py).
// Modifications by JustVoice contributors are licensed under MIT as part of the combined
// JustVoice work. The MIT permission notice (LICENSES/MIT.txt) continues to apply to
// upstream-derived portions.
//
// Column-level migrations for the JustVoice SQLite database.
//
// Why not a migration framework? JustVoice ships as a desktop app; every user has exactly
// one SQLite file. Migration tracking across environments, rollback and team coordination
// don't apply here. The column-existence checks below are idempotent and run in
// milliseconds on startup.
//
// Adding a new migration:
//   1. Append a new `migrate…` helper at the bottom of this file.
//   2. Call it from `runMigrations()` in the appropriate spot.
//   3. The helper checks column/table existence before acting (idempotent) and logs a short
//      message when it does real work.

import { getLogger } from "@delebash/llm-runner/platform/log";

const logger = getLogger("justvoice.database.migrations");

/** Run all schema migrations. Safe to call on every startup. `h` is a database handle. */
export function runMigrations(h) {
  const tables = new Set(tableNames(h));
  // Add per-table migrations here as the schema evolves. Each must be idempotent — safe to
  // run on a fresh DB AND on an upgraded one.
  migrateGenerationsOkStatus(h, tables);
  migrateDropVoiceProfileTables(h, tables);
  migrateBlocksExtractionTelemetry(h, tables);
  migrateMcpBindingsPersona(h, tables);
  migrateCapturesPinned(h, tables);
  migrateRenameJvFeaturePrompts(h, tables);
}

// ── helpers ───────────────────────────────────────────────────────────────

/** The inspector's table names (SQLite's own `sqlite_*` tables left out). */
function tableNames(h) {
  return h
    .all("select name from sqlite_master where type = 'table' and name not like 'sqlite~_%' escape '~' order by name")
    .map((r) => r.name);
}

const getColumns = (h, table) => new Set(h.columnNames(table));

/** Add a column. Idempotent by the callers' checks. */
function addColumn(h, table, columnSql, label) {
  h.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
  logger.info(`Added ${label} column to ${table}`);
}

// ── per-table migrations ──────────────────────────────────────────────────

/** Per DESIGN_FREEZE.md §4.14 — bulk-delete requires an `ok_status` column on generations. */
function migrateGenerationsOkStatus(h, tables) {
  if (!tables.has("generations")) return;
  if (!getColumns(h, "generations").has("ok_status")) {
    addColumn(h, "generations", "ok_status VARCHAR NOT NULL DEFAULT 'ok'", "ok_status");
  }
}

/** extraction_confidence FLOAT + source TEXT on blocks (Phase 3 / Slice 2) — populated when
 * blocks land via POST /v1/scenes/{id}/analyze; Script and the Speaker Lab read them. */
function migrateBlocksExtractionTelemetry(h, tables) {
  if (!tables.has("blocks")) return;
  const columns = getColumns(h, "blocks");
  if (!columns.has("extraction_confidence")) addColumn(h, "blocks", "extraction_confidence FLOAT", "extraction_confidence");
  if (!columns.has("source")) addColumn(h, "blocks", "source VARCHAR", "source");
}

/**
 * Drop voice_profiles, profile_samples, profile_channels (Slice 4 of the Profile-kill).
 *
 * The personas.voice_profile_id + personas.personality_enabled columns are LEFT IN PLACE as
 * dead null residue: SQLite refuses to drop a column that participates in an FK definition
 * (the original CREATE TABLE references the dropped voice_profiles table), and the full
 * table-recreate is deferred. Harmless — no code writes them.
 */
function migrateDropVoiceProfileTables(h, tables) {
  for (const table of ["profile_channels", "profile_samples", "voice_profiles"]) {
    if (tables.has(table)) {
      h.exec(`DROP TABLE IF EXISTS ${table}`);
      logger.info(`Dropped ${table} table (Slice 4 of Profile-kill)`);
    }
  }
}

/** `pinned` on captures (pin the stream phrases you repeat; pinned rows sort first). */
function migrateCapturesPinned(h, tables) {
  if (!tables.has("captures")) return;
  if (!getColumns(h, "captures").has("pinned")) {
    addColumn(h, "captures", "pinned BOOLEAN NOT NULL DEFAULT 0", "pinned");
  }
}

/** mcp_bindings predating the Profile-kill lack persona_id (+ the later default/telemetry
 * columns). User-hit 2026-06-12: GET /v1/mcp/bindings 500'd on a DB created before Slice 4. */
function migrateMcpBindingsPersona(h, tables) {
  if (!tables.has("mcp_bindings")) return;
  const columns = getColumns(h, "mcp_bindings");
  if (!columns.has("persona_id")) addColumn(h, "mcp_bindings", "persona_id VARCHAR", "persona_id");
  if (!columns.has("default_engine")) addColumn(h, "mcp_bindings", "default_engine VARCHAR", "default_engine");
  if (!columns.has("last_seen_at")) addColumn(h, "mcp_bindings", "last_seen_at DATETIME", "last_seen_at");
}

/**
 * feature_prompts -> jv_feature_prompts (2026-08-01, convergence part 2). The shared LLM
 * stack owns a `feature_prompts` table with a DIFFERENT schema; JV's own prompt table moves
 * aside so both keep their rows until engines/llm/migrate_prompts merges them. Only fires
 * when the old name exists in JV's shape (has `temperature`, lacks `json_mode`).
 */
function migrateRenameJvFeaturePrompts(h, tables) {
  if (!tables.has("feature_prompts") || tables.has("jv_feature_prompts")) return;
  const cols = getColumns(h, "feature_prompts");
  if (!cols.has("temperature") || cols.has("json_mode")) return; // the shared stack's table — not ours
  h.tx(() => h.exec("ALTER TABLE feature_prompts RENAME TO jv_feature_prompts"));
}
