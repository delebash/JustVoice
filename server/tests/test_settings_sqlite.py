# SPDX-License-Identifier: GPL-3.0-or-later
"""Settings folded into SQLite (Phase 1.5) — persistence + legacy seed/retire."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from justvoice.app import create_app


def _client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def test_patch_persists_in_sqlite_no_json_file(tmp_path):
    c = _client(tmp_path)
    assert c.patch("/v1/settings", json={"server": {"host": "0.0.0.0"}}).status_code == 200
    # A fresh app instance on the same data dir reads the persisted row.
    c2 = _client(tmp_path)
    assert c2.get("/v1/settings").json()["server"]["host"] == "0.0.0.0"
    # SQLite is the store — no settings.json is written.
    assert not (tmp_path / "settings.json").exists()


def test_legacy_settings_json_imported_then_retired(tmp_path):
    # An existing install (or a restored pre-fold backup) carries a settings.json.
    (tmp_path / "settings.json").write_text(
        json.dumps({"server": {"host": "0.0.0.0"}}), encoding="utf-8"
    )
    c = _client(tmp_path)
    # First load imports it into the DB row...
    assert c.get("/v1/settings").json()["server"]["host"] == "0.0.0.0"
    # ...then retires the file so the DB is the sole source.
    assert not (tmp_path / "settings.json").exists()
