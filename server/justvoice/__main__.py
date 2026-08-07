# SPDX-License-Identifier: MIT
"""Module entry point — `python -m justvoice`, and the PyInstaller target.

`release.yml` builds the shipped sidecar with:

    pyinstaller --onefile server/justvoice/__main__.py --name justvoice-server

This file did not exist, so that step could not succeed and no release has ever
produced a Python sidecar. The console script (`justvoice-server =
"justvoice.serve:main"`) covers a pip install, but PyInstaller needs a real
script path to freeze, not an entry-point name — hence this shim.

It targets the SERVER entry (target-tree P3 backfill, 2026-08-08): the sidecar
IS the server, and serve.py has been the one serving door since cli.py became
the domain CLI. Until this fix the shim still ran `cli.app`, whose `serve`
command died in P3 — a frozen sidecar (or bare `python -m justvoice`) printed
Typer help and exited instead of serving.

It stays a shim on purpose: no logic, no imports beyond the entry, so there is
nothing here to drift from `serve.py`.
"""

from __future__ import annotations

from .serve import main

if __name__ == "__main__":
    main()
