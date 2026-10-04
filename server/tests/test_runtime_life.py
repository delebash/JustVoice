# SPDX-License-Identifier: MIT
"""The speech runtime's life (audit 2026-10-04 §13.2, docs/plans/2026-10-04-audiocpp-switch-audit.md):
models registered at run time so nothing downloaded restarts a process, one process per kind,
a dead slot dropped with its booking, Cancel freeing its booking, and the engine endpoints off
the event loop. No binary, no GPU — the live check is in the audit's §13.2."""

from __future__ import annotations

import base64
import inspect
import io
import json
import wave
from types import SimpleNamespace

import pytest

from justvoice.engines.audiocpp import runtime
from justvoice.engines.audiocpp import slot as slot_mod
from justvoice.engines.audiocpp.runtime import ModelEntry
from justvoice.engines.manager import EngineManager, discover_engines


class _FakeProc:
    pid = 777
    returncode = None

    def poll(self):
        return None

    def terminate(self):
        pass

    def kill(self):
        pass

    def wait(self, timeout=None):
        return 0


@pytest.fixture
def spawns(monkeypatch):
    """`AudioCppServer.ensure` with the spawn faked: each start is recorded, nothing runs."""
    import llm_runner.runner.process as process

    started = []

    def _spawn(popen, argv, out):
        out.close()
        started.append(argv)
        return _FakeProc(), None

    monkeypatch.setattr(process, "spawn_child", _spawn)
    monkeypatch.setattr(runtime.AudioCppServer, "_wait_healthy", lambda self, timeout=60.0: None)
    monkeypatch.setattr(runtime, "_child_env", lambda: {})
    return started


def _config(tmp_path, stem="audiocpp-server"):
    return json.loads((tmp_path / "engines-runtime-config" / f"{stem}.json").read_text(encoding="utf-8"))


def test_a_managed_process_starts_with_no_models_and_a_download_never_restarts_it(spawns, tmp_path):
    srv = runtime.AudioCppServer("gpu", "tts")
    exe = tmp_path / "audiocpp_server.exe"
    kokoro = ModelEntry("kokoro-82m-q8", "kokoro_tts", "tts", "C:/m/k.gguf")
    kitten = ModelEntry("kitten-mini-0.8", "kitten_tts", "tts", "C:/m/t.gguf")
    srv.ensure(exe, [kokoro], data_dir=tmp_path, managed=True)
    cfg = _config(tmp_path)
    assert cfg["model_management"] is True and cfg["models"] == []
    assert "ui_management" not in cfg          # never the WebUI's installer / delete / browse
    srv.ensure(exe, [kokoro, kitten], data_dir=tmp_path, managed=True)   # a model downloaded
    assert len(spawns) == 1 and srv.managed


def test_an_older_build_lists_its_models_and_a_new_one_restarts_it(spawns, tmp_path):
    srv = runtime.AudioCppServer("gpu", "stt")
    exe = tmp_path / "audiocpp_server.exe"
    asr = ModelEntry("qwen3-asr-1.7b-q8", "qwen3_asr", "asr", "C:/m/a.gguf")
    srv.ensure(exe, [asr], data_dir=tmp_path)
    cfg = _config(tmp_path, "audiocpp-server-stt")
    assert [m["id"] for m in cfg["models"]] == ["qwen3-asr-1.7b-q8"] and "model_management" not in cfg
    assert srv.has_model("qwen3-asr-1.7b-q8") and not srv.managed
    srv.ensure(exe, [asr, ModelEntry("x", "qwen3_asr", "asr", "C:/m/x.gguf")], data_dir=tmp_path)
    assert len(spawns) == 2


class _ManagedServer:
    """What the slot needs from a managed process."""

    managed = True
    pid = 5

    def __init__(self):
        self._run = SimpleNamespace(proc=SimpleNamespace(pid=5), port=1)
        self.registered: dict[str, ModelEntry] = {}
        self.calls: list[tuple] = []

    def is_running(self):
        return True

    def has_model(self, model_id):
        return model_id in self.registered

    def register(self, entry):
        self.calls.append(("register", entry.id))
        self.registered[entry.id] = entry

    def transcribe(self, body):
        return {"text": ""}

    def align(self, model, wav, text, language):
        self.calls.append(("align", model))
        return {"words": [{"word": "hi", "start": 0.0, "end": 0.2}]}

    def unload(self, ids):
        self.calls.append(("unload", tuple(ids)))


