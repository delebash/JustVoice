"""Settings storage — single JSON file with atomic write + patch.

Same on-disk layout as the Rust core's SettingsStore — settings.json
lives at ``$DATA_DIR/settings.json``. Existing JustVoice data dirs
transfer with no migration.

Corrupt files fall back to defaults with a logger warning; the
server keeps running.
"""

from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock

from ..models import Settings, SettingsPatch
from ..paths import settings_path
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _deep_merge(base: dict, update: dict) -> None:
    """Recursively merge `update` into `base`. Dicts merge; everything
    else (scalars, lists) replaces."""
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


class SettingsStore:
    """Thread-safe in-memory + disk-backed settings store."""

    def __init__(self, data_dir: Path):
        self._path = settings_path(data_dir)
        self._lock = Lock()
        self._current = self._load()

    def _load(self) -> Settings:
        if not self._path.exists():
            seed = Settings()
            atomic_write_json(self._path, seed.model_dump())
            return seed
        try:
            text = self._path.read_text(encoding="utf-8")
            import json

            return Settings.model_validate(json.loads(text))
        except Exception as e:
            log.warning(
                "settings.json failed to parse (path=%s, error=%s); using defaults",
                self._path,
                e,
            )
            return Settings()

    def get(self) -> Settings:
        with self._lock:
            return self._current.model_copy(deep=True)

    def set(self, new: Settings) -> Settings:
        with self._lock:
            atomic_write_json(self._path, new.model_dump())
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
            atomic_write_json(self._path, new.model_dump())
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
