# SPDX-License-Identifier: MIT
"""The cast endpoint ships names, not just ids.

User ruling 2026-08-15 — *"we should not be using these types of ids in user
facing gui"*. Every consumer used to resolve `persona_id` client-side against
a cached persona list, so an empty cache rendered raw UUIDs in the Projects
cast row and in the Lab's reassign dropdown. The name now travels with the id.
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
    r = client.post("/v1/projects", json={"name": "Stillwater", "project_type": kind})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _persona(client, name: str) -> str:
    r = client.post("/v1/personas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_cast_entries_carry_the_persona_name(client):
    pid = _project(client)  # audiobook ⇒ a builtin Narrator is already cast
    mara = _persona(client, "Mara Vance")
    assert client.post(f"/v1/projects/{pid}/cast", json={"persona_id": mara}).status_code == 201

    cast = client.get(f"/v1/projects/{pid}/cast").json()["cast"]
    names = {c["persona_name"] for c in cast}
    assert "Mara Vance" in names
    # The narrator's NAME, not its role label — the two are different fields
    # and the GUI was showing the role because the name was missing.
    narrator = next(c for c in cast if c["role_label"] == "narrator")
    assert narrator["persona_name"] == "Narrator"
    assert narrator["persona_id"] != narrator["persona_name"]


def test_assign_and_narrator_responses_carry_names_too(client):
    """Both write endpoints return the cast; they must not be name-less."""
    pid = _project(client)
    mara = _persona(client, "Mara Vance")
    r = client.post(f"/v1/projects/{pid}/cast", json={"persona_id": mara})
    assert r.status_code == 201, r.text
    assert all("persona_name" in c for c in r.json()["cast"])
    assert "Mara Vance" in {c["persona_name"] for c in r.json()["cast"]}

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    assert all("persona_name" in c for c in r.json()["cast"])


def test_deleting_a_persona_drops_it_from_the_cast(client):
    """Why a name-less entry is not an expected state: the link cascades.

    `ProjectPersona.persona_id` is `ondelete="CASCADE"` (database/models.py:194)
    and the engine runs `PRAGMA foreign_keys=ON` (database/session.py:71-73),
    so a deleted persona takes its cast links with it. `persona_name` is
    Optional and the query outer-joins purely defensively — this test is what
    says the null branch is unreachable in normal operation."""
    pid = _project(client, "game_voicelines")  # no builtin narrator in the way
    ghost = _persona(client, "Ghost")
    assert client.post(f"/v1/projects/{pid}/cast", json={"persona_id": ghost}).status_code == 201
    assert client.delete(f"/v1/personas/{ghost}").status_code == 200

    cast = client.get(f"/v1/projects/{pid}/cast").json()["cast"]
    assert [c for c in cast if c["persona_id"] == ghost] == []
    assert all(c["persona_name"] for c in cast)
