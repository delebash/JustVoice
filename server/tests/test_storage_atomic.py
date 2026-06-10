# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for atomic JSON write — the crash-safety primitive for settings.json.

Phase 1.5 migrates everything else to SQLite, but settings.json stays atomic-JSON
forever (per CONTRACT.md). These tests guard the atomic-write semantics.
"""

from __future__ import annotations

import json
from pathlib import Path

from justvoice.storage.atomic import atomic_write_json


def test_round_trip(tmp_storage_dir: Path) -> None:
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    data = {"x": 1, "y": [2, 3], "z": "ok"}
    atomic_write_json(p, data)
    assert json.loads(p.read_text(encoding="utf-8")) == data


def test_overwrite(tmp_storage_dir: Path) -> None:
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    atomic_write_json(p, {"a": 1})
    atomic_write_json(p, {"a": 2})
    assert json.loads(p.read_text(encoding="utf-8")) == {"a": 2}


def test_no_temp_file_left_behind(tmp_storage_dir: Path) -> None:
    """Atomic write should not leave .tmp/.partial siblings on success."""
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    atomic_write_json(p, {"a": 1})
    siblings = [f.name for f in tmp_storage_dir.iterdir()]
    # Only the final file should exist.
    assert siblings == ["settings.json"], f"Stray siblings: {siblings}"
