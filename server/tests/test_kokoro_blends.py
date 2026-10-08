# SPDX-License-Identifier: MIT
"""Kokoro blends on the speech runtime (gap 2, docs/plans/2026-10-03-gap-2-kokoro-blends.md):
the voices are read from the GGUF's embedded files, a blend renders through our audio.cpp's
`voice_pack` option, and an older runtime refuses by name."""

from __future__ import annotations

import json
import struct
from pathlib import Path
from types import SimpleNamespace

import pytest

from justvoice.engines import blending
from justvoice.engines.audiocpp import release, runtime, slot
from justvoice.engines.audiocpp.gguf_files import embedded_files


def _gguf_with_files(path: Path, files: dict[str, bytes]) -> Path:
    """A minimal GGUF v3: two unrelated keys around the three embedded-file arrays."""
    def s(text: str) -> bytes:
        raw = text.encode("utf-8")
        return struct.pack("<Q", len(raw)) + raw

    names = list(files)
    offsets, data = [0], b""
    for n in names:
        data += files[n]
        offsets.append(len(data))
    kv = [
        (s("general.name") + struct.pack("<I", 8) + s("tiny")),
        (s("audiocpp.embedded_files.names") + struct.pack("<II", 9, 8) + struct.pack("<Q", len(names))
         + b"".join(s(n) for n in names)),
        (s("audiocpp.embedded_files.offsets") + struct.pack("<II", 9, 10) + struct.pack("<Q", len(offsets))
         + struct.pack("<" + "Q" * len(offsets), *offsets)),
        (s("audiocpp.embedded_files.data") + struct.pack("<II", 9, 0) + struct.pack("<Q", len(data)) + data),
        (s("general.after") + struct.pack("<I", 4) + struct.pack("<I", 7)),
    ]
    path.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, len(kv)) + b"".join(kv))
    return path


ROWS = 3


def _voice(seed: float) -> bytes:
    return struct.pack(f"<{ROWS * 256}f", *([seed] * (ROWS * 256)))


@pytest.fixture()
def kokoro_gguf(tmp_path, monkeypatch):
    voices = {"af_heart": _voice(1.0), "am_adam": _voice(3.0)}
    files = {"voices.json": json.dumps({n: {"rows": ROWS, "cols": 256, "path": f"{n}.bin"} for n in voices}).encode(),
             **{f"voices/{n}.bin": v for n, v in voices.items()},
             "config.json": b"{}"}
    g = _gguf_with_files(tmp_path / "kokoro.gguf", files)
    monkeypatch.setattr(blending, "_kokoro_gguf", lambda data_dir: g)
    blending._PACK_CACHE.clear()
    yield g
    blending._PACK_CACHE.clear()


def test_the_reader_returns_every_embedded_file(kokoro_gguf):
    files = embedded_files(kokoro_gguf)
    assert set(files) == {"voices.json", "voices/af_heart.bin", "voices/am_adam.bin", "config.json"}
    assert len(files["voices/af_heart.bin"]) == ROWS * 256 * 4


def test_a_gguf_without_embedded_files_reads_as_none(tmp_path):
    assert embedded_files(_gguf_with_files(tmp_path / "x.gguf", {})) == {}
    plain = tmp_path / "plain.gguf"
    plain.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 0))
    assert embedded_files(plain) == {}


def test_blends_are_made_from_the_ggufs_voices(kokoro_gguf, tmp_path):
    pack, names, features = blending._kokoro_pack(tmp_path)
    assert names == ["af_heart", "am_adam"] and len(pack["af_heart"]) == ROWS * 256 * 4 and features == 256
    mix = blending.blend("kokoro", ["af_heart", "am_adam"], [0.5, 0.5], data_dir=tmp_path,
                         resolve_stored=lambda vid: None)
    assert len(mix) == ROWS * 256 and mix[0] == pytest.approx(2.0)
    mean = blending.pack_mean("kokoro", data_dir=tmp_path)
    assert mean[0] == pytest.approx(2.0)
    spliced = blending.recombine("kokoro", [("af_heart", 0.0, 0.5), ("am_adam", 0.5, 1.0)],
                                 data_dir=tmp_path, resolve_stored=lambda vid: None)
    assert spliced[0] == pytest.approx(1.0) and spliced[200] == pytest.approx(3.0)


