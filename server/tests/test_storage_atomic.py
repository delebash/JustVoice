# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for atomic JSON write — the crash-safety primitive for settings.json.

Phase 1.5 migrates everything else to SQLite, but settings.json stays atomic-JSON
forever (per CONTRACT.md). These tests guard the atomic-write semantics.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from justvoice.storage.atomic import write_json_atomic, read_json


def test_round_trip(tmp_storage_dir: Path) -> None:
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    data = {"x": 1, "y": [2, 3], "z": "ok"}
    write_json_atomic(p, data)
    assert read_json(p) == data


def test_overwrite(tmp_storage_dir: Path) -> None:
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    write_json_atomic(p, {"a": 1})
    write_json_atomic(p, {"a": 2})
    assert read_json(p) == {"a": 2}


def test_read_missing_returns_default(tmp_storage_dir: Path) -> None:
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "missing.json"
    assert read_json(p, default={"k": "v"}) == {"k": "v"}


def test_no_temp_file_left_behind(tmp_storage_dir: Path) -> None:
    """Atomic write should not leave .tmp/.partial siblings on success."""
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    write_json_atomic(p, {"a": 1})
    siblings = [f.name for f in tmp_storage_dir.iterdir()]
    # Only the final file should exist.
    assert siblings == ["settings.json"], f"Stray siblings: {siblings}"
