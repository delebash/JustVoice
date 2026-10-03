# SPDX-License-Identifier: MIT
"""A cloud voice's WAV header decides the rendered line's sample rate (2026-10-02).

The providers return `sample_rate=24000` as a placeholder with the real rate in the WAV
header (`external_openai.py`). A chapter render took the placeholder, so a 44.1 kHz WAV would
have been labelled 24 kHz — slowed and lowered on playback. Generate reads the header since
gap 8; the chapter render now does too.
"""

from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from justvoice.audio.wav import write_wav_container
from justvoice.engines.base import EngineMeta, PresetVoice, SynthOutput
from justvoice.engines.registry import EngineRegistry
from justvoice.render_core import render_line

SR = 44100


class _CloudVoice:
    """A registry provider whose WAV is 44.1 kHz stereo while its output says 24000 mono."""

    def __init__(self):
        self.meta = EngineMeta(engine_id="cloud", display_name="Cloud", backend="cloud",
                               supported_runtimes=["http"])

    def ready(self):
        return True

    def voices(self):
        return [PresetVoice(id="cv_1", name="CV")]

    def synthesize(self, req):
        tone = (0.2 * np.sin(2 * np.pi * 220 * np.arange(SR) / SR) * 32767).astype("<i2")
        stereo = np.repeat(tone, 2).tobytes()
        return SynthOutput(bytes=write_wav_container(stereo, SR, 2), sample_rate=24000,
                           channels=1, is_wav_container=True)


def test_a_chapter_line_takes_the_rate_and_channels_from_the_wav_header():
    registry = EngineRegistry()
    registry.register(_CloudVoice())
    settings = SimpleNamespace(
        limits=SimpleNamespace(text_max_chars=5000),
        cache=SimpleNamespace(enabled=False),
        generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50),
    )
    st = SimpleNamespace(
        settings=SimpleNamespace(get=lambda: settings), engines=registry,
        voices=SimpleNamespace(get=lambda vid: None), lexicons=SimpleNamespace(get=lambda lid: None),
    )
    line = render_line(st, voice="cv_1", text="Hi", use_cache=False)
    assert (line.sample_rate, line.channels) == (SR, 2)
    assert len(line.pcm) == SR * 2 * 2  # one second, two channels, 16-bit
