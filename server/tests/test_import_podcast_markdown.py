# SPDX-License-Identifier: GPL-3.0-or-later
"""podcast_markdown adapter — labels, headings, markers, tag preservation."""

from __future__ import annotations

import pytest

from justvoice.errors import ApiError
from justvoice.imports import get_adapter
from justvoice.imports.adapters.podcast_markdown import parse

SCRIPT = """# Ep. 42 — The codec episode

SARAH: Welcome back to Signal and Noise. I'm Sarah, that's Jin. [warm]

**JIN:** Mave, your team just shipped a codec that's half the bitrate. [curious]

MAVE: [laughs] Half on a good day.

And the trick is we stopped trying to preserve the waveform.

— Mid-roll marker · ad break —

## Deep dive

JIN: Back to it. Before the break you said something I want to push on.
"""


def test_labels_headings_markers_and_continuation():
    out = parse(SCRIPT.encode(), filename="ep42_script.md")
    assert out.project.kind == "podcast"
    assert out.project.name == "ep42_script"
    assert [c.name for c in out.characters] == ["Sarah", "Jin", "Mave"]
    assert [s.title for s in out.scenes] == ["Ep. 42 — The codec episode", "Deep dive"]

    seg1 = out.scenes[0].lines
    assert seg1[0].character_id == "sarah"
    assert "[warm]" in seg1[0].text          # paralinguistic tags preserved
    assert seg1[1].character_id == "jin"
    assert seg1[2].character_id == "mave"
    # unlabeled continuation stays with the current speaker
    assert seg1[3].character_id == "mave"
    assert seg1[3].text.startswith("And the trick")
    # the marker line is unattributed + flagged
    assert seg1[4].character_id is None
    assert seg1[4].delivery == {"marker": True}

    assert out.scenes[1].lines[0].character_id == "jin"


def test_prose_sentences_with_colons_are_not_labels():
    text = "SARAH: Hi.\n\nThe thing about codecs: they lie.\n"
    out = parse(text.encode(), filename="x.md")
    lines = out.scenes[0].lines
    assert len(lines) == 2
    assert lines[1].character_id == "sarah"  # continuation, NOT a new 'The thing…' speaker
    assert [c.id for c in out.characters] == ["sarah"]


def test_unlabeled_script_warns():
    out = parse(b"Just narration.\n\nMore narration.", filename="plain.md")
    assert out.characters == []
    assert any("no speaker labels" in w for w in out.warnings)


def test_empty_rejected_and_registered():
    with pytest.raises(ApiError):
        parse(b"   ", filename="empty.md")
    assert get_adapter("podcast_markdown") is not None
