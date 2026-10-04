# SPDX-License-Identifier: MIT
"""The audio.cpp switch (docs/plans/2026-10-01-audiocpp-switch.md): the catalog, the
request mapping per family, and the runtime's own bookkeeping. No binary, no GPU — the
live checks are in the plan's §8."""

from __future__ import annotations

import pytest

from justvoice.engines.audiocpp import release
from justvoice.engines.audiocpp.runtime import AudioCppError, ModelEntry
from justvoice.engines.audiocpp.slot import to_speech_request
from justvoice.engines.capability_details import lookup
from justvoice.engines.manager import discover_engines
from justvoice.engines.qwen3 import manifest as qwen3_manifest


def _row(engine: str, variant: str) -> dict:
    m = discover_engines()[engine]
    return next(r for r in m.module.VARIANTS if r["id"] == variant)


# ─── the catalog ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("engine", ["kokoro", "qwen3", "chatterbox", "asr"])
def test_every_switched_engine_runs_on_audiocpp(engine):
    m = discover_engines()[engine]
    assert m.uses_audiocpp
    assert m.default_variant_id in {r["id"] for r in m.module.VARIANTS}
    for r in m.module.VARIANTS:
        src = r["sources"][0]
        # audio.cpp's own repo, or our conversion of a model it does not publish (gap 4).
        pinned = {release.MODEL_REPO: release.MODEL_REVISION,
                  qwen3_manifest.CV_06_REPO: qwen3_manifest.CV_06_REVISION}
        assert src["hf_repo"] in pinned
        assert src["revision"] == pinned[src["hf_repo"]]          # a commit, never a branch
        assert r["audiocpp"]["file"] in src["files"]


def test_every_switched_variant_reaches_a_capability_row():
    for engine in ("kokoro", "qwen3", "chatterbox"):
        for r in discover_engines()[engine].module.VARIANTS:
            assert lookup(r["id"]) is not None, r["id"]


def test_qwen3_family_still_reads_off_the_variant_id():
    # voice_model.model_of_variant walks the id down to its capability row:
    # qwen3-<family>-<size>-<precision> → qwen3-<family>.
    from justvoice.voice_model import model_of_variant

    ids = [r["id"] for r in discover_engines()["qwen3"].module.VARIANTS]
    assert {model_of_variant(i) for i in ids} == {"qwen3-cv", "qwen3-base", "qwen3-vd"}


def test_kokoro_offers_only_voices_audiocpp_can_speak():
    voices = discover_engines()["kokoro"].static_voices
    assert len(voices) == 49 and not any(v["language"] == "ja" for v in voices)


def test_the_aligner_rides_with_speech_recognition():
    row = _row("asr", "qwen3-asr-1.7b-q8")
    comp = row["audiocpp"]["companions"][0]
    assert comp["role"] == "aligner" and comp["file"] in row["sources"][0]["files"]


def test_turbo_has_its_own_row_again_and_multilingual_has_no_min_p():
    # Gap 1 (docs/plans/2026-10-03-gap-1-turbo-cloning.md): Turbo clones on our audio.cpp.
    assert lookup("chatterbox-turbo-v1").engine_id == "chatterbox-turbo"
    assert "min_p" not in {k.key for k in lookup("chatterbox-multilingual").knobs}


# ─── request mapping ─────────────────────────────────────────────────────────


def test_kokoro_maps_voice_language_speed_and_seed():
    req = to_speech_request(_row("kokoro", "kokoro-82m-q8"), {
        "voice_id": "bf_emma", "text": "Hello.", "language": None, "seed": 7,
        "delivery": {"speed": 1.1}})
    assert req == {"model": "kokoro-82m-q8", "input": "Hello.", "seed": 7, "voice": "bf_emma",
                   "language": "en-gb", "speed": 1.1}


