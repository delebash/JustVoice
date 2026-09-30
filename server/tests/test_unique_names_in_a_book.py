# SPDX-License-Identifier: MIT
"""Speaker names are unique within a book (decided 2026-09-29).

Two books may each have a "Narrator" or a "Mother", but one book never holds two
speakers called the same — Script's speaker list, attribution and Discover all
resolve names within a book. Case and extra spaces don't count. Checked when a
speaker is added (Cast's ＋ Add, Discover's Add) and renamed; an import keeps
the book's characters exactly as the book has them. Personas — the voices in
the library — have no name rule.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _book(client, name="Stillwater"):
    r = client.post("/v1/projects", json={"name": name, "project_type": "audiobook"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _add(client, pid, name):
    return client.post(f"/v1/projects/{pid}/speakers", json={"name": name})


def test_a_book_refuses_a_second_speaker_with_the_same_name(client):
    pid = _book(client)
    assert _add(client, pid, "Mara").status_code == 201
    r = _add(client, pid, "  mara ")
    assert r.status_code == 409 and 'already has a speaker called "Mara"' in r.json()["detail"]


def test_two_books_may_share_a_speaker_name(client):
    one, two = _book(client, "One"), _book(client, "Two")
    assert _add(client, one, "Mother").status_code == 201
    assert _add(client, two, "Mother").status_code == 201


def test_persona_names_are_unique_across_the_library(client):
    """2026-09-29: a persona is a voice in the library, so its name is unique
    there — case and extra spaces don't count. (Speakers: unique per book.)"""
    first = client.post("/v1/personas", json={"name": "  Gravel   old man "})
    assert first.status_code == 201 and first.json()["name"] == "Gravel old man"
    for clash in ("Gravel old man", "gravel OLD man", " gravel  old  man"):
        r = client.post("/v1/personas", json={"name": clash})
        assert r.status_code == 409 and '"Gravel old man"' in r.json()["detail"], r.text


def test_a_persona_must_have_a_name(client):
    for blank in ("", "   "):
        r = client.post("/v1/personas", json={"name": blank})
        assert r.status_code == 400 and "needs a name" in r.json()["detail"]
    pid = client.post("/v1/personas", json={"name": "Warm"}).json()["id"]
    assert client.put(f"/v1/personas/{pid}", json={"name": " "}).status_code == 400


def test_a_persona_rename_is_refused_into_a_taken_name(client):
    warm = client.post("/v1/personas", json={"name": "Warm"}).json()["id"]
    client.post("/v1/personas", json={"name": "Crisp"})
    r = client.put(f"/v1/personas/{warm}", json={"name": "CRISP"})
    assert r.status_code == 409 and '"Crisp"' in r.json()["detail"]
    # Its own name, in another case, is not a clash.
    assert client.put(f"/v1/personas/{warm}", json={"name": "WARM"}).json()["name"] == "WARM"
    assert client.put("/v1/personas/persona_nope", json={"name": "Other"}).status_code == 404


def test_a_rename_is_refused_when_the_book_has_that_name(client):
    pid = _book(client)
    mara = _add(client, pid, "Mara").json()["id"]
    tom = _add(client, pid, "Tom").json()["id"]
    r = client.patch(f"/v1/speakers/{tom}", json={"name": "MARA"})
    assert r.status_code == 409 and "Mara" in r.json()["detail"]
    assert client.patch(f"/v1/speakers/{tom}", json={"name": "Tom Harlan"}).status_code == 200
    # Only case changes: still the same name, never a clash.
    assert client.patch(f"/v1/speakers/{mara}", json={"name": "MARA"}).status_code == 200


def test_discover_add_is_refused_for_a_name_the_book_has(client):
    pid = _book(client)
    _add(client, pid, "Mara")
    r = client.post(f"/v1/projects/{pid}/speakers/promote", json={"candidates": [{"name": "mara"}]})
    assert r.status_code == 409
    assert [s["name"] for s in client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]] == ["Mara"]


def test_an_import_keeps_the_books_characters_as_they_are(client):
    guard = {"main": False, "age": 0, "gender": "", "pronouns": "", "aliases": [],
             "lifeStatus": "alive", "oneLiner": "", "role": "", "tags": []}
    book = book_json(characters=[{"id": "g1", "name": "Guard", **guard}, {"id": "g2", "name": "Guard", **guard}])
    r = client.post("/v1/projects/import?source=justwrite", json=book)
    assert r.status_code == 200, r.text
    speakers = client.get(f"/v1/projects/{r.json()['project_id']}/speakers").json()["speakers"]
    assert [s["name"] for s in speakers] == ["Guard", "Guard"]
