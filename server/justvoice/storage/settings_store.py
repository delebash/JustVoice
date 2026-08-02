# SPDX-License-Identifier: MIT
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

# ── Legacy LLM-config camelCase migration ────────────────────────────────
# The shared LLM-config models (llm_runner.llm.schema: LLMProviderConfig /
# FeaturePinConfig / ProductionConfig) became camelCase-NATIVE
# on 2026-06-21 — the Python field IS the JSON key, with NO snake_case aliases
# and no populate_by_name. Settings persisted before that date stored these
# sections (engines.llm[] / feature_pins[] / production_configs[])
# with snake_case keys via the old `model_dump()`. Loading that snake data into
# the camel-native models would silently DROP the renamed fields (a provider
# would lose its base_url / api_key / default_model, etc.). This one-time,
# idempotent migration renames the known snake keys to camelCase for exactly
# those LLM sections before validation. Already-camel data passes through
# untouched (the snake keys simply aren't present). Other settings sections
# (engines.external[] = TTS, etc.) keep their snake fields and are left alone.
# (`engines.llm_roles` was migrated here too until 2026-08-01; the roles
# concept is deleted, the model has no such field, and a stored key is now
# simply ignored by pydantic — no rename needed for data nothing reads.)

# Per-section snake→camel rename maps. Only these keys are renamed; anything
# else in a row is preserved verbatim.
_LLM_PROVIDER_RENAMES = {
    "provider_type": "providerType",
    "base_url": "baseUrl",
    "api_key": "apiKey",
    "default_model": "defaultModel",
    "embedding_model": "embeddingModel",
    "timeout_seconds": "timeoutSeconds",
}
_FEATURE_PIN_RENAMES = {"provider_id": "providerId"}
_PRODUCTION_CONFIG_RENAMES = {
    "provider_id": "providerId",
    "system_prompt": "systemPrompt",
    "user_prompt": "userPrompt",
    "promoted_at": "promotedAt",
}


def _rename_keys(obj: dict, renames: dict[str, str]) -> None:
    """Rename `obj`'s keys per `renames`, in place. Idempotent — a key that's
    already the camel target (and has no snake source) is left as-is. If both
    the snake source and the camel target somehow coexist, the existing camel
    value wins (already-migrated data isn't clobbered)."""
    for snake, camel in renames.items():
        if snake in obj:
            if camel not in obj:
                obj[camel] = obj[snake]
            del obj[snake]


def _migrate_llm_camel(data: dict) -> dict:
    """Rename legacy snake_case LLM-config keys to camelCase in a settings
    dict (mutates + returns it). Tolerant of missing/oddly-typed sections —
    a malformed legacy row must never raise here (the caller already guards
    against parse failures, but this stays defensive)."""
    engines = data.get("engines")
    if not isinstance(engines, dict):
        return data

    for prov in engines.get("llm") or []:
        if isinstance(prov, dict):
            _rename_keys(prov, _LLM_PROVIDER_RENAMES)

    for pin in engines.get("feature_pins") or []:
        if isinstance(pin, dict):
            _rename_keys(pin, _FEATURE_PIN_RENAMES)

    for cfg in engines.get("production_configs") or []:
        if isinstance(cfg, dict):
            _rename_keys(cfg, _PRODUCTION_CONFIG_RENAMES)

    return data


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
            return Settings.model_validate(_migrate_llm_camel(json.loads(row.data)))
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
            return Settings.model_validate(_migrate_llm_camel(data))
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
        sibling state (llm providers, production_configs).
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
