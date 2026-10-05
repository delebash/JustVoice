# SPDX-License-Identifier: MIT
"""The speakers endpoint ships names, not just ids.

User ruling 2026-08-15 — *"we should not be using these types of ids in user
facing gui"*. Consumers used to resolve ids client-side against a cached list,
so an empty cache rendered raw UUIDs. Since the 2026-09-29 split a book's cast
is its speakers, and each carries its persona's NAME beside the persona id.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _project(client, kind: str = "audiobook") -> str:
    r = client.post("/v1/projects", json={"name": "The Ninth Facet", "project_type": kind})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_speakers_carry_their_personas_name(client):
    pid = _project(client)
    voice = client.post("/v1/personas", json={"name": "Warm narrator"}).json()["id"]
    r = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Mara Vance", "persona_id": voice})
    assert r.status_code == 201, r.text
    assert r.json()["persona_name"] == "Warm narrator"
    listed = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
    assert [(s["name"], s["persona_name"]) for s in listed] == [("Mara Vance", "Warm narrator")]


def test_narrator_responses_carry_names_too(client):
    pid = _project(client)
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    assert [s["name"] for s in r.json()["speakers"]] == ["Narrator"]


def test_deleting_a_persona_leaves_its_speakers_uncast_not_nameless(client):
    """A deleted persona un-casts the speakers it played (SET NULL); the
    speakers keep their names — nothing reaches the GUI as a bare id."""
    pid = _project(client)
    ghost = client.post("/v1/personas", json={"name": "Ghost"}).json()["id"]
    client.post(f"/v1/projects/{pid}/speakers", json={"name": "Mara", "persona_id": ghost})
    assert client.delete(f"/v1/personas/{ghost}").status_code == 200
    [s] = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
    assert (s["name"], s["persona_id"], s["persona_name"]) == ("Mara", None, None)
