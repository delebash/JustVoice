# SPDX-License-Identifier: MIT
"""CPU placement (decided 2026-10-02 — docs/plans/2026-10-02-cpu-placement.md §8).

Every speech model runs on the graphics card or the CPU. These pin:
  - the rule: a CPU build runs everything on the CPU; the user's choice wins; Auto takes
    the card when nothing else is on it or the model's MEASURED size fits beside the AI
    model, else the CPU when it is fast enough there, else the card with the AI model
    unloaded first — and a size never measured counts as not fitting (decision 1);
  - the load door puts the slot where the rule says, moves a loaded model whose place
    changed, and records the CPU speed of the first line after each load;
  - KittenTTS and Pocket TTS requests, Pocket's language refusal, and the Kyutai terms
    gate on a Pocket render from a reference clip (decision 2);
  - the two runtime processes and the API that shows and sets all of it.
"""

from __future__ import annotations

import io
import struct
import wave
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from llm_runner.runner.arbiter import VramArbiter, set_arbiter
from llm_runner.runner.schema import GpuInfo, HardwareInfo

from justvoice.engines import manager as mgr_mod
from justvoice.engines.audiocpp import runtime, slot
from justvoice.engines.manager import EngineManager, TermsRequired, _wav_seconds


def _discrete(vram_mb=8192):
    return HardwareInfo(os="Windows", platform="windows", cpu_cores=8, ram_mb=32768,
                        gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=vram_mb)],
                        runtimes={"cuda": True})


