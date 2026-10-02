# SPDX-License-Identifier: MIT
"""Tests for engine manifests — discovery + required-field validation.

Every engine is a catalog: a manifest.py declaring its id, name,
capabilities and its model VARIANTS, each runnable in the speech runtime.
Discovery walks engines/<id>/manifest.py.
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


def test_every_engine_runs_in_the_speech_runtime(engine_id: str) -> None:
    """Since 2026-10-01 there is no per-engine program: an engine.py beside a
    manifest would be dead code, and a variant with no `audiocpp` block would
    have nothing to run it."""
    from justvoice.engines.manager import discover_engines

    assert not (ENGINES_DIR / engine_id / "engine.py").exists(), f"{engine_id} has a stray engine.py"
    m = next(m for m in discover_engines().values() if m.engine_dir.name == engine_id)
    assert m.uses_audiocpp, f"{engine_id}: a variant has no audiocpp block"


def test_at_least_one_engine_discovered() -> None:
    ids = _engine_ids()
    assert len(ids) >= 1, "Expected at least one engine to be discoverable"
