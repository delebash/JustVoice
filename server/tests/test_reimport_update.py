# SPDX-License-Identifier: MIT
"""Game re-import — update-in-place by stable line id + derived staleness."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


CSV_V1 = """id,scene,character,text
Q01_A,Ashfall,Hale,"Halt. State your business."
Q01_B,Ashfall,Hale,"The well's dry."
Q02_A,Gate,Keeper,"Three seals were placed."
"""

# v2: Q01_A changed, Q01_B unchanged, Q02_A removed, Q02_B added
CSV_V2 = """id,scene,character,text
Q01_A,Ashfall,Hale,"HALT. State your business, traveler."
Q01_B,Ashfall,Hale,"The well's dry."
Q02_B,Gate,Keeper,"Three seals must answer."
"""


def _import(client, csv, project_id=None):
    data = {"source": "csv_lines", "dry_run": "false"}
    if project_id:
        data["project_id"] = project_id
    r = client.post(
        "/v1/projects/import",
        data=data,
        files={"file": ("emberfall.csv", csv.encode(), "text/csv")},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _mark_rendered(client, pid, line_ids):
    """Simulate renders: write Generation+Take rows w/ the block's text."""
    from justvoice.database import session as db_session
    from justvoice.database.models import Block, Generation, Take

    db = db_session.SessionLocal()
    try:
        import json as _json

        blocks = db.query(Block).all()
        for b in blocks:
            ref = _json.loads(b.metadata_json or "{}").get("source_ref")
            if ref in line_ids:
                g = Generation(block_id=b.id, text=b.text, engine="test", status="completed")
                db.add(g)
                db.flush()
                db.add(Take(block_id=b.id, generation_id=g.id, is_default=True))
        db.commit()
    finally:
        db.close()


def test_reimport_updates_in_place_and_derives_staleness(client):
    pid = _import(client, CSV_V1)["project_id"]
    _mark_rendered(client, pid, {"Q01_A", "Q01_B", "Q02_A"})

    before = client.get(f"/v1/projects/{pid}/lines").json()
    assert before["counts"] == {"none": 0, "rendered": 3, "stale": 0}

    r = _import(client, CSV_V2, project_id=pid)
    assert r["project_id"] == pid
    assert any("updated in place" in w for w in r["warnings"])

    after = client.get(f"/v1/projects/{pid}/lines").json()
    by_id = {row["line_id"]: row for row in after["lines"]}
    assert by_id["Q01_A"]["take_status"] == "stale"      # text changed
    assert by_id["Q01_A"]["text"].startswith("HALT.")
    assert by_id["Q01_B"]["take_status"] == "rendered"   # untouched
    assert by_id["Q02_B"]["take_status"] == "none"       # new line
    assert "Q02_A" not in by_id                            # removed
    assert after["counts"] == {"none": 1, "rendered": 1, "stale": 1}
    # No duplicate project created.
    projects = client.get("/v1/projects").json()["projects"]
    assert len([p for p in projects if p["name"] == "emberfall"]) == 1


def test_update_requires_stable_ids(client):
    pid = _import(client, CSV_V1)["project_id"]
    no_ids = 'scene,character,text\nAshfall,Hale,"Hello."\n'
    r = client.post(
        "/v1/projects/import",
        data={"source": "csv_lines", "dry_run": "false", "project_id": pid},
        files={"file": ("x.csv", no_ids.encode(), "text/csv")},
    )
    assert r.status_code == 400
    assert "stable line id" in r.text


def test_block_render_clears_staleness(client, monkeypatch):
    from justvoice.render_core import RenderedLine

    pid = _import(client, CSV_V1)["project_id"]
    _mark_rendered(client, pid, {"Q01_A"})
    # change the text via re-import v2 → Q01_A goes stale
    _import(client, CSV_V2, project_id=pid)
    lines = client.get(f"/v1/projects/{pid}/lines").json()["lines"]
    stale = next(r for r in lines if r["line_id"] == "Q01_A")
    assert stale["take_status"] == "stale"

    # voice on the persona so the production renderer accepts the block
    personas = client.get("/v1/personas").json()["personas"]
    hale = next(p for p in personas if p["name"] == "Hale")
    body = {
        **{k: hale.get(k) for k in ("name", "language", "personality")},
        "voice_id": "af_heart",
    }
    client.put(f"/v1/personas/{hale['id']}", json=body)

    monkeypatch.setattr(
        "justvoice.render_core.render_line",
        lambda st, voice, text, **kw: RenderedLine(
            pcm=b"\x00\x00" * 160, sample_rate=16000, channels=1, effective_delivery={}
        ),
    )
    r = client.post(f"/v1/blocks/{stale['block_id']}/render")
    assert r.status_code == 200, r.text
    lines = client.get(f"/v1/projects/{pid}/lines").json()["lines"]
    assert next(x for x in lines if x["line_id"] == "Q01_A")["take_status"] == "rendered"
