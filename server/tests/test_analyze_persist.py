# SPDX-License-Identifier: MIT
"""Analyze writes itself onto the chapter — the Script-tab restore.

docs/plans/2026-08-08-script-tab-restore.md, decisions 2/3/4. Before this,
`/v1/scenes/{id}/analyze` returned rows and persisted nothing: the renderer
held them in one ref that a chapter change wiped, and a separate "Apply"
button POSTed them back as NEW blocks on top of the ones the text was built
from, so analyzing twice doubled the chapter.

What these pin:
  * the first analyze re-cuts an imported chapter into segments and saves them
  * narration binds to the project's Narrator instead of null (it used to be
    dropped from the render in silence)
  * a second analyze updates in place — the block count never moves
  * rows the user corrected survive a re-analyze
  * a re-cut is refused once takes exist (Take.block_id is ON DELETE CASCADE)
  * a speaker the model invented does not blow up the run on the FK
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from tests.jw_fixtures import book_json, scene

pytest_plugins = ["tests.conftest_db"]

# Two paragraphs, one of them mixing narration and dialogue — so the
# segmenter's split (3 segments) differs from the import's (2 blocks).
PARA_1 = "The lamps guttered in the hall."
PARA_2 = '“We leave at dawn,” said Mara.'


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


def _analyze(client, scene_id, text):
    return client.post(f"/v1/scenes/{scene_id}/analyze", json={"text": text})


def _mara_id(client, project_id):
    cast = client.get(f"/v1/projects/{project_id}/cast").json()["cast"]
    personas = {p["id"]: p for p in client.get("/v1/personas").json()["personas"]}
    return next(
        c["persona_id"] for c in cast if "Mara" in (personas[c["persona_id"]]["name"] or "")
    )


def _narrator_id(client, project_id):
    cast = client.get(f"/v1/projects/{project_id}/cast").json()["cast"]
    return next(c["persona_id"] for c in cast if c["role_label"] == "narrator")


def _answer(speaker: str, confidence: float = 0.95):
    """Stub the model's reply for the one [D#] segment in PARA_2."""
    def run(action, variables, **overrides):
        return SimpleNamespace(
            text=f'[{{"dialogue_id": 0, "speaker": "{speaker}", "confidence": {confidence}}}]',
            prompt_tokens=0, completion_tokens=0, model="stub",
        )
    return run


def test_first_analyze_resegments_and_saves(client, project, monkeypatch):
    mara = _mara_id(client, project.id)
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _answer(mara))

    before = _blocks(client, project.scene_id)
    assert len(before) == 2                      # import: one block per paragraph
    assert all(b["source"] is None for b in before)

    r = _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")
    assert r.status_code == 200, r.text
    assert r.json()["persisted"]["mode"] == "resegmented"

    after = _blocks(client, project.scene_id)
    assert len(after) == 3                       # narration · dialogue · narration
    assert [b["source"] for b in after] == ["narration", "llm", "narration"]
    # Dialogue keeps its quote marks, or the stored chapter reads wrong AND
    # re-segmenting it would find no dialogue at all.
    assert after[1]["text"] == "“We leave at dawn,”"
    assert after[1]["persona_id"] == mara


def test_narration_binds_to_the_narrator(client, project, monkeypatch):
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")

    narrator = _narrator_id(client, project.id)
    narration = [b for b in _blocks(client, project.scene_id) if b["source"] == "narration"]
    assert narration and all(b["persona_id"] == narrator for b in narration)


def test_reanalyze_updates_in_place_and_keeps_corrections(client, project, monkeypatch):
    mara = _mara_id(client, project.id)
    narrator = _narrator_id(client, project.id)
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _answer(mara))
    _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")

    blocks = _blocks(client, project.scene_id)
    # The user fixes the dialogue row — Studio's PATCH, source="corrected".
    r = client.patch(
        f"/v1/blocks/{blocks[1]['id']}",
        json={"persona_id": narrator, "source": "corrected"},
    )
    assert r.status_code == 200, r.text

    # The stored source text is what a re-analyze feeds back in.
    stored = client.get(f"/v1/projects/{project.id}/scenes").json()[0]["metadata"]
    assert stored["source_text"] == f"{PARA_1}\n\n{PARA_2}"

    r = _analyze(client, project.scene_id, stored["source_text"])
    assert r.status_code == 200, r.text
    assert r.json()["persisted"] == {"mode": "in_place", "written": 2, "kept_corrected": 1}

    after = _blocks(client, project.scene_id)
    assert [b["id"] for b in after] == [b["id"] for b in blocks]   # nothing re-created
    assert after[1]["persona_id"] == narrator                       # the fix survived
    assert after[1]["source"] == "corrected"


