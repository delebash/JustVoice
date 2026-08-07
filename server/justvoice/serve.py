# SPDX-License-Identifier: MIT
"""`justvoice-server` — run the server standalone (and as the Tauri sidecar).

The family entry shape (target-tree P3, 2026-08-08; docgen's serve.py is the
donor): `justvoice-server serve` is the canonical form — the shell and the npm
`server` script use it — and the bare form works too. Host/port default from
the SETTINGS STORE (the no-hardcoded-tunables law), with CLI/env overrides.
Domain subcommands (default-settings · open-api · self-test) live in cli.py,
reachable as `python -m justvoice.cli` — one door per purpose.
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .paths import default_data_dir
from .version import VERSION


def main() -> None:
    ap = argparse.ArgumentParser(description="JustVoice server")
    ap.add_argument("command", nargs="?", choices=["serve"], default="serve")
    ap.add_argument("--host", default=os.environ.get("JUSTVOICE_HOST"),
                    help="default: the settings store's server.host")
    ap.add_argument("--port", type=int,
                    default=int(os.environ["JUSTVOICE_PORT"]) if os.environ.get("JUSTVOICE_PORT") else None,
                    help="default: the settings store's server.port")
    ap.add_argument("--data-dir", default=os.environ.get("JUSTVOICE_DATA_DIR"),
                    help=f"default: {default_data_dir()}")
    ap.add_argument("--log-level", default=os.environ.get("JUSTVOICE_LOG_LEVEL", "info"))
    args = ap.parse_args()

    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    dd = Path(args.data_dir) if args.data_dir else default_data_dir()
    app = create_app(dd)

    # Workspace seeding lives HERE, not in create_app(), on purpose: the pytest
    # suite's create_app(tmp_path) apps start from an empty, unmigrated database
    # (the family's named winner for the seeding call-site — target-tree P6).
    from .database.seed import seed_workspace

    seed_workspace()

    # CLI/env overrides sit on top of the settings-derived host/port.
    from .app_state import get_state

    settings = get_state().settings.get()
    bind_host = args.host or settings.server.host
    bind_port = args.port or settings.server.port

    print(f"JustVoice {VERSION} — http://{bind_host}:{bind_port}/  (data: {dd})")
    uvicorn.run(app, host=bind_host, port=bind_port, log_level=args.log_level.lower())


if __name__ == "__main__":
    main()