def _wav_b64(seconds=0.5, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return base64.b64encode(buf.getvalue()).decode()


def test_a_load_registers_its_model_and_the_aligner_registers_on_first_use(monkeypatch, tmp_path):
    import justvoice.speech_cache as speech_cache

    srv = _ManagedServer()
    monkeypatch.setattr(slot_mod, "ensure_server", lambda placement="gpu", kind="tts": srv)
    monkeypatch.setattr(slot_mod, "get_server", lambda placement="gpu", kind="tts": srv)
    monkeypatch.setattr(slot_mod, "effective_placement", lambda placement: placement)
    monkeypatch.setattr(slot_mod, "_data_dir", lambda: tmp_path)
    monkeypatch.setattr(speech_cache, "variant_on_disk", lambda *a: True)
    asr = discover_engines()["asr"]
    s = slot_mod.AudioCppSlot(asr, "gpu")
    assert s.kind == "stt"
    assert s.post("/load", {"variant": None}).status_code == 200
    model_id = asr.default_variant_id
    assert srv.calls[0] == ("register", model_id) and s.is_alive()
    assert f"{model_id}::aligner" not in srv.registered          # lazily, as before
    r = s.post("/align", {"wav_b64": _wav_b64(), "text": "hi", "language": "en"})
    assert r.status_code == 200 and r.json()["words"][0]["word"] == "hi"
    assert ("register", f"{model_id}::aligner") in srv.calls
    s.terminate()
    assert srv.calls[-1] == ("unload", (model_id, f"{model_id}::aligner"))


def test_a_load_refuses_a_model_that_is_not_downloaded(monkeypatch, tmp_path):
    import justvoice.speech_cache as speech_cache

    srv = _ManagedServer()
    monkeypatch.setattr(slot_mod, "ensure_server", lambda placement="gpu", kind="tts": srv)
    monkeypatch.setattr(slot_mod, "effective_placement", lambda placement: placement)
    monkeypatch.setattr(slot_mod, "_data_dir", lambda: tmp_path)
    monkeypatch.setattr(speech_cache, "variant_on_disk", lambda *a: False)
    r = slot_mod.AudioCppSlot(discover_engines()["kokoro"], "gpu").post("/load", {"variant": None})
    assert r.status_code == 400 and "not downloaded" in r.text and srv.calls == []


@pytest.fixture
def arbiter():
    from llm_runner.runner.arbiter import VramArbiter, set_arbiter
    from llm_runner.runner.schema import GpuInfo, HardwareInfo

    hw = HardwareInfo(os="Windows", platform="windows", cpu_cores=8, ram_mb=32768,
                      gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=8192)], runtimes={"cuda": True})
    arb = VramArbiter(hardware_fn=lambda: hw)
    set_arbiter(arb)
    yield arb
    set_arbiter(None)


class _Slot:
    def __init__(self, engine_id, *, alive=True, dead=False):
        self.manifest = SimpleNamespace(id=engine_id)
        self._alive, self._dead = alive, dead
        self.terminated = False

    def is_alive(self):
        return self._alive

    def is_dead(self):
        return self._dead

    def terminate(self):
        self.terminated = True


def test_a_slot_whose_process_died_is_dropped_with_its_booking(arbiter):
    # §13.1, live: the GPU process restarted under the recogniser and its 2,861 MB booking
    # stayed, so its own reload was refused against it.
    mgr = EngineManager()
    arbiter.reserve("stt:asr", 2861, kind="stt", evict_fn=lambda: None, source="measured")
    mgr._loaded = {"stt": _Slot("asr", alive=False, dead=True)}
    mgr._current_variants["asr"] = "qwen3-asr-1.7b-q8"
    assert mgr.loaded_for("stt") is None
    assert "stt" not in mgr._loaded and "asr" not in mgr._current_variants
    assert not arbiter.reserved_mb("stt:asr")


def test_the_memory_strip_never_shows_a_dead_models_booking(arbiter, monkeypatch):
    # Live 2026-10-04: after the speech process was killed, the first poll still listed
    # `tts:qwen3 1913 MB` — the handler read the bookings before it looked at the slots.
    from justvoice.api import engines_api

    mgr = EngineManager()
    arbiter.reserve("tts:qwen3", 1913, kind="tts", evict_fn=lambda: None, source="measured")
    mgr._loaded = {"tts": _Slot("qwen3", alive=False, dead=True)}
    monkeypatch.setattr(engines_api, "get_manager", lambda: mgr)
    monkeypatch.setattr(mgr, "_hardware", lambda: None)
    monkeypatch.setattr(mgr, "pool_used_mb", lambda fresh=False: 500)
    out = engines_api.get_engine_vram()
    assert not [r for r in out.reservations if r.key == "tts:qwen3"] and not out.loaded


def test_a_slot_still_loading_is_left_alone(arbiter):
    mgr = EngineManager()
    arbiter.reserve("tts:kokoro", 600, kind="tts", evict_fn=lambda: None, source="measured")
    loading = _Slot("kokoro", alive=False, dead=False)
    mgr._loaded = {"tts": loading}
    assert mgr.loaded_for("tts") is None
    assert mgr._loaded["tts"] is loading and arbiter.reserved_mb("tts:kokoro") == 600


def test_cancel_frees_the_booking_with_the_slot(arbiter):
    mgr = EngineManager()
    arbiter.reserve("tts:kokoro", 600, kind="tts", evict_fn=lambda: None, source="measured")
    s = _Slot("kokoro")
    mgr._loaded = {"tts": s}
    assert mgr.request_cancel_load("kokoro") is True
    assert s.terminated and "tts" not in mgr._loaded and not arbiter.reserved_mb("tts:kokoro")


def test_engine_handlers_run_off_the_event_loop():
    # A plain `def` runs on FastAPI's thread pool; an `async def` that never awaits ran the
    # whole load — download, start, warm-up — on the event loop, so Cancel and the progress
    # polls waited behind it (audit §5 C3).
    from justvoice.api import engines_api, engines_models_api, models_api

    handlers = [engines_models_api.install_engine, engines_models_api.load_engine,
                engines_models_api.cancel_engine_load, engines_models_api.unload_engine,
                engines_models_api.uninstall_engine_endpoint, engines_api.accept_engine_terms,
                engines_api.list_engines, engines_api.list_engine_capabilities,
                engines_api.get_engine_vram, engines_api.get_current_engine,
                models_api.clear_speech_cache, models_api.delete_model]
    assert not [h.__name__ for h in handlers if inspect.iscoroutinefunction(h)]
