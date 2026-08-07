# SPDX-License-Identifier: MIT
"""JV's warm-on-startup default is OFF (ruling 2026-08-05).

The shared stack defaults warm ON (seed "1"; an ABSENT row also reads as ON —
stores.py), and JV's DBs have carried that seeded "1" since install_llm arrived
2026-08-01 while no JV surface ever exposed the toggle. seed_workspace()
(serve-time since target-tree P6; create_app until then) therefore writes an
explicit "0" once, marker-guarded: fresh DBs seed OFF, legacy DBs are flipped
OFF exactly once, and a user's later warm-ON choice survives reboots.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace


def _warm(client: TestClient) -> bool:
    r = client.get("/v1/ai/engine-config")
    assert r.status_code == 200
    return r.json()["warmDefaultOnStartup"]


def test_fresh_db_seeds_warm_off(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    assert _warm(client) is False


def test_legacy_shared_seeded_on_is_flipped_once(tmp_path):
    # A DB from the 2026-08-01..05 window: the shared seed's "1" is present and
    # JV's marker is not (simulated by removing it after a normal boot).
    TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    from llm_runner.llm import db as llm_db

    s = llm_db.session()
    try:
        s.get(llm_db.RunnerSetting, "warm_default_on_startup").value = "1"
        s.delete(s.get(llm_db.RunnerSetting, "jv_warm_default_applied"))
        s.commit()
    finally:
        s.close()

    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    assert _warm(client) is False


def test_user_warm_on_choice_survives_reboot(tmp_path):
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    r = client.put("/v1/ai/engine-config", json={"warmDefaultOnStartup": True})
    assert r.status_code == 200
    assert _warm(client) is True

    client2 = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    assert _warm(client2) is True
