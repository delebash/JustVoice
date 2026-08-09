# SPDX-License-Identifier: MIT
"""Audiobook export — QC math, FFMETADATA chapters, m4b mux argv, endpoints."""

from __future__ import annotations

import math
import struct
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.export_audiobook import (
    ChapterAudio,
    build_ffmetadata,
    mux_m4b,
    qc_report,
)
from tests.jw_fixtures import book_json, scene


def _wav(amplitude: float, seconds: float = 1.0, rate: int = 16000) -> bytes:
    """Mono 16-bit sine at the given linear amplitude (0..1)."""
    n = int(rate * seconds)
    frames = b"".join(
        struct.pack("<h", int(amplitude * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        for i in range(n)
    )
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()


def _ch(title: str, amp: float, dur: float = 1.0) -> ChapterAudio:
    return ChapterAudio(scene_id=f"s_{title}", title=title, wav=_wav(amp, dur), duration_s=dur)


# ── QC ───────────────────────────────────────────────────────────────


def test_qc_flags_hot_and_quiet_chapters():
    # sine RMS = amp/√2 → dBFS = 20log10(amp) - 3.01
    good = _ch("Good", 10 ** (-17.0 / 20))   # RMS ≈ -20 dB, peak -17 → ok
    hot = _ch("Hot", 0.9)                     # peak ≈ -0.9 dB → peak fail
    quiet = _ch("Quiet", 10 ** (-30.0 / 20))  # RMS ≈ -33 dB → rms fail
    rep = qc_report([good, hot, quiet])
    assert [c.ok for c in rep] == [True, False, False]
    assert rep[1].peak_ok is False and rep[1].rms_ok is False  # 0.9 amp RMS ≈ -3.9 dB (too hot)
    assert rep[2].rms_ok is False and rep[2].peak_ok is True


# ── chapter metadata ────────────────────────────────────────────────


def test_ffmetadata_cumulative_chapter_marks():
    md = build_ffmetadata([_ch("One", 0.1, 2.0), _ch("Two", 0.1, 3.5)], "Stillwater", "S. K. H.")
    assert md.startswith(";FFMETADATA1")
    assert "title=Stillwater" in md and "artist=S. K. H." in md
    assert "START=0\nEND=2000\ntitle=One" in md
    assert "START=2000\nEND=5500\ntitle=Two" in md


# ── mux argv (ffmpeg stubbed) ───────────────────────────────────────


def test_mux_m4b_builds_one_ffmpeg_call(tmp_path):
    calls = {}

    def fake_run(argv, capture_output=True):
        calls["argv"] = argv
        # produce the output file ffmpeg would have written
        from pathlib import Path

        Path(argv[-1]).write_bytes(b"m4b-bytes")
        return SimpleNamespace(returncode=0, stderr=b"")

    out = mux_m4b([_ch("One", 0.1)], "Stillwater", None, run=fake_run)
    assert out == b"m4b-bytes"
    argv = calls["argv"]
    assert argv[0] == "ffmpeg" and "-f" in argv
    assert "ipod" in argv and "concat" in argv
    assert any(str(a).endswith("chapters.txt") for a in argv)


def test_mux_m4b_raises_on_ffmpeg_failure():
    def fake_run(argv, capture_output=True):
        return SimpleNamespace(returncode=1, stderr=b"boom")

    with pytest.raises(RuntimeError, match="boom"):
        mux_m4b([_ch("One", 0.1)], "X", None, run=fake_run)


# ── endpoints ────────────────────────────────────────────────────────


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _seed(client) -> str:
    # A real JustWrite book.json — see tests/jw_fixtures.py.
    payload = book_json(
        premise="by S. K. H.",
        chapters=[
            ("ch1", "One", [scene("scn1", "Hello.")]),
            ("ch2", "Two", [scene("scn2", "There.")]),
        ],
    )
    r = client.post("/v1/projects/import?source=justwrite", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_qc_endpoint_with_stubbed_renderer(client, monkeypatch):
    pid = _seed(client)
    monkeypatch.setattr(
        "justvoice.api.render_chapter_api.render_scene_to_wav",
        lambda st, scene_id: _wav(10 ** (-17.0 / 20), 1.0),
    )
    r = client.get(f"/v1/projects/{pid}/qc")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["all_ok"] is True
    assert [c["title"] for c in body["chapters"]] == ["One", "Two"]
    assert body["limits"]["rms_min_db"] == -23.0


def test_export_m4b_503_without_ffmpeg(client, monkeypatch):
    pid = _seed(client)
    monkeypatch.setattr("justvoice.export_audiobook.have_ffmpeg", lambda: False)
    r = client.post(f"/v1/projects/{pid}/export_m4b")
    assert r.status_code == 503
    assert "ffmpeg" in r.text


def test_export_m4b_with_stubbed_ffmpeg(client, monkeypatch):
    pid = _seed(client)
    monkeypatch.setattr(
        "justvoice.api.render_chapter_api.render_scene_to_wav",
        lambda st, scene_id: _wav(0.1, 0.5),
    )
    monkeypatch.setattr("justvoice.export_audiobook.have_ffmpeg", lambda: True)

    def fake_run(argv, capture_output=True):
        from pathlib import Path

        Path(argv[-1]).write_bytes(b"M4B!")
        return SimpleNamespace(returncode=0, stderr=b"")

    monkeypatch.setattr("justvoice.export_audiobook.subprocess.run", fake_run)
    r = client.post(f"/v1/projects/{pid}/export_m4b")
    assert r.status_code == 200, r.text
    assert r.content == b"M4B!"
    assert r.headers["content-type"].startswith("audio/mp4")
    assert "Stillwater.m4b" in r.headers.get("content-disposition", "")
