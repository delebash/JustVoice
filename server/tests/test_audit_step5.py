# SPDX-License-Identifier: MIT
"""Audit 2026-10-04, step 5 (docs/plans/2026-10-04-audiocpp-switch-audit.md §13.5): the
requests, gates, runtime errors, placement, installs, leaks and options batches. No binary,
no GPU — the live checks are in the audit record."""

from __future__ import annotations

import hashlib
import os
import time
from types import SimpleNamespace

import httpx
import pytest

from justvoice.engines.audiocpp import release, runtime, runtime_options, slot
from justvoice.engines.audiocpp.runtime import AudioCppError, AudioCppServer
from justvoice.engines.audiocpp.slot import to_speech_request
from justvoice.engines.capability_details import lookup
from justvoice.engines.manager import discover_engines


def _row(engine: str, variant: str) -> dict:
    m = discover_engines()[engine]
    return next(r for r in m.module.VARIANTS if r["id"] == variant)


# ─── 5a: requests ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("seed", [None, 0, "0", ""])
def test_no_seed_or_zero_sends_a_new_random_one(seed):
    # audio.cpp's own "no seed" repeats on Kokoro, Kitten, Turbo and VoxCPM2 (§5 D1).
    seen = {to_speech_request(_row("kokoro", "kokoro-82m-q8"),
                              {"voice_id": "af_heart", "text": "Hi.", "seed": seed})["seed"]
            for _ in range(8)}
    assert len(seen) > 1 and all(1 <= s < 2**31 for s in seen)


def test_a_set_seed_is_sent_as_it_is():
    req = to_speech_request(_row("kokoro", "kokoro-82m-q8"),
                            {"voice_id": "af_heart", "text": "Hi.", "seed": 42})
    assert req["seed"] == 42


def test_qwen3_gets_auto_for_a_language_it_does_not_speak():
    for lang in ("xx", None):
        req = to_speech_request(_row("qwen3", "qwen3-cv-1.7b-q8"),
                                {"voice_id": "Ryan", "text": "Hi.", "language": lang})
        assert req["language"] == ("Auto" if lang else "English")


def test_qwen3_sampling_is_floored_and_the_sub_talker_reaches_the_runtime():
    req = to_speech_request(_row("qwen3", "qwen3-cv-1.7b-q8"), {
        "voice_id": "Ryan", "text": "Hi.", "language": "en",
        "delivery": {"temperature": 0, "engine": {
            "talker_top_p": 0, "subtalker_temperature": 0, "subtalker_top_k": 20,
            "subtalker_top_p": 0.8}}})
    o = req["options"]
    assert o["temperature"] == 0.05 and o["top_p"] == 0.05
    assert o["subtalker_temperature"] == 0.05 and o["subtalker_top_k"] == 20
    assert o["subtalker_top_p"] == 0.8


def test_chatterbox_min_p_and_decoder_cfg_reach_the_runtime():
    knobs = {k.key: k for k in lookup("chatterbox-multilingual").knobs}
    assert knobs["min_p"].default == 0.05 and knobs["s3gen_cfg_rate"].default == 0.7
    assert knobs["repetition_penalty"].default == 1.2              # what it uses (§5 D3)
    req = to_speech_request(_row("chatterbox", "chatterbox-multilingual-v2-q8"), {
        "voice_id": "c1", "text": "Hi.", "audio_prompt_path": "/v/ref.wav",
        "delivery": {"engine": {"min_p": 0.1, "s3gen_cfg_rate": 0.5}}})
    assert req["options"] == {"min_p": 0.1, "s3gen_cfg_rate": 0.5}


def test_voxcpm2_runaway_settings_reach_the_runtime():
    keys = {k.key for k in lookup("voxcpm2").knobs}
    assert {"retry_badcase_max_times", "retry_badcase_ratio_threshold"} <= keys
    req = to_speech_request(_row("voxcpm2", discover_engines()["voxcpm2"].default_variant_id), {
        "voice_id": "v", "text": "Hi.", "audio_prompt_path": "/v/ref.wav",
        "delivery": {"engine": {"retry_badcase_max_times": 0, "retry_badcase_ratio_threshold": 4}}})
    assert req["options"] == {"retry_badcase_max_times": 1, "retry_badcase_ratio_threshold": 4.0}


def test_every_sampling_knob_stops_short_of_zero():
    for row in ("qwen3-cv", "chatterbox-multilingual", "chatterbox-turbo"):
        for k in lookup(row).knobs:
            if "temperature" in k.key or k.key.endswith("top_p"):
                assert k.min >= 0.05, (row, k.key)


