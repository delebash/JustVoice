# SPDX-License-Identifier: MIT
"""Engine processes never outlive their server (decided 2026-09-29).

The evening's finding: five engine pairs (Kokoro ×3, Whisper ×2) orphaned by
hard-killed servers survived four restarts, Whisper holding 1.6 GB of the 8 GB
card, and the app's language model could no longer load its MTP draft. The
four parts, each pinned here with REAL processes where it matters:

1. every engine watches the server that started it and exits when it goes
   (`justvoice_plugin.lifetime`, driven by JUSTVOICE_SERVER_PID);
2. a startup sweep stops this install's engines whose server is gone
   (`engines/leftovers.py`);
3. POST /v1/shutdown — the shell's clean close;
4. GET/POST /v1/engines/leftovers — what the boot splash's button calls.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.engines import leftovers
from justvoice.engines.manager import ENGINES_DIR

LIFETIME_PY = Path(__file__).resolve().parents[1] / "justvoice_plugin" / "justvoice_plugin" / "lifetime.py"


def _lifetime():
    spec = importlib.util.spec_from_file_location("jv_lifetime_under_test", LIFETIME_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


# ── 1. the engine's own watch ───────────────────────────────────────────────


def test_server_alive_follows_a_real_process():
    lt = _lifetime()
    p = _sleeper(30)
    try:
        assert lt.server_alive(p.pid) is True
    finally:
        p.kill()
        p.wait(timeout=10)
    assert lt.server_alive(p.pid) is False


@pytest.mark.skipif(sys.platform != "win32", reason="Windows OpenProcess refusal")
def test_a_server_we_may_not_open_is_never_taken_for_gone():
    """OpenProcess refused for a reason other than "no such process" (here:
    the System process, which a user process may not open) means we can't
    tell — and an engine must never exit on a guess."""
    lt = _lifetime()
    h = lt._ServerHandle(4)
    assert h._unknowable is True and h.alive() is True
    assert lt._ServerHandle(_dead_pid())._unknowable is False


def test_no_server_pid_means_no_watch(monkeypatch):
    """An engine run by hand (or by an older host) has no variable: no watch,
    never an exit."""
    lt = _lifetime()
    monkeypatch.delenv(lt.ENV_SERVER_PID, raising=False)
    assert lt.watch_server() is None


def test_an_engine_exits_within_seconds_of_its_server_dying():
    """The whole point, end to end: a stand-in server, a stand-in engine that
    calls watch_server() exactly as the plugin's serve() does, then the server
    is killed the hard way — the engine is gone a few seconds later."""
    server = _sleeper(120)
    engine_code = (
        "import importlib.util, time\n"
        f"spec = importlib.util.spec_from_file_location('lt', r'{LIFETIME_PY}')\n"
        "lt = importlib.util.module_from_spec(spec); spec.loader.exec_module(lt)\n"
        "lt.CHECK_EVERY_S = 0.2\n"
        "lt.watch_server()\n"
        "time.sleep(120)\n"
    )
    engine = subprocess.Popen([sys.executable, "-c", engine_code],
                              env={**os.environ, "JUSTVOICE_SERVER_PID": str(server.pid)})
    try:
        time.sleep(1.5)
        assert engine.poll() is None, "the engine must keep running while its server lives"
        server.kill()
        server.wait(timeout=10)
        took = _wait_exit(engine, timeout=15)
        assert took is not None, "the engine outlived its server"
        assert engine.returncode == 0
    finally:
        for p in (engine, server):
            if p.poll() is None:
                p.kill()
                p.wait(timeout=10)


# ── 2. the startup sweep ────────────────────────────────────────────────────


def _engine_script() -> str:
    """A real engine.py of this install — what a leftover's command line runs."""
    for d in sorted(Path(ENGINES_DIR).iterdir()):
        if (d / "engine.py").is_file():
            return str(d / "engine.py")
    pytest.skip("no engine.py in this install")


def _fake_engine(server_pid: int) -> subprocess.Popen:
    # `python -c <sleep> <engines>/<id>/engine.py serve`: the command line an
    # engine has, without running one.
    return _sleeper(120, _engine_script(), "serve", env={"JUSTVOICE_SERVER_PID": str(server_pid)})


