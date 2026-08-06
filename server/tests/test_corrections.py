# SPDX-License-Identifier: MIT
"""Correction memory — THE one writer (parity batch 2026-08-06).

`extraction_api.record_correction` is shared by the Studio block-PATCH side
effect and the attribution Lab's reassign door (POST
/v1/projects/{id}/corrections); these tests pin the shared behavior: the
400-char snippet cap, the 200-per-project cap, and both doors landing in the
same table the count/clear routes read.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


CSV = """id,scene,character,text
Q01_A,Ashfall,Hale,"Halt. State your business."
Q01_B,Ashfall,Hale,"The well's dry."
"""


def _import_project(client) -> str:
    r = client.post(
        "/v1/projects/import",
        data={"source": "csv_lines", "dry_run": "false"},
        files={"file": ("emberfall.csv", CSV.encode(), "text/csv")},
    )
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def _mk_persona(client, name: str) -> str:
    r = client.post("/v1/personas", json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_lab_door_records_and_counts(client) -> None:
    """character_id is an FK to personas — the door records REAL personas
    (the renderer's reassign offers only the project's real cast)."""
    pid = _import_project(client)
    hale = _mk_persona(client, "Hale")
    assert client.get(f"/v1/projects/{pid}/corrections/count").json()["count"] == 0

    r = client.post(
        f"/v1/projects/{pid}/corrections",
        json={"text_snippet": "“Halt,” he said.", "character_id": hale},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "count": 1}
    assert client.get(f"/v1/projects/{pid}/corrections/count").json()["count"] == 1

    # Clear wipes the project's memory.
    assert client.delete(f"/v1/projects/{pid}/corrections").json()["deleted"] == 1
    assert client.get(f"/v1/projects/{pid}/corrections/count").json()["count"] == 0


def test_lab_door_refuses_unknown_personas(client) -> None:
    """A synthetic lab-cast id is not a persona — the door answers 404, never
    a 500 off the FK."""
    pid = _import_project(client)
    r = client.post(
        f"/v1/projects/{pid}/corrections",
        json={"text_snippet": "“Halt,” he said.", "character_id": "c_hale_0"},
    )
    assert r.status_code == 404, r.text
    assert client.get(f"/v1/projects/{pid}/corrections/count").json()["count"] == 0


def test_snippet_capped_at_400_chars(client) -> None:
    pid = _import_project(client)
    who = _mk_persona(client, "Anna")
    client.post(
        f"/v1/projects/{pid}/corrections",
        json={"text_snippet": "x" * 1000, "character_id": who},
    )
    from justvoice.database import session as db_session
    from justvoice.database.models import SpeakerCorrection

    db = db_session.SessionLocal()
    try:
        row = db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == pid).one()
        assert len(row.text_snippet) == 400
    finally:
        db.close()


def test_cap_at_200_per_project(client) -> None:
    pid = _import_project(client)
    other = _import_project(client)
    who_a = _mk_persona(client, "Anna")
    who_b = _mk_persona(client, "Bram")
    from justvoice.api.extraction_api import record_correction
    from justvoice.database import session as db_session
    from justvoice.database.models import SpeakerCorrection

    db = db_session.SessionLocal()
    try:
        for i in range(205):
            record_correction(db, pid, f"line {i}", who_a)
        record_correction(db, other, "the other project's row", who_b)
        db.commit()
        assert (
            db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == pid).count()
            == 200
        )
        # The cap is per-project — the sibling's row is untouched.
        assert (
            db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == other).count()
            == 1
        )
    finally:
        db.close()


def test_studio_block_patch_shares_the_writer(client) -> None:
    """A persona reassign on a block writes the SAME correction memory the
    Lab door does (the shared record_correction — the two cannot drift)."""
    pid = _import_project(client)
    keeper = _mk_persona(client, "Keeper")
    from justvoice.database import session as db_session
    from justvoice.database.models import Block

    db = db_session.SessionLocal()
    try:
        block = db.query(Block).first()
        block_id, block_text = block.id, block.text
    finally:
        db.close()

    r = client.patch(f"/v1/blocks/{block_id}", json={"persona_id": keeper})
    assert r.status_code == 200, r.text

    counted = client.get(f"/v1/projects/{pid}/corrections/count").json()
    assert counted["count"] == 1
    from justvoice.database.models import SpeakerCorrection

    db = db_session.SessionLocal()
    try:
        row = db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == pid).one()
        assert row.character_id == keeper
        assert row.text_snippet == block_text[:400]
    finally:
        db.close()
