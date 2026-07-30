# SPDX-License-Identifier: MIT
"""Module entry point — `python -m justvoice`, and the PyInstaller target.

`release.yml` builds the shipped sidecar with:

    pyinstaller --onefile server/justvoice/__main__.py --name justvoice-server

This file did not exist, so that step could not succeed and no release has ever
produced a Python sidecar. The console script (`justvoice-server =
"justvoice.cli:app"`) covers a pip install, but PyInstaller needs a real script
path to freeze, not an entry-point name — hence this shim.

It stays a shim on purpose: no logic, no imports beyond the CLI, so there is
nothing here to drift from `cli.py`.
"""

from __future__ import annotations

from .cli import app

if __name__ == "__main__":
    app()