def test_no_kokoro_download_says_so(tmp_path):
    with pytest.raises(LookupError, match="Kokoro is not downloaded"):
        blending._kokoro_gguf(tmp_path)


# ── the runtime and the slot ─────────────────────────────────────────────


def test_features_follow_the_build_order(monkeypatch):
    # jv.2 and jv.3 were never published; blends arrive in jv.4 (decided 2026-10-04).
    for tag, expect in (("v0.9.0", False), ("v0.9.0-jv.1", False), ("v0.9.0-jv.2", False),
                        ("v0.9.0-jv.4", True), (None, False), ("v9-unknown", False)):
        monkeypatch.setattr(runtime, "installed_tag", lambda backend=None, t=tag: t)
        assert runtime.has_feature("voice_pack") is expect, tag
    monkeypatch.setattr(release, "TAG", "v0.9.0")
    assert release.pinned_has("voice_pack") is False
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.4")
    assert release.pinned_has("voice_pack") is True


def _kokoro_row():
    from justvoice.engines.manager import discover_engines

    return next(r for r in discover_engines()["kokoro"].module.VARIANTS if r["id"] == "kokoro-82m-q8")


def test_a_blend_rides_voice_pack_with_a_preset_of_its_language():
    for lang, voice, code in (("en-US", "af_alloy", "en-us"), ("en-GB", "bf_alice", "en-gb"),
                              ("zh", "zf_xiaobei", "zh")):
        req = slot.to_speech_request(_kokoro_row(), {"voice_id": "v_blend", "text": "Hi.", "language": lang,
                                                     "voice_pack_path": "C:\\cache\\p.bin"})
        assert (req["voice"], req["language"], req["options"]) == (voice, code, {"voice_pack": "C:/cache/p.bin"})


def test_the_pack_file_is_written_once_by_content(tmp_path, monkeypatch):
    monkeypatch.setattr(slot, "_data_dir", lambda: tmp_path)
    vec = [2.0] * (ROWS * 256)
    p1 = slot.write_voice_pack(vec)
    p2 = slot.write_voice_pack(vec)
    assert p1 == p2 and p1.read_bytes() == struct.pack(f"<{len(vec)}f", *vec)
    with pytest.raises(slot.AudioCppError, match="rows × 256"):
        slot.write_voice_pack([1.0, 2.0])


class _Slot(slot.AudioCppSlot):
    def __init__(self, family):
        self.manifest = SimpleNamespace(name="Kokoro", id="kokoro", module=SimpleNamespace())
        self._row = {"id": "m", "audiocpp": {"family": family}}
        self.placement = "gpu"

    def is_alive(self):
        return True


def test_an_older_runtime_refuses_a_blend_by_name(monkeypatch):
    from justvoice.engines.audiocpp import release

    monkeypatch.setattr(runtime, "has_feature", lambda name, backend=None: False)
    # The slot holds its own reference (`from .runtime import has_feature`): patch that one too,
    # or the installed runtime answers — this passed only while jv.1 was installed.
    monkeypatch.setattr(slot, "has_feature", lambda name, backend=None: False)
    # The pin has blends: an update brings them. It doesn't: this version can't (audit §5 E3).
    monkeypatch.setattr(release, "pinned_has", lambda f: True)
    r = _Slot("kokoro_tts")._synth({"voice_vector": [0.0] * 256, "text": "Hi."})
    assert r.status_code == 409 and "speech runtime update" in r.json()["detail"]
    monkeypatch.setattr(release, "pinned_has", lambda f: False)
    r = _Slot("kokoro_tts")._synth({"voice_vector": [0.0] * 256, "text": "Hi."})
    assert r.status_code == 409 and "Blended voices" in r.json()["detail"]
    assert "isn't in this version" in r.json()["detail"]
    r = _Slot("qwen3_tts")._synth({"voice_vector": [0.0] * 256, "text": "Hi."})
    assert r.status_code == 422 and "blends are Kokoro's" in r.json()["detail"]
