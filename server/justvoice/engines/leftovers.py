# SPDX-License-Identifier: MIT
"""Speech-runtime processes left behind by a server that is gone — found,
measured, stopped (decided 2026-09-29; the runtime since 2026-10-01).

Every speech model runs in ONE audio.cpp server process our server starts
(`engines/audiocpp/runtime.py`). On Windows it sits in a kill-on-close Job
Object, so it dies with our server however that server dies; elsewhere, or for
one an older JustVoice left, this module is the sweep:

  - run once when the server starts (`stop_leftover_engines`, from app.py);
  - `GET /v1/engines/leftovers` / `POST /v1/engines/leftovers/stop`, which the
    boot splash's failed-load box offers as a button.

(Until the switch the engines were Python subprocesses — `engine.py serve` in
each engine's venv — and five such trees held 1.6 GB on 2026-09-29, the day
this sweep was written.)

Only THIS install's runtime is touched: a process counts only when it runs a
binary under this install's runtime folder, or the development build `npm run dev`
points it at (`audiocpp/dev_build.py`). One whose server is alive is never
touched — that includes a second JustVoice server on the same install (the
renderer gate runs one).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class Leftover:
    pid: int                      # the tree's root
    engine_id: str
    started: float                # epoch seconds
    server_pid: int | None        # who started it, when known
    pids: list[int] = field(default_factory=list)   # the whole tree, root first
    gpu_mb: int | None = None


def _audiocpp_roots() -> tuple[str, ...]:
    """normcase(every dir this install's audio.cpp servers live under): the runtime folder,
    and the development build's bin folder when `npm run dev` points at one."""
    from .audiocpp import dev_build
    from .manager import engines_runtime_root

    roots = [os.path.normcase(str(Path(engines_runtime_root()) / "audiocpp"))]
    if (dev := dev_build.current()) is not None:
        roots.append(os.path.normcase(str(dev.bin_dir)))
    return tuple(roots)


def _engine_id_of(cmdline: list[str], audiocpp_roots: tuple[str, ...]) -> str | None:
    """"audiocpp" when this command line runs a binary under one of this install's runtime
    folders (our own server, started with JUSTVOICE_SERVER_PID set), else None."""
    if cmdline and any(r and os.path.normcase(cmdline[0]).startswith(r) for r in audiocpp_roots):
        return "audiocpp"
    return None


def _server_gone(proc, psutil) -> tuple[bool, int | None]:
    """(gone?, server pid). The server pid comes from the process's environment
    (`JUSTVOICE_SERVER_PID`); a pid that now belongs to a process started AFTER
    this one was recycled, so that server is gone too. With no variable the
    parent is the server."""
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
    """This install's runtime process trees whose server is gone."""
    try:
        import psutil
    except ImportError:
        return []
    roots = _audiocpp_roots()
    engines: dict[int, tuple[object, str]] = {}
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            eid = _engine_id_of(p.info.get("cmdline") or [], roots)
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
