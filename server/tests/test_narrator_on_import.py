# SPDX-License-Identifier: MIT
"""An import never makes a narrator; a book's own "Narrator" becomes it.

Until 2026-09-29 every import made a new "Narrator" persona, and deleting the
book left it in the library — re-imports piled them up (three in the user's
library). Decided that day: no book gets a narrator on its own; you tick one
in Cast or use "+ Add Narrator".

One case stays: a manuscript may ship its own narrator character —
`docs/import-and-export.md:50` shows exactly that — and that character is
marked as the narrator. Nothing new is created.
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
    return client.get(f"/v1/projects/{project_id}/speakers").json()["speakers"]


def _import(client, **kwargs):
    r = client.post("/v1/projects/import?source=justwrite", json=book_json(**kwargs))
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_an_import_makes_no_narrator(client):
    cast = _cast(client, _import(client))
    assert [c["name"] for c in cast] == ["Mara Vance"]
    assert not [c for c in cast if c["role_label"] == "narrator"]
    assert client.get("/v1/personas").json()["personas"] == [], "an import makes no persona"


def test_reimporting_a_deleted_book_leaves_nothing_behind(client):
    """The pile-up this replaced: import, delete, import again. Speakers go
    with their book; the library of personas never saw them."""
    first = _import(client)
    assert client.delete(f"/v1/projects/{first}").status_code == 200
    second = _import(client)
    assert [c["name"] for c in _cast(client, second)] == ["Mara Vance"]
    assert client.get("/v1/personas").json()["personas"] == []


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


# ── One narrator rule (2026-09-30, docs/plans/2026-09-30-script-leftovers.md B6) ──

SRT = (
    "1\n00:00:01,000 --> 00:00:03,000\nNARRATOR: The rain fell on the quay.\n\n"
    "2\n00:00:03,500 --> 00:00:05,000\nMARA: We leave at dawn.\n"
).encode("utf-8")


def _import_srt(client):
    r = client.post(
        "/v1/projects/import",
        data={"source": "srt"},
        files={"file": ("scene.srt", SRT, "application/x-subrip")},
    )
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_a_custom_import_adopts_its_own_narrator(client):
    pid = _import_srt(client)
    assert client.get(f"/v1/projects/{pid}").json()["project_type"] == "custom"
    narrators = [c for c in _cast(client, pid) if c["name"].lower() == "narrator"]
    assert len(narrators) == 1 and narrators[0]["role_label"] == "narrator"


def test_a_speaker_merely_called_narrator_is_not_the_narrator(client):
    """The role is the rule — Studio and Cast read only the role, and so does
    the server now; a name alone made the two disagree."""
    pid = client.post("/v1/projects", json={"name": "Stillwater", "project_type": "audiobook"}).json()["id"]
    r = client.post(f"/v1/projects/{pid}/speakers", json={"name": "Narrator"})
    assert r.status_code in (200, 201), r.text
    scene_id = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]
    client.post(f"/v1/scenes/{scene_id}/blocks", json={"text": "The rain fell."})
    assert client.get(f"/v1/scenes/{scene_id}/script").json()["narrator_id"] is None
