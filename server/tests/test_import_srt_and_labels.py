# SPDX-License-Identifier: MIT
"""srt + audacity_labels adapters.

Both shipped in the format picker with NO test of any kind (found 2026-08-08
auditing what the import list really does). These pin the behaviour that was
only ever described in their docstrings: cue and label parsing, the speaker
prefix lifting to a character, and pause-from-gap arithmetic — the one piece of
real math in either adapter.
"""

from __future__ import annotations

import pytest

from justvoice.errors import ApiError
from justvoice.imports import run_adapter

pytest_plugins = ["tests.conftest_db"]

SRT = """1
00:00:01,000 --> 00:00:04,000
NARRATOR: It began at dawn.

2
00:00:05,500 --> 00:00:08,000
The dock was empty.

3
00:00:08,000 --> 00:00:09,250
MARA: You're late.
"""


def test_srt_cues_become_lines_with_speakers_and_gaps():
    result = run_adapter("srt", SRT.encode("utf-8"), filename="episode.srt")

    assert result.source == "srt"
    assert result.project.name == "episode"
    (scene,) = result.scenes
    assert scene.kind == "cue_sheet"

    assert [ln.text for ln in scene.lines] == [
        "It began at dawn.",
        "The dock was empty.",
        "You're late.",
    ]
    # A `NAME:` prefix lifts into a character and is stripped from the line.
    assert [ln.character_id for ln in scene.lines] == ["narrator", None, "mara"]
    assert sorted(c.name for c in result.characters) == ["Mara", "Narrator"]

    # pause_after_ms is the gap to the NEXT cue: 5.5s - 4.0s = 1500ms, then
    # 8.0s - 8.0s = no gap, so the second line carries nothing.
    assert scene.lines[0].pause_after_ms == 1500
    assert scene.lines[1].pause_after_ms is None
    assert scene.lines[2].pause_after_ms is None


def test_srt_without_cues_is_rejected():
    with pytest.raises(ApiError) as excinfo:
        run_adapter("srt", b"not a subtitle file at all", filename="x.srt")

    assert "no cues found" in excinfo.value.detail


LABELS = (
    "0.000000\t4.250000\tFirst label text\n"
    "\\\t20.000000\t8000.000000\n"  # region frequency row — Audacity writes these
    "5.000000\t6.000000\tSecond label\n"
    "9.500000\tA point label\n"
)


def test_audacity_labels_become_lines_with_gap_pauses():
    result = run_adapter("audacity_labels", LABELS.encode("utf-8"), filename="markers.txt")

    assert result.source == "audacity_labels"
    assert result.project.name == "markers"
    (scene,) = result.scenes
    assert scene.kind == "label_track"

    # The backslash-prefixed frequency row is skipped, not imported as text.
    assert [ln.text for ln in scene.lines] == [
        "First label text",
        "Second label",
        "A point label",
    ]
    assert [ln.source_ref for ln in scene.lines] == ["label:1", "label:2", "label:3"]

    # Gap from one label's END to the next label's START: 5.0 - 4.25 = 750ms,
    # then 9.5 - 6.0 = 3500ms. The last label has no successor.
    assert [ln.pause_after_ms for ln in scene.lines] == [750, 3500, None]


def test_a_label_file_with_no_usable_rows_is_rejected():
    with pytest.raises(ApiError) as excinfo:
        run_adapter("audacity_labels", b"nocolumns\nnothing here\n", filename="x.txt")

    assert "no label rows" in excinfo.value.detail
