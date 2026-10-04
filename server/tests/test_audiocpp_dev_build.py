# SPDX-License-Identifier: MIT
"""`npm run dev` runs our audio.cpp checkout's own build (docs/dev/TASKS.md, "`npm run dev`
always runs the latest audio.cpp"): the server reads the build from JUSTVOICE_AUDIOCPP_BUILD,
runs it instead of the pinned release, offers every feature, shows it on the runtime row, and
installs only eSpeak NG for it."""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from justvoice.engines.audiocpp import dev_build, espeak, release, runtime


def _make_build(root: Path, *, cuda: bool = True, dirty: bool = False) -> Path:
    """A stand-in for ../audio.cpp/build/jv-dev: the server exe, the CMake cache, the info."""
    bin_dir = root / "audio.cpp" / "build" / "jv-dev" / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / dev_build.SERVER_EXE).write_bytes(b"x")
    (bin_dir.parent / "CMakeCache.txt").write_text(
        f"ENGINE_ENABLE_CUDA:BOOL={'ON' if cuda else 'OFF'}\nENGINE_ENABLE_VULKAN:BOOL=OFF\n")
    (bin_dir / "jv-dev-build.json").write_text(json.dumps(
        {"commit": "6a2bb4c5", "dirty": dirty, "source": "..\\audio.cpp"}))
    return bin_dir


@pytest.fixture()
def dev(monkeypatch, tmp_path):
    """The server pointed at a development build, with eSpeak NG installed."""
    bin_dir = _make_build(tmp_path)
    rt_root = tmp_path / "rt"
    monkeypatch.setenv(dev_build.ENV, str(bin_dir))
    monkeypatch.setattr(runtime, "_runtime_root", lambda: rt_root)
    monkeypatch.setattr(espeak, "paths", lambda root: (Path("lib.dll"), Path("data")))
    dev_build.current.cache_clear()
    runtime.forget_installed()
    yield bin_dir
    dev_build.current.cache_clear()
    runtime.forget_installed()


def test_without_the_variable_there_is_no_dev_build(monkeypatch):
    monkeypatch.delenv(dev_build.ENV, raising=False)
    dev_build.current.cache_clear()
    assert dev_build.current() is None


def test_a_packaged_app_ignores_it(dev, monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    dev_build.current.cache_clear()
    assert dev_build.current() is None


def test_a_folder_without_the_server_runs_the_pinned_release(monkeypatch, tmp_path):
    monkeypatch.setenv(dev_build.ENV, str(tmp_path))
    dev_build.current.cache_clear()
    assert dev_build.current() is None


def test_the_build_is_read_from_its_own_folder(dev):
    b = dev_build.current()
    assert (b.exe, b.backend, b.commit, b.source) == (dev / dev_build.SERVER_EXE, "cuda", "6a2bb4c5", "..\\audio.cpp")
    assert b.version == "dev · 6a2bb4c5"


def test_uncommitted_edits_show_in_the_version(monkeypatch, tmp_path):
    monkeypatch.setenv(dev_build.ENV, str(_make_build(tmp_path, cuda=False, dirty=True)))
    dev_build.current.cache_clear()
    b = dev_build.current()
    assert (b.version, b.backend) == ("dev · 6a2bb4c5 + local changes", "cpu")


def test_the_runtime_is_the_dev_build_with_every_feature(dev):
    exe = runtime.installed_exe()
    assert exe == dev / dev_build.SERVER_EXE and runtime.installed_tag() == "dev"
    assert runtime.backend_of(exe) == "cuda"
    assert all(runtime.has_feature(f) for f in release.FEATURES)
    assert all(release.pinned_has(f) for f in release.FEATURES)
    assert not runtime.has_feature("no_such_feature") and not release.pinned_has("no_such_feature")


def test_without_espeak_it_waits_for_install(dev, monkeypatch):
    monkeypatch.setattr(espeak, "paths", lambda root: None)
    runtime.forget_installed()
    assert runtime.installed_exe() is None


def test_the_catalogs_offer_what_the_dev_build_reads(dev):
    import justvoice.engines.chatterbox.manifest as cb
    import justvoice.engines.kokoro.manifest as kk

    try:
        importlib.reload(cb), importlib.reload(kk)
        assert {"he", "ru", "zh", "ja"} <= set(cb.VARIANTS[0]["languages"])
        assert len(kk.STATIC_VOICES) == 54
    finally:
        dev_build.current.cache_clear()
        import os

        os.environ.pop(dev_build.ENV, None)
        importlib.reload(cb), importlib.reload(kk)


def test_the_runtime_row_says_it_is_the_dev_build(dev, monkeypatch):
    from justvoice.api import speech_runtime_api

    class _Srv:
        _run = None
        pid = None

        def is_running(self):
            return False

    monkeypatch.setattr(runtime, "servers", lambda placement=None: [_Srv()])
    monkeypatch.setattr(runtime, "available_backends", lambda: ["cuda", "cpu"])
    monkeypatch.setattr(runtime, "_hardware", lambda: SimpleNamespace(gpus=[]))
    monkeypatch.setattr(runtime, "cpu_threads", lambda: 8)
    monkeypatch.setattr(runtime, "physical_cores", lambda: 8)
    monkeypatch.setattr(runtime, "_settings", lambda: SimpleNamespace(
        backend="vulkan", gpu=0, cpu_threads=0, cpu_min_realtime=2.0))
    info = speech_runtime_api._info()
    assert (info.installed, info.version, info.update_to, info.backend, info.build, info.dev_source) == (
        True, "dev · 6a2bb4c5", None, "cuda", None, "..\\audio.cpp")
    assert info.japanese_dictionary is not None          # the dev build reads Japanese


def test_install_fetches_only_espeak(dev, monkeypatch):
    from justvoice.engines import manager as mgr_mod

    calls: list = []
    monkeypatch.setattr(runtime, "install", lambda **kw: calls.append("binary"))
    monkeypatch.setattr(espeak, "install", lambda root, force=False: calls.append("espeak"))
    monkeypatch.setattr(mgr_mod, "_remove_replaced_build", lambda *a: calls.append("remove"))
    mgr_mod._install_audiocpp_runtime()
    assert calls == ["espeak"]


def test_the_leftover_sweep_covers_the_dev_build(dev):
    from justvoice.engines import leftovers

    roots = leftovers._audiocpp_roots()
    assert leftovers._engine_id_of([str(dev / dev_build.SERVER_EXE), "--config", "x"], roots) == "audiocpp"
    assert leftovers._engine_id_of(["C:\\elsewhere\\audiocpp_server.exe"], roots) is None


def test_the_wrapper_is_told_when_the_app_still_runs_it(dev, monkeypatch):
    """Before it builds, `npm run dev` stops servers whose JustVoice is gone and refuses (exit 3)
    while one still serves a running app — it holds the exe (decided D5)."""
    import psutil

    from justvoice.engines import leftovers

    stopped: list = []
    monkeypatch.setattr(leftovers, "stop_leftover_engines", lambda reason: stopped.append(reason) or [])
    procs = [SimpleNamespace(pid=11, info={"exe": "C:\\other\\x.exe"})]
    monkeypatch.setattr(psutil, "process_iter", lambda attrs: iter(procs))
    assert dev_build._stop_leftovers() == 0 and stopped == ["npm run dev"]
    procs.append(SimpleNamespace(pid=12, info={"exe": str(dev / dev_build.SERVER_EXE)}))
    assert dev_build._stop_leftovers() == 3
