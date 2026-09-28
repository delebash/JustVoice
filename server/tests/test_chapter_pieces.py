# SPDX-License-Identifier: MIT
"""Chapter splitting (2026-09-28, docs/plans/2026-09-28-chapter-splitting.md).

A chapter too long for the model is read in pieces of whole paragraphs, each with
a lead-in from the piece before whose answers are thrown away. Backstops halve a
piece the provider refuses as too big, or whose reply comes back cut off
(finish_reason "length" — llama.cpp's only signal when the context fills).
"""

from __future__ import annotations

import re
from types import SimpleNamespace

import pytest

from justvoice.extraction import pipeline
from justvoice.extraction.pieces import ParagraphTooBig, Piece, is_break, plan_pieces
from justvoice.extraction.pipeline import AnalyzeRequest, AttributionModelError, analyze_scene
from justvoice.models import Settings

# ── the planner ────────────────────────────────────────────────────────────


def test_a_chapter_that_fits_is_one_piece():
    assert plan_pieces([10, 10, 10], room=30, lead_in=2) == [Piece(0, 0, 3)]


def test_pieces_are_whole_paragraphs_with_a_lead_in():
    got = plan_pieces([10] * 10, room=40, lead_in=1)
    assert got[0] == Piece(0, 0, 4)
    assert got[1] == Piece(3, 4, 7), "one lead-in paragraph + three it owns = 40"
    assert [p.start for p in got] == [0, 4, 7] and got[-1] == Piece(6, 7, 10)
    owned = [i for p in got for i in range(p.start, p.end)]
    assert owned == list(range(10)), "every paragraph owned exactly once"


def test_a_scene_break_near_the_end_moves_the_cut():
    got = plan_pieces([10] * 10, room=80, lead_in=0, breaks={6})
    assert got[0] == Piece(0, 0, 7), "cut just after the *** at paragraph 6, not at 8"


def test_a_break_early_in_the_piece_is_ignored():
    got = plan_pieces([10] * 10, room=80, lead_in=0, breaks={1})
    assert got[0] == Piece(0, 0, 8)


def test_the_lead_in_gives_way_to_a_big_paragraph():
    got = plan_pieces([10, 10, 35], room=40, lead_in=2)
    assert got[-1] == Piece(2, 2, 3), "no room for the lead-in beside it — dropped, not the paragraph"


def test_a_paragraph_bigger_than_the_room_is_refused():
    with pytest.raises(ParagraphTooBig) as e:
        plan_pieces([10, 50, 10], room=40, lead_in=0)
    assert e.value.index == 1


def test_scene_break_marks():
    assert all(is_break(t) for t in ("***", "* * *", "---", "#", "~", "—"))
    assert not any(is_break(t) for t in ("", "Mara.", "“—”"))


# ── the runner ─────────────────────────────────────────────────────────────

CAST = [{"id": "p_mara", "name": "Mara"}, {"id": "p_hale", "name": "Hale"}]
_D = re.compile(r"\[D(\d+)\]")


def _chapter(n: int) -> str:
    # Untagged lines, so every answer comes from the model (no anchors).
    return "\n\n".join(f"Paragraph {i} has words in it. “Line {i}.”" for i in range(n))


def _settings(lead_in=1, per_line=10):
    s = Settings()
    s.extraction.split_lead_in_paragraphs = lead_in
    s.extraction.answer_tokens_per_line = per_line
    return s


def _stub(monkeypatch, *, context, answer=lambda did: "mara", finish=lambda ids: "stop", refuse=None):
    """measure: 1 token per char of the rendered paragraphs + 100 overhead.
    run: answers every [D#] in the prompt, via `answer(did)`."""
    calls = []

    def measure(action, variables, **kw):
        return SimpleNamespace(prompt_tokens=100 + len(variables["paragraphs"]), context=context, model="m")

    def run(action, variables, **kw):
        ids = [int(x) for x in _D.findall(variables["paragraphs"])]
        calls.append(ids)
        if refuse and refuse(ids):
            raise RuntimeError('local-llamacpp 400: {"error":{"type":"exceed_context_size_error",'
                               '"n_prompt_tokens":40000,"n_ctx":32768}}')
        text = "[" + ",".join(f'{{"id":"D{i}","speaker":"{answer(i)}","confidence":0.9}}' for i in ids) + "]"
        return SimpleNamespace(text=text, finish_reason=finish(ids), prompt_tokens=1, completion_tokens=1,
                               model="m")

    monkeypatch.setattr(pipeline, "measure_feature", measure)
    monkeypatch.setattr(pipeline, "run_feature", run)
    return calls


def _speakers(rows):
    return [r.speaker for r in rows if r.kind == "dialogue"]


def test_a_chapter_that_fits_is_one_call(monkeypatch):
    calls = _stub(monkeypatch, context=100_000)
    raw = {}
    rows = analyze_scene(settings=_settings(), request=AnalyzeRequest(route="direct", text=_chapter(8), characters=CAST),
                         raw_out=raw)
    assert len(calls) == 1 and raw["usage"]["pieces"] == 1
    assert _speakers(rows) == ["p_mara"] * 8


def test_a_long_chapter_is_read_in_pieces_and_the_lead_in_answers_are_dropped(monkeypatch):
    # Pieces answer their lead-in lines "hale"; the owning piece says "mara". If a
    # lead-in answer leaked, some line would come back as Hale.
    first_call_of = {}

    def answer(did):
        n = len(calls)
        first_call_of.setdefault(did, n)
        return "mara" if first_call_of[did] == n else "hale"

    calls = _stub(monkeypatch, context=400, answer=answer)
    raw = {}
    rows = analyze_scene(settings=_settings(lead_in=1), request=AnalyzeRequest(route="direct", text=_chapter(12), characters=CAST),
                         raw_out=raw)
    assert len(calls) > 1 and raw["usage"]["pieces"] == len(calls)
    assert any(c[0] in calls[i - 1] for i, c in enumerate(calls) if i), "later pieces carry a lead-in"
    assert _speakers(rows) == ["p_mara"] * 12


