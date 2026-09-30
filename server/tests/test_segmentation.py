# SPDX-License-Identifier: MIT
"""The segmenter: speech over several paragraphs, and a book's speech marks.

A long speech opens a quote on every paragraph and closes only the last.
The curly branch always read that; the straight one needed the closing
quote, so a straightened book lost a fifth of its speech to the Narrator
(docs/plans/2026-08-15-voice-workflow-redesign.md §8.24, 3a).

Speech marks (2026-09-30, docs/plans/2026-09-30-script-leftovers.md B3): a
book written in ‘single quotes’, «guillemets» or „German“ marks read as all
narration — zero dialogue, and no re-analyze could fix it. Each style is read
now, and Auto picks a chapter's by counting; the three answer-keyed books must
cut exactly as they did.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from justvoice.extraction.segmentation import (
    detect_marks,
    left_open,
    opens_speech,
    paragraphs_of,
    segment_paragraphs,
    segments_from_lines,
    split_into_paragraphs,
    strip_marks,
)
from justvoice.imports import run_adapter

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
BOOK = SAMPLES / "the-speckled-band" / "book.txt"


def _spoken(text: str) -> list[str]:
    segs = segment_paragraphs(split_into_paragraphs(text))
    return [s["text"] for s in segs if s["kind"] == "dialogue"]


def _straighten(text: str) -> str:
    return text.replace("“", '"').replace("”", '"')


def test_a_straight_quote_left_open_is_speech_to_the_paragraphs_end():
    text = '"I have come to you, sir," said she. "My name is Helen Stoner, and I live'
    segs = segment_paragraphs(split_into_paragraphs(text))
    assert [(s["kind"], s["text"]) for s in segs] == [
        ("dialogue", "I have come to you, sir,"),
        ("narration", "said she."),
        ("dialogue", "My name is Helen Stoner, and I live"),
    ]


def test_a_speech_over_several_paragraphs_is_speech_on_each():
    text = '"It began last spring.\n\n"Then the letters stopped.\n\n"That is all," she said.'
    assert _spoken(text) == [
        "It began last spring.",
        "Then the letters stopped.",
        "That is all,",
    ]


def test_the_straightened_book_finds_every_line_the_curly_one_does():
    curly = BOOK.read_text(encoding="utf-8")
    assert len(_spoken(curly)) == 247            # the answer key's count
    assert _spoken(_straighten(curly)) == _spoken(curly)


# ── Speech marks ─────────────────────────────────────────────────────────


def _cut(text: str, marks: str | None = None) -> list[tuple[str, str]]:
    return [(s["kind"], s["text"]) for s in segment_paragraphs(split_into_paragraphs(text), marks=marks)]


def test_single_quotes_are_speech_and_an_apostrophe_never_ends_one():
    assert _cut("‘Come here,’ said Marius. ‘I don’t know why.’") == [
        ("dialogue", "Come here,"),
        ("narration", "said Marius."),
        ("dialogue", "I don’t know why."),
    ]
    assert _cut("'Wait,' she said. 'It's late.'", "single") == [
        ("dialogue", "Wait,"), ("narration", "she said."), ("dialogue", "It's late."),
    ]


def test_an_elision_never_opens_a_speech():
    text = "'Tis late, and he played rock 'n' roll in the '90s. 'Em too."
    assert _cut(text, "single") == [("narration", text)]


def test_a_trailing_apostrophe_cuts_the_line_early_the_known_limit():
    # Split and Merge on Script fix this line by hand.
    assert _cut("‘The boys’ bikes are gone,’ she said.", "single")[0] == ("dialogue", "The boys")


def test_guillemets_both_ways_and_german_marks():
    assert _cut("«Bonjour», dit-il. «Ça va?»") == [
        ("dialogue", "Bonjour"), ("narration", ", dit-il."), ("dialogue", "Ça va?"),
    ]
    assert _cut("»Komm her«, sagte er.", "guillemets") == [
        ("dialogue", "Komm her"), ("narration", ", sagte er."),
    ]
    assert _cut("„Komm her“, sagte Marius. „Jetzt.”") == [
        ("dialogue", "Komm her"), ("narration", ", sagte Marius."), ("dialogue", "Jetzt."),
    ]


def test_a_german_closing_mark_is_not_read_as_an_english_opening_one():
    # Read as double quotes, the closing “ opened a speech and inverted the line.
    assert detect_marks("„Komm her“, sagte Marius. „Geh“, sagte sie.") == "german"


def test_another_styles_marks_are_quotes_inside_the_speech():
    # The Speckled Band quotes Helen's sister inside Helen's own speech.
    text = "“‘Tell me, Helen,’ said she, ‘have you ever heard anyone whistle?’”"
    assert detect_marks("\n\n".join([text] * 3)) == "double"
    assert _cut(text, "double") == [("dialogue", text[1:-1])]


@pytest.mark.parametrize("sample", ["the-ninth-facet", "the-salt-iron-road", "the-speckled-band"])
def test_auto_reads_every_keyed_chapter_of_the_samples_as_double(sample):
    root = SAMPLES / sample
    key = json.loads((root / "attribution-truth.json").read_text(encoding="utf-8"))
    book_file = key.get("book", "book.json")
    book = run_adapter(key.get("adapter", "justwrite"), (root / book_file).read_bytes(), filename=book_file)
    keyed = [s for s in book.scenes if s.title in key["chapters"]]
    assert keyed
    for scene in keyed:
        text = "\n\n".join(line.text for line in scene.lines if line.text)
        assert detect_marks(text) == "double", scene.title


def test_a_speech_left_open_in_each_style():
    assert left_open("‘Tell me about it", "single")
    assert left_open("«Il était une fois", "guillemets")
    assert left_open("„Es war einmal", "german")
    assert left_open("“a” b “c", "double")
    assert not left_open("“a” b", "double")
    assert not left_open("‘I don’t know,’ she said.", "single")


def test_a_stored_line_opens_speech_in_any_style_but_not_on_an_elision():
    assert all(opens_speech(t) for t in ("“Hi.”", '"Hi."', "‘Hi.’", "'Hi.'", "«Salut»", "»Hallo«", "„Hallo“"))
    assert not any(opens_speech(t) for t in ("said Marius,", "'Tis nothing.", ""))


# ── An edited chapter, read as its lines ───────────────────────────────────


def test_strip_marks_takes_off_the_pair_and_a_mark_left_open():
    assert strip_marks("“Come here,”") == "Come here,"
    assert strip_marks("'Wait,’") == "Wait,"
    assert strip_marks("„Jetzt.“") == "Jetzt."
    assert strip_marks("“and the rest") == "and the rest"
    assert strip_marks("said Marius,") == "said Marius,"


def test_lines_of_one_paragraph_read_together_again():
    lines = [
        {"text": "“Come here,”", "spoken": True, "paragraph": 4},
        {"text": "said Marius,", "spoken": False, "paragraph": 4},
        {"text": "“now.”", "spoken": True, "paragraph": 4},
        {"text": "A line you added.", "spoken": False, "paragraph": None},
        {"text": "“Yes.”", "spoken": True, "paragraph": 9},
    ]
    segs = segments_from_lines(lines)
    assert [(s["kind"], s["text"], s["paragraph_idx"], s.get("dialogue_id")) for s in segs] == [
        ("dialogue", "Come here,", 0, 0),
        ("narration", "said Marius,", 0, None),
        ("dialogue", "now.", 0, 1),
        ("narration", "A line you added.", 1, None),
        ("dialogue", "Yes.", 2, 2),
    ]
    assert paragraphs_of(segs) == ["Come here, said Marius, now.", "A line you added.", "Yes."]
