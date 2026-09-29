# SPDX-License-Identifier: MIT
"""The segmenter reads a speech that runs over several paragraphs.

A long speech opens a quote on every paragraph and closes only the last.
The curly branch always read that; the straight one needed the closing
quote, so a straightened book lost a fifth of its speech to the Narrator
(docs/plans/2026-08-15-voice-workflow-redesign.md §8.24, 3a).
"""

from __future__ import annotations

from pathlib import Path

from justvoice.extraction.segmentation import segment_paragraphs, split_into_paragraphs

BOOK = Path(__file__).resolve().parents[2] / "samples" / "the-speckled-band" / "book.txt"


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
