# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/prefs — renderer UI preferences (real rows, not localStorage)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from justvoice.app import create_app


def _c(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def test_empty(tmp_path):
    assert _c(tmp_path).get("/v1/prefs").json() == {}


def test_patch_returns_merged_and_persists_real_json(tmp_path):
    c = _c(tmp_path)
    merged = c.patch("/v1/prefs", json={
        "appearance": {"theme": "dark", "accentHue": 200},
        "hiddenVoices": ["v1", "v2"],
    }).json()
    assert merged["appearance"] == {"theme": "dark", "accentHue": 200}
    assert merged["hiddenVoices"] == ["v1", "v2"]
    assert c.get("/v1/prefs").json() == merged


def test_partial_patch_keeps_other_keys(tmp_path):
    c = _c(tmp_path)
    c.patch("/v1/prefs", json={"appearance": {"theme": "dark"}, "autoLoadEngine": "always"})
    c.patch("/v1/prefs", json={"hiddenVoices": ["v9"]})
    doc = c.get("/v1/prefs").json()
    assert doc["appearance"] == {"theme": "dark"}
    assert doc["autoLoadEngine"] == "always"
    assert doc["hiddenVoices"] == ["v9"]


def test_wholesale_per_key_allows_deletion(tmp_path):
    c = _c(tmp_path)
    # A map entry can be removed by sending the smaller value — what the
    # settings deep-merge can't do.
    c.patch("/v1/prefs", json={"voiceGenderOverrides": {"a": "female", "b": "male"}})
    c.patch("/v1/prefs", json={"voiceGenderOverrides": {"a": "female"}})
    assert c.get("/v1/prefs").json()["voiceGenderOverrides"] == {"a": "female"}


def test_persist_across_instances_and_clear(tmp_path):
    c = _c(tmp_path)
    c.patch("/v1/prefs", json={"appearance": {"theme": "dark"}})
    c2 = _c(tmp_path)  # new app instance, same SQLite file
    assert c2.get("/v1/prefs").json() == {"appearance": {"theme": "dark"}}
    assert c2.delete("/v1/prefs").status_code == 204
    assert c2.get("/v1/prefs").json() == {}