@pytest.mark.parametrize("variant", ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"])
def test_qwen3_customvoice_takes_speaker_instruct_and_a_language_name(variant):
    req = to_speech_request(_row("qwen3", variant), {
        "voice_id": "Ryan", "text": "Hi.", "language": "en-US",
        "delivery": {"instruct": "Whisper it.", "temperature": 0.7,
                     "engine": {"talker_top_k": 40, "repetition_penalty": 1.1}}})
    assert req["language"] == "English"                       # "en" is rejected by audio.cpp
    assert req["options"] == {"speaker": "Ryan", "instruct": "Whisper it.", "temperature": 0.7,
                              "top_k": 40, "repetition_penalty": 1.1}


def test_qwen3_base_clones_from_the_clip_and_its_transcript():
    req = to_speech_request(_row("qwen3", "qwen3-base-1.7b-q8"), {
        "voice_id": "v1", "text": "Hi.", "audio_prompt_path": "C:\\voices\\v1\\ref.wav",
        "ref_text": "The reference words."})
    assert req["voice_ref"] == "C:/voices/v1/ref.wav"
    assert req["reference_text"] == "The reference words."
    assert "speaker" not in (req.get("options") or {})


def test_qwen3_refuses_the_wrong_family_by_name():
    for cv in ("qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"):
        with pytest.raises(AudioCppError, match="cannot clone"):
            to_speech_request(_row("qwen3", cv),
                              {"voice_id": "x", "text": "Hi.", "audio_prompt_path": "a.wav"})
    with pytest.raises(AudioCppError, match="clone-only"):
        to_speech_request(_row("qwen3", "qwen3-base-1.7b-q8"), {"voice_id": "Ryan", "text": "Hi."})


def test_qwen3_voicedesign_speaks_from_its_description():
    req = to_speech_request(_row("qwen3", "qwen3-vd-1.7b-q8"), {
        "voice_id": "d1", "text": "Hi.", "delivery": {"instruct": "A gravel-voiced harbour-master."}})
    assert req["instructions"] == "A gravel-voiced harbour-master."
    with pytest.raises(AudioCppError, match="description"):
        to_speech_request(_row("qwen3", "qwen3-vd-1.7b-q8"), {"voice_id": "d1", "text": "Hi."})


def test_chatterbox_maps_cfg_to_guidance_scale_per_line():
    req = to_speech_request(_row("chatterbox", "chatterbox-multilingual-v2-q8"), {
        "voice_id": "c1", "text": "Hallo.", "language": "de", "audio_prompt_path": "/v/ref.wav",
        "delivery": {"temperature": 0.8, "engine": {"exaggeration": 0.7, "cfg_weight": 0.3}}})
    assert req["voice_ref"] == "/v/ref.wav" and req["language"] == "de"
    assert req["options"] == {"exaggeration": 0.7, "guidance_scale": 0.3, "temperature": 0.8}


def test_chatterbox_needs_a_clip():
    with pytest.raises(AudioCppError, match="cloned voices"):
        to_speech_request(_row("chatterbox", "chatterbox-multilingual-v2-q8"),
                          {"voice_id": "c1", "text": "Hi."})


# ─── the runtime's bookkeeping ───────────────────────────────────────────────


def test_model_entry_writes_the_config_row():
    e = ModelEntry("kokoro-82m-q8", "kokoro_tts", "tts", "C:/m/k.gguf",
                   (("espeak_data_path", "C:/e/data"),))
    assert e.to_config() == {"id": "kokoro-82m-q8", "family": "kokoro_tts", "task": "tts",
                             "mode": "offline", "path": "C:/m/k.gguf",
                             "session_options": {"espeak_data_path": "C:/e/data"}}


def test_release_rows_pin_one_tag_and_ship_the_windows_cuda_runtime():
    rows = release.binaries()
    assert all(f"/{release.TAG}/" in r.asset_url for r in rows)
    win_cuda = [r for r in rows if r.platform == "windows" and r.gpu.startswith("cuda")]
    assert win_cuda and all(r.runtime_url and "cudart" in r.runtime_url for r in win_cuda)


def test_two_kinds_in_one_server_each_book_only_their_own_share():
    # audio.cpp serves speech AND speech→text from one process: the second kind's
    # measurement holds the first kind's model too, which must not be booked twice.
    from types import SimpleNamespace

    from llm_runner.runner.arbiter import VramArbiter, set_arbiter
    from llm_runner.runner.schema import GpuInfo, HardwareInfo

    from justvoice.engines.manager import EngineManager

    hw = HardwareInfo(os="Windows", platform="windows", cpu_cores=8, ram_mb=32768,
                      gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=8192)], runtimes={"cuda": True})
    arb = VramArbiter(hardware_fn=lambda: hw)
    set_arbiter(arb)
    try:
        mgr = EngineManager()
        server = SimpleNamespace(pid=4242)
        tts = SimpleNamespace(manifest=SimpleNamespace(id="kokoro"), proc=server)
        stt = SimpleNamespace(manifest=SimpleNamespace(id="asr"), proc=server)
        arb.reserve("tts:kokoro", 2500, kind="tts", evict_fn=lambda: None, source="measured")
        mgr._loaded = {"tts": tts, "stt": stt}
        assert mgr._own_share_mb("stt", stt, 6500) == 4000
        mgr._loaded = {"tts": tts}                       # alone in its process → the whole number
        assert mgr._own_share_mb("tts", tts, 2500) == 2500
        other = SimpleNamespace(manifest=SimpleNamespace(id="whisper"), proc=SimpleNamespace(pid=99))
        mgr._loaded = {"tts": tts, "stt": other}         # a different process is not subtracted
        assert mgr._own_share_mb("stt", other, 2200) == 2200
    finally:
        set_arbiter(None)