def test_a_transcription_gets_its_floor_or_three_times_its_length(tmp_path, monkeypatch):
    import wave

    monkeypatch.setattr(slot, "request_timeout", lambda: 900.0)
    short, long_ = tmp_path / "s.wav", tmp_path / "l.wav"
    for path, seconds in ((short, 2), (long_, 400)):
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(8000)
            w.writeframes(b"\0\0" * 8000 * seconds)
    assert slot._transcribe_timeout(str(short)) == 900.0
    assert slot._transcribe_timeout(str(long_)) == 1200.0
    assert slot._transcribe_timeout(str(tmp_path / "missing.wav")) == 900.0


# ─── 5b: gates ───────────────────────────────────────────────────────────────


def test_a_refusal_offers_an_update_only_when_the_pin_has_the_feature(monkeypatch):
    monkeypatch.setattr(release, "pinned_has", lambda f: True)
    assert "needs the speech runtime update" in slot.feature_refusal("voice_pack")
    monkeypatch.setattr(release, "pinned_has", lambda f: False)
    msg = slot.feature_refusal("voice_pack")
    assert msg.startswith("Blended voices — ") and "isn't in this version" in msg
    assert "Update" not in msg


# ─── 5c: runtime errors ──────────────────────────────────────────────────────


def test_a_bare_string_error_body_keeps_its_status():
    r = httpx.Response(503, json={"error": "server_busy"})
    with pytest.raises(AudioCppError) as ei:
        AudioCppServer._raise_for(r)
    assert ei.value.status == 503 and "server_busy" in str(ei.value)


def test_a_timeout_is_a_503_that_names_the_limit(monkeypatch):
    srv = AudioCppServer("gpu", "tts")
    monkeypatch.setattr(srv, "_url", lambda path: "http://127.0.0.1:1" + path)

    def boom(*a, **k):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "post", boom)
    with pytest.raises(AudioCppError) as ei:
        srv.speech({"model": "m"}, timeout=12)
    assert ei.value.status == 503 and "within 12 s" in str(ei.value)


def test_the_request_and_start_limits_are_settings():
    from justvoice.models import SpeechRuntimeSettings

    s = SpeechRuntimeSettings()
    assert (s.gpu_threads, s.start_timeout_s, s.request_timeout_s) == (4, 60.0, 900.0)
    assert runtime.gpu_threads() == 4 and runtime.request_timeout() == 900.0


# ─── 5d: placement ───────────────────────────────────────────────────────────


def test_cpu_speed_is_the_best_of_the_newest_five_at_these_threads(monkeypatch):
    from justvoice.engines.manager import EngineManager

    def row(x, threads="8"):
        return SimpleNamespace(modelId="tts:kokoro:kokoro-82m-q8", machineKey="box", source="speed",
                               backend="cpu", realtimeX=x,
                               switches=[SimpleNamespace(flagName="threads", flagValue=threads)])

    rows = [row(1.1), row(2.9), row(1.4), row(1.2), row(1.3), row(5.0), row(9.9, threads="4")]
    store = SimpleNamespace(list=lambda mid: [r for r in rows if r.modelId == mid])
    monkeypatch.setattr("llm_runner.llm.stores.get_model_measurement_store", lambda: store)
    monkeypatch.setattr("llm_runner.runner.hardware.current_machine_key", lambda: "box")
    monkeypatch.setattr(runtime, "cpu_threads", lambda: 8)
    # Newest first: the sixth reading (5.0) is past the five, the 4-thread one another setting.
    assert EngineManager().cpu_speed("tts", "kokoro", "kokoro-82m-q8") == (2.9, True)


def test_the_16bit_cpu_rows_have_speeds_of_their_own():
    assert _row("kokoro", "kokoro-82m-bf16")["cpu_realtime"] > 0
    # The measured ones; German and Italian at 16 bits were not measured, so Auto doesn't offer
    # them the CPU until a render there measures them.
    speeds = {r["id"]: r.get("cpu_realtime") for r in discover_engines()["pocket"].module.VARIANTS
              if r["id"].endswith("-bf16")}
    assert all(speeds[f"pocket-{c}-bf16"] for c in ("en", "es", "pt"))
    assert not speeds["pocket-de-bf16"] and not speeds["pocket-it-bf16"]


# ─── 5e: installs ────────────────────────────────────────────────────────────


def test_every_pinned_archive_carries_its_checksum():
    for b in release.binaries():
        assert b.sha256, b.asset_url
        if b.runtime_url:
            assert b.runtime_sha256, b.runtime_url
    assert all("cpu-portable" in b.asset_url for b in release.binaries() if b.gpu == "cpu")


