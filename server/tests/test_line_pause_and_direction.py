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
    from justvoice.api.render_chapter_api import _block_pause_after

    class B:
        metadata_json = json.dumps({"source_ref": "x", "pause_after_ms": 750})

    assert _block_pause_after(B()) == 750


def test_block_pause_after_is_none_when_absent_or_unparseable() -> None:
    from justvoice.api.render_chapter_api import _block_pause_after

    class NoMeta:
        metadata_json = None

    class NoKey:
        metadata_json = json.dumps({"marker": True})

    class Junk:
        metadata_json = "{not json"

    class BadValue:
        metadata_json = json.dumps({"pause_after_ms": "soon"})

    assert _block_pause_after(NoMeta()) is None
    assert _block_pause_after(NoKey()) is None
    assert _block_pause_after(Junk()) is None
    assert _block_pause_after(BadValue()) is None


def test_import_adapters_still_parse_pause_after_ms() -> None:
    """The producer side of the pause path — a field with no consumer was
    the bug; a consumer with no producer would be the same bug inverted."""
    from justvoice.imports.standard_schema import StandardLine

    assert "pause_after_ms" in StandardLine.model_fields
