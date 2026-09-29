# SPDX-License-Identifier: MIT
"""Script's Check column — `extraction/flags.py` (§8.24, 3a).

Each check was measured on answer-keyed books before it was built (§8.23,
§8.25). These pin the rules as measured, on hand-made runs and on the three
sample books' answer keys, where every flag is by definition a false alarm.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from justvoice.extraction.flags import (
    Line,
    flag_groups,
    flagged_lines,
    lines_from_rows,
    not_in_cast,
    quote_left_open,
)
from justvoice.extraction.segmentation import segment_paragraphs, split_into_paragraphs
from justvoice.imports import run_adapter

CAST = {"marius", "june", "renn", "narrator"}
SAMPLES = Path(__file__).resolve().parents[2] / "samples"


def say(i, who, text="“Line.”", *, p=None, source="llm", llm=None):
    return Line(id=f"d{i}", speaker=who, text=text, spoken=True, source=source,
                paragraph=i if p is None else p, llm_speaker=llm)


def prose(i, text="He paused.", *, p=None):
    return Line(id=f"n{i}", speaker="narrator", text=text, spoken=False,
                source="narration", paragraph=i if p is None else p)


def checks(lines, cast=CAST):
    return [(g.check, g.speaker, g.lines) for g in flag_groups(lines, cast, narrator_id="narrator")]


# ── Three in a row ─────────────────────────────────────────────────────────


def test_three_turns_with_no_reply_flag_the_whole_run():
    # "Ino." / "Quartermaster." / "Breathe." all went to one speaker, and the
    # wrong one was the MIDDLE line — so the group is the run, not its third.
    lines = [say(0, "june"), say(1, "june"), say(2, "june"), say(3, "marius")]
    groups = flag_groups(lines, CAST, narrator_id="narrator")
    run = [g for g in groups if g.check == "run"]
    assert len(run) == 1
    assert run[0].lines == ["d0", "d1", "d2"] and run[0].turns == 3


def test_two_turns_are_a_normal_exchange():
    assert [c for c in checks([say(0, "june"), say(1, "june"), say(2, "marius")])
            if c[0] == "run"] == []


def test_a_narration_only_paragraph_breaks_the_run():
    lines = [say(0, "june"), say(1, "june"), prose(2), say(3, "june")]
    assert [c for c in checks(lines) if c[0] == "run"] == []


def test_narration_inside_a_spoken_paragraph_does_not_break_it():
    lines = [
        say(0, "june"),
        say(1, "june", p=1), prose(1, "she said,", p=1), say(9, "june", p=1),
        say(2, "june"),
    ]
    run = [c for c in checks(lines) if c[0] == "run"]
    assert run == [("run", "june", ["d0", "d1", "d9", "d2"])]


def test_a_speech_over_several_paragraphs_is_one_turn():
    # Helen Stoner's account: each paragraph opens a quote, only the last
    # closes it. Counted per paragraph it was 2 false alarms on the key.
    lines = [
        say(0, "june", "“It began last spring."),
        say(1, "june", "“Then the letters stopped."),
        say(2, "june", "“That is all.”"),
        say(3, "marius"),
        say(4, "june"),
    ]
    assert [c for c in checks(lines) if c[0] == "run"] == []


def test_the_speech_then_two_more_turns_is_three():
    lines = [
        say(0, "june", "“It began last spring."),
        say(1, "june", "“That is all.”"),
        say(2, "june"),
        say(3, "june"),
    ]
    groups = [g for g in flag_groups(lines, CAST, narrator_id="narrator") if g.check == "run"]
    assert len(groups) == 1 and groups[0].turns == 3


def test_a_paragraph_with_two_speakers_or_none_breaks_the_run():
    two = [say(0, "june"), say(1, "june"),
           say(2, "june", p=2), say(8, "marius", p=2), say(3, "june")]
    none = [say(0, "june"), say(1, "june"), say(2, None, source="floored"), say(3, "june")]
    assert [c for c in checks(two) if c[0] == "run"] == []
    assert [c for c in checks(none) if c[0] == "run"] == []


def test_lines_you_set_are_never_marked():
    mixed = [say(0, "june", source="corrected"), say(1, "june"), say(2, "june")]
    assert [c for c in checks(mixed) if c[0] == "run"] == [("run", "june", ["d1", "d2"])]
    yours = [say(i, "june", source="corrected") for i in range(3)]
    assert checks(yours) == []


def test_imported_lines_are_their_own_paragraphs_and_never_marked():
    lines = [say(i, "june", source="manual", p=None) for i in range(4)]
    for ln in lines:
        ln.paragraph = None
    assert checks(lines) == []


# ── One line at a time ─────────────────────────────────────────────────────


def test_a_personas_only_line():
    lines = [say(0, "marius"), say(1, "june"), say(2, "marius"), say(3, "renn")]
    assert ("only", "renn", ["d3"]) in checks(lines)
    assert ("only", "june", ["d1"]) in checks(lines)
    assert not any(c[0] == "only" and c[1] == "marius" for c in checks(lines))


def test_speech_given_to_the_narrator():
    lines = [say(0, "narrator"), say(1, "june"), say(2, "june")]
    assert ("narrator", "narrator", ["d0"]) in checks(lines)
    # ...and it never forms a run of its own.
    three = [say(i, "narrator") for i in range(3)]
    assert [c[0] for c in checks(three)] == ["narrator"] * 3


def test_the_book_and_the_model_disagree():
    lines = [say(0, "june", source="tag", llm="marius"), say(1, "marius"), say(2, "june")]
    groups = flag_groups(lines, CAST, narrator_id="narrator")
    dis = [g for g in groups if g.check == "disagree"]
    assert len(dis) == 1 and dis[0].speaker == "june" and dis[0].other == "marius"


def test_a_speaker_who_left_the_cast():
    lines = [say(0, "tom"), say(1, "tom"), say(2, "june"), say(3, "june")]
    assert not_in_cast(lines, CAST) == {"tom": 2}
    # Not an "only line" either: that check is about the cast.
    assert not any(c[0] == "only" and c[1] == "tom" for c in checks(lines))


def test_groups_come_in_reading_order():
    lines = [say(0, "renn"), say(1, "june"), say(2, "june"), say(3, "june"),
             say(4, "marius", source="tag", llm="june")]
    assert [c[0] for c in checks(lines)] == ["only", "run", "only", "disagree"]
    assert flagged_lines(flag_groups(lines, CAST, narrator_id="narrator")) == {
        "d0", "d1", "d2", "d3", "d4"}


def test_quote_left_open():
    assert quote_left_open("“It began last spring.")
    assert quote_left_open('"It began last spring.')
    assert not quote_left_open("“It began,” she said.")
    assert not quote_left_open('"It began," she said.')


def test_the_pipelines_rows_as_lines():
    rows = [
        {"paragraph_idx": 0, "kind": "narration", "text": "He sat.", "speaker": "narrator",
         "source": "narration"},
        {"paragraph_idx": 1, "kind": "dialogue", "text": "Go.", "speaker": "june",
         "source": "tag", "llm_speaker": "marius"},
        {"paragraph_idx": 2, "kind": "dialogue", "text": "No.", "speaker": "unknown",
         "source": "floored", "llm_speaker": "marius"},
    ]
    lines = lines_from_rows(rows)
    assert [ln.id for ln in lines] == ["N0", "D0", "D1"]
    assert lines[1].llm_speaker == "marius"          # the book won, the model differed
    assert lines[2].speaker is None and lines[2].llm_speaker is None


# ── The answer keys: every flag there is a false alarm ─────────────────────


def _key_lines(sample: str):
    root = SAMPLES / sample
    key = json.loads((root / "attribution-truth.json").read_text(encoding="utf-8"))
    book_file = key.get("book", "book.json")
    book = run_adapter(key.get("adapter", "justwrite"), (root / book_file).read_bytes(),
                       filename=book_file)
    cast = {c if isinstance(c, str) else c["name"] for c in key["cast"]}
    for scene in book.scenes:
        truth = key["chapters"].get(scene.title)
        if truth is None:
            continue
        text = "\n\n".join(line.text for line in scene.lines if line.text)
        paras = split_into_paragraphs(text)
        lines, d = [], 0
        for i, seg in enumerate(segment_paragraphs(paras)):
            if seg["kind"] == "dialogue":
                who = truth.get(str(d))
                lines.append(Line(id=f"D{d}", speaker=None if who in (None, "unknown") else who,
                                  text=seg["text"], source="llm", paragraph=seg["paragraph_idx"]))
                d += 1
            else:
                lines.append(Line(id=f"N{i}", speaker="Narrator", text=seg["text"], spoken=False,
                                  source="narration", paragraph=seg["paragraph_idx"]))
        open_paras = {i for i, p in enumerate(paras) if quote_left_open(p)}
        yield scene.title, flag_groups(lines, cast, narrator_id="Narrator",
                                       open_paragraphs=open_paras)


@pytest.mark.parametrize("sample", ["the-ninth-facet", "the-salt-iron-road", "the-speckled-band"])
def test_the_answer_keys_raise_no_run_and_no_narrator_flag(sample):
    for _title, groups in _key_lines(sample):
        assert [g for g in groups if g.check in ("run", "narrator", "disagree")] == []


def test_the_answer_keys_only_lines_are_real_ones():
    # A persona with one line in a chapter is flagged whether or not the line
    # is right — the check asks. On the keys that is exactly one line.
    only = [(s, t, g.speaker) for s in ("the-ninth-facet", "the-salt-iron-road", "the-speckled-band")
            for t, groups in _key_lines(s) for g in groups if g.check == "only"]
    assert only == [("the-ninth-facet", "Bigger Inside", "Odeline Marran")]
