# SPDX-License-Identifier: MIT
"""Answers are matched to lines by their [D#] id (2026-09-28).

The measured failure this pins: the model returned a plain positional array,
one merged/skipped entry early in a chapter shifted every later answer onto
the next line, and each wrong answer still read confidence 1.00 — 15 of 35
lines wrong in one chapter of The Ninth Facet.
"""

from justvoice.extraction.pipeline import align_picks
from justvoice.extraction.prompts import DIRECT_SYSTEM, GUIDED_SYSTEM

SEGS = [{"dialogue_id": i} for i in range(4)]
PAD = {"speaker": "unknown", "confidence": 0.4}


def test_answers_land_on_their_own_line_even_when_one_is_missing():
    picks = [{"id": "D0", "speaker": "a"}, {"id": "D2", "speaker": "c"}, {"id": "D3", "speaker": "d"}]
    out = align_picks(picks, SEGS)
    assert [p["speaker"] for p in out] == ["a", "unknown", "c", "d"], \
        "a gap must stay a gap, not pull D2's answer onto D1"


def test_ids_are_read_leniently_and_out_of_order_answers_are_fine():
    picks = [{"id": "d3", "speaker": "d"}, {"id": " D 1", "speaker": "b"}, {"id": 0, "speaker": "a"},
             {"id": "D2", "speaker": "c"}]
    assert [p["speaker"] for p in align_picks(picks, SEGS)] == ["a", "b", "c", "d"]


def test_a_duplicate_id_keeps_the_first_answer():
    picks = [{"id": "D0", "speaker": "a"}, {"id": "D0", "speaker": "x"}]
    assert align_picks(picks, SEGS)[0]["speaker"] == "a"


def test_a_reply_without_ids_falls_back_to_position():
    assert align_picks([{"speaker": "a"}, {"speaker": "b"}], SEGS) == [
        {"speaker": "a"}, {"speaker": "b"}, PAD, PAD]
    assert len(align_picks([{"speaker": "x"}] * 9, SEGS)) == 4
    assert align_picks([], SEGS) == [PAD] * 4


def test_both_routes_ask_for_ids_and_allow_clear_turn_taking():
    for prompt in (DIRECT_SYSTEM, GUIDED_SYSTEM):
        assert '"id": "D0"' in prompt
        assert "turn" in prompt and "DO NOT guess by alternating" not in prompt
    assert GUIDED_SYSTEM.startswith(DIRECT_SYSTEM)


def test_an_answer_that_is_not_a_cast_id_is_matched_back_by_name():
    """Measured 2026-09-28: the guided route copied the examples' id shape and
    answered c_iven_sarraz for a real (UUID-like) id — the right person, a
    phantom id. It resolves to the cast member; a stranger stays unknown."""
    from justvoice.extraction.pipeline import resolve_speaker

    cast = [{"id": "7f3a", "name": "Iven Sarraz", "aliases": []},
            {"id": "9b2c", "name": "Odeline Marran", "aliases": ["Ode"]}]
    assert resolve_speaker("7f3a", cast) == "7f3a"
    assert resolve_speaker("c_iven_sarraz", cast) == "7f3a"
    assert resolve_speaker("p_odeline_marran", cast) == "9b2c"
    assert resolve_speaker("Ode", cast) == "9b2c"
    assert resolve_speaker("Unknown", cast) == "unknown"
    assert resolve_speaker("c_somebody_else", cast) == "unknown"
    assert resolve_speaker(None, cast) == "unknown"


def test_the_model_sees_name_handles_not_real_ids_and_answers_map_back():
    """Measured 2026-09-28: UUID persona ids in the prompt made the model misread a
    chapter it gets right with readable ids. It sees name handles; answers map back."""
    from justvoice.extraction.pipeline import prompt_handles, resolve_speaker

    real = [{"id": "3f1c2a9e-0000-4000-8000-00000000000a", "name": "Cael Ferren", "aliases": []},
            {"id": "3f1c2a9e-0000-4000-8000-00000000000b", "name": "Nettle", "aliases": []},
            {"id": "3f1c2a9e-0000-4000-8000-00000000000c", "name": "Nettle", "aliases": []}]
    shown, to_id = prompt_handles(real)
    assert [c["id"] for c in shown] == ["cael_ferren", "nettle", "nettle_2"]
    assert all("3f1c" not in c["id"] for c in shown)
    h = resolve_speaker("cael_ferren", shown)
    assert to_id[h] == real[0]["id"]
    assert to_id[resolve_speaker("nettle_2", shown)] == real[2]["id"]


def test_the_answer_array_is_found_inside_prose_and_salvaged_when_cut_off():
    """Measured 2026-09-28: Qwen replies with prose around the JSON blanked whole
    chapters — the old greedy [.*] started at a bracket in the prose."""
    from justvoice.extraction.pipeline import _extract_first_json_array as extract

    prose = 'Checking [D5] against [D6]. Answer: [{"id": "D0", "speaker": "a"}, {"id": "D1", "speaker": "b"}] ok [x]'
    assert [p["id"] for p in extract(prose)] == ["D0", "D1"]
    cut = '[{"id": "D0", "speaker": "a"}, {"id": "D1", "speaker": "b"}, {"id": "D2", "spe'
    assert [p["id"] for p in extract(cut)] == ["D0", "D1"]
    assert extract("no answer at all") == []