def test_a_model_file_that_does_not_match_its_checksum_is_deleted(tmp_path):
    from justvoice.speech_cache import _verify_lfs_sha256

    f = tmp_path / "m.gguf"
    f.write_bytes(b"model")
    _verify_lfs_sha256(f, hashlib.sha256(b"model").hexdigest())          # matches: kept
    _verify_lfs_sha256(f, "a" * 40)                                      # a git blob id: not checked
    assert f.exists()
    with pytest.raises(RuntimeError, match="published checksum"):
        _verify_lfs_sha256(f, "0" * 64)
    assert not f.exists()


# ─── 5f: leaks ───────────────────────────────────────────────────────────────


def test_a_candidate_clip_is_reused_and_old_ones_are_cleared(tmp_path, monkeypatch):
    import tempfile

    from justvoice.api.voice_preview_api import _candidate_clip

    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    old = tmp_path / "justvoice-candidate-clips" / "old.wav"
    old.parent.mkdir()
    old.write_bytes(b"x")
    os.utime(old, (time.time() - 7200, time.time() - 7200))
    a = _candidate_clip(b"RIFF-one")
    assert a == _candidate_clip(b"RIFF-one") and a.read_bytes() == b"RIFF-one"
    assert not old.exists()


def test_voice_packs_are_touched_on_reuse_and_only_the_newest_kept(tmp_path, monkeypatch):
    import numpy as np

    monkeypatch.setattr(slot, "_data_dir", lambda: tmp_path)
    monkeypatch.setattr(slot, "_VOICE_PACKS_KEPT", 3)
    folder = tmp_path / "cache" / "kokoro-voice-packs"
    folder.mkdir(parents=True)
    for i in range(4):
        p = folder / f"old{i}.bin"
        p.write_bytes(b"x")
        os.utime(p, (time.time() - 1000 + i, time.time() - 1000 + i))
    first = slot.write_voice_pack(np.ones(256))
    assert first.exists() and sorted(p.name for p in folder.glob("*.bin")) == \
        sorted([first.name, "old3.bin", "old2.bin"])
    os.utime(first, (time.time() - 5000, time.time() - 5000))
    assert slot.write_voice_pack(np.ones(256)) == first and first.stat().st_mtime > time.time() - 60
    assert not list(folder.glob("*.tmp"))


def test_the_log_rolls_over_past_ten_megabytes(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "_LOG_ROTATE_BYTES", 10)
    log = tmp_path / "audiocpp-server.log"
    log.write_bytes(b"short")
    runtime._rotate_log(log)
    assert log.exists()
    log.write_bytes(b"a long enough log")
    runtime._rotate_log(log)
    assert not log.exists() and (tmp_path / "audiocpp-server.1.log").read_bytes() == b"a long enough log"


def test_the_log_tail_reads_only_the_end(tmp_path):
    log = tmp_path / "x.log"
    log.write_text("\n".join(f"line {i}" for i in range(50_000)), encoding="utf-8")
    srv = AudioCppServer("gpu", "tts")
    srv._run = SimpleNamespace(log_path=log)
    assert srv.log_tail(3).splitlines() == ["line 49997", "line 49998", "line 49999"]


def test_an_oversized_transcription_upload_leaves_no_file(tmp_path, monkeypatch):
    import tempfile

    from fastapi.testclient import TestClient

    from justvoice.api import captures_api
    from justvoice.app import create_app

    spool = tmp_path / "spool"
    spool.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(spool))
    monkeypatch.setattr(captures_api, "_MAX_UPLOAD_MB", 0)
    c = TestClient(create_app(data_dir=tmp_path / "data"), raise_server_exceptions=False)
    r = c.post("/v1/transcribe", files={"file": ("a.wav", b"RIFF" + b"\0" * 64, "audio/wav")})
    assert r.status_code == 400 and not list(spool.glob("*.wav"))


def test_system_info_reports_only_runtimes_this_app_can_use():
    from justvoice.system_info import _detect_runtimes

    assert _detect_runtimes({"cuda": True, "vulkan": True}) == {"cpu": True, "cuda": True, "vulkan": True}
    assert _detect_runtimes(None) == {"cpu": True}


# ─── 5g: counts that follow the pin ──────────────────────────────────────────


def test_kokoro_and_chatterbox_texts_count_what_is_offered():
    k = discover_engines()["kokoro"].module
    assert f"{len(k.STATIC_VOICES)} preset voices" in k.DESCRIPTION
    assert k.VARIANTS[0]["languages"] == list(dict.fromkeys(v["language"] for v in k.STATIC_VOICES))
    cb = discover_engines()["chatterbox"].module
    n = len(cb.VARIANTS[0]["languages"])
    assert lookup("chatterbox-multilingual").notes[0].startswith(f"{n} languages")


# ─── 5h: runtime options ─────────────────────────────────────────────────────