def _wav(seconds: float, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return buf.getvalue()


@pytest.fixture
def arb():
    hw = _discrete()
    a = VramArbiter(hardware_fn=lambda: hw)
    set_arbiter(a)
    yield a
    set_arbiter(None)


def _mgr(monkeypatch, build="cuda12"):
    exe = Path(f"C:/rt/audiocpp/v0.9.0/{build}/audiocpp_server.exe")
    monkeypatch.setattr(runtime, "installed_exe", lambda backend=None: exe)
    monkeypatch.setattr(slot, "installed_exe", lambda backend=None: exe)
    monkeypatch.setattr(EngineManager, "pool_used_mb", lambda self, *, fresh=False: None)
    mgr = mgr_mod.EngineManager()
    mgr._hw_cache = _discrete()
    mgr._hw_detected = True
    return mgr


def _ai_on_card(arb, mb=6800):
    arb.reserve("llm:gemma", mb, kind="llm", evict_fn=lambda: None, source="measured")


# ─── the rule ───────────────────────────────────────────────────────────────


def test_a_cpu_build_runs_everything_on_the_cpu(monkeypatch, arb):
    mgr = _mgr(monkeypatch, build="cpu")
    where, why, unload = mgr.placement_for(mgr.get_manifest("chatterbox"), "tts",
                                           "chatterbox-multilingual-v2-q8")
    assert (where, unload) == ("cpu", False) and "CPU build" in why


def test_auto_takes_the_card_when_nothing_else_is_on_it(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    assert mgr.placement_for(mgr.get_manifest("kokoro"), "tts", "kokoro-82m-q8")[0] == "gpu"


def test_auto_keeps_a_fast_model_off_the_card_beside_the_ai_model(monkeypatch, arb):
    """Kokoro was never measured on this card, and it is fast on the CPU: CPU (the
    2026-10-01 Check B case — on the card it pushed Gemma off an 8 GB card)."""
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    where, why, unload = mgr.placement_for(mgr.get_manifest("kokoro"), "tts", "kokoro-82m-q8")
    assert (where, unload) == ("cpu", False)
    assert "3.1× real time on the reference machine" in why and "AI model" in why


def test_a_measured_size_that_fits_stays_on_the_card(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb, mb=5000)
    monkeypatch.setattr(EngineManager, "_prior_gpu_mb", lambda self, k, e, v: 600)
    where, why, unload = mgr.placement_for(mgr.get_manifest("kokoro"), "tts", "kokoro-82m-q8")
    assert (where, unload) == ("gpu", False) and "fits beside the AI model (600 MB)" in why


def test_a_never_measured_slow_model_unloads_the_ai_model(monkeypatch, arb):
    """Decision 1: an unknown size does not fit while the AI model is on the card, and
    Chatterbox has no usable CPU speed — the card, with the AI model unloaded first."""
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    where, why, unload = mgr.placement_for(mgr.get_manifest("chatterbox"), "tts",
                                           "chatterbox-multilingual-v2-q8")
    assert (where, unload) == ("gpu", True) and "AI model makes room" in why


def test_a_measured_size_that_does_not_fit_goes_through_admission(monkeypatch, arb):
    """Known size, too big beside the AI model, slow on the CPU: the card — and the
    normal admission (make_room on the measured size) does the eviction, not a blanket
    unload."""
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    monkeypatch.setattr(EngineManager, "_prior_gpu_mb", lambda self, k, e, v: 3200)
    where, _why, unload = mgr.placement_for(mgr.get_manifest("chatterbox"), "tts",
                                            "chatterbox-multilingual-v2-q8")
    assert (where, unload) == ("gpu", False)


def test_a_sleeping_ai_model_is_not_on_the_card(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    arb.sync_sleeping({"llm:gemma"})
    assert mgr.placement_for(mgr.get_manifest("kokoro"), "tts", "kokoro-82m-q8")[0] == "gpu"


def test_the_users_choice_wins(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    monkeypatch.setattr(EngineManager, "_user_placement", staticmethod(lambda e, v: "cpu"))
    where, why, _ = mgr.placement_for(mgr.get_manifest("chatterbox"), "tts",
                                      "chatterbox-multilingual-v2-q8")
    assert where == "cpu" and why.startswith("your choice")
    monkeypatch.setattr(EngineManager, "_user_placement", staticmethod(lambda e, v: "gpu"))
    assert mgr.placement_for(mgr.get_manifest("kokoro"), "tts", "kokoro-82m-q8")[:2] == \
        ("gpu", "your choice")


def test_cpu_speed_reads_this_machine_before_the_reference(monkeypatch):
    mgr = _mgr(monkeypatch)
    rows = []
    store = SimpleNamespace(list=lambda mid: [r for r in rows if r.modelId == mid])
    monkeypatch.setattr("llm_runner.llm.stores.get_model_measurement_store", lambda: store)
    monkeypatch.setattr("llm_runner.runner.hardware.current_machine_key", lambda: "box")
    assert mgr.cpu_speed("tts", "kokoro", "kokoro-82m-q8") == (3.15, False)
    rows.append(SimpleNamespace(modelId="tts:kokoro:kokoro-82m-q8", machineKey="box",
                                source="speed", backend="cpu", realtimeX=2.4))
    assert mgr.cpu_speed("tts", "kokoro", "kokoro-82m-q8") == (2.4, True)
    # Another machine's number is not this one's.
    rows[0].machineKey = "other"
    assert mgr.cpu_speed("tts", "kokoro", "kokoro-82m-q8") == (3.15, False)
    assert mgr.cpu_speed("tts", "chatterbox", "chatterbox-multilingual-v2-q8") == (None, False)


# ─── the load door ──────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, status=200, content=b"", payload=None):
        self.status_code, self.content, self._payload = status, content, payload or {}
        self.headers = {"content-type": "audio/wav"}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class _Slot:
    made: list = []

    def __init__(self, manifest, placement="gpu"):
        self.manifest, self.placement = manifest, placement
        self.terminated = False
        self.speed_recorded = False
        self.synth_reply = _Resp(200, _wav(3.0))
        self.proc = None
        _Slot.made.append(self)

    def spawn(self):
        pass

    def is_alive(self):
        return not self.terminated

    def terminate(self):
        self.terminated = True

    def get(self, path):
        return _Resp(payload={"voices": []})

    def post(self, path, json=None, timeout=None):
        if path == "/synth":
            return self.synth_reply
        return _Resp(payload={"ok": True, "variant": (json or {}).get("variant")})


def _loadable(monkeypatch, where, unload=False):
    _Slot.made = []
    monkeypatch.setattr(mgr_mod, "_new_slot", _Slot)
    monkeypatch.setattr(EngineManager, "placement_for",
                        lambda self, m, kind, v: (where, f"why {where}", unload))
    calls = []
    monkeypatch.setattr(EngineManager, "_unload_ai_model", lambda self, eid: calls.append(eid))
    return calls


def test_the_load_puts_the_slot_where_the_rule_says(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _loadable(monkeypatch, "cpu")
    mgr.load("kokoro")
    assert _Slot.made[-1].placement == "cpu"
    assert mgr.resolved_device_for("kokoro") == "cpu"
    assert mgr.placement_reason_for("kokoro") == "why cpu"
    # A CPU-placed model books nothing on a discrete card.
    assert arb.reserved_mb("tts:kokoro") is None


def test_the_third_step_unloads_the_ai_model_before_the_load(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    calls = _loadable(monkeypatch, "gpu", unload=True)
    mgr.load("chatterbox")
    assert calls == ["chatterbox"] and _Slot.made[-1].placement == "gpu"


def test_the_unload_goes_through_make_room_and_spares_speech(monkeypatch, arb):
    """The blanket unload is the kit's make_room — so the eviction event (and the app's
    toast) names who made room for whom — and a speech model is never its victim."""
    mgr = _mgr(monkeypatch)
    _ai_on_card(arb)
    gone = []
    arb.reserve("stt:asr", 2400, kind="stt", evict_fn=lambda: gone.append("asr"), source="measured")
    arb.reserve("llm:qwen", 3000, kind="llm", evict_fn=lambda: gone.append("qwen"), source="measured")
    mgr._unload_ai_model("chatterbox")
    assert set(gone) == {"qwen"} and arb.reserved_mb("llm:gemma") is None
    assert arb.reserved_mb("stt:asr") == 2400
    assert any(e["reason"] == "loading chatterbox" for e in arb.events_since(0))


def test_a_loaded_model_moves_when_its_place_changes(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _loadable(monkeypatch, "gpu")
    mgr.load("kokoro")
    first = _Slot.made[-1]
    _loadable(monkeypatch, "cpu")
    mgr.load("kokoro")
    assert first.terminated and _Slot.made[-1].placement == "cpu"
    # Same place again: nothing moves.
    mgr.load("kokoro")
    assert len(_Slot.made) == 1


def test_the_first_cpu_line_after_a_load_records_its_speed_once(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _loadable(monkeypatch, "cpu")
    recorded = []
    store = SimpleNamespace(record=lambda mid, **kw: recorded.append((mid, kw)), list=lambda mid: [])
    monkeypatch.setattr("llm_runner.llm.stores.get_model_measurement_store", lambda: store)
    monkeypatch.setattr("llm_runner.runner.hardware.current_machine_key", lambda: "box")
    mgr.load("kokoro")
    mgr.synth("kokoro", {"text": "A line."})
    mgr.synth("kokoro", {"text": "Another."})
    assert len(recorded) == 1
    mid, kw = recorded[0]
    assert mid == "tts:kokoro:kokoro-82m-q8" and kw["backend"] == "cpu" and kw["source"] == "speed"
    assert kw["realtime_x"] > 0 and kw["machine_key"] == "box"


def test_a_gpu_line_records_no_cpu_speed(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _loadable(monkeypatch, "gpu")
    recorded = []
    store = SimpleNamespace(record=lambda mid, **kw: recorded.append(mid), list=lambda mid: [])
    monkeypatch.setattr("llm_runner.llm.stores.get_model_measurement_store", lambda: store)
    mgr.load("kokoro")
    mgr.synth("kokoro", {"text": "A line."})
    assert recorded == []


def test_a_terms_refusal_reaches_the_caller_as_terms_required(monkeypatch, arb):
    mgr = _mgr(monkeypatch)
    _loadable(monkeypatch, "cpu")
    mgr.load("pocket")
    _Slot.made[-1].synth_reply = _Resp(403, payload={"detail": "accept Kyutai's terms",
                                                     "code": "terms_required", "engine": "pocket"})
    with pytest.raises(TermsRequired) as ei:
        mgr.synth("pocket", {"text": "Hi.", "audio_prompt_path": "/v/ref.wav"})
    err = ei.value.api_error()
    assert err.status_code == 403 and err.slug == "terms-required" and err.extra == {"engine": "pocket"}


def test_wav_seconds_reads_any_sample_format():
    assert _wav_seconds(_wav(2.0)) == pytest.approx(2.0)
    # A 32-bit float WAV (format 3) — the duration still reads.
    data = b"\x00" * (16000 * 4)
    fmt = struct.pack("<HHIIHH", 3, 1, 16000, 16000 * 4, 4, 32)
    raw = (b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(data)) + b"WAVE"
           + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data)
    assert _wav_seconds(raw) == pytest.approx(1.0)
    assert _wav_seconds(b"not a wav") is None


# ─── KittenTTS and Pocket TTS requests ──────────────────────────────────────


def _row(engine, variant):
    return next(r for r in mgr_mod.discover_engines()[engine].module.VARIANTS if r["id"] == variant)


def test_kitten_takes_its_own_voice_name_and_speed():
    req = slot.to_speech_request(_row("kitten", "kitten-mini-0.8"),
                                 {"text": "Hi.", "voice_id": "kitten_bella", "delivery": {"speed": 1.2}})
    assert req["voice"] == "Bella" and req["speed"] == 1.2 and req["model"] == "kitten-mini-0.8"


def test_pocket_speaks_a_preset_or_clones_from_the_clip():
    row = _row("pocket", "pocket-en-q8")
    assert slot.to_speech_request(row, {"text": "Hi.", "voice_id": "pocket_bill_boerst"})["voice"] == "bill_boerst"
    req = slot.to_speech_request(row, {"text": "Hi.", "audio_prompt_path": "C:\\v\\ref.wav", "seed": 3})
    assert req["voice_ref"] == "C:/v/ref.wav" and "voice" not in req and req["seed"] == 3


def test_pocket_refuses_a_line_in_another_language_by_name():
    row = _row("pocket", "pocket-en-q8")
    with pytest.raises(slot.AudioCppError, match="speaks English.*German.*load the German Pocket TTS model"):
        slot.to_speech_request(row, {"text": "Hallo.", "voice_id": "pocket_alba", "language": "de-DE"})
    # Its own language, any region, is fine.
    assert slot.to_speech_request(row, {"text": "Hi.", "voice_id": "pocket_alba", "language": "en-GB"})


def test_pocket_offers_only_the_presets_licensed_for_commercial_use():
    voices = {v["id"] for v in mgr_mod.discover_engines()["pocket"].static_voices}
    assert len(voices) == 20
    assert not voices & {"pocket_cosette", "pocket_jean", "pocket_giovanni", "pocket_lola",
                         "pocket_juergen", "pocket_rafael"}
    for row in mgr_mod.discover_engines()["pocket"].module.VARIANTS:
        files = row["sources"][0]["files"]
        assert len(files) == 21 and files[0].endswith(".gguf")


def test_every_new_voice_id_is_unique_across_engines():
    seen: dict[str, str] = {}
    for eid, m in mgr_mod.discover_engines().items():
        for v in m.static_voices:
            assert v["id"] not in seen, f"{v['id']} is both {seen.get(v['id'])} and {eid}"
            seen[v["id"]] = eid


class _FakeServer:
    def __init__(self):
        self.calls = []

    def speech(self, req):
        self.calls.append(req)
        return _wav(1.0), {}


def _pocket_slot(monkeypatch, accepted: bool):
    srv = _FakeServer()
    monkeypatch.setattr(slot, "get_server", lambda placement="gpu": srv)
    monkeypatch.setattr(slot, "terms_accepted", lambda eid: accepted)
    monkeypatch.setattr(slot.AudioCppSlot, "is_alive", lambda self: True)
    s = slot.AudioCppSlot.__new__(slot.AudioCppSlot)
    s.manifest = mgr_mod.discover_engines()["pocket"]
    s.placement = "cpu"
    s._row = _row("pocket", "pocket-en-q8")
    return s, srv


def test_a_pocket_clone_waits_for_kyutais_terms(monkeypatch):
    s, srv = _pocket_slot(monkeypatch, accepted=False)
    r = s._synth({"text": "Hi.", "audio_prompt_path": "/v/ref.wav"})
    assert r.status_code == 403 and r.json()["code"] == "terms_required" and srv.calls == []
    assert "Kyutai" in r.json()["detail"]
    # A preset needs no terms.
    assert s._synth({"text": "Hi.", "voice_id": "pocket_alba"}).status_code == 200


def test_an_accepted_pocket_clone_renders(monkeypatch):
    s, srv = _pocket_slot(monkeypatch, accepted=True)
    assert s._synth({"text": "Hi.", "audio_prompt_path": "/v/ref.wav"}).status_code == 200
    assert srv.calls[0]["voice_ref"] == "/v/ref.wav"


# ─── the two processes ──────────────────────────────────────────────────────


def test_each_placement_has_its_own_process_files():
    gpu, cpu = runtime.get_server("gpu"), runtime.get_server("cpu")
    assert gpu is not cpu and runtime.get_server("cpu") is cpu
    assert gpu._file_stem() == "audiocpp-server" and cpu._file_stem() == "audiocpp-server-cpu"
    with pytest.raises(ValueError):
        runtime.get_server("npu")


def test_cpu_threads_default_to_the_physical_cores(monkeypatch):
    from justvoice.models import SpeechRuntimeSettings

    monkeypatch.setattr(runtime, "physical_cores", lambda: 8)
    monkeypatch.setattr(runtime, "_settings", lambda: SpeechRuntimeSettings())
    assert runtime.cpu_threads() == 8
    monkeypatch.setattr(runtime, "_settings", lambda: SpeechRuntimeSettings(cpu_threads=6))
    assert runtime.cpu_threads() == 6


def test_the_cpu_process_runs_the_same_build_on_the_cpu(monkeypatch, tmp_path):
    """ensure_server("cpu") hands the installed build `backend: cpu` and the thread setting."""
    seen = {}

    class _Srv:
        def ensure(self, exe, models, **kw):
            seen.update(kw, exe=exe)

    exe = Path("C:/rt/audiocpp/v0.9.0/cuda12/audiocpp_server.exe")
    monkeypatch.setattr(slot, "installed_exe", lambda backend=None: exe)
    monkeypatch.setattr(slot, "get_server", lambda placement="gpu": _Srv())
    monkeypatch.setattr(slot, "installed_entries", lambda: [])
    monkeypatch.setattr(slot, "_data_dir", lambda: tmp_path)
    monkeypatch.setattr(slot, "cpu_threads", lambda: 8)
    slot.ensure_server("cpu")
    assert seen["backend"] == "cpu" and seen["threads"] == 8 and seen["exe"] == exe


# ─── the API ────────────────────────────────────────────────────────────────


@pytest.fixture
def client(tmp_path, monkeypatch):
    from justvoice.app import create_app

    monkeypatch.setattr(EngineManager, "_ai_model_on_card", lambda self: False)
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def test_the_models_say_where_they_run(client):
    rows = {v["id"]: v for v in client.get("/v1/engines/kokoro/models").json()["variants"]}
    k = rows["kokoro-82m-q8"]
    assert k["placement"] == "auto" and k["runs_on"] in ("gpu", "cpu") and k["runs_on_reason"]
    assert k["cpu_realtime"] == 3.15 and k["cpu_realtime_here"] is False


def test_a_models_place_is_saved_and_auto_clears_it(client):
    r = client.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement", json={"placement": "cpu"})
    assert r.status_code == 200 and r.json()["runs_on"] == "cpu" and r.json()["moves"] is False
    ov = client.get("/v1/settings").json()["engines"]["engine_overrides"]["kokoro"]
    assert ov["placements"] == {"kokoro-82m-q8": "cpu"}
    client.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement", json={"placement": "auto"})
    ov = client.get("/v1/settings").json()["engines"]["engine_overrides"]["kokoro"]
    assert ov["placements"] == {}
    assert client.put("/v1/engines/kokoro/models/nope/placement", json={"placement": "cpu"}).status_code == 404
    assert client.put("/v1/engines/kokoro/models/kokoro-82m-q8/placement",
                      json={"placement": "npu"}).status_code == 422


def test_pocket_shows_its_terms_until_accepted(client):
    eng = next(e for e in client.get("/v1/engines").json()["engines"] if e["id"] == "pocket")
    assert eng["terms"]["owner"] == "Kyutai" and eng["terms"]["gates"] == "cloning"
    assert "voice impersonation or cloning without explicit and lawful consent" in eng["terms"]["text"]
    assert eng["terms_accepted"] is False
    r = client.post("/v1/engines/pocket/terms")
    assert r.status_code == 200 and r.json()["accepted"] is True and r.json()["at"]
    eng = next(e for e in client.get("/v1/engines").json()["engines"] if e["id"] == "pocket")
    assert eng["terms_accepted"] is True
    # An engine without terms has nothing to accept.
    assert client.post("/v1/engines/kokoro/terms").status_code == 400
    assert next(e for e in client.get("/v1/engines").json()["engines"] if e["id"] == "kokoro")["terms"] is None
