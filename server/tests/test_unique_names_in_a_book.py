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


def test_two_books_and_the_library_may_share_a_name(client):
    one, two = _book(client, "One"), _book(client, "Two")
    assert _add(client, one, "Mother").status_code == 201
    assert _add(client, two, "Mother").status_code == 201
    for _ in range(2):
        assert client.post("/v1/personas", json={"name": "Mother"}).status_code == 201


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
