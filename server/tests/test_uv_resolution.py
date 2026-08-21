# SPDX-License-Identifier: MIT
"""Engine installs must work for a user who has never heard of uv.

Engines cannot be baked into the installer — chatterbox alone pulls torch at
2.4 GB — so they are built on the user's machine at click-time, and that path
shells out to uv. Which means uv has to SHIP, and the code has to prefer the
shipped copy over whatever may or may not be on PATH.

Two bugs these tests exist to prevent, both of which were live:

1. `_check_uv_available()` only ever looked at PATH, while `tauri.conf.json`
   declared no `externalBin` — so a released build had an undeclared external
   dependency and told users to pipe an install script off the internet.

2. Both venv-creation calls passed `--python sys.executable`. In the shipped
   bundle that is the PyInstaller sidecar, not an interpreter: the call failed
   and fell through to a no-`--python` fallback where uv picked whatever it
   liked. Engine wheels are version-sensitive (torch cu124, numba/llvmlite ship
   per-Python builds), so "whatever uv found" silently produced environments
   the wheels were never built for.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from justvoice.engines import manager


def test_bundled_uv_beside_the_server_binary_wins_over_path(tmp_path, monkeypatch):
    """The shipped copy must win. A dev box with uv on PATH must not mask a
    broken bundle, and a user without uv on PATH must still get the bundled one."""
    exe = "uv.exe" if sys.platform == "win32" else "uv"
    bundled = tmp_path / exe
    bundled.write_text("#!/bin/sh\n", encoding="utf-8")

    monkeypatch.setattr(manager, "_uv_candidates", lambda: [bundled])
    monkeypatch.setattr(manager.shutil, "which", lambda _n: r"C:\somewhere\else\uv.exe")

    assert manager._check_uv_available() == str(bundled)


def test_falls_back_to_path_when_nothing_is_bundled(tmp_path, monkeypatch):
    """Dev checkouts have no bundled sidecar and must keep working."""
    monkeypatch.setattr(manager, "_uv_candidates", lambda: [tmp_path / "absent-uv"])
    monkeypatch.setattr(manager.shutil, "which", lambda _n: "/usr/local/bin/uv")

    assert manager._check_uv_available() == "/usr/local/bin/uv"


def test_missing_everywhere_raises_something_actionable(tmp_path, monkeypatch):
    monkeypatch.setattr(manager, "_uv_candidates", lambda: [tmp_path / "absent-uv"])
    monkeypatch.setattr(manager.shutil, "which", lambda _n: None)

    with pytest.raises(manager.InstallError) as e:
        manager._check_uv_available()
    msg = str(e.value)
    # A released build ships uv, so absence means a broken install — the message
    # must say so rather than only handing a dev a curl command.
    assert "reinstall" in msg.lower()
    assert "astral.sh" in msg


def test_candidates_probe_beside_sys_executable_first():
    """That directory is where Tauri puts an externalBin sidecar, and in a
    frozen build sys.executable IS the sidecar."""
    cands = manager._uv_candidates()
    assert cands, "there must be at least one place to look"
    assert cands[0].parent == Path(sys.executable).resolve().parent


def test_engine_python_is_pinned_not_the_running_interpreter():
    """The pin is the fix for bug 2. If someone reverts it to sys.executable
    this fails, because a frozen sidecar path is not a version string.

    3.13 since 2026-08-22, and the number itself does work: on 3.12
    chatterbox-tts's dependency marker asks for numpy<2, which cannot coexist
    with kokoro-onnx's numpy>=2.0.2; on 3.13 that marker flips and the
    conflict stops existing.
    """
    assert manager.ENGINE_PYTHON_VERSION == "3.13"
    assert not Path(manager.ENGINE_PYTHON_VERSION).is_absolute()


def test_venv_creation_passes_the_pin_and_has_no_silent_fallback(monkeypatch, tmp_path):
    """Assert the actual argv, and that a failed venv creation RAISES.

    The removed fallback is the point: turning a bad pin into an arbitrary
    Python version is worse than failing, because the failure is visible and
    the wrong environment is not.
    """
    calls: list[list[str]] = []

    class Result:
        returncode = 1
        stdout = ""
        stderr = "boom"

    def fake_run(argv, **kw):
        calls.append([str(a) for a in argv])
        return Result()

    module = type("M", (), {"ID": "myengine", "INSTALL": []})
    m = manager.EngineManifest(tmp_path / "myengine", module)

    monkeypatch.setattr(manager, "_check_uv_available", lambda: "uv")
    monkeypatch.setattr(manager.subprocess, "run", fake_run)

    with pytest.raises(manager.InstallError, match="uv venv failed"):
        manager.install_engine(m)

    assert len(calls) == 1, "a failed venv creation must not retry unpinned"
    argv = calls[0]
    assert "--python" in argv
    assert argv[argv.index("--python") + 1] == manager.ENGINE_PYTHON_VERSION
    assert sys.executable not in argv, "must not pin to the running interpreter"
