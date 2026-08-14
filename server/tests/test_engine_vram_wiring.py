# SPDX-License-Identifier: MIT
"""The 2026-08-13 VRAM wiring (vram-think §6 steps 3-4): device policy at the
one load door, booking/admission against the kit's shared arbiter, the
one-pool ruling, and the tts/stt busy flags.

Every test injects its own VramArbiter (fake hardware) via set_arbiter and
restores the singleton after — no test reads the box's real ledger."""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace

import pytest
from llm_runner.runner.arbiter import VramArbiter, set_arbiter
from llm_runner.runner.schema import GpuInfo, HardwareInfo

from justvoice.engines.manager import EngineManager


def _discrete(vram_mb=8192, ram_mb=32768):
    return HardwareInfo(
        os="Windows", platform="windows", cpu_cores=8, ram_mb=ram_mb,
        gpus=[GpuInfo(vendor="NVIDIA", name="fake", vram_mb=vram_mb)],
        runtimes={"cuda": True},
    )


def _one_pool(ram_mb=16384):
    return HardwareInfo(
        os="Windows", platform="windows", cpu_cores=8, ram_mb=ram_mb,
        gpus=[GpuInfo(vendor="Intel", name="Intel(R) Graphics", vram_mb=128)],
        runtimes={},
    )


@pytest.fixture
def arb_env():
    """(make_arbiter) — installs a fresh arbiter for the test, restores after."""
    installed = []

    def make(hw):
        arb = VramArbiter(hardware_fn=lambda: hw)
        set_arbiter(arb)
        installed.append(arb)
        return arb

    yield make
    set_arbiter(None)


class _Resp:
    status_code = 200
    text = ""

    def json(self):
        return {"ok": True, "voices": []}


class _Proc:
    def __init__(self, manifest):
        self.manifest = manifest
        self.terminated = False
        self.load_bodies = []

    def spawn(self):
        pass

    def is_alive(self):
        return not self.terminated

    def terminate(self):
        self.terminated = True

    def post(self, path, json=None, timeout=None):
        if path == "/load":
            self.load_bodies.append(json)
        return _Resp()

    def get(self, path):
        return _Resp()


def _manifest(engine_id="eng", kind="tts", vram_min_mb=4096, cpu_adequate=False):
    return SimpleNamespace(
        id=engine_id, kind=kind, isolation="shared", is_installed=True,
        default_variant_id="v1",
        requirements={"vram_min_mb": vram_min_mb, "cpu_adequate": cpu_adequate,
                      "gpu_runtimes": ["cuda", "cpu"]},
    )


def _mgr(monkeypatch, hw, manifest):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "EngineProcess", _Proc)
    monkeypatch.setattr(mgr_mod, "shared_venv_exists", lambda: True)
    mgr = mgr_mod.EngineManager()
    mgr._manifests = {manifest.id: manifest}
    mgr._hw_cache = hw
    mgr._hw_detected = True
    return mgr


# ─── device policy (Q2) ───────────────────────────────────────────────


def test_auto_resolves_cpu_for_cpu_adequate(monkeypatch, arb_env):
    mgr = _mgr(monkeypatch, _discrete(), _manifest(cpu_adequate=True))
    assert mgr._resolve_device(mgr._manifests["eng"], "auto") == "cpu"


def test_auto_resolves_cuda_on_a_cuda_box(monkeypatch, arb_env):
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    assert mgr._resolve_device(mgr._manifests["eng"], "auto") == "cuda"


def test_auto_resolves_cpu_without_cuda(monkeypatch, arb_env):
    mgr = _mgr(monkeypatch, _one_pool(), _manifest())
    assert mgr._resolve_device(mgr._manifests["eng"], "auto") == "cpu"


def test_explicit_request_wins(monkeypatch, arb_env):
    mgr = _mgr(monkeypatch, _one_pool(), _manifest(cpu_adequate=True))
    assert mgr._resolve_device(mgr._manifests["eng"], "cuda") == "cuda"


def test_user_device_setting_wins_over_auto(monkeypatch, arb_env):
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(EngineManager, "_user_device_override",
                        staticmethod(lambda engine_id: "cpu"))
    assert mgr._resolve_device(mgr._manifests["eng"], "auto") == "cpu"


