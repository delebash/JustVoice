# SPDX-License-Identifier: MIT
"""Persona names are unique within a book, not across the library.

Decided 2026-09-29 (the user's "maybe we can have duplicate names but not per
project per project only unique names"): two books may each have a "Narrator"
or a "Mother", but one cast never holds two people called the same — Script's
speaker picker, attribution and Discover all resolve names within a book.
Case and extra spaces don't count. A persona in no book has no rule. Checked
when a persona joins a cast and when one is renamed; an import keeps the
book's characters exactly as the book has them.
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


def _persona(client, name):
    r = client.post("/v1/personas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _cast_add(client, pid, persona_id):
    return client.post(f"/v1/projects/{pid}/cast", json={"persona_id": persona_id})


def test_a_cast_refuses_a_second_person_with_the_same_name(client):
    pid = _book(client)
    mara = _persona(client, "Mara")
    assert _cast_add(client, pid, mara).status_code == 201
    other = _persona(client, "  mara ")
    r = _cast_add(client, pid, other)
    assert r.status_code == 409 and 'already has someone called "Mara"' in r.json()["detail"]
    # Adding the one already there again is not a clash with herself.
    assert _cast_add(client, pid, mara).status_code == 201


def test_the_library_and_two_books_may_share_a_name(client):
    one, two = _book(client, "One"), _book(client, "Two")
    first, second = _persona(client, "Mother"), _persona(client, "Mother")
    assert _cast_add(client, one, first).status_code == 201
    assert _cast_add(client, two, second).status_code == 201
    assert client.post(f"/v1/projects/{one}/narrator").status_code == 201
    assert client.post(f"/v1/projects/{two}/narrator").status_code == 201


def test_a_rename_is_refused_when_a_book_it_is_in_has_that_name(client):
    pid = _book(client, "Stillwater")
    mara, tom = _persona(client, "Mara"), _persona(client, "Tom")
    _cast_add(client, pid, mara)
    _cast_add(client, pid, tom)
    r = client.put(f"/v1/personas/{tom}", json={"name": "MARA"})
    assert r.status_code == 409 and "Stillwater" in r.json()["detail"]
    assert client.get(f"/v1/personas/{tom}").json()["name"] == "Tom"
    assert client.put(f"/v1/personas/{tom}", json={"name": "Tom Harlan"}).status_code == 200
    # Only case changes: still the same name, never a clash.
    assert client.put(f"/v1/personas/{mara}", json={"name": "MARA"}).status_code == 200
    # In no book: free to take any name.
    loner = _persona(client, "Loner")
    assert client.put(f"/v1/personas/{loner}", json={"name": "Tom Harlan"}).status_code == 200


def test_discover_add_is_refused_for_a_name_the_cast_has(client):
    pid = _book(client)
    _cast_add(client, pid, _persona(client, "Mara"))
    r = client.post(f"/v1/projects/{pid}/personas/promote", json={"candidates": [{"name": "mara"}]})
    assert r.status_code == 409
    library_mara = _persona(client, "Mara")
    r = client.post(f"/v1/projects/{pid}/personas/promote",
                    json={"candidates": [{"name": "Mara", "persona_id": library_mara}]})
    assert r.status_code == 409
    assert [c["persona_name"] for c in client.get(f"/v1/projects/{pid}/cast").json()["cast"]] == ["Mara"]


def test_an_import_keeps_the_books_characters_as_they_are(client):
    guard = {"main": False, "age": 0, "gender": "", "pronouns": "", "aliases": [],
             "lifeStatus": "alive", "oneLiner": "", "role": "", "tags": []}
    book = book_json(characters=[{"id": "g1", "name": "Guard", **guard}, {"id": "g2", "name": "Guard", **guard}])
    r = client.post("/v1/projects/import?source=justwrite", json=book)
    assert r.status_code == 200, r.text
    cast = client.get(f"/v1/projects/{r.json()['project_id']}/cast").json()["cast"]
    assert [c["persona_name"] for c in cast] == ["Guard", "Guard"]
