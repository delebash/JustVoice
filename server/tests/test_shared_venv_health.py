# SPDX-License-Identifier: MIT
"""The shared venv must be judged by whether its interpreter RUNS.

A venv is a few files plus a `pyvenv.cfg` naming the base Python it was built
from. Remove or upgrade that base and every file remains while the interpreter
is dead — on Windows it exits non-zero with `No Python at '<old path>'`.

Readiness used to be `python.exe`.is_file(), which is true for exactly that
corpse. The consequences compounded:

  1. `/v1/engines/setup` reported `ready: true`, so the GUI offered
     "Re-run setup" rather than "Set up engines".
  2. Re-running called `setup_shared_venv()` with no `force`, and
     `uv venv --allow-existing` reused the broken directory.
  3. So the only actual fix was deleting several gigabytes by hand.

Found for real on 2026-07-29: a venv built against `E:\\Python310` after that
install went away. It surfaced as a 502 from the first engine that tried to
load — several layers from the cause.

These tests fake the corpse rather than describing it, so they fail if the
check ever goes back to trusting file existence.
"""

from __future__ import annotations

import sys

import pytest

from justvoice.engines import manager


@pytest.fixture(autouse=True)
def _clean_health_cache():
    manager.invalidate_shared_venv_health()
    yield
    manager.invalidate_shared_venv_health()


def _fake_interpreter(tmp_path, *, works: bool):
    """A file that exists at the venv interpreter path and either runs or not."""
    exe = tmp_path / ("python.exe" if sys.platform == "win32" else "python")
    exe.write_text("not a real interpreter", encoding="utf-8")
    return exe


def test_a_present_but_dead_interpreter_is_not_healthy(tmp_path, monkeypatch):
    """The whole point. `exists` is true, `healthy` must be false."""
    exe = _fake_interpreter(tmp_path, works=False)
    monkeypatch.setattr(manager, "shared_venv_python", lambda: exe)

    assert manager.shared_venv_exists() is True, "file is on disk"
    assert manager.shared_venv_healthy() is False, (
        "a file that cannot execute must never be reported healthy — this is "
        "exactly the state that produced a 502 instead of 'venv needs setup'"
    )


def test_a_working_interpreter_is_healthy(monkeypatch):
    """Guard the other direction, so the check cannot just return False."""
    from pathlib import Path

    monkeypatch.setattr(manager, "shared_venv_python", lambda: Path(sys.executable))
    assert manager.shared_venv_healthy() is True


def test_a_missing_interpreter_is_not_healthy(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, "shared_venv_python", lambda: tmp_path / "nope.exe")
    assert manager.shared_venv_exists() is False
    assert manager.shared_venv_healthy() is False


def test_the_probe_is_cached(tmp_path, monkeypatch):
    """Readiness is polled by the GUI; spawning a process per poll is not free."""
    from pathlib import Path

    calls = {"n": 0}
    real_run = manager.subprocess.run

    def counting_run(*a, **kw):
        calls["n"] += 1
        return real_run(*a, **kw)

    monkeypatch.setattr(manager, "shared_venv_python", lambda: Path(sys.executable))
    monkeypatch.setattr(manager.subprocess, "run", counting_run)

    assert manager.shared_venv_healthy() is True
    assert manager.shared_venv_healthy() is True
    assert manager.shared_venv_healthy() is True
    assert calls["n"] == 1, "the interpreter should be probed once, then cached"


def test_invalidating_the_cache_forces_a_re_probe(tmp_path, monkeypatch):
    """Without this, a venv rebuilt during the session stays 'broken' forever."""
    from pathlib import Path

    monkeypatch.setattr(manager, "shared_venv_python", lambda: Path(sys.executable))
    assert manager.shared_venv_healthy() is True

    # Now point at a corpse and invalidate — the verdict must change.
    exe = _fake_interpreter(tmp_path, works=False)
    monkeypatch.setattr(manager, "shared_venv_python", lambda: exe)
    assert manager.shared_venv_healthy() is True, "still cached, as designed"
    manager.invalidate_shared_venv_health()
    assert manager.shared_venv_healthy() is False, "re-probed after invalidation"


def test_setup_status_reports_broken_separately(monkeypatch):
    """`ready: false` alone cannot tell the GUI whether to say "set up" or
    "rebuild" — a user who already ran setup needs the second sentence."""
    from justvoice.api import engines_models_api as api

    monkeypatch.setattr(api, "detect_gpu", lambda: ("none", None, "CPU"))
    monkeypatch.setattr(manager, "shared_venv_exists", lambda: True)
    monkeypatch.setattr(manager, "shared_venv_healthy", lambda: False)

    import anyio

    out = anyio.run(api.get_setup_status)
    assert out["ready"] is False
    assert out["venv_broken"] is True
