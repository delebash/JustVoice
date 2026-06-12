# SPDX-License-Identifier: MIT AND GPL-3.0-or-later
# SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors
#
# Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/backend/database/migrations.py
# (commit pinned in voicebox-pin.txt at repo root).
# Adapted to JustVoice's schema on 2026-06-08.
# Modifications by JustVoice contributors are licensed under GPL-3.0-or-later
# as part of the combined JustVoice work. The MIT permission notice
# (LICENSES/MIT.txt) continues to apply to upstream-derived portions.

"""Column-level migrations for the JustVoice SQLite database.

Why not Alembic? JustVoice ships as a PyInstaller-bundled desktop app. Every
user has exactly one SQLite file. Alembic's strengths — migration tracking
across environments, rollback, team coordination — don't apply here and would
add bundling complexity (alembic.ini, env.py, versions/ directory all need to
survive PyInstaller). The column-existence checks below are idempotent, run
in <50 ms on startup, and have been battle-tested upstream across 12+
schema changes (see SPDX header above for the upstream attribution).

If the project ever moves to a server-based deployment or Postgres, this
decision should be revisited.

Adding a new migration:
    1. Append a new `_migrate_*` helper at the bottom of this file.
    2. Call it from `run_migrations()` in the appropriate spot.
    3. The helper should check column/table existence before acting
       (idempotent) and log a short message when it does real work.
"""

from __future__ import annotations

import logging
import sqlite3

from sqlalchemy import inspect, text


logger = logging.getLogger(__name__)


def run_migrations(engine) -> None:
    """Run all schema migrations. Safe to call on every startup."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    # Add per-table migrations here as the schema evolves. Each must be
    # idempotent — safe to run on a fresh DB AND on an upgraded one.
    _migrate_generations_ok_status_and_preset(engine, inspector, tables)
    _migrate_voice_profiles_personality(engine, inspector, tables)
    _migrate_personas_absorb_profile_fields(engine, inspector, tables)
    _migrate_drop_voice_profile_tables(engine, inspector, tables)
    _migrate_render_presets_effects_chain(engine, inspector, tables)
    _migrate_render_presets_voice_nullable(engine, inspector, tables)
    _migrate_blocks_extraction_telemetry(engine, inspector, tables)
    _migrate_mcp_bindings_persona(engine, inspector, tables)
    _migrate_captures_pinned(engine, inspector, tables)


# ── helpers ───────────────────────────────────────────────────────────────


def _get_columns(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _add_column(engine, table: str, column_sql: str, label: str) -> None:
    """Add a column if it doesn't already exist. Idempotent."""
    with engine.connect() as conn:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_sql}"))
        conn.commit()
    logger.info("Added %s column to %s", label, table)


def _supports_drop_column(engine) -> bool:
    """Whether `ALTER TABLE ... DROP COLUMN` is supported by the dialect +
    runtime. SQLite gained the feature in 3.35 (Mar 2021)."""
    if engine.dialect.name != "sqlite":
        return True
    return tuple(int(p) for p in sqlite3.sqlite_version.split(".")[:3]) >= (3, 35, 0)


# ── per-table migrations ──────────────────────────────────────────────────


def _migrate_generations_ok_status_and_preset(engine, inspector, tables: set[str]) -> None:
    """Per DESIGN_FREEZE.md §4.14 — bulk-delete + render-preset support
    requires `ok_status` and `preset_id` columns on generations."""
    if "generations" not in tables:
        return
    columns = _get_columns(inspector, "generations")
    if "ok_status" not in columns:
        _add_column(
            engine,
            "generations",
            "ok_status VARCHAR NOT NULL DEFAULT 'ok'",
            "ok_status",
        )
    if "preset_id" not in columns:
        _add_column(engine, "generations", "preset_id VARCHAR", "preset_id")


def _migrate_voice_profiles_personality(engine, inspector, tables: set[str]) -> None:
    """Adds `personality TEXT` + `default_delivery TEXT` to voice_profiles.

    Kept idempotent so older databases finish their column add BEFORE
    the Profile→Persona migration in migrate_profiles.py reads them.
    Becomes a no-op (table missing) after the table-drop migration
    below runs once.
    """
    if "voice_profiles" not in tables:
        return
    columns = _get_columns(inspector, "voice_profiles")
    if "personality" not in columns:
        _add_column(engine, "voice_profiles", "personality TEXT", "personality")
    if "default_delivery" not in columns:
        _add_column(engine, "voice_profiles", "default_delivery TEXT", "default_delivery")


