# SPDX-License-Identifier: GPL-3.0-or-later
"""Project lifecycle auto-creates a builtin Narrator for prose-voice kinds.

The Narrator persona is project-scoped, linked via ProjectPersona with
role_label="narrator", and carries is_builtin=True so:
  - the personas DELETE endpoint refuses with 400 (rename / voice
    reassignment still allowed)
  - the Studio Cast UI hides the ✕ Remove affordance

Game projects (NPCs only) and custom projects don't get one — there's
no single steady prose voice in those use cases.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _create_project(client, name: str, kind: str) -> str:
    r = client.post(
        "/v1/projects",
        json={"name": name, "project_type": kind},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _project_personas(client, project_id: str) -> list[dict]:
    """Resolve the project's cast to full Persona objects (the cast
    endpoint only returns persona_id + role_label)."""
    r = client.get(f"/v1/projects/{project_id}/cast")
    assert r.status_code == 200, r.text
    entries = r.json().get("cast", [])
    out: list[dict] = []
    for e in entries:
        rp = client.get(f"/v1/personas/{e['persona_id']}")
        assert rp.status_code == 200, rp.text
        out.append(rp.json())
    return out


def test_audiobook_create_yields_builtin_narrator(client):
    pid = _create_project(client, "Stillwater", "audiobook")
    personas = _project_personas(client, pid)
    narrators = [p for p in personas if p["name"].lower() == "narrator"]
    assert len(narrators) == 1, personas
    assert narrators[0]["is_builtin"] is True


def test_podcast_create_yields_builtin_narrator(client):
    pid = _create_project(client, "Daily Show", "podcast")
    narrators = [
        p for p in _project_personas(client, pid) if p["name"].lower() == "narrator"
    ]
    assert len(narrators) == 1
    assert narrators[0]["is_builtin"] is True


def test_game_project_does_not_get_a_narrator(client):
    pid = _create_project(client, "Quest", "game_voicelines")
    personas = _project_personas(client, pid)
    assert not [p for p in personas if p["name"].lower() == "narrator"], personas


def test_custom_project_does_not_get_a_narrator(client):
    pid = _create_project(client, "Bench", "custom")
    personas = _project_personas(client, pid)
    assert not [p for p in personas if p["name"].lower() == "narrator"], personas


def test_delete_persona_refuses_builtin(client):
    pid = _create_project(client, "Book", "audiobook")
    narrator = next(
        p for p in _project_personas(client, pid) if p["name"].lower() == "narrator"
    )
    r = client.delete(f"/v1/personas/{narrator['id']}")
    assert r.status_code == 400, r.text
    assert "built-in" in r.text.lower()


def test_user_created_persona_still_deletable(client):
    """The is_builtin guard only applies to lifecycle-created personas."""
    _create_project(client, "Book", "audiobook")
    r = client.post("/v1/personas", json={"name": "Sarah"})
    assert r.status_code in (200, 201), r.text
    sarah_id = r.json()["id"]
    r = client.delete(f"/v1/personas/{sarah_id}")
    assert r.status_code == 200, r.text


def test_ensure_narrator_endpoint_is_idempotent(client):
    """POST /v1/projects/{id}/narrator creates one on first call, no-ops
    on second call. Used by the Studio Cast "+ Add Narrator" placeholder
    so projects that missed the init-time backfill still get one without
    a server restart."""
    pid = _create_project(client, "Book", "audiobook")
    # The create_project path already adds a narrator — calling ensure
    # should leave the cast unchanged.
    r1 = client.post(f"/v1/projects/{pid}/narrator")
    assert r1.status_code == 201, r1.text
    cast1 = r1.json()["cast"]
    narrators = [c for c in cast1 if c.get("role_label") == "narrator"]
    assert len(narrators) == 1

    # Second call: still exactly one.
    r2 = client.post(f"/v1/projects/{pid}/narrator")
    assert r2.status_code == 201, r2.text
    narrators2 = [
        c for c in r2.json()["cast"] if c.get("role_label") == "narrator"
    ]
    assert len(narrators2) == 1
    assert narrators[0]["persona_id"] == narrators2[0]["persona_id"]


def test_ensure_narrator_creates_on_pre_feature_project(client, tmp_path):
    """Simulate a project that pre-dates the feature: delete the
    auto-created narrator, then call ensure — it should re-create."""
    pid = _create_project(client, "Book", "audiobook")
    narrator = next(
        p for p in _project_personas(client, pid) if p["name"].lower() == "narrator"
    )
    # Detach (builtin protects DELETE persona, but cast-detach is allowed)
    r = client.delete(f"/v1/projects/{pid}/cast/{narrator['id']}")
    assert r.status_code == 200, r.text
    assert not [
        c for c in client.get(f"/v1/projects/{pid}/cast").json()["cast"]
        if c.get("role_label") == "narrator"
    ]
    # Ensure brings one back.
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201
    assert [c for c in r.json()["cast"] if c.get("role_label") == "narrator"]


def test_narrator_is_renameable_and_voice_reassignable(client):
    """Builtin protection only blocks DELETE — rename + voice still work."""
    pid = _create_project(client, "Book", "audiobook")
    narrator = next(
        p for p in _project_personas(client, pid) if p["name"].lower() == "narrator"
    )
    r = client.put(
        f"/v1/personas/{narrator['id']}",
        json={"name": "Main Narrator", "voice_id": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Main Narrator"
    assert r.json()["is_builtin"] is True
