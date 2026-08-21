# SPDX-License-Identifier: MIT
"""The venv-wide dependency ceiling, and the regression that made it necessary.

Engine venvs are built one `uv pip install` at a time — every manifest INSTALL
step is its own resolution. A version pin declared by one step therefore holds
only until an unrelated later step re-resolves the same package, and nothing in
the manifest layer can see that happen.

It happened. The SDK currency refresh shipped with a bare `--reinstall`, which
reinstalls the WHOLE resolution rather than the named package; uv re-resolved
justvoice-plugin's unbounded `numpy>=1.24` to numpy 2.5.2 over a shared venv
where every engine had pinned `numpy<2.0`; and numba — pulled in by librosa,
which sits in the import chain of chatterbox-tts, qwen-tts, zipvoice and
hume-tada — refused to import: "Numba needs NumPy 2.0 or less. Got NumPy 2.5."
Every engine but Kokoro (sherpa-onnx, the one chain with no numba) failed to
load, and the failure surfaced as a 500 from voice preview, several layers away
from the pip command that caused it.

These tests pin both halves of the fix: the ceiling is applied at the ONE
install door, and the refresh can never again re-resolve packages it does not
own.
"""

from __future__ import annotations

import re

import pytest

from justvoice.engines import manager


# ─── The ceiling itself ───────────────────────────────────────────────


def test_constraints_file_ships_and_caps_numpy() -> None:
    """The file is data the installer depends on — a checkout missing it
    installs unconstrained, which is exactly the state this fixes."""
    assert manager.CONSTRAINTS_FILE.is_file(), (
        f"{manager.CONSTRAINTS_FILE} is missing — engine installs would run "
        "with no numpy ceiling"
    )
    text = manager.CONSTRAINTS_FILE.read_text(encoding="utf-8")
    numpy_lines = [
        ln.strip() for ln in text.splitlines()
        if ln.strip() and not ln.strip().startswith("#") and ln.strip().startswith("numpy")
    ]
    assert numpy_lines, "no numpy constraint declared"
    assert "<2.0" in numpy_lines[0], (
        f"numpy ceiling must stay below 2.0 while numba is pinned <0.61; got {numpy_lines[0]!r}"
    )


def test_constraint_args_are_absent_rather_than_fatal(monkeypatch, tmp_path) -> None:
    """A missing file degrades to the pre-ceiling behaviour, never an
    InstallError — refusing to install over a missing text file is the worse
    trade."""
    monkeypatch.setattr(manager, "CONSTRAINTS_FILE", tmp_path / "nope.txt")
    assert manager._constraint_args() == []

    present = tmp_path / "c.txt"
    present.write_text("numpy<2.0\n", encoding="utf-8")
    monkeypatch.setattr(manager, "CONSTRAINTS_FILE", present)
    assert manager._constraint_args() == ["--constraint", str(present)]


def test_no_manifest_declares_a_numpy_bound_the_ceiling_would_break() -> None:
    """Drift guard, both directions. An engine that genuinely needs numpy 2.x
    cannot silently coexist with the ceiling — it has to move numba first, and
    this test is where that conversation starts."""
    offenders: list[str] = []
    for eid, m in manager.discover_engines().items():
        if m.isolation == "venv":
            # Isolated venvs install without the ceiling (2026-08-19) —
            # kokoro's kokoro-onnx needs numpy>=2 and has no numba.
            continue
        for step in m.install_steps:
            for pkg in step.get("packages", []) or []:
                name = re.split(r"[<>=!~\[; ]", str(pkg), 1)[0].strip().lower()
                if name != "numpy":
                    continue
                if "<2" not in str(pkg):
                    offenders.append(f"{eid}: {pkg!r}")
    assert not offenders, (
        "manifest numpy pins disagree with constraints.txt — "
        f"{offenders}. Raising the ceiling means raising numba across every "
        "engine that pulls librosa."
    )


# ─── The ceiling is applied at the one door ───────────────────────────


