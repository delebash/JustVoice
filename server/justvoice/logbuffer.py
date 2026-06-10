# SPDX-License-Identifier: GPL-3.0-or-later
"""In-memory ring buffer of recent log lines.

Installed on the root logger at app boot so Settings → Logs can tail,
copy, and download recent server activity without any file plumbing.
Capped at 2000 lines; survives for the life of the process only.
"""

from __future__ import annotations

import logging
import threading
from collections import deque

_MAX_LINES = 2000
_LOCK = threading.Lock()
_BUFFER: deque[str] = deque(maxlen=_MAX_LINES)


class RingBufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
        except Exception:
            return
        with _LOCK:
            _BUFFER.append(line)


_installed = False


def install() -> None:
    """Attach the ring buffer to the root logger (idempotent)."""
    global _installed
    if _installed:
        return
    handler = RingBufferHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-7s %(name)s — %(message)s")
    )
    handler.setLevel(logging.INFO)
    logging.getLogger().addHandler(handler)
    _installed = True


def tail(lines: int = 100) -> list[str]:
    with _LOCK:
        items = list(_BUFFER)
    return items[-max(1, min(_MAX_LINES, lines)):]