def test_recut_is_refused_once_takes_exist(client, project, monkeypatch):
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")
    block_id = _blocks(client, project.scene_id)[0]["id"]

    # SessionLocal is None until init_db runs, so it has to be read off the
    # module at call time, not bound at import (the same lazy resolve
    # render_chapter_api._open_db does).
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

    # Different text → a different split → a replace, which would cascade the
    # take away. It must refuse instead.
    r = _analyze(client, project.scene_id, "One sentence only.")
    assert r.status_code == 409, r.text
    assert "take" in r.json()["detail"]
    assert len(_blocks(client, project.scene_id)) == 3   # untouched


def test_an_invented_speaker_leaves_the_line_unplaced(client, project, monkeypatch):
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer("a-persona-that-never-existed"),
    )
    r = _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")
    assert r.status_code == 200, r.text
    dialogue = [b for b in _blocks(client, project.scene_id) if b["source"] != "narration"]
    assert dialogue and all(b["persona_id"] is None for b in dialogue)


def test_the_imports_line_ids_survive_the_recut(client, project, monkeypatch):
    """`source_ref` is the import's stable line id and re-import merges on it
    (`_reimport_update`'s `by_ref`). Re-cutting deletes the blocks that carry
    it, so without carry-over the first analyze would silently break
    re-import — every paragraph would come back as new and duplicate the
    chapter, which is the failure this whole change exists to end."""
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    before = [b["metadata"].get("source_ref") for b in _blocks(client, project.scene_id)]
    assert len(before) == 2 and all(before)
    # A hand-written performance note on the second paragraph — authored
    # content the re-cut must not silently drop either.
    blocks = _blocks(client, project.scene_id)
    client.patch(f"/v1/blocks/{blocks[1]['id']}", json={"direction": "weary"})

    _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")

    after = _blocks(client, project.scene_id)
    assert len(after) == 3
    # Each segment carries the ref of the paragraph it was CUT OUT OF —
    # positionally, so a swapped mapping fails too.
    assert [b["metadata"].get("source_ref") for b in after] == [
        before[0], before[1], before[1],
    ]
    assert [b["direction"] for b in after] == [None, "weary", "weary"]


def test_an_unclosed_quote_does_not_gain_a_closing_one(client, project, monkeypatch):
    """segmentation.py:22 matches dialogue that opens and runs to the end of
    a line without ever closing. Storing it back with a tidy closing quote
    would put punctuation in the manuscript the author never wrote."""
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    text = "He turned.\n\n“We leave at dawn"
    r = _analyze(client, project.scene_id, text)
    assert r.status_code == 200, r.text
    stored = [b["text"] for b in _blocks(client, project.scene_id)]
    assert "“We leave at dawn" in stored
    assert not any(t.endswith('"') or t.endswith("”") for t in stored)


def test_a_run_with_no_rows_never_wipes_the_chapter(client, project, monkeypatch):
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    r = _analyze(client, project.scene_id, "   ")
    assert r.status_code == 409, r.text
    assert len(_blocks(client, project.scene_id)) == 2   # the import's blocks, intact


def test_editing_a_block_forgets_the_stored_source_text(client, project, monkeypatch):
    monkeypatch.setattr(
        "justvoice.extraction.pipeline.run_feature", _answer(_mara_id(client, project.id)),
    )
    _analyze(client, project.scene_id, f"{PARA_1}\n\n{PARA_2}")

    block_id = _blocks(client, project.scene_id)[0]["id"]
    client.patch(f"/v1/blocks/{block_id}", json={"text": "The lamps went out."})

    meta = client.get(f"/v1/projects/{project.id}/scenes").json()[0]["metadata"]
    assert "source_text" not in meta
