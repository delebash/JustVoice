# SPDX-License-Identifier: MIT
"""The pause between lines is the pause heard, and a paragraph's lines join closer
(decided 2026-10-07).

Kokoro pads every take with ~265 ms of silence before and ~715 ms after (exact
digital zero), so a 600 ms pause played as ~1.6 s; and Analyze cuts a paragraph —
a quote, its dialogue tag, the quote's rest — into lines joined at that same gap.
"""

from __future__ import annotations

from types import SimpleNamespace

from array import array

from justvoice.api import render_chapter_api
from justvoice.line_takes import paragraph_joins
from justvoice.models import ChapterLine, GenerationSettings, Settings
from justvoice.audio import dsp_client
from justvoice.render_core import TRIM_BELOW_DBFS, TRIM_KEEP_MS, RenderedLine, concat_lines

SR = 24000


def _ms(n_samples: int) -> int:
    return round(n_samples / SR * 1000)


def _padded(lead_ms: int, sound_ms: int, trail_ms: int, *, level: int = 8000) -> bytes:
    """A take as a model hands it over: silence, sound, silence."""
    z = lambda ms: [0] * int(SR * ms / 1000)  # noqa: E731
    return array("h", z(lead_ms) + [level] * int(SR * sound_ms / 1000) + z(trail_ms)).tobytes()


def _trim_pcm(pcm: bytes, sr: int, ch: int) -> bytes:
    """A line's silence trim, as concat_lines asks the DSP program for it."""
    return dsp_client.fit(pcm, sr, ch, sr, ch, trim_below_dbfs=TRIM_BELOW_DBFS, trim_keep_ms=TRIM_KEEP_MS)


def test_a_takes_own_silence_is_cut_to_the_margin():
    out = _trim_pcm(_padded(265, 1000, 715), SR, 1)
    assert _ms(len(out) // 2) == TRIM_KEEP_MS + 1000 + TRIM_KEEP_MS


def test_a_quiet_tail_above_the_threshold_is_kept():
    """A word's decay at −60 dBFS is sound, not padding — −45 dBFS cut up to 710 ms of one."""
    quiet = int(32768 * 10 ** (-60 / 20))  # ≈ 33
    pcm = _padded(0, 500, 0) + array("h", [quiet] * int(SR * 0.4) + [0] * int(SR * 0.7)).tobytes()
    assert _ms(len(_trim_pcm(pcm, SR, 1)) // 2) == 500 + 400 + TRIM_KEEP_MS


def test_a_silent_line_is_kept_as_it_is():
    pcm = b"\x00\x00" * SR
    assert _trim_pcm(pcm, SR, 1) == pcm


def test_the_join_plays_the_pause_set_not_the_padding():
    line = lambda: RenderedLine(pcm=_padded(265, 1000, 715), sample_rate=SR, channels=1, effective_delivery={})  # noqa: E731
    out = concat_lines([line(), line()], silence_ms=600)
    # 50 + 1000 + 50 | 600 | 50 + 1000 + 50 — the padding (265 + 715 ms each) is gone.
    assert _ms(len(out.pcm) // 2) == 2 * (TRIM_KEEP_MS * 2 + 1000) + 600


def test_lines_of_one_paragraph_are_found_by_their_source_ref():
    ref = lambda r: SimpleNamespace(id=r[0], metadata_json='{"source_ref": "%s"}' % r[1] if r[1] else "{}")  # noqa: E731
    blocks = [ref(b) for b in [("a", "ch1#scene:s1#block:1"), ("b", "ch1#scene:s1#block:2"),
                               ("c", "ch1#scene:s1#block:2"), ("d", "ch1#scene:s1#block:2"),
                               ("e", None), ("f", None)]]
    # c and d follow b and c in the same paragraph; lines with no source_ref never join closer.
    assert paragraph_joins(blocks) == {"b", "c"}


def test_the_join_uses_the_pause_within_a_paragraph_and_the_scene_break(monkeypatch):
    assert GenerationSettings().pause_within_paragraph_ms == 250
    settings = Settings()
    settings.generation.pause_within_paragraph_ms = 250
    settings.generation.pause_at_scene_break_ms = 2000
    st = SimpleNamespace(settings=SimpleNamespace(get=lambda: settings))
    seen = {}
    monkeypatch.setattr(render_chapter_api, "concat_lines",
                        lambda rendered, silence_ms: seen.update(rendered=rendered, gap=silence_ms))
    lines = [ChapterLine(voice="v", text="“You flicker,”", paragraph_next=True),
             ChapterLine(voice="v", text="she told it,", paragraph_next=True),
             ChapterLine(voice="v", text="“and you’re steady.”", scene_break_after=True),
             ChapterLine(voice="v", text="Next scene.")]
    rendered = [RenderedLine(pcm=b"", sample_rate=SR, channels=1, effective_delivery={"pause_after": 900})
                for _ in lines]
    render_chapter_api._join(st, lines, rendered, 600)
    after = [rl.effective_delivery.get("pause_after") for rl in seen["rendered"]]
    # The paragraph's and the scene break's pauses win over a persona's 900 ms; the
    # last line keeps its own delivery.
    assert after == [250, 250, 2000, 900]
    assert seen["gap"] == 600
    assert rendered[0].effective_delivery["pause_after"] == 900, "a cached line is never changed"
