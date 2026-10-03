# SPDX-License-Identifier: MIT
"""The optional Japanese dictionary (gap 7, docs/plans/2026-10-03-gap-7-more-languages.md):
unidic-lite downloads, is verified and unpacks to only its dictionary and licences; the runtime
finds it through AUDIOCPP_UNIDIC_DIR; a Japanese line without it is refused by name; the runtime
row offers it only once the pinned runtime reads Japanese."""

from __future__ import annotations

import hashlib
import importlib
import io
import tarfile
from pathlib import Path

import pytest

from justvoice.engines.audiocpp import japanese, release, runtime, slot

DIC = f"unidic-lite-{japanese.VERSION}/unidic_lite/dicdir/"


def _sdist(path: Path) -> bytes:
    """A small stand-in for the sdist: the dictionary folder, the licences, and the Python
    wrapper that must be left behind."""
    files = {DIC + "dicrc": b"; dicrc\n", DIC + "sys.dic": b"\x00" * 64, DIC + "BSD": b"bsd",
             f"unidic-lite-{japanese.VERSION}/LICENSE": b"mit",
             f"unidic-lite-{japanese.VERSION}/LICENSE.unidic": b"unidic",
             f"unidic-lite-{japanese.VERSION}/unidic_lite/__init__.py": b"print('no')",
             f"unidic-lite-{japanese.VERSION}/setup.py": b""}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    path.write_bytes(buf.getvalue())
    return buf.getvalue()


@pytest.fixture()
def fake_download(monkeypatch, tmp_path):
    import llm_runner.runner.download as download

    blob = _sdist(tmp_path / "sdist.tar.gz")
    calls = []

    def fake_stream(url, dest, on_progress=None, cancel_check=None, **kw):
        calls.append(url)
        Path(dest).write_bytes(blob)
        if on_progress:
            on_progress(len(blob), len(blob))

    monkeypatch.setattr(download, "stream_download", fake_stream)
    monkeypatch.setattr(japanese, "SHA256", hashlib.sha256(blob).hexdigest())
    return calls


def test_it_unpacks_only_the_dictionary_and_its_licences(fake_download, tmp_path):
    root = tmp_path / "rt"
    seen = []
    got = japanese.install(root, on_progress=lambda done, total: seen.append((done, total)))
    assert got == japanese.home(root) and japanese.dictionary_dir(root) == got
    assert sorted(p.name for p in got.iterdir()) == ["BSD", "LICENSE", "LICENSE.unidic", "dicrc", "sys.dic"]
    assert seen and not list(root.glob("audiocpp/*.tar.gz")) and not list(root.glob("audiocpp/*.staging"))
    japanese.install(root)                       # idempotent: no second download
    assert fake_download == [japanese.URL]


def test_a_tampered_download_is_refused(fake_download, monkeypatch, tmp_path):
    monkeypatch.setattr(japanese, "SHA256", "0" * 64)
    with pytest.raises(RuntimeError, match="checksum mismatch"):
        japanese.install(tmp_path / "rt")
    assert japanese.dictionary_dir(tmp_path / "rt") is None


def test_the_runtime_is_told_where_the_dictionary_is(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "_runtime_root", lambda: tmp_path)
    monkeypatch.setenv("AUDIOCPP_UNIDIC_DIR", "stale")
    assert "AUDIOCPP_UNIDIC_DIR" not in runtime._child_env()
    (japanese.home(tmp_path)).mkdir(parents=True)
    (japanese.home(tmp_path) / "dicrc").write_text("x")
    assert runtime._child_env()["AUDIOCPP_UNIDIC_DIR"] == str(japanese.home(tmp_path))


def _kokoro_row():
    from justvoice.engines.manager import discover_engines

    return next(r for r in discover_engines()["kokoro"].module.VARIANTS if r["id"] == "kokoro-82m-q8")


CB = {"id": "chatterbox-multilingual-v2-q8", "audiocpp": {"family": "chatterbox", "task": "clon", "file": "c.gguf"}}


def test_a_japanese_line_is_refused_by_name_until_the_dictionary_is_here(monkeypatch, tmp_path):
    import justvoice.engines.manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "engines_runtime_root", lambda: tmp_path)
    with pytest.raises(slot.AudioCppError, match="Japanese needs the Japanese dictionary — install it on AI "
                                                 "Settings → Speech engines."):
        slot.to_speech_request(_kokoro_row(), {"voice_id": "jf_alpha", "text": "こんにちは。"})
    with pytest.raises(slot.AudioCppError, match="Japanese dictionary"):
        slot.to_speech_request(CB, {"text": "こんにちは。", "language": "ja", "audio_prompt_path": "C:/v.wav"})
    # Other languages never ask for it.
    assert slot.to_speech_request(_kokoro_row(), {"voice_id": "af_heart", "text": "Hi."})["language"] == "en-us"
    (japanese.home(tmp_path)).mkdir(parents=True)
    (japanese.home(tmp_path) / "dicrc").write_text("x")
    assert slot.to_speech_request(_kokoro_row(), {"voice_id": "jf_alpha", "text": "こんにちは。"})["language"] == "ja"
    assert slot.to_speech_request(CB, {"text": "こんにちは。", "language": "ja",
                                       "audio_prompt_path": "C:/v.wav"})["language"] == "ja"


def test_languages_and_voices_follow_the_pin(monkeypatch):
    import justvoice.engines.chatterbox.manifest as cb
    import justvoice.engines.kokoro.manifest as kk

    try:
        monkeypatch.setattr(release, "TAG", "v0.9.0-jv.1")
        importlib.reload(cb), importlib.reload(kk)
        assert len(cb.VARIANTS[0]["languages"]) == 19 and len(kk.STATIC_VOICES) == 49
        monkeypatch.setattr(release, "TAG", "v0.9.0-jv.3")
        importlib.reload(cb), importlib.reload(kk)
        assert {"he", "ru", "zh", "ja"} <= set(cb.VARIANTS[0]["languages"])
        assert cb.VARIANTS[0]["name"] == "Chatterbox Multilingual (23 languages)"
        assert len(kk.STATIC_VOICES) == 54
    finally:
        monkeypatch.undo()
        importlib.reload(cb), importlib.reload(kk)


def test_the_runtime_row_offers_it_only_once_the_pin_reads_japanese(monkeypatch):
    from justvoice.api import speech_runtime_api as api

    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.1")
    assert api._japanese_dictionary() is None
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.3")
    info = api._japanese_dictionary()
    assert info.version == japanese.VERSION and info.size_bytes == japanese.INSTALLED_BYTES
