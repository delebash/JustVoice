# SPDX-License-Identifier: MIT
"""Engine processes left behind by a server that is gone — found, measured,
stopped (decided 2026-09-29).

An engine subprocess is `<engines>/<id>/.venv/python engine.py serve`; on
Windows the venv `python.exe` is uv's launcher and the real interpreter is its
CHILD (the launcher-shim fact), so one engine is a two-process tree. When its
server is hard-killed the tree keeps running and keeps its GPU memory — five
such trees held 1.6 GB on 2026-09-29 and the app's language model could no
longer load. Since plugin 0.3.0 an engine exits by itself when its server goes
(`justvoice_plugin.lifetime`); this module is the sweep for everything that
predates that, or slipped past it:

  - run once when the server starts (`stop_leftover_engines`, from app.py);
  - `GET /v1/engines/leftovers` / `POST /v1/engines/leftovers/stop`, which the
    boot splash's failed-load box offers as a button.

Only THIS install's engines are touched: a process counts only when its
command line runs one of our `engine.py` files. An engine whose server is
alive is never touched — that includes a second JustVoice server on the same
install (the renderer gate runs one).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class Leftover:
    pid: int                      # the tree's root (the venv launcher on Windows)
    engine_id: str
    started: float                # epoch seconds
    server_pid: int | None        # who started it, when known
    pids: list[int] = field(default_factory=list)   # the whole tree, root first
    gpu_mb: int | None = None


def _engine_scripts() -> dict[str, str]:
    """normcase(path of each engine.py) → engine id, for this install."""
    from .manager import ENGINES_DIR

    out: dict[str, str] = {}
    for d in Path(ENGINES_DIR).iterdir():
        f = d / "engine.py"
        if f.is_file():
            out[os.path.normcase(str(f))] = d.name
    return out


def _engine_id_of(cmdline: list[str], scripts: dict[str, str]) -> str | None:
    if "serve" not in cmdline:
        return None
    for arg in cmdline:
        eid = scripts.get(os.path.normcase(arg))
        if eid:
            return eid
    return None


def _server_gone(proc, psutil) -> tuple[bool, int | None]:
    """(gone?, server pid). The server pid comes from the engine's environment
    (`JUSTVOICE_SERVER_PID`, plugin 0.3.0+); a pid that now belongs to a
    process started AFTER the engine was recycled, so that server is gone too.
    Older engines carry no variable: their launcher's parent is the server."""
    server_pid = None
    try:
        raw = (proc.environ() or {}).get("JUSTVOICE_SERVER_PID", "")
        server_pid = int(raw) if raw.strip().isdigit() else None
    except Exception:  # noqa: BLE001 — environ() can be refused; fall back to the parent
        server_pid = None
    if server_pid is None:
        server_pid = proc.ppid()
    if server_pid == os.getpid():
        return False, server_pid
    try:
        server = psutil.Process(server_pid)
        if server.create_time() > proc.create_time() + 1:
            return True, server_pid           # pid recycled after the engine started
        return (not server.is_running()), server_pid
    except (psutil.NoSuchProcess, psutil.ZombieProcess):
        return True, server_pid
    except psutil.AccessDenied:
        return False, server_pid              # can't tell → leave it alone


def find_leftover_engines(*, measure: bool = True) -> list[Leftover]:
    """This install's engine process trees whose server is gone."""
    try:
        import psutil
    except ImportError:
        return []
    scripts = _engine_scripts()
    engines: dict[int, tuple[object, str]] = {}
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            eid = _engine_id_of(p.info.get("cmdline") or [], scripts)
        except Exception:  # noqa: BLE001
            eid = None
        if eid:
            engines[p.pid] = (p, eid)
    out: list[Leftover] = []
    for pid, (proc, eid) in engines.items():
        try:
            if proc.ppid() in engines:
                continue                      # a child of another engine process — its root decides
            gone, server_pid = _server_gone(proc, psutil)
            if not gone:
                continue
            tree = [pid] + [c.pid for c in proc.children(recursive=True)]
            out.append(Leftover(pid=pid, engine_id=eid, started=proc.create_time(),
                                server_pid=server_pid, pids=tree))
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    if measure and out:
        held = _gpu_by_pid()
        if held is not None:
            for lo in out:
                lo.gpu_mb = sum(held.get(p, 0) for p in lo.pids)
    return sorted(out, key=lambda lo: lo.started)


def _gpu_by_pid() -> dict[int, int] | None:
    """pid → GPU MB for every process holding any, from the kit's ONE
    whole-machine query (`gpu_processes`). Not the per-tree probe: on Windows
    that runs a counter query per pid, ~1 s each, and the sweep runs at
    startup. None = unmeasurable here."""
    try:
        from llm_runner.runner.hardware import gpu_processes

        snap = gpu_processes(fresh=True)
    except Exception:  # noqa: BLE001 — measuring is informative only
        return None
    if snap is None:
        return None
    return {int(r["pid"]): int(r["memMb"]) for r in snap.get("processes", [])}


def stop_leftover_engines(reason: str = "startup sweep") -> list[Leftover]:
    """Stop every leftover engine tree (children first) and log what it held."""
    found = find_leftover_engines()
    if not found:
        return []
    import psutil

    for lo in found:
        procs = []
        for p in reversed(lo.pids):           # children before their launcher
            try:
                pr = psutil.Process(p)
                pr.kill()
                procs.append(pr)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        psutil.wait_procs(procs, timeout=5)
    freed = sum(lo.gpu_mb or 0 for lo in found)
    log.warning(
        "%s: stopped %d leftover engine process tree(s) whose server is gone — %s — "
        "freeing about %d MB of GPU memory",
        reason, len(found),
        ", ".join(f"{lo.engine_id} pid {lo.pid} (server {lo.server_pid}, "
                  f"{lo.gpu_mb if lo.gpu_mb is not None else '?'} MB)" for lo in found),
        freed,
    )
    return found
