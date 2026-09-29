# SPDX-License-Identifier: MIT
"""A book's narrator — an ordinary persona, chosen, never made on its own.

The narrator is the cast member holding the "narrator" role — the role, not
anything on the persona, says so. Since 2026-09-29 there are no built-in
personas (the Narrator renames, re-voices, leaves the cast and deletes like
any other), and no book gets a narrator on its own ("i dont think each
project should automatically create a narrator"): you tick one in Cast, or
"+ Add Narrator" (POST /narrator) gives the book one — a free "Narrator"
from the library first, a new one only if there is none.
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


def _book(client, name: str = "Book", kind: str = "audiobook") -> tuple[str, str]:
    """A new book given a narrator by "+ Add Narrator"; (project id, narrator id)."""
    pid = _create_project(client, name, kind)
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    return pid, _narrator(client, pid)["persona_id"]


def _narrators_in_library(client) -> list[str]:
    return [p["id"] for p in client.get("/v1/personas").json()["personas"] if p["name"] == "Narrator"]


@pytest.mark.parametrize("kind", ["audiobook", "podcast", "game_voicelines", "custom"])
def test_a_new_project_gets_no_narrator(client, kind):
    pid = _create_project(client, "Stillwater", kind)
    assert _cast(client, pid) == []
    assert _narrators_in_library(client) == []


def test_no_persona_is_built_in(client):
    """The persona API carries no built-in flag at all."""
    _pid, narrator_id = _book(client)
    assert "is_builtin" not in client.get(f"/v1/personas/{narrator_id}").json()


def test_the_narrator_deletes_like_any_persona(client):
    """Deleting it takes it out of the cast too (ON DELETE CASCADE); the
    project has no narrator until "+ Add Narrator" gives it one again."""
    pid, narrator_id = _book(client)

    r = client.delete(f"/v1/personas/{narrator_id}")
    assert r.status_code == 200, r.text
    assert client.get(f"/v1/personas/{narrator_id}").status_code == 404
    assert _narrator(client, pid) is None

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    back = [c for c in r.json()["cast"] if c.get("role_label") == "narrator"]
    assert len(back) == 1 and back[0]["persona_id"] != narrator_id


def test_a_persona_you_made_deletes_too(client):
    r = client.post("/v1/personas", json={"name": "Sarah"})
    assert r.status_code in (200, 201), r.text
    r = client.delete(f"/v1/personas/{r.json()['id']}")
    assert r.status_code == 200, r.text


def test_ensure_narrator_endpoint_is_idempotent(client):
    """POST /v1/projects/{id}/narrator gives the book one on the first call
    and changes nothing on the second. Studio Cast's "+ Add Narrator"."""
    pid = _create_project(client, "Book", "audiobook")
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
    """Take the Narrator out of the cast (the persona stays in the library,
    in no book), then "+ Add Narrator" — the same persona comes back."""
    pid, narrator_id = _book(client)
    r = client.delete(f"/v1/projects/{pid}/cast/{narrator_id}")
    assert r.status_code == 200, r.text
    assert _narrator(client, pid) is None

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201
    assert [c["persona_id"] for c in r.json()["cast"] if c.get("role_label") == "narrator"] == [narrator_id]
    assert _narrators_in_library(client) == [narrator_id]


def test_add_narrator_uses_a_free_library_narrator_before_making_one(client):
    """A deleted book's Narrator is in no book: the next book's "+ Add
    Narrator" takes it instead of making another. One still in a book is not
    free, so a second book beside it gets its own."""
    first, narrator_id = _book(client, "First")
    assert client.delete(f"/v1/projects/{first}").status_code == 200
    second, reused = _book(client, "Second")
    assert reused == narrator_id
    _third, fresh = _book(client, "Third")
    assert fresh != narrator_id
    assert sorted(_narrators_in_library(client)) == sorted([narrator_id, fresh])