def _migrate_personas_absorb_profile_fields(engine, inspector, tables: set[str]) -> None:
    """Adds voice-styling columns to personas as part of the Profile-kill
    rollout (Slice 1 of the approved plan).

    Persona becomes the sole identity layer; effects/delivery/personality
    and friends move from VoiceProfile onto Persona. The actual data
    migration (copying voice_profile rows into orphan Persona records) is
    in `migrate_profiles.py` and runs at AppState init.
    """
    if "personas" not in tables:
        return
    columns = _get_columns(inspector, "personas")
    if "voice_id" not in columns:
        _add_column(engine, "personas", "voice_id VARCHAR", "voice_id")
    if "language" not in columns:
        _add_column(engine, "personas", "language VARCHAR DEFAULT 'en'", "language")
    if "avatar_path" not in columns:
        _add_column(engine, "personas", "avatar_path VARCHAR", "avatar_path")
    if "personality" not in columns:
        _add_column(engine, "personas", "personality TEXT", "personality")
    if "default_delivery" not in columns:
        _add_column(engine, "personas", "default_delivery TEXT", "default_delivery")
    if "effects_chain" not in columns:
        _add_column(engine, "personas", "effects_chain TEXT", "effects_chain")
    if "imported_id" not in columns:
        _add_column(engine, "personas", "imported_id VARCHAR", "imported_id")


def _migrate_blocks_extraction_telemetry(engine, inspector, tables: set[str]) -> None:
    """Add extraction_confidence FLOAT + source TEXT to blocks (Phase 3 /
    Slice 2). Populated when blocks land via POST /v1/scenes/{id}/analyze.
    The Studio Script tab and the Speaker Lab both read these.
    """
    if "blocks" not in tables:
        return
    columns = _get_columns(inspector, "blocks")
    if "extraction_confidence" not in columns:
        _add_column(engine, "blocks", "extraction_confidence FLOAT", "extraction_confidence")
    if "source" not in columns:
        _add_column(engine, "blocks", "source VARCHAR", "source")


def _migrate_render_presets_effects_chain(engine, inspector, tables: set[str]) -> None:
    """Add `effects_chain TEXT` to render_presets (Slice 6 of the
    Profile-kill plan / Effects v1 wiring).

    The column carries a JSON list of {type, params} dicts; the render
    pipeline overlays it on top of `persona.effects_chain` at TTS time.
    """
    if "render_presets" not in tables:
        return
    columns = _get_columns(inspector, "render_presets")
    if "effects_chain" not in columns:
        _add_column(engine, "render_presets", "effects_chain TEXT", "effects_chain")


