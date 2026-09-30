# SPDX-License-Identifier: MIT
"""A book's narrator — a speaker holding the narrator role, never made on its own.

Since 2026-09-29 the people in a book are its speakers, and each speaker is
played by a persona (the finished voice). The narrator is the speaker holding
the "narrator" role — the role, not the name, says so. No book gets one on its
own ("i dont think each project should automatically create a narrator"):
Cast's tick makes any speaker the narrator, and "+ Add Narrator" (POST
/narrator) makes a speaker called Narrator — cast with the persona of exactly
that name when the library has one.
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
    r = client.post("/v1/projects", json={"name": name, "project_type": kind})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _speakers(client, project_id: str) -> list[dict]:
    r = client.get(f"/v1/projects/{project_id}/speakers")
    assert r.status_code == 200, r.text
    return r.json()["speakers"]


def _narrator(client, project_id: str) -> dict | None:
    return next((s for s in _speakers(client, project_id) if s["role_label"] == "narrator"), None)


def _book(client, name: str = "Book", kind: str = "audiobook") -> tuple[str, str]:
    """A new book given a narrator by "+ Add Narrator"; (project id, narrator speaker id)."""
    pid = _create_project(client, name, kind)
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201, r.text
    return pid, _narrator(client, pid)["id"]


def _speaker_of(client, sid, block_id):
    return next(b for b in client.get(f"/v1/scenes/{sid}/blocks").json() if b["id"] == block_id)["speaker_id"]


@pytest.mark.parametrize("kind", ["audiobook", "podcast", "game_voicelines", "custom"])
def test_a_new_project_gets_no_narrator(client, kind):
    pid = _create_project(client, "Stillwater", kind)
    assert _speakers(client, pid) == []
    assert client.get("/v1/personas").json()["personas"] == []


def test_add_narrator_makes_a_speaker_and_no_persona(client):
    pid, sid = _book(client)
    narrator = _narrator(client, pid)
    assert narrator["name"] == "Narrator" and narrator["persona_id"] is None
    assert client.get("/v1/personas").json()["personas"] == []


def test_add_narrator_is_cast_with_a_persona_of_exactly_that_name(client):
    """Every new speaker: a persona called "narrator " (case and spaces aside)
    plays it at once."""
    voice = client.post("/v1/personas", json={"name": "narrator "}).json()["id"]
    pid, _ = _book(client)
    assert _narrator(client, pid)["persona_id"] == voice


def test_ensure_narrator_endpoint_is_idempotent(client):
    pid = _create_project(client, "Book", "audiobook")
    r1 = client.post(f"/v1/projects/{pid}/narrator")
    assert r1.status_code == 201, r1.text
    first = [s["id"] for s in r1.json()["speakers"] if s["role_label"] == "narrator"]
    r2 = client.post(f"/v1/projects/{pid}/narrator")
    assert r2.status_code == 201, r2.text
    assert [s["id"] for s in r2.json()["speakers"] if s["role_label"] == "narrator"] == first
    assert len(_speakers(client, pid)) == 1


def test_a_removed_narrator_takes_its_speaker_off_the_narration(client):
    """Removing the narrator's speaker leaves its lines with no speaker;
    "+ Add Narrator" makes a new one and gives them back."""
    pid, narrator_id = _book(client)
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]
    line = client.post(f"/v1/scenes/{sid}/blocks", json={
        "position": 0, "text": "It was early April.", "speaker_id": narrator_id,
        "source": "narration"}).json()["id"]
    r = client.delete(f"/v1/speakers/{narrator_id}")
    assert r.status_code == 200 and r.json() == {"deleted": True, "lines": 1}
    assert _narrator(client, pid) is None
    assert _speaker_of(client, sid, line) is None

    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201 and r.json()["moved_lines"] == 1
    assert _speaker_of(client, sid, line) == _narrator(client, pid)["id"] != narrator_id


def test_add_narrator_takes_the_narration_nobody_reads(client):
    """Analyze on a book with no narrator leaves narration with no speaker;
    "+ Add Narrator" moves those lines to it, as ticking a narrator does."""
    pid = _create_project(client, "Book", "audiobook")
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]
    line = client.post(f"/v1/scenes/{sid}/blocks", json={
        "position": 0, "text": "It was early April.", "speaker_id": None, "source": "narration"}).json()["id"]
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201 and r.json()["moved_lines"] == 1
    assert _speaker_of(client, sid, line) == _narrator(client, pid)["id"]


def test_the_narrator_renames_like_any_speaker(client):
    """Renamed, it is still the book's narrator — the role, not the name."""
    pid, narrator_id = _book(client)
    r = client.patch(f"/v1/speakers/{narrator_id}", json={"name": "Main Narrator"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Main Narrator"
    assert _narrator(client, pid)["id"] == narrator_id


def test_a_removed_narrator_stays_removed_across_a_restart(tmp_path):
    """There is no startup fill-in: "Add Narrator" is the one way back."""
    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    pid, narrator_id = _book(client)
    assert client.delete(f"/v1/speakers/{narrator_id}").status_code == 200
    again = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    assert _narrator(again, pid) is None


def test_a_deleted_book_takes_its_speakers_with_it(client):
    """Speakers can't outlive their book — so no leftover Narrators pile up;
    the persona that played them stays in the library."""
    voice = client.post("/v1/personas", json={"name": "Narrator"}).json()["id"]
    pid, narrator_id = _book(client)
    assert client.delete(f"/v1/projects/{pid}").status_code == 200
    assert client.patch(f"/v1/speakers/{narrator_id}", json={"name": "x"}).status_code == 404
    assert [p["id"] for p in client.get("/v1/personas").json()["personas"]] == [voice]


# ── Any speaker can be the narrator (2026-09-29) ─────────────────────────────


def _book_with_watson(client):
    """An audiobook whose speakers are its Narrator plus Watson, with a chapter
    of narration: one line on the Narrator, one on nobody, one you set, one of
    Watson's dialogue."""
    pid, old = _book(client, "Band")
    r = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Dr. Watson"})
    assert r.status_code == 201, r.text
    watson = r.json()["id"]
    sid = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]

    def block(pos, text, speaker, source):
        r = client.post(f"/v1/scenes/{sid}/blocks", json={
            "position": pos, "text": text, "speaker_id": speaker, "source": source})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    ids = {
        "on_old": block(0, "I had called upon my friend.", old, "narration"),
        "on_none": block(1, "It was early April.", None, "narration"),
        "yours": block(2, "He rose.", old, "corrected"),
        "speech": block(3, "“What is it?”", watson, "llm"),
    }
    return pid, sid, old, watson, ids


def test_any_speaker_can_be_the_narrator(client):
    pid, sid, old, watson, ids = _book_with_watson(client)
    r = client.put(f"/v1/projects/{pid}/narrator", json={"speaker_id": watson})
    assert r.status_code == 200, r.text
    assert r.json()["moved_lines"] == 2

    roles = {s["id"]: s["role_label"] for s in r.json()["speakers"]}
    assert roles[watson] == "narrator"
    assert roles[old] is None                     # still a speaker, as an ordinary one
    assert [s["id"] for s in _speakers(client, pid) if s["role_label"] == "narrator"] == [watson]

    # Narration follows the role; a line you set stays; dialogue is untouched.
    assert _speaker_of(client, sid, ids["on_old"]) == watson
    assert _speaker_of(client, sid, ids["on_none"]) == watson
    assert _speaker_of(client, sid, ids["yours"]) == old
    assert _speaker_of(client, sid, ids["speech"]) == watson


def test_add_narrator_never_makes_a_second_one(client):
    pid, _sid, _old, watson, _ids = _book_with_watson(client)
    client.put(f"/v1/projects/{pid}/narrator", json={"speaker_id": watson})
    r = client.post(f"/v1/projects/{pid}/narrator")
    assert r.status_code == 201
    assert [s["id"] for s in r.json()["speakers"] if s["role_label"] == "narrator"] == [watson]


def test_the_narrator_must_be_a_speaker_of_this_book(client):
    pid = _create_project(client, "Band", "audiobook")
    other = _create_project(client, "Other", "audiobook")
    stranger = client.post(f"/v1/projects/{other}/speakers", json={"name": "Stranger"}).json()["id"]
    r = client.put(f"/v1/projects/{pid}/narrator", json={"speaker_id": stranger})
    assert r.status_code == 400
    assert "isn't in this book" in r.json()["detail"]


def test_choosing_the_current_narrator_changes_nothing(client):
    pid, sid, old, _watson, ids = _book_with_watson(client)
    r = client.put(f"/v1/projects/{pid}/narrator", json={"speaker_id": old})
    assert r.status_code == 200 and r.json()["moved_lines"] == 0
    assert _speaker_of(client, sid, ids["on_none"]) is None


# ── Speakers — the people in a book, and their cast ─────────────────────────


def test_a_speaker_is_cast_by_giving_it_a_persona_and_uncast_by_null(client):
    pid = _create_project(client, "Book", "audiobook")
    voice = client.post("/v1/personas", json={"name": "Gruff dockhand"}).json()["id"]
    sp = client.post(f"/v1/projects/{pid}/speakers", json={
        "name": "Harbek", "aliases": ["Harb", " harbek "], "description": "A dock guard."}).json()
    assert sp["aliases"] == ["Harb"], "trimmed, de-duplicated, never the speaker's own name"
    assert sp["persona_id"] is None and sp["lines"] == 0
    r = client.patch(f"/v1/speakers/{sp['id']}", json={"persona_id": voice})
    assert r.json()["persona_id"] == voice and r.json()["persona_name"] == "Gruff dockhand"
    r = client.patch(f"/v1/speakers/{sp['id']}", json={"persona_id": None})
    assert r.json()["persona_id"] is None
    assert client.patch(f"/v1/speakers/{sp['id']}", json={"persona_id": "nope"}).status_code == 404


def test_one_persona_can_play_many_speakers_and_deleting_it_uncasts_them(client):
    pid = _create_project(client, "Book", "audiobook")
    voice = client.post("/v1/personas", json={"name": "Guard"}).json()["id"]
    a = client.post(f"/v1/projects/{pid}/speakers", json={"name": "First guard", "persona_id": voice}).json()
    b = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Second guard", "persona_id": voice}).json()
    assert a["persona_id"] == b["persona_id"] == voice
    usage = client.get("/v1/personas/usage").json()["usage"][voice]
    assert sorted(u["speaker_name"] for u in usage) == ["First guard", "Second guard"]
    assert client.delete(f"/v1/personas/{voice}").status_code == 200
    assert {s["persona_id"] for s in _speakers(client, pid)} == {None}


def test_clear_cast_uncasts_every_speaker_and_keeps_them(client):
    pid = _create_project(client, "Book", "audiobook")
    voice = client.post("/v1/personas", json={"name": "Guard"}).json()["id"]
    for n in ("A", "B"):
        client.post(f"/v1/projects/{pid}/speakers", json={"name": n, "persona_id": voice})
    r = client.post(f"/v1/projects/{pid}/speakers/uncast")
    assert r.status_code == 200
    assert [(s["name"], s["persona_id"]) for s in r.json()["speakers"]] == [("A", None), ("B", None)]


def test_rewrite_in_character_reads_the_speakers_who_they_are(client, monkeypatch):
    """Script's right-click Rewrite: the speaker's "Who they are" is the
    character (it moved off the persona 2026-09-29)."""
    from types import SimpleNamespace

    pid = _create_project(client, "Book", "audiobook")
    sp = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Mara"}).json()
    r = client.post(f"/v1/speakers/{sp['id']}/rewrite", json={"text": "Hi."})
    assert r.status_code == 400 and "Who they are" in r.json()["detail"]

    client.patch(f"/v1/speakers/{sp['id']}", json={"description": "Lead detective. Dry wit."})
    seen = {}

    def fake_run(action, variables, **_kw):
        seen.update(action=action, **variables)
        return SimpleNamespace(text="  Well. Hi.  ", prompt_tokens=1, completion_tokens=2, model="m")

    monkeypatch.setattr("justvoice.engines.llm.run.run_feature", fake_run)
    r = client.post(f"/v1/speakers/{sp['id']}/rewrite", json={"text": "Hi."})
    assert r.status_code == 200, r.text
    assert (r.json()["original"], r.json()["rewritten"], r.json()["speaker_id"]) == ("Hi.", "Well. Hi.", sp["id"])
    assert seen == {"action": "persona_rewrite", "personality": "Lead detective. Dry wit.", "text": "Hi."}
