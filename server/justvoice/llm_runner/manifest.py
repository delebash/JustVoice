# SPDX-License-Identifier: GPL-3.0-or-later
"""Loader for the bundled `runner-manifest.json`.

Reads the JSON beside this module (the convention used by the rest of the
package, e.g. labs/extraction/corpus/*.json) and validates it into the
camelCase `RunnerManifest` schema. Cached after first load; `load_manifest(
refresh=True)` re-reads from disk (used by tests and a future "refresh
catalog" action).

A malformed manifest raises pydantic's ValidationError — better to fail
loudly at load than to silently spawn llama-server with garbage flags.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from .schema import RunnerManifest

_MANIFEST_PATH = Path(__file__).resolve().parent / "runner-manifest.json"

_lock = threading.Lock()
_cached: RunnerManifest | None = None


def manifest_path() -> Path:
    """Absolute path to the bundled manifest (also used by tests)."""
    return _MANIFEST_PATH


def load_manifest(refresh: bool = False) -> RunnerManifest:
    """Return the validated manifest. Cached unless refresh=True."""
    global _cached
    with _lock:
        if _cached is not None and not refresh:
            return _cached
        raw = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
        _cached = RunnerManifest.model_validate(raw)
        return _cached
