# SPDX-License-Identifier: MIT
"""Tests for engine manifests — discovery + required-field validation.

Every engine plugin must have a manifest.py declaring its id, name,
capabilities, and install steps. Discovery walks engines/<id>/manifest.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ENGINES_DIR = Path(__file__).resolve().parent.parent / "justvoice" / "engines"


def _engine_ids() -> list[str]:
    return [
        d.name
        for d in ENGINES_DIR.iterdir()
        if d.is_dir() and not d.name.startswith("_") and not d.name.startswith(".")
        and (d / "manifest.py").exists()
    ]


@pytest.fixture(params=_engine_ids())
def engine_id(request) -> str:
    return request.param


def test_manifest_imports_cleanly(engine_id: str) -> None:
    import importlib.util

    manifest_path = ENGINES_DIR / engine_id / "manifest.py"
    spec = importlib.util.spec_from_file_location(
        f"justvoice.engines.{engine_id}.manifest", manifest_path
    )
    assert spec is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Sanity-check the manifest exposes the required surface.
    assert hasattr(mod, "ID"), f"{engine_id} manifest missing ID"
    assert hasattr(mod, "NAME"), f"{engine_id} manifest missing NAME"
    assert isinstance(getattr(mod, "ID"), str)
    assert isinstance(getattr(mod, "NAME"), str)


def test_engine_dir_has_engine_py(engine_id: str) -> None:
    p = ENGINES_DIR / engine_id / "engine.py"
    assert p.exists(), f"{engine_id} missing engine.py"


def test_at_least_one_engine_discovered() -> None:
    ids = _engine_ids()
    assert len(ids) >= 1, "Expected at least one engine to be discoverable"