def test_add_narrator_takes_the_narration_nobody_reads(client):
    """Analyze on a book with no narrator leaves narration with no speaker;
    "+ Add Narrator" moves those lines to it, as ticking a narrator does."""
    pid = _create_project(client, "Book", "audiobook")
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]
    line = client.post(f"/v1/scenes/{sid}/blocks", json={
        "position": 0, "text": "It was early April.", "persona_id": None, "source": "narration"}).json()["id"]
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201 and r.json()["moved_lines"] == 1
    assert _speaker(client, sid, line) == _narrator(client, pid)["persona_id"]


def test_narrator_is_renameable_and_voice_reassignable(client):
    """Renamed, it is still the project's narrator — the cast role, not the
    name, says so."""
    pid, narrator_id = _book(client)
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
    pid, narrator_id = _book(client)
    assert client.delete(f"/v1/personas/{narrator_id}").status_code == 200

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


# ── Any cast member can be the narrator (2026-09-29) ───────────────────────


def _book_with_watson(client):
    """An audiobook whose cast is its Narrator plus Watson, with a chapter of
    narration: one line on the Narrator, one on nobody, one you set, one of
    Watson's dialogue."""
    pid, old = _book(client, "Band")
    watson = client.post("/v1/personas", json={"name": "Dr. Watson"}).json()["id"]
    assert client.post(f"/v1/projects/{pid}/cast", json={"persona_id": watson}).status_code == 201
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]

    def block(pos, text, persona, source):
        r = client.post(f"/v1/scenes/{sid}/blocks", json={
            "position": pos, "text": text, "persona_id": persona, "source": source})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    ids = {
        "on_old": block(0, "I had called upon my friend.", old, "narration"),
        "on_none": block(1, "It was early April.", None, "narration"),
        "yours": block(2, "He rose.", old, "corrected"),
        "speech": block(3, "“What is it?”", watson, "llm"),
    }
    return pid, sid, old, watson, ids


def _speaker(client, sid, block_id):
    return next(b for b in client.get(f"/v1/scenes/{sid}/blocks").json() if b["id"] == block_id)["persona_id"]


def test_any_cast_member_can_be_the_narrator(client):
    pid, sid, old, watson, ids = _book_with_watson(client)
    r = client.put(f"/v1/projects/{pid}/narrator", json={"persona_id": watson})
    assert r.status_code == 200, r.text
    assert r.json()["moved_lines"] == 2

    roles = {c["persona_id"]: c["role_label"] for c in r.json()["cast"]}
    assert roles[watson] == "narrator"
    assert roles[old] is None                     # still cast, as an ordinary member
    assert [c for c in _cast(client, pid) if c["role_label"] == "narrator"] == [
        c for c in _cast(client, pid) if c["persona_id"] == watson]

    # Narration follows the role; a line you set stays; dialogue is untouched.
    assert _speaker(client, sid, ids["on_old"]) == watson
    assert _speaker(client, sid, ids["on_none"]) == watson
    assert _speaker(client, sid, ids["yours"]) == old
    assert _speaker(client, sid, ids["speech"]) == watson


def test_add_narrator_never_makes_a_second_one(client):
    pid, _sid, _old, watson, _ids = _book_with_watson(client)
    client.put(f"/v1/projects/{pid}/narrator", json={"persona_id": watson})
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201
    assert [c["persona_id"] for c in r.json()["cast"] if c["role_label"] == "narrator"] == [watson]


def test_the_narrator_must_be_in_the_cast(client):
    pid = _create_project(client, "Band", "audiobook")
    stranger = client.post("/v1/personas", json={"name": "Stranger"}).json()["id"]
    r = client.put(f"/v1/projects/{pid}/narrator", json={"persona_id": stranger})
    assert r.status_code == 400
    assert "isn't in this project's cast" in r.text


def test_choosing_the_current_narrator_changes_nothing(client):
    pid, sid, old, _watson, ids = _book_with_watson(client)
    r = client.put(f"/v1/projects/{pid}/narrator", json={"persona_id": old})
    assert r.status_code == 200 and r.json()["moved_lines"] == 0
    assert _speaker(client, sid, ids["on_none"]) is None
