# SPDX-License-Identifier: MIT
"""JV rides the family's warm-on-startup default (ON) since 2026-08-13.

The 2026-08-05 warm-OFF override was an explicit stopgap — "TTS owns the GPU
until F4's arbiter" — and retired as the VRAM wiring's LAST step (Q6): with
budgeted arbitration live, an idle warm LLM is simply evictable, so the shared
seed's "1" now reaches fresh JV databases and the first Analyze is instant.
Seeds-only rule: an existing DB's stored value is never flipped either way —
a user's choice (or a legacy 0) survives every boot until they change it or
reset.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace


def _warm(client: TestClient) -> bool:
    r = client.get("/v1/ai/engine-config")
    assert r.status_code == 200
    return r.json()["warmDefaultOnStartup"]


def test_fresh_db_seeds_warm_on(tmp_path):
    """The family default reaches a fresh JV DB — no override left to block it."""
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    assert _warm(client) is True


def test_stored_warm_off_survives_reboot(tmp_path):
    """Seeds-only honesty: a DB carrying warm OFF (a user's choice, or the
    retired 2026-08-05 override's residue) is NOT flipped by a boot — the
    shared seed is insert-if-missing and no code rewrites the row."""
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    r = client.put("/v1/ai/engine-config", json={"warmDefaultOnStartup": False})
    assert r.status_code == 200
    assert _warm(client) is False

    client2 = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    assert _warm(client2) is False
