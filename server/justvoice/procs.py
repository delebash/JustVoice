# SPDX-License-Identifier: MIT
"""Starting an external program from the server — always with no console to
inherit (decided 2026-10-07).

A child started without CREATE_NO_WINDOW inherits the server's console. When
the shell that started the app is gone, that console has no host, and Windows
cannot start the child at all: exit 0xC0000142. That is how every chapter's
mastering failed on 2026-10-07 ("mastering: ffmpeg failed (exit 3221225794)")
while the speech runtime, started with the flag, kept working. Reproduced
outside the app: a process whose console host was killed starts ffmpeg →
0xc0000142 without the flag, exit 0 with it. With the flag the child gets a
hidden console of its own. Elsewhere the flag is 0.
"""

from __future__ import annotations

import subprocess
import sys

NO_CONSOLE = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

#: Windows' "the program could not start" (STATUS_DLL_INIT_FAILED), as an exit code.
CANT_START = 0xC0000142


def run(argv, **kw):
    """`subprocess.run`, with no console to inherit."""
    return subprocess.run(argv, creationflags=NO_CONSOLE, **kw)


def check_output(argv, **kw):
    """`subprocess.check_output`, with no console to inherit."""
    return subprocess.check_output(argv, creationflags=NO_CONSOLE, **kw)


def failed(name: str, returncode: int, stderr: bytes | None) -> str:
    """What a failed run says: the program's own words, or — when it never
    started — that, rather than a bare Windows code."""
    if (returncode & 0xFFFFFFFF) == CANT_START:
        return f"{name} could not start (Windows error 0xC0000142)"
    err = (stderr or b"").decode("utf-8", errors="ignore").strip()[-1500:]
    return f"{name} failed (exit {returncode}){': ' + err if err else ''}"