def _capture_uv_pip(monkeypatch) -> list[list[str]]:
    """Run _run_uv_pip against a fake Popen and return the argv it built."""
    seen: list[list[str]] = []

    class FakeProc:
        stdout = iter(())

        def wait(self, timeout=None):
            return 0

        def poll(self):
            return 0

    def fake_popen(cmd, **kw):
        seen.append([str(c) for c in cmd])
        return FakeProc()

    monkeypatch.setattr(manager.subprocess, "Popen", fake_popen)
    return seen


def test_install_carries_the_constraint(monkeypatch, tmp_path) -> None:
    seen = _capture_uv_pip(monkeypatch)
    manager._run_uv_pip(
        "uv", tmp_path / "python.exe", ["pip", "install", "librosa"],
        lambda p, ln: None, lambda: None,
    )
    argv = seen[0]
    assert "--constraint" in argv, f"install ran without the ceiling: {argv}"
    assert argv[argv.index("--constraint") + 1] == str(manager.CONSTRAINTS_FILE)
    # It must precede the requirement, not trail it — uv reads the file as the
    # value of the flag, and a stray position would silently swallow a package.
    assert argv.index("--constraint") < argv.index("librosa")


def test_isolated_install_opts_out_of_the_constraint(monkeypatch, tmp_path) -> None:
    """Isolated venvs resolve their own world — the shared ceiling would
    make kokoro-onnx (numpy>=2) uninstallable, which is exactly how the
    kokoro venv build failed on 2026-08-19 before this scoping."""
    seen = _capture_uv_pip(monkeypatch)
    manager._run_uv_pip(
        "uv", tmp_path / "python.exe", ["pip", "install", "kokoro-onnx"],
        lambda p, ln: None, lambda: None, use_constraints=False,
    )
    assert "--constraint" not in seen[0]


def test_uninstall_does_not_carry_the_constraint(monkeypatch, tmp_path) -> None:
    """`uv pip uninstall` rejects --constraint; splicing it in unconditionally
    would break every uninstall path."""
    seen = _capture_uv_pip(monkeypatch)
    manager._run_uv_pip(
        "uv", tmp_path / "python.exe", ["pip", "uninstall", "librosa"],
        lambda p, ln: None, lambda: None,
    )
    assert "--constraint" not in seen[0]


# ─── The refresh never re-resolves what it does not own ───────────────


def test_plugin_refresh_scopes_its_reinstall(monkeypatch, tmp_path) -> None:
    """THE regression test. Bare `--reinstall` is what upgraded numpy under
    every engine; the refresh must name the one package it is refreshing."""
    venv = tmp_path / "venv"
    sp = venv / "Lib" / "site-packages"
    sp.mkdir(parents=True)
    # A STALE plugin, so the refresh actually runs.
    (sp / "justvoice_plugin-0.1.0.dist-info").mkdir()

    seen: list[list[str]] = []

    class Result:
        returncode = 0
        stdout = ""
        stderr = ""

    monkeypatch.setattr(manager, "_check_uv_available", lambda: "uv")
    monkeypatch.setattr(
        manager.subprocess, "run",
        lambda argv, **kw: (seen.append([str(a) for a in argv]), Result())[1],
    )

    manager._ensure_plugin_current(venv / "Scripts" / "python.exe")

    assert seen, "a stale plugin must be refreshed"
    argv = seen[0]
    assert "--reinstall" not in argv, (
        "bare --reinstall re-resolves the whole environment and clobbers the "
        f"engines' pins: {argv}"
    )
    assert "--reinstall-package" in argv
    assert argv[argv.index("--reinstall-package") + 1] == "justvoice-plugin"
    assert "--constraint" in argv, "the refresh must respect the venv ceiling too"


def test_current_plugin_is_not_reinstalled(monkeypatch, tmp_path) -> None:
    """Spawn calls this on every load; a matching dist-info must cost nothing."""
    venv = tmp_path / "venv"
    sp = venv / "Lib" / "site-packages"
    sp.mkdir(parents=True)
    (sp / f"justvoice_plugin-{manager.PLUGIN_VERSION}.dist-info").mkdir()

    def boom(*a, **kw):
        raise AssertionError("must not shell out when the SDK is current")

    monkeypatch.setattr(manager, "_check_uv_available", boom)
    manager._ensure_plugin_current(venv / "Scripts" / "python.exe")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__]))
