# SPDX-License-Identifier: MIT
"""A chapter's text, edited from Script's grid — "✎ Edit text" (2026-10-05).

TASKS "A chapter's text can be edited from its row, and a chapter opens before
Analyze". What these pin:
  * the text is the chapter's lines, a paragraph each
  * a line whose words are unchanged keeps its id, speaker and takes; spacing
    is not a change
  * a changed or new paragraph is a new line with no speaker (source
    "manual"), and Script counts it "changed since" on an analyzed chapter
  * a removed or changed line takes its takes with it, and a dry run says how
    many lines with takes would go, changing nothing
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.api.projects_api import text_edit_plan
from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json, scene

pytest_plugins = ["tests.conftest_db"]

P1 = "The lamps guttered in the hall."
P2 = "“We leave at dawn,” said Mara Vance."
P3 = "Nobody answered her."


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def project(client):
    r = client.post(
        "/v1/projects/import?source=justwrite",
        json=book_json(chapters=[("ch1", "One", [scene("scn1", P1, P2, P3)])]),
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


def _put(client, scene_id, text, dry_run=False):
    return client.put(f"/v1/scenes/{scene_id}/text", json={"text": text, "dry_run": dry_run})


# ── The match ────────────────────────────────────────────────────────────


def test_the_plan_keeps_unchanged_lines_and_counts_the_rest():
    steps, counts = text_edit_plan(["a", "b", "c", "d"], ["a", "B!", "c", "e", "f"])
    assert counts == {"kept": 2, "changed": 2, "added": 1, "removed": 0}
    assert [s for s in steps if s[0] != "drop"] == [("keep", 0), ("new", 1), ("keep", 2), ("new", 3), ("new", 4)]
    assert sorted(i for kind, i in steps if kind == "drop") == [1, 3]


def test_spacing_is_not_a_change():
    _, counts = text_edit_plan(["one  two\nthree"], ["one two three"])
    assert counts == {"kept": 1, "changed": 0, "added": 0, "removed": 0}


# ── The routes ───────────────────────────────────────────────────────────


def test_the_text_is_the_chapters_lines_a_paragraph_each(client, project):
    text = client.get(f"/v1/scenes/{project.scene_id}/text").json()["text"]
    assert text == "\n\n".join(b["text"] for b in _blocks(client, project.scene_id))


def test_an_unchanged_text_changes_nothing(client, project):
    before = _blocks(client, project.scene_id)
    text = client.get(f"/v1/scenes/{project.scene_id}/text").json()["text"]
    r = _put(client, project.scene_id, text + "\n\n\n")
    assert r.status_code == 200, r.text
    assert r.json()["changed"] == r.json()["added"] == r.json()["removed"] == 0
    assert _blocks(client, project.scene_id) == before


def test_a_changed_paragraph_is_a_new_line_and_the_rest_keep_everything(client, project):
    before = _blocks(client, project.scene_id)
    mara = next(s["id"] for s in client.get(f"/v1/projects/{project.id}/speakers").json()["speakers"]
                if s["name"] == "Mara Vance")
    client.patch(f"/v1/blocks/{before[0]['id']}", json={"speaker_id": mara, "source": "corrected"})
    paras = [b["text"] for b in before]
    paras[-1] = "Nobody answered him."
    paras.append("The door shut.")

    r = _put(client, project.scene_id, "\n\n".join(paras))
    assert r.status_code == 200, r.text
    assert r.json() == {"kept": len(before) - 1, "changed": 1, "added": 1, "removed": 0, "takes_lost": 0}

    after = _blocks(client, project.scene_id)
    assert [b["text"] for b in after] == paras
    assert [b["id"] for b in after[:-2]] == [b["id"] for b in before[:-1]]
    assert after[0]["speaker_id"] == mara and after[0]["source"] == "corrected"
    assert all(b["speaker_id"] is None and b["source"] == "manual" for b in after[-2:])
    assert [b["position"] for b in after] == list(range(len(after)))


def test_a_dry_run_says_which_takes_would_go_and_changes_nothing(client, project):
    before = _blocks(client, project.scene_id)
    _add_take(before[0]["id"])
    _add_take(before[1]["id"])
    text = "\n\n".join(["Changed.", *[b["text"] for b in before[2:]]])

    r = _put(client, project.scene_id, text, dry_run=True)
    assert r.json()["takes_lost"] == 2
    assert _blocks(client, project.scene_id) == before

    assert _put(client, project.scene_id, text).status_code == 200
    from justvoice.database import session as db_session
    from justvoice.database.models import Take

    db = db_session.SessionLocal()
    try:
        assert db.query(Take).filter(Take.block_id.in_([before[0]["id"], before[1]["id"]])).count() == 0
    finally:
        db.close()


def test_an_empty_text_is_refused(client, project):
    r = _put(client, project.scene_id, " \n\n ")
    assert r.status_code == 400
    assert "Delete" in r.text


def test_script_counts_lines_changed_since_the_last_analyze(client, project, monkeypatch):
    def run(action, variables, **overrides):
        return SimpleNamespace(text="[]", prompt_tokens=0, completion_tokens=0, model="stub")

    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", run)
    text = client.get(f"/v1/scenes/{project.scene_id}/text").json()["text"]
    assert client.post(f"/v1/scenes/{project.scene_id}/analyze", json={"text": text}).status_code == 200

    def edited():
        chapters = client.get(f"/v1/projects/{project.id}/script").json()["chapters"]
        return chapters[0]["edited_since"]

    assert edited() == 0
    lines = _blocks(client, project.scene_id)
    _put(client, project.scene_id, "\n\n".join([*(b["text"] for b in lines), "The door shut."]))
    assert edited() == 1
