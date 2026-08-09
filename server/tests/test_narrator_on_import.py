# SPDX-License-Identifier: MIT
"""An imported book gets a Narrator too — and never two of them.

Until 2026-08-08 only `create_project` made one, so every book that arrived
from JustWrite (the primary workflow) had no narrator at all and its prose
could not be bound to anything: attribution's narration rows had nowhere to
go and the render dropped them in silence.

The second half matters as much: `ensure_project_persona` dedupes on
(imported_from, imported_id), NOT on name, and a manuscript may ship its own
narrator character — `docs/import-and-export.md:50` shows exactly that. Ours
must adopt the book's rather than sit beside it under the same name.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json

pytest_plugins = ["tests.conftest_db"]


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


def _cast(client, project_id):
    cast = client.get(f"/v1/projects/{project_id}/cast").json()["cast"]
    personas = {p["id"]: p for p in client.get("/v1/personas").json()["personas"]}
    return [{**c, "name": personas[c["persona_id"]]["name"]} for c in cast]


def _import(client, **kwargs):
    r = client.post("/v1/projects/import?source=justwrite", json=book_json(**kwargs))
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_an_imported_book_gets_a_narrator(client):
    cast = _cast(client, _import(client))
    narrators = [c for c in cast if c["name"].lower() == "narrator"]
    assert len(narrators) == 1, cast
    assert narrators[0]["role_label"] == "narrator"


def test_a_book_that_names_its_own_narrator_gets_one_not_two(client):
    pid = _import(client, characters=[
        {
            "id": "narr", "name": "Narrator", "main": True, "age": 0,
            "gender": "", "pronouns": "", "aliases": [],
            "lifeStatus": "alive", "oneLiner": "", "role": "", "tags": [],
        },
    ])
    cast = _cast(client, pid)
    narrators = [c for c in cast if c["name"].lower() == "narrator"]
    assert len(narrators) == 1, cast
    # The book's own character was adopted — it carries the role now.
    assert narrators[0]["role_label"] == "narrator"


def test_a_game_import_gets_no_narrator(client):
    """NPCs only — no single prose voice. Same rule as create_project."""
    from tests.jw_fixtures import book_json as _unused  # noqa: F401

    csv = b"scene,character,text\nq1,Hale,Halt.\n"
    r = client.post(
        "/v1/projects/import",
        data={"source": "csv_lines"},
        files={"file": ("lines.csv", csv, "text/csv")},
    )
    assert r.status_code == 200, r.text
    cast = _cast(client, r.json()["project_id"])
    assert not [c for c in cast if c["name"].lower() == "narrator"], cast
