# SPDX-License-Identifier: MIT
"""Tests for atomic JSON write — the crash-safety primitive for settings.json.

Phase 1.5 migrates everything else to SQLite, but settings.json stays atomic-JSON
forever (per CONTRACT.md). These tests guard the atomic-write semantics.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

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


def test_tmp_cleaned_up_when_unserializable(tmp_storage_dir: Path) -> None:
    """A serialization failure mid-write must not leave a `.tmp` turd behind.

    The stream now writes into the open tmp file, so an unserializable payload
    raises after the tmp exists — the cleanup path must remove it (and never
    touch/create the real target).
    """
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    with pytest.raises(TypeError):
        atomic_write_json(p, {"bad": object()})  # object() has no serializer
    leftovers = sorted(f.name for f in tmp_storage_dir.iterdir())
    assert leftovers == [], f"Stray files after failed write: {leftovers}"


def test_overwrite_preserved_when_new_payload_unserializable(
    tmp_storage_dir: Path,
) -> None:
    """A failed rewrite must leave the previously-written file intact."""
    tmp_storage_dir.mkdir(parents=True, exist_ok=True)
    p = tmp_storage_dir / "settings.json"
    atomic_write_json(p, {"a": 1})
    with pytest.raises(TypeError):
        atomic_write_json(p, {"bad": object()})
    # Old contents survive; no stray tmp.
    assert json.loads(p.read_text(encoding="utf-8")) == {"a": 1}
    assert sorted(f.name for f in tmp_storage_dir.iterdir()) == ["settings.json"]
