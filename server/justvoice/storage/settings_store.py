# SPDX-License-Identifier: GPL-3.0-or-later
"""Settings storage — the typed operator/server config, in SQLite.

Phase 1.5: folded off the legacy atomic `settings.json` into a singleton row of
the `settings` table — SQLite is now the one backend. The typed `Settings` model,
the GET/PUT/PATCH `/v1/settings` API, the deep-merge, and the restart-required
logic are unchanged; only persistence moved. On first load an existing
`settings.json` is imported once and then removed, so existing installs (and
restored pre-fold backups) don't lose config.

Corrupt rows/files fall back to defaults with a logger warning; the server
keeps running.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from threading import Lock

from ..database import session as _db
from ..database.models import SettingsRow
from ..models import Settings, SettingsPatch
from ..paths import settings_path

log = logging.getLogger(__name__)

_ROW_ID = "singleton"


def _deep_merge(base: dict, update: dict) -> None:
    """Recursively merge `update` into `base`. Dicts merge; everything
    else (scalars, lists) replaces."""
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


class SettingsStore:
    """Thread-safe in-memory + SQLite-backed settings store."""

    def __init__(self, data_dir: Path):
        # Legacy atomic-JSON path — read once to seed the row, then retired.
        self._legacy_path = settings_path(data_dir)
        self._lock = Lock()
        self._current = self._load()

    # ── SQLite plumbing ──────────────────────────────────────────────
    def _session(self):
        if _db.SessionLocal is None:
            raise RuntimeError("Database not initialized — call init_db() during boot")
        return _db.SessionLocal()

    def _read_row(self, db) -> Settings | None:
        row = db.get(SettingsRow, _ROW_ID)
        if row is None:
            return None
        try:
            return Settings.model_validate(json.loads(row.data))
        except Exception as e:  # noqa: BLE001 — corrupt row must not kill boot
            log.warning("settings row failed to parse (error=%s); using defaults", e)
            return Settings()

    def _write_row(self, db, settings: Settings) -> None:
        payload = json.dumps(settings.model_dump())
        row = db.get(SettingsRow, _ROW_ID)
        if row is None:
            db.add(SettingsRow(id=_ROW_ID, data=payload))
        else:
            row.data = payload
        db.commit()

    def _load(self) -> Settings:
        db = self._session()
        try:
            current = self._read_row(db)
            if current is not None:
                return current
            # No row yet — seed once from a legacy settings.json (existing
            # install or a restored pre-fold backup) or defaults, persist it,
            # then retire the file so the DB is the sole source.
            seed = self._load_legacy() or Settings()
            self._write_row(db, seed)
        finally:
            db.close()
        self._retire_legacy()
        return seed

    def _load_legacy(self) -> Settings | None:
        if not self._legacy_path.exists():
            return None
        try:
            data = json.loads(self._legacy_path.read_text(encoding="utf-8"))
            log.info("Migrating settings.json → SQLite (path=%s)", self._legacy_path)
            return Settings.model_validate(data)
        except Exception as e:  # noqa: BLE001
            log.warning("settings.json failed to parse (error=%s); using defaults", e)
            return None

    def _retire_legacy(self) -> None:
        try:
            if self._legacy_path.exists():
                self._legacy_path.unlink()
        except OSError as e:
            log.warning("couldn't remove migrated settings.json: %s", e)

    # ── Public API (unchanged shape) ─────────────────────────────────
    def get(self) -> Settings:
        with self._lock:
            return self._current.model_copy(deep=True)

    def set(self, new: Settings) -> Settings:
        with self._lock:
            db = self._session()
            try:
                self._write_row(db, new)
            finally:
                db.close()
            self._current = new
            return self._current.model_copy(deep=True)

    def patch(self, patch: SettingsPatch) -> tuple[Settings, list[str]]:
        """Apply a partial update. Returns (new_settings, restart_required_fields).

        Deep-merges dicts so `PATCH {"engines": {"external": [...]}}` only
        touches `engines.external` — a shallow top-level assignment used to
        replace the WHOLE engines subtree with section defaults, wiping
        sibling state (llm providers, llm_roles, production_configs).
        Lists replace wholesale; only fields the caller actually sent
        (exclude_unset) participate.
        """
        with self._lock:
            base = self._current.model_dump()
            update = patch.model_dump(exclude_unset=True, exclude_none=True)
            _deep_merge(base, update)
            new = Settings.model_validate(base)
            db = self._session()
            try:
                self._write_row(db, new)
            finally:
                db.close()
            restart_required = self._restart_required(self._current, new)
            self._current = new
            return self._current.model_copy(deep=True), restart_required

    @staticmethod
    def _restart_required(prev: Settings, new: Settings) -> list[str]:
        """Compute which changed fields need a server restart."""
        out: list[str] = []
        if prev.server != new.server:
            if prev.server.host != new.server.host:
                out.append("server.host")
            if prev.server.port != new.server.port:
                out.append("server.port")
            if prev.server.docs_enabled != new.server.docs_enabled:
                out.append("server.docs_enabled")
        if prev.logging != new.logging:
            out.append("logging.level")
            out.append("logging.format")
        if prev.cors != new.cors:
            out.append("cors.origins")
        if prev.limits.request_body_max_bytes != new.limits.request_body_max_bytes:
            out.append("limits.request_body_max_bytes")
        if (
            prev.engines.kokoro.model_dir_override
            != new.engines.kokoro.model_dir_override
        ):
            out.append("engines.kokoro.model_dir_override")
        return out