def test_resolved_device_is_passed_down_explicitly(monkeypatch, arb_env):
    """Q2: the engine subprocess never sees "auto" again — the hidden
    torch/sherpa greedy-cuda is removed at the door."""
    arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    mgr.load("eng", device="auto")
    proc = mgr._loaded["tts"]
    assert proc.load_bodies[0]["device"] == "cuda"
    assert mgr.resolved_device_for("eng") == "cuda"


# ─── booking (Q1/Q5 + the one-pool ruling) ────────────────────────────


def test_cuda_load_books_declared_and_unload_releases(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest(vram_min_mb=4096))
    mgr.load("eng", device="auto")
    row = arb.reservation_of("tts:eng")
    assert row == {"vram_mb": 4096, "source": "declared", "kind": "tts",
                   "pinned": False}
    mgr.unload("tts")
    assert arb.reservation_of("tts:eng") is None


def test_cpu_load_books_nothing_on_discrete(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest(vram_min_mb=1024, cpu_adequate=True))
    mgr.load("eng", device="auto")
    assert arb.reservation_of("tts:eng") is None
    assert mgr.resolved_device_for("eng") == "cpu"


def test_one_pool_books_whichever_device_resolves(monkeypatch, arb_env):
    """THE ONE-POOL RULING: CPU and GPU are the same physical bytes on a
    one-pool box, so even a cpu-resolved load claims the pool."""
    arb = arb_env(_one_pool())
    mgr = _mgr(monkeypatch, _one_pool(), _manifest(vram_min_mb=4096, cpu_adequate=True))
    mgr.load("eng", device="auto")
    row = arb.reservation_of("tts:eng")
    assert row is not None and row["vram_mb"] == 4096
    assert mgr.resolved_device_for("eng") == "cpu"


