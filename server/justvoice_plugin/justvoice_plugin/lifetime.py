# SPDX-License-Identifier: Apache-2.0
"""An engine never outlives the JustVoice server that started it (2026-09-29).

The host passes its own process id in `JUSTVOICE_SERVER_PID`. `watch_server()`
starts a daemon thread that checks every couple of seconds and ends this
process the moment that server is gone — closed, crashed or killed. Until then
an engine survived any hard kill of its host (Windows `TerminateProcess`,
SIGKILL) and kept its GPU memory: on 2026-09-29 five such leftovers held 1.6 GB
of an 8 GB card across four restarts, and the app's language model could no
longer load its speculative-decoding draft.

The host's `atexit`/shutdown path still stops engines gracefully on a normal
exit; this is the floor under every exit that path never sees. Stdlib only — it
runs inside every engine venv, which must not grow dependencies for it.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time

log = logging.getLogger("justvoice_plugin.lifetime")

ENV_SERVER_PID = "JUSTVOICE_SERVER_PID"
CHECK_EVERY_S = 2.0


class _ServerHandle:
    """Liveness of one process, robust against pid reuse where the OS allows.

    Windows: a handle opened NOW keeps meaning this process even after its pid
    is recycled, and is signalled when it exits. POSIX: `kill(pid, 0)`; a
    recycled pid is possible there, so the parent-pid change is checked too
    (the server is this process's direct parent on POSIX).
    """

    def __init__(self, pid: int):
        self.pid = pid
        self._handle = None
        self._unknowable = False
        self._ppid = os.getppid() if sys.platform != "win32" else None
        if sys.platform == "win32":
            import ctypes

            SYNCHRONIZE = 0x00100000
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            ERROR_INVALID_PARAMETER = 87  # what OpenProcess says for a pid that doesn't exist
            self._k32 = ctypes.WinDLL("kernel32", use_last_error=True)
            self._k32.OpenProcess.restype = ctypes.c_void_p
            self._k32.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
            self._handle = self._k32.OpenProcess(
                SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            # Refused for any other reason (access denied…): we can't tell, and
            # an engine must never exit on a guess — so it keeps running.
            self._unknowable = (not self._handle
                                and ctypes.get_last_error() != ERROR_INVALID_PARAMETER)

    def alive(self) -> bool:
        if self._unknowable:
            return True
        if sys.platform == "win32":
            if not self._handle:
                return False  # it was already gone when we looked
            WAIT_OBJECT_0 = 0
            return self._k32.WaitForSingleObject(self._handle, 0) != WAIT_OBJECT_0
        if self._ppid is not None and self._ppid == self.pid and os.getppid() != self.pid:
            return False  # reparented: our parent — the server — has exited
        try:
            os.kill(self.pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True


def server_alive(pid: int) -> bool:
    """One-shot check — for tests and callers that don't need the handle."""
    return _ServerHandle(pid).alive()


def watch_server(on_gone=None) -> threading.Thread | None:
    """Watch the server named in `JUSTVOICE_SERVER_PID`; end this process when
    it goes. No variable (an engine run by hand, or an older host) → no watch.
    `on_gone` runs first (best-effort, e.g. unload to free the GPU cleanly)."""
    raw = os.environ.get(ENV_SERVER_PID, "").strip()
    if not raw.isdigit():
        return None
    server = _ServerHandle(int(raw))

    def _loop() -> None:
        while server.alive():
            time.sleep(CHECK_EVERY_S)
        log.warning("JustVoice server %s is gone — this engine (pid %s) is exiting "
                    "so it does not keep holding memory", server.pid, os.getpid())
        if on_gone is not None:
            try:
                on_gone()
            except Exception:  # noqa: BLE001 — exiting regardless
                pass
        os._exit(0)

    t = threading.Thread(target=_loop, name="justvoice-server-watch", daemon=True)
    t.start()
    return t
