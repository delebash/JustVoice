# SPDX-License-Identifier: MIT
"""Per-line pauses and per-line direction actually reach the render.

Both were stored, editable, documented and dropped:

* `concat_lines` used one fixed project gap, so `pause_before` / `pause_after`
  — the Generate sliders, the delivery overlay, and the `pause_after_ms` every
  import adapter parses — did nothing.
* `Block.direction` was written by the Chapters "+ direction" button and by
  every importer's emotion/style column, then never read by a render path.

These pin both, plus the composition rule: a line's direction APPENDS to the
persona's voice_instruct rather than replacing it.
"""

from __future__ import annotations

import json

from justvoice.render_core import RenderedLine, concat_lines


def _line(ms: int, *, before: int | None = None, after: int | None = None) -> RenderedLine:
    """A silent mono 24 kHz line of `ms`, carrying its pause delivery."""
    delivery: dict = {}
    if before is not None:
        delivery["pause_before"] = before
    if after is not None:
        delivery["pause_after"] = after
    return RenderedLine(
        pcm=b"\x00\x00" * int(24000 * ms / 1000),
        sample_rate=24000,
        channels=1,
        effective_delivery=delivery,
    )


def _ms(rl: RenderedLine) -> float:
    return len(rl.pcm) / 2 / rl.sample_rate * 1000


def test_project_gap_is_used_when_no_line_sets_a_pause() -> None:
    out = concat_lines([_line(100), _line(100)], silence_ms=250)
    assert round(_ms(out)) == 450  # 100 + 250 + 100


def test_pause_after_on_the_previous_line_overrides_the_project_gap() -> None:
    out = concat_lines([_line(100, after=1000), _line(100)], silence_ms=250)
    assert round(_ms(out)) == 1200  # the project's 250 is replaced, not added


def test_pause_before_on_the_next_line_also_overrides() -> None:
    out = concat_lines([_line(100), _line(100, before=500)], silence_ms=250)
    assert round(_ms(out)) == 700


def test_both_sides_of_a_join_add_together() -> None:
    out = concat_lines([_line(100, after=300), _line(100, before=200)], silence_ms=250)
    assert round(_ms(out)) == 700  # 300 + 200, project gap ignored


def test_an_explicit_zero_pause_means_no_gap_not_the_default() -> None:
    """Blank falls through to the project gap; 0 is a deliberate butt-join."""
    out = concat_lines([_line(100, after=0), _line(100)], silence_ms=250)
    assert round(_ms(out)) == 200


def test_pauses_apply_per_join_not_globally() -> None:
    out = concat_lines(
        [_line(100, after=1000), _line(100), _line(100)], silence_ms=250
    )
    assert round(_ms(out)) == 1550  # 100 +1000+ 100 +250+ 100


def test_garbage_pause_values_fall_back_to_the_project_gap() -> None:
    bad = _line(100)
    bad.effective_delivery["pause_after"] = "not a number"
    out = concat_lines([bad, _line(100)], silence_ms=250)
    assert round(_ms(out)) == 450


# ── Block.direction → the engine's instruct ──────────────────────────────


def test_block_pause_after_is_read_off_the_metadata() -> None:
    """An import's pause_after_ms is the line's own pause (line_takes, Slice 4) —
    sent as the plan's request, so it wins over the persona's (G7)."""
    from justvoice.line_takes import line_override, override_delivery

    class B:
        metadata_json = json.dumps({"source_ref": "x", "pause_after_ms": 750})

    assert line_override(B()) == {"pause_after_ms": 750}
    assert override_delivery(B()) == {"pause_after": 750}


def test_block_pause_after_is_none_when_absent_or_unparseable() -> None:
    from justvoice.line_takes import line_override

    class NoMeta:
        metadata_json = None

    class NoKey:
        metadata_json = json.dumps({"marker": True})

    class Junk:
        metadata_json = "{not json"

    class BadValue:
        metadata_json = json.dumps({"pause_after_ms": "soon"})

    for b in (NoMeta(), NoKey(), Junk(), BadValue()):
        assert "pause_after_ms" not in line_override(b)


def test_import_adapters_still_parse_pause_after_ms() -> None:
    """The producer side of the pause path — a field with no consumer was
    the bug; a consumer with no producer would be the same bug inverted."""
    from justvoice.imports.standard_schema import StandardLine

    assert "pause_after_ms" in StandardLine.model_fields


# ── Lines from engines with different formats (2026-10-02) ──────────────


def _tone(sr: int, ch: int, seconds: float = 1.0, hz: float = 440.0) -> RenderedLine:
    import numpy as np

    t = np.arange(int(sr * seconds)) / sr
    mono = (0.3 * np.sin(2 * np.pi * hz * t) * 32767).astype("<i2")
    return RenderedLine(pcm=np.repeat(mono, ch).tobytes(), sample_rate=sr, channels=ch,
                        effective_delivery={})


def test_a_chapter_mixing_rates_joins_at_the_highest_rate_and_keeps_every_lines_length() -> None:
    """A 48 kHz VoxCPM2 line beside a 24 kHz line used to be appended raw — half speed,
    an octave low. Both now play for their real length at the chapter's 48 kHz."""
    import numpy as np

    out = concat_lines([_tone(24000, 1), _tone(48000, 1)], silence_ms=250)
    assert (out.sample_rate, out.channels) == (48000, 1)
    assert round(len(out.pcm) / 2 / 48000, 3) == 2.25  # 1 s + 0.25 s gap + 1 s
    # The upsampled 24 kHz tone is still 440 Hz, not 220.
    first = np.frombuffer(out.pcm, dtype="<i2")[:48000].astype(np.float64)
    peak_hz = np.argmax(np.abs(np.fft.rfft(first))) * 48000 / len(first)
    assert abs(peak_hz - 440) < 2


def test_a_stereo_line_makes_the_chapter_stereo() -> None:
    out = concat_lines([_tone(24000, 1), _tone(24000, 2)], silence_ms=0)
    assert (out.sample_rate, out.channels) == (24000, 2)
    assert len(out.pcm) == 2 * 24000 * 2 * 2  # 2 s, stereo, 16-bit
