# SPDX-License-Identifier: MIT
"""A speaker's pronouns (persona build P9, 2026-10-04 — docs/plans/2026-09-30-voice-gender-and-
pronouns.md §3): set on Cast, filled by a JustWrite import, read by Script's Analyze and
Smart-assign, never heard."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.extraction.pipeline import prompt_handles
from justvoice.extraction.prompts import format_characters
from justvoice.imports.adapters.justwrite import _pronouns


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _project(client) -> str:
    r = client.post("/v1/projects", json={"name": "Stillwater", "project_type": "audiobook"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_cast_sets_changes_and_clears_a_speakers_pronouns(client):
    pid = _project(client)
    made = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Mara", "pronouns": "she/her"})
    assert made.status_code == 201 and made.json()["pronouns"] == "she/her"
    sid = made.json()["id"]
    assert client.patch(f"/v1/speakers/{sid}", json={"pronouns": "they/them"}).json()["pronouns"] == "they/them"
    # A PATCH that leaves it out keeps it; null clears it.
    assert client.patch(f"/v1/speakers/{sid}", json={"description": "A pilot."}).json()["pronouns"] == "they/them"
    assert client.patch(f"/v1/speakers/{sid}", json={"pronouns": None}).json()["pronouns"] is None
    assert client.patch(f"/v1/speakers/{sid}", json={"pronouns": "xe/xem"}).status_code == 422
    listed = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
    assert [(s["name"], s["pronouns"]) for s in listed] == [("Mara", None)]


@pytest.mark.parametrize("sheet, want", [
    ("he/him", "he/him"), (" She/Her ", "she/her"), ("they", "they/them"), ("it/its", "it/its"),
    ("xe/xem", None), ("", None), (None, None),
])
def test_a_justwrite_sheets_pronouns_become_one_of_the_four(sheet, want):
    assert _pronouns({"pronouns": sheet}) == want


def test_analyze_and_smart_assign_are_told_the_pronouns():
    # The attribution prompt's speakers line (via the readable handles), and Smart-assign's.
    cast = [{"id": "s1", "name": "Mara Vance", "pronouns": "she/her", "aliases": []},
            {"id": "s2", "name": "Odd", "pronouns": None, "aliases": []}]
    line = format_characters(prompt_handles(cast)[0])
    assert 'name="Mara Vance", pronouns="she/her"' in line and line.count("pronouns=") == 1

    from justvoice.api.smart_assign_api import SmartAssignCharacter, _format_characters

    out = _format_characters([SmartAssignCharacter(id="s1", name="Mara Vance", pronouns="she/her")])
    assert 'pronouns="she/her"' in out


def test_the_cast_resolver_sends_each_speakers_pronouns(client):
    from justvoice.api.extraction_api import _resolve_cast
    from justvoice.database import session as db_session
    from justvoice.database.models import Scene

    pid = _project(client)
    client.post(f"/v1/projects/{pid}/speakers", json={"name": "Mara", "pronouns": "she/her"})
    db = db_session.SessionLocal()
    try:
        scene = Scene(project_id=pid, title="One", position=0)
        db.add(scene)
        db.commit()
        cast = _resolve_cast(scene.id, db)
    finally:
        db.close()
    assert [(c["name"], c["pronouns"]) for c in cast] == [("Mara", "she/her")]
