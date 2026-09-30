# SPDX-License-Identifier: MIT
"""Split and merge a line on Script, and what Script shows as "Left out".

docs/plans/2026-09-30-script-leftovers.md — B1/B2 (Script's "✎ Edit…" with
"Split at the cursor", and "⇲ Merge") and B4 ("Leave out dialogue tags").

What these pin:
  * a split keeps the first line's id, takes and import line id; the second
    is new, with the same speaker, placed right after it
  * a merge joins lines that sit next to each other onto the first one and
    deletes the rest — their takes with them
  * both drop the analyzed text, so a re-analyze keeps the hand cut
  * Script marks a tag-only line "Left out" only when the project says so
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json, scene

pytest_plugins = ["tests.conftest_db"]

PARA_1 = "The lamps guttered in the hall."
PARA_2 = "“We leave at dawn,” said Mara Vance."


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def project(client):
    r = client.post(
        "/v1/projects/import?source=justwrite",
        json=book_json(chapters=[("ch1", "One", [scene("scn1", PARA_1, PARA_2)])]),
    )
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    sid = client.get(f"/v1/projects/{pid}/scenes").json()[0]["id"]
    return SimpleNamespace(id=pid, scene_id=sid)


def _blocks(client, scene_id):
    return client.get(f"/v1/scenes/{scene_id}/blocks").json()


def _add_take(block_id):
    from justvoice.database import session as db_session
    from justvoice.database.models import Generation, Take

    db = db_session.SessionLocal()
    try:
        gen = Generation(text="x", engine="stub", status="completed")
        db.add(gen)
        db.flush()
        db.add(Take(block_id=block_id, generation_id=gen.id, is_default=True))
        db.commit()
    finally:
        db.close()


def _take_count(block_id):
    from justvoice.database import session as db_session
    from justvoice.database.models import Take

    db = db_session.SessionLocal()
    try:
        return db.query(Take).filter(Take.block_id == block_id).count()
    finally:
        db.close()


def _answer(speaker: str):
    def run(action, variables, **overrides):
        return SimpleNamespace(
            text=f'[{{"dialogue_id": 0, "speaker": "{speaker}", "confidence": 0.9}}]',
            prompt_tokens=0, completion_tokens=0, model="stub",
        )
    return run


# ── Split ────────────────────────────────────────────────────────────────


def test_a_split_keeps_the_first_line_and_adds_the_second_after_it(client, project):
    before = _blocks(client, project.scene_id)
    _add_take(before[0]["id"])
    r = client.post(f"/v1/blocks/{before[0]['id']}/split", json={"at": len("The lamps")})
    assert r.status_code == 200, r.text
    first, second = r.json()["blocks"]
    assert (first["id"], first["text"], second["text"]) == (before[0]["id"], "The lamps", "guttered in the hall.")

    after = _blocks(client, project.scene_id)
    assert [b["text"] for b in after] == ["The lamps", "guttered in the hall.", PARA_2]
    assert [b["position"] for b in after] == [0, 1, 2]
    assert after[1]["speaker_id"] == after[0]["speaker_id"]
    assert after[0]["metadata"].get("source_ref") and "source_ref" not in after[1]["metadata"]
    assert _take_count(before[0]["id"]) == 1                 # the first half keeps its takes


def test_a_split_can_carry_the_editors_words(client, project):
    bid = _blocks(client, project.scene_id)[0]["id"]
    r = client.post(f"/v1/blocks/{bid}/split", json={"at": 3, "text": "One two"})
    assert [b["text"] for b in r.json()["blocks"]] == ["One", "two"]


@pytest.mark.parametrize("at", [0, len(PARA_1), 999])
def test_a_split_needs_words_on_both_sides(client, project, at):
    bid = _blocks(client, project.scene_id)[0]["id"]
    r = client.post(f"/v1/blocks/{bid}/split", json={"at": at})
    assert r.status_code == 400, r.text
    assert len(_blocks(client, project.scene_id)) == 2


# ── Merge ────────────────────────────────────────────────────────────────


def test_a_merge_joins_neighbours_onto_the_first_and_deletes_their_takes(client, project):
    b0, b1 = _blocks(client, project.scene_id)
    _add_take(b1["id"])
    r = client.post(f"/v1/scenes/{project.scene_id}/blocks/merge", json={"ids": [b1["id"], b0["id"]]})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == b0["id"]
    after = _blocks(client, project.scene_id)
    assert [(b["id"], b["text"], b["position"]) for b in after] == [(b0["id"], f"{PARA_1} {PARA_2}", 0)]
    assert _take_count(b1["id"]) == 0


def test_only_lines_next_to_each_other_merge(client, project):
    b0, b1 = _blocks(client, project.scene_id)
    client.post(f"/v1/blocks/{b1['id']}/split", json={"at": len("“We leave at dawn,”")})
    b0, b1, b2 = _blocks(client, project.scene_id)
    r = client.post(f"/v1/scenes/{project.scene_id}/blocks/merge", json={"ids": [b0["id"], b2["id"]]})
    assert r.status_code == 400 and "next to each other" in r.json()["detail"]
    r = client.post(f"/v1/scenes/{project.scene_id}/blocks/merge", json={"ids": [b0["id"]]})
    assert r.status_code == 422
    r = client.post(f"/v1/scenes/{project.scene_id}/blocks/merge", json={"ids": [b0["id"], "elsewhere"]})
    assert r.status_code == 400
    assert len(_blocks(client, project.scene_id)) == 3


# ── A hand cut survives a re-analyze ──────────────────────────────────────


def test_a_hand_cut_survives_a_reanalyze(client, project, monkeypatch):
    # The book's speech is in single quotes, but the project is set to double,
    # so Analyze reads the line as narration; it is split by hand and given
    # to Mara, and re-analyzing must not undo that.
    client.patch(f"/v1/projects/{project.id}", json={"metadata": {"speech_marks": "double"}})
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _answer("nobody-real"))
    text = "She turned. 'Wait,' she said."
    assert client.post(f"/v1/scenes/{project.scene_id}/analyze", json={"text": text}).status_code == 200
    (only,) = _blocks(client, project.scene_id)
    assert only["source"] == "narration"

    client.post(f"/v1/blocks/{only['id']}/split", json={"at": len("She turned.")})
    second = _blocks(client, project.scene_id)[1]
    client.post(f"/v1/blocks/{second['id']}/split", json={"at": len("'Wait,'")})
    cut = _blocks(client, project.scene_id)
    mara = next(s["id"] for s in client.get(f"/v1/projects/{project.id}/speakers").json()["speakers"]
                if s["name"] == "Mara Vance")
    client.patch(f"/v1/blocks/{cut[1]['id']}", json={"speaker_id": mara, "source": "corrected"})

    joined = "\n\n".join(b["text"] for b in cut)
    r = client.post(f"/v1/scenes/{project.scene_id}/analyze", json={"text": joined})
    assert r.status_code == 200, r.text
    after = _blocks(client, project.scene_id)
    assert [b["id"] for b in after] == [b["id"] for b in cut]
    assert [b["text"] for b in after] == ["She turned.", "'Wait,'", "she said."]
    assert after[1]["speaker_id"] == mara


# ── Script's "Left out" ──────────────────────────────────────────────────


def test_script_marks_tag_only_lines_left_out_only_when_the_project_says_so(client, project, monkeypatch):
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _answer("nobody-real"))
    text = f"{PARA_1}\n\n“We leave at dawn,” said Mara Vance, “before the tide.”"
    client.post(f"/v1/scenes/{project.scene_id}/analyze", json={"text": text})

    def left_out():
        lines = client.get(f"/v1/scenes/{project.scene_id}/script").json()["lines"]
        return [ln["text"] for ln in lines if ln["left_out"]]

    assert left_out() == []
    meta = client.get(f"/v1/projects/{project.id}").json()["metadata"]
    client.patch(f"/v1/projects/{project.id}", json={"metadata": {**meta, "leave_out_tags": True}})
    assert left_out() == ["said Mara Vance,"]


def test_script_counts_each_lines_takes(client, project):
    b0, _b1 = _blocks(client, project.scene_id)
    _add_take(b0["id"])
    _add_take(b0["id"])
    lines = client.get(f"/v1/scenes/{project.scene_id}/script").json()["lines"]
    assert [ln["takes"] for ln in lines] == [2, 0]


def test_the_project_settings_keep_each_other(client, project):
    """Overview writes one key at a time into the project's metadata, merged
    on the client; the server stores what it's given."""
    client.patch(f"/v1/projects/{project.id}", json={"metadata": {"speech_marks": "single"}})
    meta = client.get(f"/v1/projects/{project.id}").json()["metadata"]
    client.patch(f"/v1/projects/{project.id}", json={"metadata": {**meta, "leave_out_tags": True}})
    assert json.loads(json.dumps(client.get(f"/v1/projects/{project.id}").json()["metadata"])) == {
        "speech_marks": "single", "leave_out_tags": True,
    }