def test_flash_attention_is_offered_only_on_8bit_qwen3():
    for r in discover_engines()["qwen3"].module.VARIANTS:
        keys = [o["key"] for o in runtime_options.offered_for(r)]
        if r["id"].endswith("-q8"):        # Base 1.7B's file is "…-q8_0_v2.gguf" — still 8-bit
            assert keys == ["qwen3_tts.perf_mode", "qwen3_tts.conv_weight_type"], r["id"]
        else:
            assert keys == ["qwen3_tts.conv_weight_type"], r["id"]
    assert runtime_options.offered_for(_row("kokoro", "kokoro-82m-q8")) == []


def test_runtime_options_are_validated_and_defaults_dropped():
    row = _row("qwen3", "qwen3-cv-1.7b-q8")
    # 16-bit is the app's default (heard as no different, 2026-10-04): only 32-bit is saved.
    assert runtime_options.validate(row, {"qwen3_tts.perf_mode": "off",
                                          "qwen3_tts.conv_weight_type": "f32"}) == \
        {"qwen3_tts.conv_weight_type": "f32"}
    assert runtime_options.validate(row, {"qwen3_tts.conv_weight_type": "f16"}) == {}
    with pytest.raises(ValueError, match="must be one of"):
        runtime_options.validate(row, {"qwen3_tts.perf_mode": "turbo"})
    with pytest.raises(ValueError, match="no runtime option"):
        runtime_options.validate(row, {"qwen3_tts.mem_saver": "true"})


def test_saved_runtime_options_ride_the_models_registration(monkeypatch, tmp_path):
    row = _row("qwen3", "qwen3-cv-1.7b-q8")
    monkeypatch.setattr(runtime_options, "saved_for",
                        lambda e, v: {"qwen3_tts.perf_mode": "flash_attention", "stale.key": "x"})
    monkeypatch.setattr(slot, "_data_dir", lambda: tmp_path)
    entry = slot._entries_for(discover_engines()["qwen3"], row)[0]
    # 16-bit decoder weights ride by default — audio.cpp's own default is 32-bit.
    assert dict(entry.session_options) == {"qwen3_tts.perf_mode": "flash_attention",
                                           "qwen3_tts.conv_weight_type": "f16"}
    monkeypatch.setattr(runtime_options, "saved_for", lambda e, v: {"qwen3_tts.conv_weight_type": "f32"})
    assert dict(slot._entries_for(discover_engines()["qwen3"], row)[0].session_options) == {}


def test_the_model_row_reads_and_saves_its_runtime_options(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from justvoice.app import create_app

    c = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    url = "/v1/engines/qwen3/models/qwen3-cv-1.7b-q8/runtime-options"
    r = c.put(url, json={"options": {"qwen3_tts.perf_mode": "flash_attention"}})
    assert r.status_code == 200 and r.json()["reload"] is False
    v = next(v for v in c.get("/v1/engines/qwen3/models").json()["variants"]
             if v["id"] == "qwen3-cv-1.7b-q8")
    assert {o["key"]: o["value"] for o in v["runtime_options"]} == {
        "qwen3_tts.perf_mode": "flash_attention", "qwen3_tts.conv_weight_type": "f16"}
    ov = c.get("/v1/settings").json()["engines"]["engine_overrides"]["qwen3"]
    assert ov["runtime_options"] == {"qwen3-cv-1.7b-q8": {"qwen3_tts.perf_mode": "flash_attention"}}
    assert c.put(url, json={"options": {"qwen3_tts.perf_mode": "x"}}).status_code == 400
    c.put(url, json={"options": {"qwen3_tts.perf_mode": "off"}})
    ov = c.get("/v1/settings").json()["engines"]["engine_overrides"]["qwen3"]
    assert ov["runtime_options"] == {}


def test_the_runtime_row_keeps_a_setting_it_does_not_send(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from llm_runner.runner.schema import GpuInfo, HardwareInfo

    from justvoice.app import create_app

    monkeypatch.setattr(runtime, "_HW", HardwareInfo(
        os="Windows", platform="windows", cpu_cores=8, ram_mb=32768,
        gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=8192)], runtimes={"cuda": True}))
    monkeypatch.setattr(runtime, "installed_exe", lambda backend=None: None)
    c = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    assert c.put("/v1/speech-runtime", json={"backend": "auto", "request_timeout_s": 1800}).status_code == 200
    assert c.put("/v1/speech-runtime", json={"backend": "vulkan", "gpu": 0}).status_code == 200
    sr = c.get("/v1/settings").json()["engines"]["speech_runtime"]
    assert sr["backend"] == "vulkan" and sr["request_timeout_s"] == 1800
    assert c.put("/v1/speech-runtime", json={"backend": "vulkan", "gpu_threads": 0}).status_code == 400
