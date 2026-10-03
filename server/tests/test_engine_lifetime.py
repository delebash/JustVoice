# SPDX-License-Identifier: MIT
"""The speech runtime never outlives its server (decided 2026-09-29; the runtime
since the 2026-10-01 switch).

The 2026-09-29 finding: five engine pairs orphaned by hard-killed servers
survived four restarts, one holding 1.6 GB of the 8 GB card, and the app's
language model could no longer load its MTP draft. Every speech model now runs
in ONE audio.cpp server process, and the four parts are pinned here with REAL
processes where it matters:

1. on Windows the runtime sits in the kit's kill-on-close Job Object
   (`llm_runner.runner.process.spawn_child`), so it dies with its server
   however the server dies;
2. a startup sweep stops this install's runtime whose server is gone
   (`engines/leftovers.py`);
3. POST /v1/shutdown — the shell's clean close;
4. GET/POST /v1/engines/leftovers — what the boot splash's button calls.

(Until the switch part 1 was each Python engine watching JUSTVOICE_SERVER_PID
itself — `justvoice_plugin.lifetime`, gone with the engines.)
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.engines import leftovers


def _sleeper(seconds: float, *extra: str, env: dict | None = None) -> subprocess.Popen:
    return subprocess.Popen(
        [sys.executable, "-c", f"import time; time.sleep({seconds})", *extra],
        env={**os.environ, **(env or {})},
    )


def _dead_pid() -> int:
    p = _sleeper(0)
    p.wait(timeout=30)
    return p.pid


def _wait_exit(p: subprocess.Popen, timeout: float) -> float | None:
    start = time.monotonic()
    try:
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    return time.monotonic() - start


def _alive(pid: int) -> bool:
    psutil = pytest.importorskip("psutil")
    try:
        return psutil.Process(pid).is_running() and psutil.Process(pid).status() != "zombie"
    except psutil.NoSuchProcess:
        return False


# ── 1. the runtime dies with its server ─────────────────────────────────────


@pytest.mark.skipif(sys.platform != "win32", reason="the Job Object is the Windows arm")
def test_the_runtime_dies_when_its_server_is_hard_killed():
    """End to end, the way the app spawns it: a stand-in server spawns a
    stand-in runtime through the kit's spawn seam, then the server is killed the
    hard way (TerminateProcess — no atexit, no shutdown hook). The runtime must
    be gone a moment later."""
    server_code = (
        "import functools, subprocess, sys, time\n"
        "from llm_runner.runner.process import spawn_child\n"
        "popen = functools.partial(subprocess.Popen)\n"
        "proc, job = spawn_child(popen, [sys.executable, '-c', 'import time; time.sleep(120)'], None)\n"
        "print(proc.pid, flush=True)\n"
        "time.sleep(120)\n"
    )
    server = subprocess.Popen([sys.executable, "-c", server_code], stdout=subprocess.PIPE, text=True)
    child = None
    try:
        child = int(server.stdout.readline().strip())
        assert _alive(child), "the runtime must run while its server lives"
        server.kill()
        server.wait(timeout=10)
        deadline = time.monotonic() + 10
        while _alive(child) and time.monotonic() < deadline:
            time.sleep(0.2)
        assert not _alive(child), "the runtime outlived its server"
    finally:
        if server.poll() is None:
            server.kill()
        if child and _alive(child):
            import psutil

            psutil.Process(child).kill()


# ── 2. the startup sweep ────────────────────────────────────────────────────


FAKE = "--jv-fake-runtime"


@pytest.fixture
def runtime_root(monkeypatch):
    """A sleeping python tagged FAKE counts as the runtime — the sweep's
    server-gone logic under test, without a real binary. (Matching on this
    interpreter's folder would also match pytest itself, the fake's parent, and
    the sweep rightly skips a child of another runtime.)"""
    monkeypatch.setattr(leftovers, "_engine_id_of",
                        lambda cmdline, roots: "audiocpp" if FAKE in cmdline else None)


def _fake_runtime(server_pid: int) -> subprocess.Popen:
    return _sleeper(120, FAKE, env={"JUSTVOICE_SERVER_PID": str(server_pid)})


def test_a_runtime_whose_server_is_gone_is_a_leftover(runtime_root):
    pytest.importorskip("psutil")
    rt = _fake_runtime(_dead_pid())
    try:
        time.sleep(0.5)
        found = [lo for lo in leftovers.find_leftover_engines(measure=False) if lo.pid == rt.pid]
        assert len(found) == 1 and found[0].engine_id == "audiocpp"
    finally:
        rt.kill()
        rt.wait(timeout=10)


def test_a_runtime_whose_server_lives_is_never_touched(runtime_root):
    """Another JustVoice server on this install (the renderer gate runs one)
    keeps its runtime — and so does this one."""
    pytest.importorskip("psutil")
    server = _sleeper(120)
    theirs, ours = _fake_runtime(server.pid), _fake_runtime(os.getpid())
    try:
        time.sleep(0.5)
        pids = {lo.pid for lo in leftovers.find_leftover_engines(measure=False)}
        assert theirs.pid not in pids
        assert ours.pid not in pids
    finally:
        for p in (theirs, ours, server):
            p.kill()
            p.wait(timeout=10)


def test_only_a_binary_under_this_installs_runtime_folder_counts():
    root = (os.path.normcase("C:\\data\\engines-runtime\\audiocpp"),)
    assert leftovers._engine_id_of(
        ["C:\\data\\engines-runtime\\audiocpp\\v0.9.0\\cuda12\\audiocpp_server.exe", "--config", "x"],
        root) == "audiocpp"
    assert leftovers._engine_id_of(["C:\\elsewhere\\audiocpp_server.exe"], root) is None
    assert leftovers._engine_id_of(["python", "E:/x/engines/kokoro/engine.py", "serve"], root) is None
    assert leftovers._engine_id_of([], root) is None


def test_stop_kills_the_tree_and_reports_what_it_freed(monkeypatch, caplog):
    pytest.importorskip("psutil")
    rt = _fake_runtime(_dead_pid())
    lo = leftovers.Leftover(pid=rt.pid, engine_id="audiocpp", started=time.time(),
                            server_pid=1, pids=[rt.pid], gpu_mb=1295)
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: [lo])
    try:
        with caplog.at_level("WARNING", logger="justvoice.engines.leftovers"):
            out = leftovers.stop_leftover_engines("startup sweep")
        assert out == [lo]
        assert _wait_exit(rt, timeout=10) is not None
        assert "audiocpp pid" in caplog.text and "1295" in caplog.text
    finally:
        if rt.poll() is None:
            rt.kill()
            rt.wait(timeout=10)


def test_gpu_is_measured_with_one_whole_machine_query(monkeypatch):
    """Not the per-tree probe (a counter query per pid on Windows, ~1 s each —
    the sweep runs at startup)."""
    import llm_runner.runner.hardware as hw

    calls = []
    monkeypatch.setattr(hw, "gpu_processes", lambda fresh=False: calls.append(fresh) or {
        "processes": [{"pid": 10, "memMb": 4}, {"pid": 11, "memMb": 1291}, {"pid": 99, "memMb": 500}]})
    assert leftovers._gpu_by_pid() == {10: 4, 11: 1291, 99: 500}
    assert calls == [True]


# ── 3. POST /v1/shutdown ────────────────────────────────────────────────────


@pytest.fixture
def app(tmp_path):
    return create_app(data_dir=tmp_path)


def test_shutdown_is_refused_from_another_machine(app):
    c = TestClient(app, raise_server_exceptions=False, client=("192.168.1.20", 50000))
    assert c.post("/v1/shutdown").status_code == 403


def test_shutdown_stops_engines_and_ends_the_server(app, monkeypatch):
    from justvoice.api import system_api
    from justvoice.engines import manager

    stopped, timers = [], []
    monkeypatch.setattr(manager, "shutdown_manager", lambda: stopped.append(True))

    class _Timer:  # never the real one: it would os._exit this test run
        def __init__(self, s, fn, args=()):
            timers.append((s, fn))
            self.daemon = False

        def start(self):
            pass

    monkeypatch.setattr(system_api.threading, "Timer", _Timer)
    server = SimpleNamespace(should_exit=False)
    app.state.uvicorn_server = server

    r = TestClient(app, client=("127.0.0.1", 50000)).post("/v1/shutdown")
    assert r.status_code == 200 and r.json() == {"ok": True, "exiting": True}
    assert stopped == [True], "engines stop before the server goes"
    assert server.should_exit is True
    assert timers and timers[0][1] is os._exit, "a stalled exit still ends"


def test_shutdown_without_a_server_handle_only_stops_engines(app, monkeypatch):
    from justvoice.engines import manager

    stopped = []
    monkeypatch.setattr(manager, "shutdown_manager", lambda: stopped.append(True))
    r = TestClient(app, client=("127.0.0.1", 50000)).post("/v1/shutdown")
    assert r.json() == {"ok": True, "exiting": False}
    assert stopped == [True]


# ── 4. the endpoints behind the splash's button ────────────────────────────


def _two_runtimes():
    return [
        leftovers.Leftover(pid=10, engine_id="audiocpp", started=1.0, server_pid=7, pids=[10], gpu_mb=1295),
        leftovers.Leftover(pid=20, engine_id="audiocpp", started=2.0, server_pid=8, pids=[20], gpu_mb=286),
    ]


def test_leftovers_endpoint_names_the_engine_and_sums_the_memory(app, monkeypatch):
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: _two_runtimes())
    body = TestClient(app).get("/v1/engines/leftovers").json()
    assert body["gpu_mb"] == 1581
    assert [(r["pid"], r["engine_name"], r["gpu_mb"]) for r in body["leftovers"]] == [
        (10, "Speech runtime", 1295), (20, "Speech runtime", 286)]


def test_unmeasurable_memory_is_null_not_zero(app, monkeypatch):
    rows = _two_runtimes()
    for lo in rows:
        lo.gpu_mb = None
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: rows)
    assert TestClient(app).get("/v1/engines/leftovers").json()["gpu_mb"] is None


def test_stop_endpoint_reports_what_it_stopped(app, monkeypatch):
    seen = []
    monkeypatch.setattr(leftovers, "stop_leftover_engines",
                        lambda reason="": seen.append(reason) or _two_runtimes())
    body = TestClient(app).post("/v1/engines/leftovers/stop").json()
    assert [r["pid"] for r in body["leftovers"]] == [10, 20]
    assert seen == ["stopped from the app"]


# ── 5. The close works with "Require a token even on localhost" on (2026-09-30) ──


def test_shutdown_needs_no_token_from_this_machine(app, monkeypatch):
    from justvoice.api import system_api
    from justvoice.engines import manager

    stopped = []
    monkeypatch.setattr(manager, "shutdown_manager", lambda: stopped.append(True))
    monkeypatch.setattr(system_api.threading, "Timer",
                        lambda *a, **k: SimpleNamespace(start=lambda: None, daemon=False))
    local = TestClient(app, raise_server_exceptions=False, client=("127.0.0.1", 50000))
    r = local.patch("/v1/settings", json={"auth": {"tokens": ["t0k"], "require_for_loopback": True}})
    assert r.status_code == 200, r.text
    assert local.get("/v1/settings").status_code == 401          # the setting is really on

    assert local.post("/v1/shutdown").status_code == 200         # the shell's close, no token
    assert stopped == [True]
    remote = TestClient(app, raise_server_exceptions=False, client=("192.168.1.20", 50000))
    assert remote.post("/v1/shutdown").status_code == 401