def test_max_context_forces_splitting_on_a_short_chapter(monkeypatch):
    calls = _stub(monkeypatch, context=100_000)
    analyze_scene(settings=_settings(), request=AnalyzeRequest(route="direct", text=_chapter(12), characters=CAST, max_context=400))
    assert len(calls) > 1


def test_a_reply_cut_off_at_the_context_halves_the_piece(monkeypatch):
    # Measuring says one piece fits; the model runs out of room on anything over 4 lines.
    calls = _stub(monkeypatch, context=100_000, finish=lambda ids: "length" if len(ids) > 4 else "stop")
    raw = {}
    rows = analyze_scene(settings=_settings(lead_in=0), request=AnalyzeRequest(route="direct", text=_chapter(12), characters=CAST),
                         raw_out=raw)
    assert _speakers(rows) == ["p_mara"] * 12, "nothing left as unknown"
    assert raw["usage"]["pieces"] == sum(1 for c in calls if len(c) <= 4), "only the calls that fit count"


def test_a_refusal_as_too_big_halves_the_piece_unmeasured(monkeypatch):
    # Another provider: nothing to measure; it refuses anything over 3 lines.
    calls = _stub(monkeypatch, context=100_000, refuse=lambda ids: len(ids) > 3)
    monkeypatch.setattr(pipeline, "measure_feature", lambda *a, **k: None)
    rows = analyze_scene(settings=_settings(lead_in=0), request=AnalyzeRequest(route="direct", text=_chapter(10), characters=CAST))
    assert _speakers(rows) == ["p_mara"] * 10
    assert len(calls) > 3


def test_one_paragraph_that_never_fits_says_so(monkeypatch):
    _stub(monkeypatch, context=100_000, refuse=lambda ids: True)
    monkeypatch.setattr(pipeline, "measure_feature", lambda *a, **k: None)
    with pytest.raises(AttributionModelError) as e:
        analyze_scene(settings=_settings(), request=AnalyzeRequest(route="direct", text=_chapter(3), characters=CAST))
    assert str(e.value).startswith("A paragraph of this chapter is too long for the model to read")
    assert "40,000 tokens" in str(e.value) and "32,768" in str(e.value)


# ── Discover reads a long chapter in pieces too (Slice 4) ─────────────────────


def _identify_stub(monkeypatch, *, context, refuse=None):
    from justvoice.engines.llm import run as run_mod

    calls = []

    def measure(action, variables, **kw):
        return SimpleNamespace(prompt_tokens=100 + len(variables["manuscript"]), context=context, model="m")

    def run(action, variables, **kw):
        m = variables["manuscript"]
        calls.append(m)
        if refuse and refuse(m):
            raise RuntimeError("local-llamacpp 400: exceed_context_size_error")
        names = sorted(set(re.findall(r"\b(Tom|Edith)\b", m)))
        text = "[" + ",".join(f'{{"name":"{n}","approx_lines":1,"evidence":"{n}"}}' for n in names) + "]"
        return SimpleNamespace(text=text, finish_reason="stop", prompt_tokens=1, completion_tokens=1, model="m")

    monkeypatch.setattr(run_mod, "measure_feature", measure)
    monkeypatch.setattr(run_mod, "run_feature", run)
    return calls


def _book(n):
    return "\n\n".join(f"Paragraph {i}: {'Tom' if i % 2 else 'Edith'} waited by the gate." for i in range(n))


def test_discover_reads_a_long_chapter_in_pieces_and_merges_names(monkeypatch):
    from justvoice.extraction.identify import identify_speakers

    calls = _identify_stub(monkeypatch, context=400)
    raw = {}
    got = identify_speakers(_book(20), [], settings=_settings(per_line=10), raw_out=raw)
    assert len(calls) > 1 and raw["usage"]["pieces"] == len(calls)
    assert "\n\n".join(calls) == _book(20), "every paragraph read exactly once, in order"
    by = {c.name: c.approx_lines for c in got}
    assert set(by) == {"Tom", "Edith"} and by["Tom"] == sum("Tom" in c for c in calls), "one row per name, lines summed"


def test_discover_halves_a_piece_the_provider_refuses(monkeypatch):
    from justvoice.extraction.identify import identify_speakers

    calls = _identify_stub(monkeypatch, context=100_000, refuse=lambda m: m.count("Paragraph") > 3)
    got = identify_speakers(_book(10), [], settings=_settings())
    assert {c.name for c in got} == {"Tom", "Edith"}
    assert sum(1 for c in calls if c.count("Paragraph") <= 3) >= 4


def test_a_piece_answered_without_line_numbers_is_placed_by_order(monkeypatch):
    # Measured: a piece's reply put the speaker in the id field. One answer per line
    # of the piece -> placed in order; nothing lost.
    calls = _stub(monkeypatch, context=400)
    real = pipeline.run_feature

    def no_ids(action, variables, **kw):
        resp = real(action, variables, **kw)
        return SimpleNamespace(**{**resp.__dict__, "text": re.sub(r'"id":"D\d+"', '"id":"nettle_2"', resp.text)})

    monkeypatch.setattr(pipeline, "run_feature", no_ids)
    rows = analyze_scene(settings=_settings(lead_in=1),
                         request=AnalyzeRequest(route="direct", text=_chapter(12), characters=CAST))
    assert len(calls) > 1 and _speakers(rows) == ["p_mara"] * 12