def test_an_audiocpp_engine_runs_where_the_runtime_runs(monkeypatch):
    from pathlib import Path

    from justvoice.engines.audiocpp import runtime
    from justvoice.engines.manager import EngineManager

    monkeypatch.setattr(runtime, "installed_exe",
                        lambda backend=None: Path("C:/rt/audiocpp/v0.9.0/vulkan/audiocpp_server.exe"))
    m = discover_engines()["kokoro"]
    # Neither a per-call device nor the old per-engine Device setting moves one model off
    # the shared server.
    assert EngineManager()._resolve_device(m, "cpu") == "vulkan"


def _client(tmp_path, monkeypatch, *, installed=None):
    from fastapi.testclient import TestClient
    from llm_runner.runner.schema import GpuInfo, HardwareInfo

    from justvoice.app import create_app
    from justvoice.engines.audiocpp import runtime

    monkeypatch.setattr(runtime, "_HW", HardwareInfo(
        os="Windows", platform="windows", cpu_cores=8, ram_mb=32768,
        gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=8192)], runtimes={"cuda": True}))
    monkeypatch.setattr(runtime, "installed_exe", lambda backend=None: installed)
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def test_the_runtime_row_reads_and_saves_its_backend(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    r = c.get("/v1/speech-runtime").json()
    assert r["installed"] is False and r["backend_setting"] == "auto"
    assert set(r["backends"]) == {"cuda", "vulkan", "cpu"} and r["gpus"] == ["fake"]
    r = c.put("/v1/speech-runtime", json={"backend": "vulkan", "gpu": 0})
    assert r.status_code == 200 and r.json()["backend_setting"] == "vulkan"
    assert c.get("/v1/settings").json()["engines"]["speech_runtime"] == {
        "backend": "vulkan", "gpu": 0, "cpu_threads": 0, "cpu_min_realtime": 2.0}


def test_the_runtime_row_saves_the_cpu_process_threads_without_touching_the_build(tmp_path, monkeypatch):
    """CPU placement (2026-10-02): the CPU process's threads are a setting; 0 means the
    physical core count, and changing them keeps the backend the user chose."""
    from justvoice.engines.audiocpp import runtime

    monkeypatch.setattr(runtime, "physical_cores", lambda: 8)
    c = _client(tmp_path, monkeypatch)
    r = c.get("/v1/speech-runtime").json()
    assert r["cpu_threads"] == 0 and r["cpu_threads_used"] == 8 and r["physical_cores"] == 8
    assert r["cpu_min_realtime"] == 2.0 and r["cpu_running"] is False
    c.put("/v1/speech-runtime", json={"backend": "vulkan", "gpu": 0})
    r = c.put("/v1/speech-runtime", json={"backend": "vulkan", "gpu": 0, "cpu_threads": 6})
    assert r.status_code == 200 and r.json()["cpu_threads_used"] == 6
    assert r.json()["backend_setting"] == "vulkan"
    assert c.put("/v1/speech-runtime", json={"backend": "vulkan", "cpu_threads": -1}).status_code == 400
    assert c.put("/v1/speech-runtime", json={"backend": "vulkan", "cpu_min_realtime": 0}).status_code == 400


def test_the_runtime_row_refuses_a_build_this_os_has_none_of(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    assert c.put("/v1/speech-runtime", json={"backend": "metal"}).status_code == 400
    assert c.put("/v1/speech-runtime", json={"backend": "cpu", "gpu": -1}).status_code == 400


def test_deleting_an_engines_models_says_so_when_files_stay(tmp_path, monkeypatch):
    # Windows refuses to delete a file a process holds open; the delete must not
    # report success over files that are still there.
    from justvoice.engines import manager as mgr_mod

    c = _client(tmp_path, monkeypatch)
    model = tmp_path / "speech-cache" / "kokoro" / "kokoro-82m-q8" / "kokoro-82m-q8_0.gguf"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"gguf")
    with monkeypatch.context() as mp:
        mp.setattr(mgr_mod.shutil, "rmtree", lambda *a, **k: None)
        r = c.delete("/v1/engines/kokoro")
    assert r.status_code == 409 and "still in use" in r.text
    assert c.delete("/v1/engines/kokoro").status_code == 200 and not model.exists()


# ─── the aligner's input rate ────────────────────────────────────────────────


def _tone_wav(rate: int, seconds: float, channels: int = 1) -> bytes:
    import numpy as np

    from justvoice.audio.wav import write_wav_container

    t = np.arange(int(rate * seconds)) / rate
    x = (np.sin(2 * np.pi * 220 * t) * 8000).astype("<i2")
    if channels > 1:
        x = np.repeat(x, channels)
    return write_wav_container(x.tobytes(), rate, channels)


@pytest.mark.parametrize("rate, channels", [(24000, 1), (44100, 2), (48000, 1)])
def test_the_aligner_gets_16k_mono_so_its_seconds_are_right(rate, channels):
    """audio.cpp v0.9.0 reports aligned seconds at the INPUT rate: a 24 kHz render
    came back at 2/3 of its real times. The slot sends 16 kHz mono, same length."""
    from justvoice.audio.wav import parse_wav_header
    from justvoice.engines.audiocpp.slot import as_16k_mono

    fmt, _o, _s = parse_wav_header(as_16k_mono(_tone_wav(rate, 2.0, channels)))
    assert (fmt.sample_rate, fmt.channels) == (16000, 1)
    assert fmt.duration_sec == pytest.approx(2.0, abs=0.01)


def test_16k_mono_goes_as_it_is():
    from justvoice.engines.audiocpp.slot import as_16k_mono

    wav = _tone_wav(16000, 1.0)
    assert as_16k_mono(wav) is wav


# ── VoxCPM2 (gap 9) ──────────────────────────────────────────────────────


def test_voxcpm2_clones_from_the_clip_and_sends_direction_as_its_prefix():
    req = to_speech_request(_row("voxcpm2", "voxcpm2-q8"), {
        "voice_id": "v1", "text": "The lights came on.", "audio_prompt_path": "C:\\voices\\v1\\ref.wav",
        "ref_text": "The reference words.", "delivery": {"instruct": "Whispered, (tired)"}})
    assert req["voice_ref"] == "C:/voices/v1/ref.wav"
    assert req["reference_text"] == "The reference words."
    # Brackets inside the direction would end the tag early; they go.
    assert req["input"] == "(Whispered, tired)The lights came on."


def test_voxcpm2_designs_from_a_description_and_refuses_a_voice_with_neither():
    req = to_speech_request(_row("voxcpm2", "voxcpm2-q8"), {
        "text": "Hi.", "delivery": {"instruct": "A deep, slow, elderly man's voice"}})
    assert req["input"] == "(A deep, slow, elderly man's voice)Hi." and "voice_ref" not in req
    with pytest.raises(AudioCppError, match="neither a reference clip nor a description"):
        to_speech_request(_row("voxcpm2", "voxcpm2-q8"), {"voice_id": "x", "text": "Hi."})


def test_voxcpm2_speaks_a_lines_own_brackets_as_dashes():
    """VoxCPM2 does not speak parenthesised text, anywhere in the line (measured 2026-10-02)."""
    row = _row("voxcpm2", "voxcpm2-q8")
    req = to_speech_request(row, {"text": "He left (quietly, without a word) and shut it.",
                                  "audio_prompt_path": "a.wav"})
    assert req["input"] == "He left — quietly, without a word — and shut it."
    req = to_speech_request(row, {"text": "(Aside) He left.", "audio_prompt_path": "a.wav"})
    assert req["input"] == "Aside — He left."
    req = to_speech_request(row, {"text": "(Aside) He left.", "delivery": {"instruct": "Dry"}})
    assert req["input"] == "(Dry)Aside — He left."
