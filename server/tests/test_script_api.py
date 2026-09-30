# SPDX-License-Identifier: MIT
"""Script's server half — Studio Slice 3, 3a (§8.24).

What these pin:
  * an Analyze run records when it ran and the cast it could choose from,
    and on each line its paragraph, the book's words that named the speaker,
    and the model's differing pick where the book won
  * a re-analyze that changes a line's speaker records who it was, and
    setting or confirming the line clears that mark
  * the two script endpoints: the grid row and the chapter page, flags
    included, on the one "analyzed" rule
  * "added since", "from the import", "not in the cast", "no dialogue found"
  * the block PATCH: no_fix, the fix id, deleting one fix, clearing a speaker
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

PARAS = [
    "“We leave at dawn,” said Mara.",      # D0 — the book names Mara
    "“Not yet.”",                          # D1
    "“Why?”",                              # D2
    "“The tide.”",                         # D3
    "The lamps guttered in the hall.",
]
TEXT = "\n\n".join(PARAS)
CHARACTERS = [
    {"id": "mara", "name": "Mara Vance", "aliases": ["Mara"], "main": True},
    {"id": "tom", "name": "Tom Hale", "aliases": [], "main": False},
]


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def project(client):
    r = client.post(
        "/v1/projects/import?source=justwrite",
        json=book_json(characters=CHARACTERS,
                       chapters=[("ch1", "One", [scene("scn1", *PARAS)])]),
    )
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    sid = client.get(f"/v1/projects/{pid}/scenes").json()[0]["id"]
    # "+ Add Narrator" — no book has a narrator until you choose one (2026-09-29).
    assert client.post(f"/v1/projects/{pid}/narrator").status_code == 201
    cast = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
    ids = {s["name"]: s["id"] for s in cast}
    narrator = next(s["id"] for s in cast if s["role_label"] == "narrator")
    return SimpleNamespace(id=pid, scene_id=sid, mara=ids["Mara Vance"], tom=ids["Tom Hale"],
                           narrator=narrator)


def _model_says(monkeypatch, picks: dict[int, str], confidence: float = 0.95):
    """Stub the model: `picks` maps each [D#] to a speaker id."""
    def run(action, variables, **overrides):
        reply = [{"dialogue_id": d, "speaker": who, "confidence": confidence}
                 for d, who in picks.items()]
        return SimpleNamespace(text=json.dumps(reply), prompt_tokens=0,
                               completion_tokens=0, model="stub")
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", run)


def _analyze(client, scene_id, text=TEXT):
    r = client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()


def _blocks(client, scene_id):
    return client.get(f"/v1/scenes/{scene_id}/blocks").json()


def _spoken(client, scene_id):
    return [b for b in _blocks(client, scene_id) if b["source"] != "narration"]


def _scene_meta(client, project_id):
    return client.get(f"/v1/projects/{project_id}/scenes").json()[0]["metadata"]


def _all_tom(p):
    return {0: p.tom, 1: p.tom, 2: p.tom, 3: p.tom}


# ── What a run records ─────────────────────────────────────────────────────


def test_a_run_records_when_and_the_cast_it_chose_from(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    meta = _scene_meta(client, project.id)
    assert meta["analyzed_at"]
    assert meta["analyzed_cast"] == sorted([project.mara, project.tom, project.narrator])


def test_each_line_records_its_paragraph_and_the_books_words(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    blocks = _blocks(client, project.scene_id)
    assert [b["metadata"]["paragraph_idx"] for b in blocks] == [0, 0, 1, 2, 3, 4]
    d0 = blocks[0]
    assert d0["source"] == "tag" and d0["speaker_id"] == project.mara
    assert d0["metadata"]["anchor_words"] == "said Mara"
    # The book won; the model had said Tom — kept for "the book and the AI disagree".
    assert d0["metadata"]["llm_speaker"] == project.tom
    assert "llm_speaker" not in blocks[2]["metadata"]      # the model decided that one
    assert "prev_speaker_id" not in d0["metadata"]         # a first run changes no one's mind


def test_a_propagated_line_carries_its_tags_words(client, project, monkeypatch):
    text = "“Wait.” “We leave at dawn,” said Mara."
    _model_says(monkeypatch, {0: project.mara, 1: project.mara})
    _analyze(client, project.scene_id, text)
    spoken = _spoken(client, project.scene_id)
    assert [b["source"] for b in spoken] == ["propagated", "tag"]
    assert [b["metadata"]["anchor_words"] for b in spoken] == ["said Mara", "said Mara"]


def test_a_reanalyze_records_who_a_changed_line_was(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    _model_says(monkeypatch, {**_all_tom(project), 2: project.mara})
    _analyze(client, project.scene_id, _scene_meta(client, project.id)["source_text"])

    spoken = _spoken(client, project.scene_id)
    changed = [b for b in spoken if "prev_speaker_id" in b["metadata"]]
    assert [b["text"] for b in changed] == ["“Why?”"]
    assert changed[0]["speaker_id"] == project.mara
    assert changed[0]["metadata"]["prev_speaker_id"] == project.tom

    page = client.get(f"/v1/scenes/{project.scene_id}/script").json()
    assert page["chapter"]["changed"] == 1
    line = next(ln for ln in page["lines"] if ln["id"] == changed[0]["id"])
    assert line["changed"] and line["prev_speaker_id"] == project.tom

    # Confirming the line ("Looks right") clears the mark and saves no fix.
    r = client.patch(f"/v1/blocks/{line['id']}", json={"source": "corrected"})
    assert r.status_code == 200 and r.json()["fix_id"] is None
    assert "prev_speaker_id" not in r.json()["metadata"]


# ── The two script endpoints ───────────────────────────────────────────────


def test_the_chapter_page_carries_its_flags(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    page = client.get(f"/v1/scenes/{project.scene_id}/script").json()

    spoken = [ln for ln in page["lines"] if ln["spoken"]]
    d0, d1, d2, d3 = (ln["id"] for ln in spoken)
    groups = [(g["check"], g["speaker"], g["lines"]) for g in page["flag_groups"]]
    assert groups == [
        ("only", project.mara, [d0]),                  # Mara's only line
        ("disagree", project.mara, [d0]),              # the book says Mara, the AI Tom
        ("run", project.tom, [d1, d2, d3]),            # Tom three times, no reply
    ]
    assert page["flag_groups"][1]["other"] == project.tom
    assert page["flag_groups"][2]["turns"] == 3
    assert spoken[0]["anchor_words"] == "said Mara"
    assert spoken[1]["flags"] == [2]

    ch = page["chapter"]
    assert (ch["lines"], ch["spoken"], ch["anchored"], ch["guessed"], ch["by_you"]) == (6, 4, 1, 3, 0)
    assert (ch["flagged"], ch["flag_groups"], ch["no_speaker"], ch["to_check"]) == (4, 3, 0, 4)
    assert ch["analyzed"] and ch["analyzed_at"] and not ch["from_import"]
    # Speakers: most lines first, every speaker of the book offered.
    assert [(s["speaker_id"], s["lines"]) for s in page["speakers"]][:2] == [
        (project.tom, 3), (project.narrator, 2)]
    assert {s["speaker_id"] for s in page["speakers"]} == {project.tom, project.narrator,
                                                            project.mara}
    assert page["narrator_id"] == project.narrator


def test_the_grid_row_and_the_one_analyzed_rule(client, project, monkeypatch):
    before = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    # Imported prose, no speakers: never analyzed, not "from the import".
    assert not before["analyzed"] and not before["from_import"]
    assert before["flag_groups"] == 0 and before["lines"] == 5
    # Its lines have no speaker, but it needs Analyze, not checking.
    assert before["no_speaker"] == 5 and before["to_check"] == 0

    _model_says(monkeypatch, {0: project.mara, 1: project.tom, 2: project.mara, 3: project.tom})
    _analyze(client, project.scene_id)
    row = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    assert row["analyzed"] and row["title"] == "One"
    assert (row["anchored"], row["guessed"], row["flagged"], row["to_check"]) == (1, 3, 0, 0)


def test_speakers_from_the_import_are_not_analyzed(client, project):
    for b in _blocks(client, project.scene_id):
        client.patch(f"/v1/blocks/{b['id']}", json={"speaker_id": project.narrator})
    row = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    assert row["from_import"] and not row["analyzed"]
    assert row["no_speaker"] == 0 and row["flag_groups"] == 0


def test_a_speaker_added_since_whose_name_is_in_the_text(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    for name in ("Tide", "Harbek"):           # "The tide." names one; nothing names Harbek
        r = client.post(f"/v1/projects/{project.id}/speakers", json={"name": name})
        assert r.status_code == 201, r.text
    row = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    assert row["added_since"] == ["Tide"]


def test_a_removed_speaker_leaves_their_lines_with_no_speaker(client, project, monkeypatch):
    """Since 2026-09-29 removing a speaker deletes it from the book: its lines
    go back to no speaker, and the page no longer lists it."""
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    r = client.delete(f"/v1/speakers/{project.tom}")
    assert r.status_code == 200 and r.json()["lines"] == 3
    page = client.get(f"/v1/scenes/{project.scene_id}/script").json()
    assert project.tom not in {s["speaker_id"] for s in page["speakers"]}
    assert sum(ln["speaker_id"] == project.tom for ln in page["lines"]) == 0
    assert page["chapter"]["no_speaker"] == 3


def test_a_line_left_with_no_speaker_is_not_counted_as_decided(client, project, monkeypatch):
    _model_says(monkeypatch, {0: project.tom, 1: "someone-invented", 2: project.tom, 3: project.mara})
    _analyze(client, project.scene_id)
    row = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    assert (row["anchored"], row["guessed"], row["by_you"], row["no_speaker"]) == (1, 2, 0, 1)
    assert row["anchored"] + row["guessed"] + row["by_you"] + row["no_speaker"] == row["spoken"]


def test_no_dialogue_found(client, project, monkeypatch):
    # Speech after a dash is the style the segmenter doesn't read (single
    # quotes are read since 2026-09-30, Speech marks).
    _model_says(monkeypatch, {})
    _analyze(client, project.scene_id, "The lamps guttered.\n\n— Wait, she said.")
    row = client.get(f"/v1/projects/{project.id}/script").json()["chapters"][0]
    assert row["analyzed"] and row["spoken"] == 0 and row["no_dialogue_found"]


def test_a_single_quoted_chapter_finds_its_speech(client, project, monkeypatch):
    _model_says(monkeypatch, {})
    _analyze(client, project.scene_id, "The lamps guttered.\n\n‘Wait,’ she said. ‘I don’t know.’")
    lines = client.get(f"/v1/scenes/{project.scene_id}/script").json()["lines"]
    assert [ln["text"] for ln in lines if ln["spoken"]] == ["‘Wait,’", "‘I don’t know.’"]


def test_unknown_scene_and_project_404(client):
    assert client.get("/v1/scenes/nope/script").status_code == 404
    assert client.get("/v1/projects/nope/script").status_code == 404


# ── The block PATCH and one fix ────────────────────────────────────────────


def _fix_count(client, project_id):
    return client.get(f"/v1/projects/{project_id}/corrections/count").json()["count"]


def test_a_speaker_change_returns_its_fix_and_undo_removes_it(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    line = _spoken(client, project.scene_id)[2]
    base = _fix_count(client, project.id)

    r = client.patch(f"/v1/blocks/{line['id']}",
                     json={"speaker_id": project.mara, "source": "corrected"})
    fix_id = r.json()["fix_id"]
    assert fix_id and _fix_count(client, project.id) == base + 1

    # Undo: the old speaker back, no new fix, and the saved one deleted.
    r = client.patch(f"/v1/blocks/{line['id']}", json={
        "speaker_id": project.tom, "source": line["source"],
        "extraction_confidence": line["extraction_confidence"],
        "metadata": line["metadata"], "no_fix": True})
    assert r.status_code == 200 and r.json()["fix_id"] is None
    assert r.json()["source"] == "llm" and r.json()["speaker_id"] == project.tom
    r = client.delete(f"/v1/projects/{project.id}/corrections/{fix_id}")
    assert r.json() == {"deleted": 1}
    assert _fix_count(client, project.id) == base
    # Already gone is not an error.
    assert client.delete(f"/v1/projects/{project.id}/corrections/{fix_id}").json() == {"deleted": 0}


def test_a_null_speaker_clears_it_and_a_missing_one_leaves_it(client, project, monkeypatch):
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    line = _spoken(client, project.scene_id)[1]
    r = client.patch(f"/v1/blocks/{line['id']}", json={"direction": "quietly"})
    assert r.json()["speaker_id"] == project.tom
    r = client.patch(f"/v1/blocks/{line['id']}", json={"speaker_id": None, "no_fix": True})
    assert r.json()["speaker_id"] is None
    # Source and confidence clear the same way — a line that came with the
    # import had neither.
    r = client.patch(f"/v1/blocks/{line['id']}", json={"source": None, "extraction_confidence": None})
    assert r.json()["source"] is None and r.json()["extraction_confidence"] is None
    r = client.patch(f"/v1/blocks/{line['id']}", json={"direction": "loud"})
    assert r.json()["direction"] == "loud"


# ── A narrator who also speaks (2026-09-29) ────────────────────────────────


def _groups(client, scene_id):
    return [(g["check"], g["speaker"]) for g in
            client.get(f"/v1/scenes/{scene_id}/script").json()["flag_groups"]]


def test_speech_on_the_narrator_counts_like_anyones(client, project, monkeypatch):
    """No "given to the Narrator" check: the Narrator's one spoken line is an
    only line, as anyone's would be."""
    _model_says(monkeypatch, {0: project.tom, 1: project.narrator, 2: project.tom, 3: project.mara})
    _analyze(client, project.scene_id)
    groups = _groups(client, project.scene_id)
    assert ("only", project.narrator) in groups
    assert not [g for g in groups if g[0] not in ("run", "only", "disagree")]


def test_a_character_who_narrates_is_counted_like_anyone(client, project, monkeypatch):
    """Tom narrates and speaks: three of his lines in a row are a run."""
    _model_says(monkeypatch, _all_tom(project))
    _analyze(client, project.scene_id)
    r = client.put(f"/v1/projects/{project.id}/narrator", json={"speaker_id": project.tom})
    assert r.status_code == 200, r.text
    assert ("run", project.tom) in _groups(client, project.scene_id)