def test_slot_replacement_releases_the_prior_booking(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    a, b = _manifest("eng-a"), _manifest("eng-b", vram_min_mb=2048)
    mgr = _mgr(monkeypatch, _discrete(), a)
    mgr._manifests["eng-b"] = b
    mgr.load("eng-a", device="auto")
    assert arb.reservation_of("tts:eng-a") is not None
    mgr.load("eng-b", device="auto")
    assert arb.reservation_of("tts:eng-a") is None
    assert arb.reservation_of("tts:eng-b")["vram_mb"] == 2048


# ─── admission (Q1: honest refusal, eviction through the seam) ────────


def test_admission_refuses_honestly_when_nothing_is_evictable(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("llm:pinned-chat", 7000, pinned=True, kind="llm")
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest(vram_min_mb=4096))
    with pytest.raises(RuntimeError, match="not enough memory"):
        mgr.load("eng", device="auto")
    # The world is exactly as it was: no slot occupant, no booking.
    assert mgr._loaded.get("tts") is None
    assert arb.reservation_of("tts:eng") is None


def test_admission_evicts_the_idle_llm(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    evicted = []
    arb.reserve("chat", 7000, kind="llm", evict_fn=lambda: evicted.append("chat"))
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest(vram_min_mb=4096))
    mgr.load("eng", device="auto")
    assert evicted == ["chat"]
    assert arb.reservation_of("chat") is None
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4096
    # Q3's event feed recorded the swap for the toast poller.
    events = arb.events_since(0)
    assert events and events[0]["victim_key"] == "chat"


def test_admission_never_evicts_a_busy_kind(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("chat", 7000, kind="llm", evict_fn=lambda: None)
    arb.busy_begin("llm")
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest(vram_min_mb=4096))
    with pytest.raises(RuntimeError, match="busy: llm"):
        mgr.load("eng", device="auto")
    assert arb.reservation_of("chat") is not None


def test_evictor_terminates_only_the_matching_occupant(monkeypatch, arb_env):
    arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    mgr.load("eng", device="auto")
    proc = mgr._loaded["tts"]
    mgr._evict_for_arbiter("tts", "someone-else")
    assert proc.terminated is False
    mgr._evict_for_arbiter("tts", "eng")
    assert proc.terminated is True
    assert mgr._loaded.get("tts") is None


# ─── busy flags (step 4) ──────────────────────────────────────────────


def test_scheduler_worker_marks_tts_busy_while_draining(arb_env):
    from justvoice.synth_scheduler import SynthScheduler

    arb = arb_env(_discrete())
    sched = SynthScheduler()
    seen: list[set] = []
    gate = threading.Event()

    def line():
        seen.append(arb.busy_kinds())
        gate.wait(5)
        return "ok"

    handle = sched.submit([("eng", line)])
    for _ in range(200):
        if seen:
            break
        time.sleep(0.01)
    assert seen and "tts" in seen[0]
    gate.set()
    assert handle.wait(5)
    for _ in range(200):
        if "tts" not in arb.busy_kinds():
            break
        time.sleep(0.01)
    assert "tts" not in arb.busy_kinds()


def test_vram_endpoint_serves_the_strip(tmp_path, arb_env):
    """GET /v1/engines/vram (Q3/Q4): snapshot + kind/source-tagged
    reservations + busy kinds + eviction events after `events_since`."""
    from starlette.testclient import TestClient

    from justvoice.app import create_app

    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("tts:eng", 4096, kind="tts", source="declared")
    arb.busy_begin("tts")
    arb.record_eviction("chat", "llm", "loading eng")
    app = create_app(data_dir=tmp_path)
    client = TestClient(app, raise_server_exceptions=False)
    body = client.get("/v1/engines/vram").json()
    assert body["mem_arch"] == "discrete"
    assert body["total_mb"] == 8192
    assert body["committed_mb"] == 4096
    assert body["remaining_mb"] == 8192 - 4096
    assert body["busy_kinds"] == ["tts"]
    row = next(r for r in body["reservations"] if r["key"] == "tts:eng")
    assert row["kind"] == "tts" and row["source"] == "declared"
    assert body["events"] and body["events"][0]["victim_key"] == "chat"
    # The poller's cursor: nothing newer than the last seen seq.
    seq = body["events"][-1]["seq"]
    again = client.get(f"/v1/engines/vram?events_since={seq}").json()
    assert again["events"] == []
    arb.busy_end("tts")
    # Q3's claim line: an unconfigured fresh DB says so honestly...
    assert body["claim"] is None
    assert body["claim_reason"] == "not-configured"
    # ...and once the routing default names a local catalog model, the claim
    # resolves through the kit's four-arm ladder (declared arm here — the
    # model isn't downloaded in a test run).
    from justvoice.database.seed import seed_workspace

    seed_workspace()
    routing = client.get("/v1/ai/routing").json()
    routing["default"]["llmId"] = "local-llamacpp"
    routing["default"]["model"] = "gemma-4-26b-a4b-qat"
    assert client.put("/v1/ai/routing", json=routing).status_code == 200
    routed = client.get("/v1/engines/vram").json()
    assert routed["claim"] is not None
    assert routed["claim"]["model"] == "gemma-4-26b-a4b-qat"
    assert routed["claim"]["vram_mb"] > 0
    assert routed["claim"]["source"] in ("declared", "computed", "measured")


def test_transcribe_marks_stt_busy(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    seen: list[set] = []

    class _SttResp:
        status_code = 200
        text = ""

        def json(self):
            return {"text": "hi"}

    class _SttProc:
        manifest = SimpleNamespace(id="whisper", kind="stt")

        def is_alive(self):
            return True

        def post(self, path, json=None, timeout=None):
            seen.append(arb.busy_kinds())
            return _SttResp()

    mgr = EngineManager.__new__(EngineManager)
    mgr._manifests = {}
    mgr._loaded = {"stt": _SttProc()}
    mgr._current_variants = {}
    mgr._lock = threading.RLock()
    mgr._cancel_load_requests = set()
    mgr._activity_locks = {}
    mgr._resolved_devices = {}
    mgr._hw_cache = None
    mgr._hw_detected = True
    assert mgr.transcribe({"wav_b64": ""}) == "hi"
    assert seen == [{"stt"}]
    assert "stt" not in arb.busy_kinds()
