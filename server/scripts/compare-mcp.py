# SPDX-License-Identifier: MIT
"""The Python half of the MCP parity check (wave D of step 5): serve ONLY the MCP mount of
JustVoice's Python server on a COPY of the dev data root, as `app.py` mounts it.

    python compare-mcp.py serve <data_dir> <port>

The app is a bare FastAPI with `mcp.mount_into(app)` — the same mount, middleware and
session-manager lifespan `create_app` installs — over the copy's database and stores (no
engines started, no LLM). compare-mcp.mjs drives it and the JS twin and compares the answers.
"""

from __future__ import annotations

import sys
from pathlib import Path


def serve(data_dir: str, port: int) -> None:
    import uvicorn
    from fastapi import FastAPI

    from justvoice.app_state import AppState, set_state
    from justvoice.database import init_db
    from justvoice.mcp import mount_into

    d = Path(data_dir)
    init_db(d)
    set_state(AppState(d))
    app = FastAPI()
    mount_into(app)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] == "serve":
        serve(sys.argv[2], int(sys.argv[3]))
    else:
        raise SystemExit(f"unknown command {sys.argv[1]!r}")
