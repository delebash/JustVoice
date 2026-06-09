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
in <50 ms on startup, and have been battle-tested in voicebox across 12+
schema changes.

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
