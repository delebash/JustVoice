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


@pytest.fixture()
def fake_speech(monkeypatch):
    """The speech model, faked: render_line returns a short silence that
    records the real inputs key (render_core.line_inputs_key), so a take made
    through the production door reads "rendered" until its line changes —
    Render's rule since Slice 4 (2026-10-04)."""
    from justvoice.render_core import RenderedLine, line_inputs_key

    def render_line(st, voice, text, **kw):
        key = line_inputs_key(st, voice, text, language=kw.get("language"), delivery=kw.get("delivery"),
                              seed=kw.get("seed"), lexicons=kw.get("lexicons"), effects=kw.get("effects"))
        return RenderedLine(pcm=b"\x00\x00" * 160, sample_rate=16000, channels=1, effective_delivery={},
                            inputs_key=key or "", seed=kw.get("seed"))

    monkeypatch.setattr("justvoice.render_core.render_line", render_line)


def _cast_everyone(client, pid):
    """Each speaker played by a persona with a voice — a line can render only then."""
    persona = client.post("/v1/personas", json={"name": "Gruff guard", "voice_id": "af_heart"}).json()["id"]
    for sp in client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]:
        client.patch(f"/v1/speakers/{sp['id']}", json={"persona_id": persona})


def _mark_rendered(client, pid, line_ids):
    """Render those lines through the one-line door (a take each)."""
    for row in client.get(f"/v1/projects/{pid}/lines").json()["lines"]:
        if row["line_id"] in line_ids:
            r = client.post(f"/v1/blocks/{row['block_id']}/render")
            assert r.status_code == 200, r.text


def test_reimport_updates_in_place_and_derives_staleness(client, fake_speech):
    pid = _import(client, CSV_V1)["project_id"]
    _cast_everyone(client, pid)
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


def test_block_render_clears_staleness(client, fake_speech):
    pid = _import(client, CSV_V1)["project_id"]
    # Hale played by a persona with a voice, so the production renderer
    # accepts the block (line → speaker → persona, 2026-09-29).
    _cast_everyone(client, pid)
    _mark_rendered(client, pid, {"Q01_A"})
    # change the text via re-import v2 → Q01_A goes stale
    _import(client, CSV_V2, project_id=pid)
    lines = client.get(f"/v1/projects/{pid}/lines").json()["lines"]
    stale = next(r for r in lines if r["line_id"] == "Q01_A")
    assert stale["take_status"] == "stale"
    assert stale["state"] == "stale"

    r = client.post(f"/v1/blocks/{stale['block_id']}/render")
    assert r.status_code == 200, r.text
    lines = client.get(f"/v1/projects/{pid}/lines").json()["lines"]
    assert next(x for x in lines if x["line_id"] == "Q01_A")["take_status"] == "rendered"
