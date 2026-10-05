# SPDX-License-Identifier: MIT
"""Analyze's second look at lines it leaves with no speaker (2026-10-05).

TASKS "Analyze takes a second look at lines it leaves with no speaker, and
offers to add who it finds"; docs/plans/2026-10-05-second-look-build.md.
What these pin:
  * only spoken lines with no speaker are asked about — none, no call
  * a cast member it names is saved with source "second_look", marked
    "nearby", and counted as AI decided
  * a name it gives who is not in the cast stays on the line
    (metadata.not_in_cast) for Script's offer, and a re-analyze clears it
  * an answer below the floor, a cast member offered as "not in the cast",
    a line you set, and a failed call all leave the line as it was
  * the neighbouring chapters' text reaches the prompt, trimmed
  * the setting turns it off
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from justvoice.extraction import second_look as sl
from justvoice.extraction.flags import Line, flag_groups
from justvoice.extraction.pipeline import AttributionRow
from justvoice.models import ExtractionSettings
from tests.jw_fixtures import book_json, scene

pytest_plugins = ["tests.conftest_db"]

CFG = ExtractionSettings()


def _row(text, speaker="unknown", kind="dialogue", source="floored", para=0):
    return AttributionRow(paragraph_idx=para, kind=kind, text=text, speaker=speaker,
                          confidence=0.4, source=source)


def _stub(answers, calls):
    """run_feature that answers from `answers` in order and records the variables."""
    def run(action, variables, **_):
        calls.append((action, variables))
        ans = answers[len(calls) - 1]
        if isinstance(ans, Exception):
            raise ans
        return SimpleNamespace(text=json.dumps(ans))
    return run


def _look(rows, monkeypatch, answers, **kw):
    calls = []
    monkeypatch.setattr(sl, "run_feature", _stub(answers, calls))
    out = {}
    sl.second_look(
        rows, ["The candle burned.", "“You always find the candle first.”"],
        cast_text='- id="ode", name="Ode"', resolve=lambda raw: {"ode": "id-ode"}.get(raw, "unknown"),
        cast_names=lambda n: n.lower() == "ode", floor=0.5, use_floor=True,
        before_text=kw.get("before"), after_text=kw.get("after"), cfg=kw.get("cfg", CFG),
        skip=kw.get("skip", set()), raw_out=out,
    )
    return calls, out["second_look"]


# ── The pass ─────────────────────────────────────────────────────────────


def test_a_named_cast_member_is_saved_marked(monkeypatch):
    rows = [_row("The candle burned.", "narrator", "narration", "narration"),
            _row("“You always find the candle first.”", para=1)]
    calls, report = _look(rows, monkeypatch, [{"speaker": "ode", "confidence": 1}])
    assert len(calls) == 1 and calls[0][0] == "speaker_second_look"
    assert "⟦“You always find the candle first.”⟧" in calls[0][1]["chapter"]
    assert (rows[1].speaker, rows[1].source, rows[1].confidence) == ("id-ode", "second_look", 1.0)
    assert report["named"] == 1


def test_nothing_blank_means_no_call(monkeypatch):
    calls, report = _look([_row("“Hello.”", "id-ode", source="llm")], monkeypatch, [])
    assert calls == [] and report["asked"] == 0


def test_someone_not_in_the_cast_is_kept_for_the_offer(monkeypatch):
    rows = [_row("“You're for the Nine,”")]
    _calls, report = _look(rows, monkeypatch, [{"speaker": "unknown", "not_in_cast": "Old Sedge"}])
    assert rows[0].speaker == "unknown" and rows[0].not_in_cast == "Old Sedge"
    assert report["not_in_cast"] == ["Old Sedge"]


@pytest.mark.parametrize("answer", [
    {"speaker": "ode", "confidence": 0.3},            # below the floor
    {"speaker": "unknown", "not_in_cast": "Ode"},     # a cast member is never "not in the cast"
    {"speaker": "narrator", "confidence": 1},         # the narrator doesn't speak a quote here
    RuntimeError("model gone"),                       # a failed call
])
def test_these_leave_the_line_as_it_was(monkeypatch, answer):
    rows = [_row("“You always find the candle first.”")]
    _look(rows, monkeypatch, [answer])
    assert (rows[0].speaker, rows[0].source, rows[0].not_in_cast) == ("unknown", "floored", None)


def test_a_line_you_set_is_not_asked_about(monkeypatch):
    calls, _ = _look([_row("“One.”"), _row("“Two.”")], monkeypatch, [{"speaker": "unknown"}], skip={0})
    assert len(calls) == 1 and calls[0][1]["line"] == "“Two.”"


def test_the_neighbours_are_trimmed_into_the_prompt(monkeypatch):
    before = " ".join(f"b{i}" for i in range(2000))
    after = " ".join(f"a{i}" for i in range(2000))
    calls, _ = _look([_row("“Hm.”")], monkeypatch, [{"speaker": "unknown"}], before=before, after=after)
    v = calls[0][1]
    assert v["before"].split() == [f"b{i}" for i in range(2000 - CFG.second_look_before, 2000)]
    assert v["after"].split() == [f"a{i}" for i in range(CFG.second_look_after)]
    calls, _ = _look([_row("“Hm.”")], monkeypatch, [{"speaker": "unknown"}])
    assert "first chapter" in calls[0][1]["before"] and "last chapter" in calls[0][1]["after"]


def test_the_cast_carries_who_they_are():
    # "Answers to Ode." is the only link from Odeline Marran to the "Ode" the
    # next chapter names — the main call's cast list leaves descriptions out.
    text = sl.cast_lines([{"id": "odeline_marran", "name": "Odeline Marran", "aliases": [],
                           "description": "Has been living the same hour.\n\nAnswers to Ode."}])
    assert text == '- id="odeline_marran", name="Odeline Marran", who="Has been living the same hour. Answers to Ode."'


def test_a_second_look_line_carries_the_nearby_mark():
    lines = [Line(id="a", speaker="ode", text="“You always find the candle first.”", source="second_look")]
    # "nearby" first: it is the question Script asks of the line.
    assert [g.check for g in flag_groups(lines, {"ode"})] == ["nearby", "only"]


# ── Through Analyze ──────────────────────────────────────────────────────

P1 = "The candle burned. The wax climbed."
P2 = "“You always find the candle first,” said someone in the dark."


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def book(client):
    r = client.post("/v1/projects/import?source=justwrite", json=book_json(chapters=[
        ("ch1", "One", [scene("scn1", "Before it all began, they had argued.")]),
        ("ch2", "Two", [scene("scn2", P1, P2)]),
        ("ch3", "Three", [scene("scn3", "“I'm Mara,” she said. “I lit the candle.”")]),
    ]))
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    scenes = client.get(f"/v1/projects/{pid}/scenes").json()
    return SimpleNamespace(id=pid, scene_id=scenes[1]["id"])


def _main_unknown(action, variables, **_):
    return SimpleNamespace(text='[{"dialogue_id": 0, "speaker": "unknown", "confidence": 0.2}]',
                           prompt_tokens=0, completion_tokens=0, model="stub")


def _analyze(client, book):
    text = "\n\n".join(b["text"] for b in client.get(f"/v1/scenes/{book.scene_id}/blocks").json())
    r = client.post(f"/v1/scenes/{book.scene_id}/analyze", json={"text": text})
    assert r.status_code == 200, r.text
    return r.json()


def test_analyze_saves_the_second_look_and_script_shows_it(client, book, monkeypatch):
    mara = next(s["id"] for s in client.get(f"/v1/projects/{book.id}/speakers").json()["speakers"]
                if s["name"] == "Mara Vance")
    calls = []
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _main_unknown)
    monkeypatch.setattr(sl, "run_feature", _stub([{"speaker": "mara_vance", "confidence": 1}], calls))
    _analyze(client, book)
    assert "argued" in calls[0][1]["before"] and "I lit the candle" in calls[0][1]["after"]

    script = client.get(f"/v1/scenes/{book.scene_id}/script").json()
    line = next(ln for ln in script["lines"] if ln["spoken"])
    assert (line["speaker_id"], line["source"]) == (mara, "second_look")
    assert any(f["check"] == "nearby" for f in script["flag_groups"])
    chapter = next(c for c in client.get(f"/v1/projects/{book.id}/script").json()["chapters"]
                   if c["scene_id"] == book.scene_id)
    assert chapter["guessed"] >= 1 and chapter["no_speaker"] == 0


def test_the_offer_is_saved_and_a_reanalyze_clears_it(client, book, monkeypatch):
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _main_unknown)
    calls = []
    monkeypatch.setattr(sl, "run_feature", _stub(
        [{"speaker": "unknown", "not_in_cast": "Old Sedge"}, {"speaker": "unknown"}], calls))
    _analyze(client, book)
    line = next(ln for ln in client.get(f"/v1/scenes/{book.scene_id}/script").json()["lines"] if ln["spoken"])
    assert line["speaker_id"] is None and line["metadata"]["not_in_cast"] == "Old Sedge"
    _analyze(client, book)
    line = next(ln for ln in client.get(f"/v1/scenes/{book.scene_id}/script").json()["lines"] if ln["spoken"])
    assert "not_in_cast" not in line["metadata"]


def test_the_setting_turns_it_off(client, book, monkeypatch):
    assert client.patch("/v1/settings", json={"extraction": {"second_look": False}}).status_code == 200
    calls = []
    monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", _main_unknown)
    monkeypatch.setattr(sl, "run_feature", _stub([], calls))
    _analyze(client, book)
    assert calls == []
    assert client.get("/v1/extraction/config").json()["second_look"] is False