def _migrate_render_presets_voice_nullable(engine, inspector, tables: set[str]) -> None:
    """Relax render_presets.voice_id NOT NULL + add is_builtin.

    User-hit 2026-06-12: creating a preset 500'd with a FOREIGN KEY
    IntegrityError because the UI had to invent a persona binding just to
    satisfy NOT NULL. Design: a preset is a delivery/effects/master STYLE;
    the voice binding is optional (the 4 built-in seeds carry none).

    SQLite can't ALTER a column to drop NOT NULL — this is the documented
    12-step rebuild: create new-shape table under a temp name, copy, drop
    old (takes its indexes with it), rename, recreate the unique index.
    """
    if "render_presets" not in tables:
        return
    columns = _get_columns(inspector, "render_presets")
    if "is_builtin" not in columns:
        _add_column(
            engine,
            "render_presets",
            "is_builtin BOOLEAN NOT NULL DEFAULT 0",
            "is_builtin",
        )
    voice_col = next(
        (c for c in inspector.get_columns("render_presets") if c["name"] == "voice_id"),
        None,
    )
    if voice_col is None or voice_col.get("nullable", True):
        return  # already new-shape (fresh DBs come from metadata.create_all)

    cols = (
        "id, name, project_id, voice_id, delivery_json, effects_chain, "
        "master, lexicons_json, seed, cache_scope, description, is_builtin, "
        "created_at, updated_at"
    )
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute(
            """
            CREATE TABLE render_presets_new (
                id VARCHAR NOT NULL PRIMARY KEY,
                name VARCHAR NOT NULL,
                project_id VARCHAR REFERENCES projects (id) ON DELETE CASCADE,
                voice_id VARCHAR REFERENCES personas (id) ON DELETE RESTRICT,
                delivery_json TEXT NOT NULL,
                effects_chain TEXT,
                master VARCHAR,
                lexicons_json TEXT NOT NULL,
                seed INTEGER,
                cache_scope VARCHAR NOT NULL,
                description TEXT,
                is_builtin BOOLEAN NOT NULL DEFAULT 0,
                created_at DATETIME,
                updated_at DATETIME
            )
            """
        )
        cur.execute(
            f"INSERT INTO render_presets_new ({cols}) SELECT {cols} FROM render_presets"
        )
        cur.execute("DROP TABLE render_presets")
        cur.execute("ALTER TABLE render_presets_new RENAME TO render_presets")
        cur.execute(
            "CREATE UNIQUE INDEX ix_render_presets_unique_name_per_project "
            "ON render_presets (project_id, name)"
        )
        cur.execute("PRAGMA foreign_keys=ON")
        raw.commit()
        logger.info("Rebuilt render_presets — voice_id now nullable")
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()


def _migrate_drop_voice_profile_tables(engine, inspector, tables: set[str]) -> None:
    """Drop voice_profiles, profile_samples, profile_channels (Slice 4).

    Runs AFTER `_migrate_personas_absorb_profile_fields` AND AFTER the
    one-shot Profile→Persona data migration in `migrate_profiles.py` has
    a chance to read voice_profiles at AppState init.

    The personas.voice_profile_id + personas.personality_enabled columns
    are LEFT IN PLACE as dead null residue. Dropping them via
    `ALTER TABLE … DROP COLUMN` fails on SQLite because the original
    CREATE TABLE statement embeds an FK declaration that references the
    soon-dropped voice_profiles table — SQLite refuses to drop a column
    that participates in an FK definition. The correct fix is a full
    table-recreate (CREATE … AS SELECT, drop, rename); that's a heavier
    migration deferred to a later cleanup slice. The dead columns are
    harmless because no code writes to them after Slice 1-3.
    """
    with engine.connect() as conn:
        for table in ("profile_channels", "profile_samples", "voice_profiles"):
            if table in tables:
                conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
                logger.info("Dropped %s table (Slice 4 of Profile-kill)", table)
        conn.commit()


def _migrate_captures_pinned(engine, inspector, tables: set[str]) -> None:
    """Add `pinned` to captures (parity with the journeys mock — pin the
    stream phrases you repeat; pinned rows sort first)."""
    if "captures" not in tables:
        return
    columns = _get_columns(inspector, "captures")
    if "pinned" not in columns:
        _add_column(engine, "captures", "pinned BOOLEAN NOT NULL DEFAULT 0", "pinned")


def _migrate_mcp_bindings_persona(engine, inspector, tables: set[str]) -> None:
    """mcp_bindings predating the Profile-kill lack persona_id (+ the
    later default/telemetry columns). User-hit 2026-06-12: GET
    /v1/mcp/bindings 500'd with 'no such column: mcp_bindings.persona_id'
    on a DB created before Slice 4."""
    if "mcp_bindings" not in tables:
        return
    columns = _get_columns(inspector, "mcp_bindings")
    if "persona_id" not in columns:
        _add_column(engine, "mcp_bindings", "persona_id VARCHAR", "persona_id")
    if "default_personality" not in columns:
        _add_column(engine, "mcp_bindings", "default_personality BOOLEAN DEFAULT 0", "default_personality")
    if "default_engine" not in columns:
        _add_column(engine, "mcp_bindings", "default_engine VARCHAR", "default_engine")
    if "last_seen_at" not in columns:
        _add_column(engine, "mcp_bindings", "last_seen_at DATETIME", "last_seen_at")
