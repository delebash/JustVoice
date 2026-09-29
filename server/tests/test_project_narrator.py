# SPDX-License-Identifier: MIT
"""A new prose-voice project gets a Narrator — an ordinary persona.

The Narrator is created with every audiobook and podcast project (imports
included) and linked to its cast in the "narrator" role — the role, not
anything on the persona, is what makes it the project's narrator. Since
2026-09-29 there are no built-in personas: the Narrator renames, re-voices,
leaves the cast and deletes exactly like any other persona.

Game projects (NPCs only) and custom projects don't get one — there's no
single steady prose voice in those use cases.
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


def _cast(client, project_id: str) -> list[dict]:
    r = client.get(f"/v1/projects/{project_id}/cast")
    assert r.status_code == 200, r.text
    return r.json().get("cast", [])


def _narrator(client, project_id: str) -> dict | None:
    return next((c for c in _cast(client, project_id) if c.get("role_label") == "narrator"), None)


def test_audiobook_create_yields_a_narrator(client):
    pid = _create_project(client, "Stillwater", "audiobook")
    narrators = [c for c in _cast(client, pid) if c.get("role_label") == "narrator"]
    assert len(narrators) == 1
    assert narrators[0]["persona_name"] == "Narrator"


def test_podcast_create_yields_a_narrator(client):
    pid = _create_project(client, "Daily Show", "podcast")
    assert _narrator(client, pid) is not None


def test_game_project_does_not_get_a_narrator(client):
    pid = _create_project(client, "Quest", "game_voicelines")
    assert _narrator(client, pid) is None


def test_custom_project_does_not_get_a_narrator(client):
    pid = _create_project(client, "Bench", "custom")
    assert _narrator(client, pid) is None


def test_no_persona_is_built_in(client):
    """The persona API carries no built-in flag at all."""
    pid = _create_project(client, "Book", "audiobook")
    narrator = client.get(f"/v1/personas/{_narrator(client, pid)['persona_id']}").json()
    assert "is_builtin" not in narrator


def test_the_narrator_deletes_like_any_persona(client):
    """Deleting it takes it out of the cast too (ON DELETE CASCADE); the
    project has no narrator until "+ Add Narrator" makes a new one."""
    pid = _create_project(client, "Book", "audiobook")
    narrator_id = _narrator(client, pid)["persona_id"]

    r = client.delete(f"/v1/personas/{narrator_id}")
    assert r.status_code == 200, r.text
    assert client.get(f"/v1/personas/{narrator_id}").status_code == 404
    assert _narrator(client, pid) is None

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    back = [c for c in r.json()["cast"] if c.get("role_label") == "narrator"]
    assert len(back) == 1 and back[0]["persona_id"] != narrator_id


def test_a_persona_you_made_deletes_too(client):
    _create_project(client, "Book", "audiobook")
    r = client.post("/v1/personas", json={"name": "Sarah"})
    assert r.status_code in (200, 201), r.text
    r = client.delete(f"/v1/personas/{r.json()['id']}")
    assert r.status_code == 200, r.text


def test_ensure_narrator_endpoint_is_idempotent(client):
    """POST /v1/projects/{id}/narrator creates one on first call, no-ops
    on second call. Used by the Studio Cast "+ Add Narrator" placeholder."""
    pid = _create_project(client, "Book", "audiobook")
    # The create_project path already adds a narrator — calling ensure
    # should leave the cast unchanged.
    r1 = client.post(f"/v1/projects/{pid}/narrator")
    assert r1.status_code == 201, r1.text
    narrators = [c for c in r1.json()["cast"] if c.get("role_label") == "narrator"]
    assert len(narrators) == 1

    # Second call: still exactly one.
    r2 = client.post(f"/v1/projects/{pid}/narrator")
    assert r2.status_code == 201, r2.text
    narrators2 = [c for c in r2.json()["cast"] if c.get("role_label") == "narrator"]
    assert len(narrators2) == 1
    assert narrators[0]["persona_id"] == narrators2[0]["persona_id"]


def test_ensure_narrator_after_the_narrator_left_the_cast(client):
    """Take the Narrator out of the cast (the persona stays in the library),
    then ensure — it makes one again."""
    pid = _create_project(client, "Book", "audiobook")
    narrator_id = _narrator(client, pid)["persona_id"]
    r = client.delete(f"/v1/projects/{pid}/cast/{narrator_id}")
    assert r.status_code == 200, r.text
    assert _narrator(client, pid) is None

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201
    assert [c for c in r.json()["cast"] if c.get("role_label") == "narrator"]


def test_narrator_is_renameable_and_voice_reassignable(client):
    """Renamed, it is still the project's narrator — the cast role, not the
    name, says so."""
    pid = _create_project(client, "Book", "audiobook")
    narrator_id = _narrator(client, pid)["persona_id"]
    r = client.put(
        f"/v1/personas/{narrator_id}",
        json={"name": "Main Narrator", "voice_id": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Main Narrator"
    assert _narrator(client, pid)["persona_id"] == narrator_id


def test_a_deleted_narrator_stays_deleted_across_a_restart(tmp_path):
    """There is no startup fill-in any more: "Add Narrator" is the one way back."""
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    pid = _create_project(client, "Book", "audiobook")
    assert client.delete(f"/v1/personas/{_narrator(client, pid)['persona_id']}").status_code == 200

    again = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    assert _narrator(again, pid) is None


def test_the_old_built_in_column_is_dropped_and_personas_save_again(tmp_path):
    """A database made from the old model has `personas.is_builtin NOT NULL`
    with no default — every insert fails while it stays. The migration drops
    it and keeps the rows."""
    from sqlalchemy import create_engine, inspect, text

    from justvoice.database.migrations import run_migrations

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.connect() as conn:
        conn.execute(text(
            "CREATE TABLE personas (id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, "
            "is_builtin BOOLEAN NOT NULL, created_at DATETIME)"
        ))
        conn.execute(text("INSERT INTO personas (id, name, is_builtin) VALUES ('n1', 'Narrator', 1)"))
        conn.commit()

    run_migrations(engine)

    assert "is_builtin" not in {c["name"] for c in inspect(engine).get_columns("personas")}
    with engine.connect() as conn:
        conn.execute(text("INSERT INTO personas (id, name) VALUES ('p2', 'Mara')"))
        conn.commit()
        rows = conn.execute(text("SELECT id, name FROM personas ORDER BY id")).fetchall()
    assert rows == [("n1", "Narrator"), ("p2", "Mara")]
    run_migrations(engine)   # a second boot is a no-op