def test_an_engine_whose_server_is_gone_is_a_leftover():
    pytest.importorskip("psutil")
    eng = _fake_engine(_dead_pid())
    try:
        time.sleep(0.5)
        found = [lo for lo in leftovers.find_leftover_engines(measure=False) if lo.pid == eng.pid]
        assert len(found) == 1
        assert found[0].engine_id == Path(_engine_script()).parent.name
    finally:
        eng.kill()
        eng.wait(timeout=10)


def test_an_engine_whose_server_lives_is_never_touched():
    """Another JustVoice server on this install (the renderer gate runs one)
    keeps its engines — and so does this one."""
    pytest.importorskip("psutil")
    server = _sleeper(120)
    theirs, ours = _fake_engine(server.pid), _fake_engine(os.getpid())
    try:
        time.sleep(0.5)
        pids = {lo.pid for lo in leftovers.find_leftover_engines(measure=False)}
        assert theirs.pid not in pids
        assert ours.pid not in pids
    finally:
        for p in (theirs, ours, server):
            p.kill()
            p.wait(timeout=10)


def test_a_process_that_only_mentions_engine_py_is_not_an_engine():
    scripts = {os.path.normcase("E:/x/engines/kokoro/engine.py"): "kokoro"}
    assert leftovers._engine_id_of(["python", "E:/x/engines/kokoro/engine.py", "serve"], scripts) == "kokoro"
    assert leftovers._engine_id_of(["python", "E:/x/engines/kokoro/engine.py", "install"], scripts) is None
    assert leftovers._engine_id_of(["python", "E:/other/engine.py", "serve"], scripts) is None


def test_stop_kills_the_tree_and_reports_what_it_freed(monkeypatch, caplog):
    pytest.importorskip("psutil")
    eng = _fake_engine(_dead_pid())
    lo = leftovers.Leftover(pid=eng.pid, engine_id="whisper", started=time.time(),
                            server_pid=1, pids=[eng.pid], gpu_mb=1295)
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: [lo])
    try:
        with caplog.at_level("WARNING", logger="justvoice.engines.leftovers"):
            out = leftovers.stop_leftover_engines("startup sweep")
        assert out == [lo]
        assert _wait_exit(eng, timeout=10) is not None
        assert "whisper pid" in caplog.text and "1295" in caplog.text
    finally:
        if eng.poll() is None:
            eng.kill()
            eng.wait(timeout=10)


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


def _two_whispers():
    return [
        leftovers.Leftover(pid=10, engine_id="whisper", started=1.0, server_pid=7, pids=[10, 11], gpu_mb=1295),
        leftovers.Leftover(pid=20, engine_id="whisper", started=2.0, server_pid=8, pids=[20, 21], gpu_mb=286),
    ]


def test_leftovers_endpoint_names_the_engine_and_sums_the_memory(app, monkeypatch):
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: _two_whispers())
    body = TestClient(app).get("/v1/engines/leftovers").json()
    assert body["gpu_mb"] == 1581
    assert [(r["pid"], r["engine_name"], r["gpu_mb"]) for r in body["leftovers"]] == [
        (10, "Whisper STT", 1295), (20, "Whisper STT", 286)]


def test_unmeasurable_memory_is_null_not_zero(app, monkeypatch):
    rows = _two_whispers()
    for lo in rows:
        lo.gpu_mb = None
    monkeypatch.setattr(leftovers, "find_leftover_engines", lambda **k: rows)
    assert TestClient(app).get("/v1/engines/leftovers").json()["gpu_mb"] is None


def test_stop_endpoint_reports_what_it_stopped(app, monkeypatch):
    seen = []
    monkeypatch.setattr(leftovers, "stop_leftover_engines",
                        lambda reason="": seen.append(reason) or _two_whispers())
    body = TestClient(app).post("/v1/engines/leftovers/stop").json()
    assert [r["pid"] for r in body["leftovers"]] == [10, 20]
    assert seen == ["stopped from the app"]
