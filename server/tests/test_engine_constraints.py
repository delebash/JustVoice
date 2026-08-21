# SPDX-License-Identifier: MIT
"""What constrains an engine environment now: the family torch pin.

Until 2026-08-22 this file guarded a venv-wide `--constraint` ceiling. That
ceiling existed because every core engine resolved into ONE interpreter, so a
pin declared by one engine's install step could be re-resolved by another's,
and the tightest bound anywhere won for everyone. Per-engine venvs removed the
mechanism, and the ceiling with it.

One constraint replaced it, and it is a real one. Every engine that installs
torch must name the SAME torch and torchaudio versions. Not for tidiness — for
disk. uv fills a venv by hardlinking out of its cache, so venvs that agree
about torch share one copy of it rather than each holding their own. Measured
2026-08-22 with all five engines installed: the venvs report 5,284 MB between
them, but deduped against the cache they link into they add only 431 MB —
against 18,750 MB if nothing were shared. A single engine pinning a different
torch costs a second full CUDA stack instead: +4.3 GB. Divergence is therefore
a deliberate act, and this file is where it has to be argued for.

Deprecated engines are exempt. They are hidden, never offered, and frozen at
whatever they last declared — TADA sits on torch 2.7.0 for exactly that reason.
Un-deprecating one means bringing it onto the family pin here.

The second half of the file guards the SDK currency refresh, which is what
originally made a ceiling necessary: a bare `--reinstall` re-resolved numpy to
2.5.2 across an environment pinned below 2.0, and librosa's numba refused to
import — surfacing as a 500 from voice preview, several layers from the pip
command that caused it. The refresh must still name the one package it owns.
"""

from __future__ import annotations

import re

import pytest

from justvoice.engines import manager


def _torch_pins(steps) -> list[str]:
    """Every package string from an engine's `torch` install steps."""
    out: list[str] = []
    for step in steps:
        if step.get("kind") != "torch":
            continue
        version = step.get("version")
        for pkg in step.get("packages") or []:
            out.append(f"{pkg}=={version}" if version and "=" not in pkg else str(pkg))
    return out


# ─── The family torch pin ─────────────────────────────────────────────


def test_every_live_engine_names_the_same_torch() -> None:
    """THE guard. Two engines on different torch versions = +4.3 GB on disk
    and two CUDA stacks to keep working."""
    pins: dict[str, list[str]] = {}
    for eid, m in manager.discover_engines().items():
        if (m.deprecated or "").strip():
            continue
        found = _torch_pins(m.install_steps)
        if found:
            pins[eid] = sorted(found)

    assert pins, "no engine declares a torch step — did the step kind get renamed?"
    distinct = {tuple(v) for v in pins.values()}
    assert len(distinct) == 1, (
        "engines disagree about torch, which costs a full second CUDA stack "
        f"on disk: {pins}. Moving one engine off the family pin is a "
        "deliberate decision — change this test in the same PR."
    )


def test_the_family_pin_is_exact_and_names_torchaudio() -> None:
    """A range would let two machines resolve differently and quietly undo
    the sharing; torchaudio has to be named because leaving it loose lets pip
    pick one built against a different torch."""
    for eid, m in manager.discover_engines().items():
        if (m.deprecated or "").strip():
            continue
        found = _torch_pins(m.install_steps)
        if not found:
            continue
        names = {re.split(r"[<>=!~ ]", p, 1)[0].strip().lower() for p in found}
        assert names == {"torch", "torchaudio"}, (
            f"{eid} torch step should install exactly torch + torchaudio; got {found}"
        )
        for pkg in found:
            assert "==" in pkg, (
                f"{eid} pins torch loosely ({pkg!r}) — two machines would "
                "resolve differently and stop sharing the cached wheels"
            )


def test_the_pin_is_a_version_the_wheel_indexes_actually_carry() -> None:
    """The pin and the index have to agree, and this pairing is render-proven
    (chatterbox on CUDA, 2026-08-22). Bumping either alone is how AMD-on-Linux
    became uninstallable: the manifests asked for torch 2.6.0 while the
    hardcoded rocm6.2 index stopped at 2.5.1."""
    for m in manager.discover_engines().values():
        if (m.deprecated or "").strip():
            continue
        found = _torch_pins(m.install_steps)
        if found:
            assert sorted(found) == ["torch==2.13.0", "torchaudio==2.11.0"], found
            break
    for url in (manager.TORCH_INDEX_CUDA12,
                manager.TORCH_INDEX_CUDA13,
                manager.TORCH_INDEX_ROCM):
        assert url.startswith("https://download.pytorch.org/whl/")
        assert "cu124" not in url and "rocm6.2" not in url, (
            f"{url} is a dead index: cu124 stops at torch 2.6.0 (no Blackwell), "
            "rocm6.2 stops at 2.5.1"
        )


# ─── No ceiling survives ──────────────────────────────────────────────


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


def test_installs_carry_no_constraint_file(monkeypatch, tmp_path) -> None:
    """Re-introducing a ceiling must be deliberate. Its old content (numpy<2)
    is now actively wrong: kokoro-onnx needs numpy>=2.0.2, and on Python 3.13
    chatterbox-tts asks for numpy>=2 itself."""
    seen = _capture_uv_pip(monkeypatch)
    manager._run_uv_pip(
        "uv", tmp_path / "python.exe", ["pip", "install", "librosa"],
        lambda p, ln: None, lambda: None,
    )
    assert "--constraint" not in seen[0], seen[0]


def test_uv_calls_pin_the_cache_beside_the_venvs(monkeypatch, tmp_path) -> None:
    """A cache on another volume cannot be hardlinked from, so uv silently
    falls back to copying whole wheels — the difference between five engine
    venvs adding 431 MB and adding 18.7 GB, both measured 2026-08-22."""
    monkeypatch.delenv("UV_CACHE_DIR", raising=False)
    monkeypatch.delenv("UV_PYTHON_INSTALL_DIR", raising=False)
    env = manager._uv_env()
    root = manager.engines_runtime_root()
    assert env["UV_CACHE_DIR"] == str(root / ".uv-cache")
    assert env["UV_PYTHON_INSTALL_DIR"] == str(root / ".uv-python")

    # A user who set their own keeps it.
    monkeypatch.setenv("UV_CACHE_DIR", str(tmp_path / "mine"))
    assert manager._uv_env()["UV_CACHE_DIR"] == str(tmp_path / "mine")


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
