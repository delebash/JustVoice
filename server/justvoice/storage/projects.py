# SPDX-License-Identifier: GPL-3.0-or-later
"""Project storage — one JSON file per project under ``$DATA_DIR/projects/``.

A "project" is the committed result of an import-pipeline run. It
captures the StandardImport payload + the operator's project name +
kind. This is intentionally thin — the full project CRUD surface
lands once Phase 1.5 migrates persistence to SQLite (see
``project_final_architecture`` memory). For now we just need enough
to round-trip imports + drive the BooksView list.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any

from ..paths import projects_root
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectStore:
    """Tiny project record store. JSON-per-project, atomic writes."""

    def __init__(self, data_dir: Path):
        self._dir = projects_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._cache: dict[str, dict[str, Any]] = {}
        self._load_all()

    def _load_all(self) -> None:
        for f in self._dir.glob("*.json"):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(rec, dict) and rec.get("id"):
                    self._cache[rec["id"]] = rec
            except Exception as e:
                log.warning("project %s unreadable: %s", f, e)

    def _path(self, id: str) -> Path:
        return self._dir / f"{id}.json"

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return sorted(self._cache.values(), key=lambda r: r.get("created_at", ""))

    def get(self, id: str) -> dict[str, Any] | None:
        with self._lock:
            rec = self._cache.get(id)
            return dict(rec) if rec else None

    def create_from_import(
        self,
        name: str,
        kind: str,
        source: str,
        standard_payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Persist a freshly-imported StandardImport as a new project."""
        with self._lock:
            pid = f"proj_{uuid.uuid4().hex}"
            rec = {
                "id": pid,
                "name": name,
                "kind": kind,
                "source": source,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "standard": standard_payload,
            }
            self._cache[pid] = rec
            atomic_write_json(self._path(pid), rec)
            return dict(rec)

    def delete(self, id: str) -> bool:
        with self._lock:
            if id not in self._cache:
                return False
            self._cache.pop(id, None)
            p = self._path(id)
            if p.exists():
                p.unlink()
            return True
