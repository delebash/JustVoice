# SPDX-License-Identifier: MIT
"""One pause between lines for Studio's Render, the export and ACX QC
(decided 2026-09-29): Settings → generation.pause_between_lines_ms.

Found on the walkthrough: Render joined lines with 250 ms (the request
model's default) and export/QC with a hardcoded 600 ms, so The Keystone was
505 s auditioned and 522 s exported — what you heard was not what shipped.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from justvoice.api import render_chapter_api
from justvoice.models import BetweenLines, ChapterLine, GenerationSettings, RenderChapterRequest, Settings


def test_the_default_is_600_ms_what_export_always_used():
    assert GenerationSettings().pause_between_lines_ms == 600
    assert BetweenLines().silence_ms is None, "None = the setting"


def _fakes(monkeypatch, pause_ms):
    gaps: list[int] = []
    settings = Settings()
    settings.generation.pause_between_lines_ms = pause_ms
    state = SimpleNamespace(settings=SimpleNamespace(get=lambda: settings))
    monkeypatch.setattr(render_chapter_api, "qwen_family_conflicts", lambda st, voices: (None, []))
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: state)
    line = ChapterLine(voice="v", text="Hello.")
    monkeypatch.setattr(render_chapter_api, "_resolve_scene_to_lines",
                        lambda *a, **k: ([line, line], []))
    monkeypatch.setattr(render_chapter_api, "render_line", lambda *a, **k: object())

    async def no_warm(*a, **k):
        return None

    monkeypatch.setattr(render_chapter_api, "warm_lines", no_warm)
    monkeypatch.setattr(render_chapter_api, "concat_lines",
                        lambda rendered, silence_ms: gaps.append(silence_ms) or object())
    monkeypatch.setattr(render_chapter_api, "_master_scene_pcm", lambda c, t: (b"RIFF", t, None))
    monkeypatch.setattr(render_chapter_api, "_scene_master_target", lambda *a, **k: (None, "none"))
    return gaps


def test_render_export_and_qc_use_the_same_setting(monkeypatch):
    gaps = _fakes(monkeypatch, 777)
    # Studio's Render (scene mode, no gap in the request).
    asyncio.run(render_chapter_api.render_chapter(RenderChapterRequest(scene_id="s1")))
    # Export and ACX QC.
    render_chapter_api.render_scene_to_wav(render_chapter_api.get_state(), "s1", master=False)
    assert gaps == [777, 777]


def test_a_caller_that_sends_a_gap_still_gets_it(monkeypatch):
    gaps = _fakes(monkeypatch, 777)
    asyncio.run(render_chapter_api.render_chapter(
        RenderChapterRequest(scene_id="s1", between_lines=BetweenLines(silence_ms=120))))
    assert gaps == [120]
