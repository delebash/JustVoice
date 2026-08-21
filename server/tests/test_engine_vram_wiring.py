# SPDX-License-Identifier: MIT
"""The VRAM wiring under the AMENDED measured currency
(docs/plans/2026-08-13-speech-catalog-redesign.md §10): device policy at the
one load door; NO pre-load estimate — a prior MEASURED footprint admits and
books EARLY, a first-ever load gets no arithmetic (attempt → measure → book →
persist, "not measured yet" until a probe lands); the per-PID-tree true-up;
the device-delta fallback (computed, never persisted); the raise-only
high-water bump with occupant re-check; the one-pool ruling; the tts/stt
busy flags.

Every test injects its own VramArbiter (fake hardware) via set_arbiter and
restores the singleton after — no test reads the box's real ledger. The pool
probe is stubbed to None by default (offline deterministic); measured-
admission and delta tests install their own probe sequences."""

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


def _manifest(engine_id="eng", kind="tts", cpu_adequate=False):
    """A duck-typed manifest. Deliberately carries NO memory number of any
    kind — the amended currency has no field to carry one."""
    return SimpleNamespace(
        id=engine_id, kind=kind, isolation="venv", is_installed=True,
        default_variant_id="v1",
        requirements={"cpu_adequate": cpu_adequate,
                      "gpu_runtimes": ["cuda", "cpu"]},
    )


def _mgr(monkeypatch, hw, manifest):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "EngineProcess", _Proc)
    # Offline-deterministic by default: no measured pool, no prior measurement
    # rows, no persistence.
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: None)
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 0)
    monkeypatch.setattr(EngineManager, "_record_speech_load",
                        lambda self, m, kind, variant, mb, device: None)
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


# ─── the amended pricing chain (§10): no estimate, measured-only ──────


def test_first_load_books_nothing_when_nothing_measurable(monkeypatch, arb_env):
    """The §10 pin: a first-ever load carries NO invented number — no
    admission, no booking, nothing evicted on its behalf. The strip says
    "not measured yet"."""
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    mgr.load("eng", device="auto")   # probe miss (fake proc), pool unmeasurable
    assert arb.reservation_of("tts:eng") is None
    assert mgr._loaded["tts"].is_alive()
    mgr.unload("tts")
    assert arb.reservation_of("tts:eng") is None


def test_load_true_up_books_the_measured_number(monkeypatch, arb_env):
    """The core of the redesign: the per-PID-tree probe books the real
    footprint the moment the load confirms — source='measured', persisted
    as the evidence the next load's admission reads."""
    arb = arb_env(_discrete())
    recorded = []
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=True: 1234)
    monkeypatch.setattr(
        EngineManager, "_record_speech_load",
        lambda self, m, kind, variant, mb, device: recorded.append((m.id, kind, mb)),
    )
    mgr.load("eng", device="auto")
    row = arb.reservation_of("tts:eng")
    assert row == {"vram_mb": 1234, "source": "measured", "kind": "tts",
                   "pinned": False, "asleep": False}
    assert recorded == [("eng", "tts", 1234)]


def test_prior_measured_admits_and_books_early(monkeypatch, arb_env):
    """A prior measured footprint books BEFORE the child confirms — the
    ledger covers the admission→true-up window (the gap neither adversarial
    pass caught). A post-load probe miss keeps the prior booking; it never
    degrades to a polluted delta."""
    arb = arb_env(_discrete())
    seen_at_post = []

    class _EarlyProc(_Proc):
        def post(self, path, json=None, timeout=None):
            if path == "/load":
                seen_at_post.append(arb.reservation_of("tts:eng"))
            return super().post(path, json=json, timeout=timeout)

    from justvoice.engines import manager as mgr_mod

    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(mgr_mod, "EngineProcess", _EarlyProc)
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 1500)
    mgr.load("eng", device="auto")
    assert seen_at_post and seen_at_post[0] is not None
    assert seen_at_post[0]["vram_mb"] == 1500
    assert seen_at_post[0]["source"] == "measured"
    assert arb.reservation_of("tts:eng")["vram_mb"] == 1500


def test_failed_load_releases_the_early_booking(monkeypatch, arb_env):
    """The F1 lesson under early booking: a reservation nobody releases is a
    lying ledger — a failed child load must strike the early booking."""
    arb = arb_env(_discrete())

    class _R500:
        status_code = 500
        text = "boom"

        def json(self):
            return {}

    class _FailProc(_Proc):
        def post(self, path, json=None, timeout=None):
            if path == "/load":
                return _R500()
            return super().post(path, json=json, timeout=timeout)

    from justvoice.engines import manager as mgr_mod

    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(mgr_mod, "EngineProcess", _FailProc)
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 1500)
    with pytest.raises(RuntimeError, match="engine load failed"):
        mgr.load("eng", device="auto")
    assert arb.reservation_of("tts:eng") is None


def test_first_load_delta_fallback_books_computed_never_persists(monkeypatch, arb_env):
    """No per-process arm on this box (AMD Linux): the device-wide delta
    across the load books as "computed" — and is NEVER persisted as
    measurement evidence, because a concurrent load could pollute it."""
    arb = arb_env(_discrete())
    recorded = []
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    seq = [3000, 4400]   # the before snapshot at the door; after at the true-up
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: seq.pop(0) if seq else 4400)
    monkeypatch.setattr(
        EngineManager, "_record_speech_load",
        lambda self, m, kind, variant, mb, device: recorded.append(mb),
    )
    mgr.load("eng", device="auto")
    row = arb.reservation_of("tts:eng")
    assert row == {"vram_mb": 1400, "source": "computed", "kind": "tts",
                   "pinned": False, "asleep": False}
    assert recorded == []


def test_cpu_load_books_nothing_on_discrete(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest(cpu_adequate=True))
    mgr.load("eng", device="auto")
    assert arb.reservation_of("tts:eng") is None
    assert mgr.resolved_device_for("eng") == "cpu"


def test_one_pool_books_whichever_device_resolves(monkeypatch, arb_env):
    """THE ONE-POOL RULING: CPU and GPU are the same physical bytes on a
    one-pool box, so even a cpu-resolved load claims the pool — at its
    MEASURED resident set."""
    arb = arb_env(_one_pool())
    mgr = _mgr(monkeypatch, _one_pool(), _manifest(cpu_adequate=True))
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=True: 800)
    mgr.load("eng", device="auto")
    row = arb.reservation_of("tts:eng")
    assert row is not None and row["vram_mb"] == 800
    assert row["source"] == "measured"
    assert mgr.resolved_device_for("eng") == "cpu"


def test_slot_replacement_releases_the_prior_booking(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    a, b = _manifest("eng-a"), _manifest("eng-b")
    mgr = _mgr(monkeypatch, _discrete(), a)
    mgr._manifests["eng-b"] = b
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=True: 1200)
    mgr.load("eng-a", device="auto")
    assert arb.reservation_of("tts:eng-a")["vram_mb"] == 1200
    mgr.load("eng-b", device="auto")
    assert arb.reservation_of("tts:eng-a") is None
    assert arb.reservation_of("tts:eng-b")["vram_mb"] == 1200


# ─── the high-water bump (raise-only + occupant re-check + create) ────


def test_high_water_bump_raises_and_never_lowers(monkeypatch, arb_env):
    arb = arb_env(_discrete())
    recorded = []
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=True: 2000)
    mgr.load("eng", device="auto")   # books measured 2000
    monkeypatch.setattr(
        EngineManager, "_record_speech_load",
        lambda self, m, kind, variant, mb, device: recorded.append(mb),
    )
    # Render peak observed above the booking → raised.
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=False: 4000)
    mgr.bump_engine_reservation("tts")
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4000
    assert arb.reservation_of("tts:eng")["source"] == "measured"
    assert recorded == [4000]
    # A lower later probe never shrinks the high-water mark.
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=False: 900)
    mgr.bump_engine_reservation("tts")
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4000
    assert recorded == [4000]


def test_bump_creates_the_booking_when_measurement_first_lands(monkeypatch, arb_env):
    """An engine that loaded "not measured yet" (no probe arm fired at the
    door) gets its booking CREATED by the first successful post-work probe."""
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    mgr.load("eng", device="auto")            # nothing measurable → no booking
    assert arb.reservation_of("tts:eng") is None
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=False: 1300)
    mgr.bump_engine_reservation("tts")
    row = arb.reservation_of("tts:eng")
    assert row is not None and row["vram_mb"] == 1300
    assert row["source"] == "measured"


def test_bump_never_creates_a_booking_for_a_cpu_placed_engine(monkeypatch, arb_env):
    """The standing policy holds through the create path: a CPU-placed engine
    on a discrete box books nothing, even if a probe returns a number."""
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest(cpu_adequate=True))
    mgr.load("eng", device="auto")
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=False: 700)
    mgr.bump_engine_reservation("tts")
    assert arb.reservation_of("tts:eng") is None


def test_bump_skips_when_the_slot_swapped_mid_probe(monkeypatch, arb_env):
    """Hardening (§10 item 6): the probe runs unlocked — if the slot occupant
    changes while it shells out, no booking is written for the departed
    engine."""
    arb = arb_env(_discrete())
    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(EngineManager, "_engine_proc_mb",
                        lambda self, proc, *, fresh=True: 1000)
    mgr.load("eng", device="auto")

    def _swap_then_probe(self, proc, *, fresh=False):
        self._loaded["tts"] = _Proc(SimpleNamespace(id="other", kind="tts"))
        return 5000

    monkeypatch.setattr(EngineManager, "_engine_proc_mb", _swap_then_probe)
    mgr.bump_engine_reservation("tts")
    assert arb.reservation_of("tts:eng")["vram_mb"] == 1000


# ─── admission (prior-measured only; honest refusal; the seam) ────────


def test_admission_refuses_honestly_when_nothing_is_evictable(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("llm:pinned-chat", 7000, pinned=True, kind="llm")
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 4096)
    with pytest.raises(RuntimeError, match="not enough memory"):
        mgr.load("eng", device="auto")
    # The world is exactly as it was: no slot occupant, no booking.
    assert mgr._loaded.get("tts") is None
    assert arb.reservation_of("tts:eng") is None


def test_admission_evicts_the_idle_llm(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    evicted = []
    arb.reserve("chat", 7000, kind="llm", evict_fn=lambda: evicted.append("chat"))
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 4096)
    mgr.load("eng", device="auto")
    assert evicted == ["chat"]
    assert arb.reservation_of("chat") is None
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4096
    assert arb.reservation_of("tts:eng")["source"] == "measured"
    # Q3's event feed recorded the swap for the toast poller.
    events = arb.events_since(0)
    assert events and events[0]["victim_key"] == "chat"


def test_admission_never_evicts_a_busy_kind(monkeypatch, arb_env):
    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("chat", 7000, kind="llm", evict_fn=lambda: None)
    arb.busy_begin("llm")
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 4096)
    with pytest.raises(RuntimeError, match="busy: llm"):
        mgr.load("eng", device="auto")
    assert arb.reservation_of("chat") is not None
    # The refusal fired BEFORE the early booking — nothing leaked.
    assert arb.reservation_of("tts:eng") is None


def test_admission_on_measured_free_sees_foreign_usage(monkeypatch, arb_env):
    """The admission truth: the ledger says 8 GB free (nothing booked) but
    the MEASURED pool says other apps hold 7 GB — the load must refuse, and
    the refusal quotes the measured number."""
    arb_env(_discrete(vram_mb=8192))
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 4096)
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: 7000)
    with pytest.raises(RuntimeError, match=r"free of 8192 MB \(measured, minus what is booked\)"):
        mgr.load("eng", device="auto")
    assert mgr._loaded.get("tts") is None


def test_admission_on_measured_free_evicts_then_settles(monkeypatch, arb_env):
    """Short measured free + an idle victim: the ledger target is inflated by
    the unledgered slice, the victim dies through the seam, the settle loop
    watches the measured number recover, and the prior-measured booking
    stands after a post-load probe miss."""
    arb = arb_env(_discrete(vram_mb=8192))
    evicted = []
    arb.reserve("chat", 6500, kind="llm", evict_fn=lambda: evicted.append("chat"))
    # Probe sequence: admission sees 7000 used (6500 booked + 500 foreign);
    # the settle re-probe and everything after see 600 (chat drained).
    seq = [7000, 600]
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: seq.pop(0) if seq else 600)
    mgr = _mgr(monkeypatch, _discrete(vram_mb=8192), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 2000)
    mgr.load("eng", device="auto")
    assert evicted == ["chat"]
    assert arb.reservation_of("tts:eng")["vram_mb"] == 2000


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


def test_vram_endpoint_serves_the_strip(tmp_path, arb_env, monkeypatch):
    """GET /v1/engines/vram (Q3/Q4 + the redesign): snapshot + the MEASURED
    pool state (used/other) + kind/source-tagged reservations + busy kinds +
    eviction events after `events_since`."""
    from starlette.testclient import TestClient

    from justvoice.app import create_app

    arb = arb_env(_discrete(vram_mb=8192))
    arb.reserve("tts:eng", 1234, kind="tts", source="measured")
    arb.busy_begin("tts")
    arb.record_eviction("chat", "llm", "loading eng")
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: 5000)
    app = create_app(data_dir=tmp_path)
    client = TestClient(app, raise_server_exceptions=False)
    body = client.get("/v1/engines/vram").json()
    assert body["mem_arch"] == "discrete"
    assert body["total_mb"] == 8192
    assert body["committed_mb"] == 1234
    assert body["remaining_mb"] == 8192 - 1234
    # The measured truth the strip displays: used is what nvidia-smi would
    # say; other = the slice the ledger can't attribute.
    assert body["used_mb"] == 5000
    assert body["other_mb"] == 5000 - 1234
    assert body["busy_kinds"] == ["tts"]
    row = next(r for r in body["reservations"] if r["key"] == "tts:eng")
    assert row["kind"] == "tts" and row["source"] == "measured"
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
    mgr._probe_cache = {}
    # Dict contract since 2026-08-21: confidence rides along (None = the
    # engine measured nothing — the fake here returns text only).
    assert mgr.transcribe({"wav_b64": ""}) == {"text": "hi", "confidence": None}
    assert seen == [{"stt"}]
    assert "stt" not in arb.busy_kinds()


# ─── the speech door prices on BOTH truths (2026-08-15) ───────────────
# This door priced on the measured probe alone. The probe cannot see a booking
# whose allocation has not landed yet, and — the defect that surfaced it — the
# AI runner's ledger kept booking a child the router had idle-unloaded, so the
# probe correctly reported gigabytes free while the ledger still claimed them.
# A TTS engine moved in on the measurement, the booking stood, and an 8 GB card
# carried 10.6 GB of reservations. The pool is now occupied by the WORSE of the
# two numbers; the sleeping half is fixed in the kit (arbiter.sync_sleeping).


def _admission_mgr(monkeypatch, arb, *, prior_mb, used_mb):
    from justvoice.engines import manager as mgr_mod

    mgr = _mgr(monkeypatch, _discrete(), _manifest())
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: prior_mb)
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: used_mb)
    monkeypatch.setattr(EngineManager, "_safety_margin_mb", staticmethod(lambda: 1024))
    # The reconcile is the runner's job and needs a router; here it must simply
    # not be reached for a decision.
    monkeypatch.setattr(mgr_mod, "EngineProcess", _Proc)
    return mgr


def test_admission_counts_a_standing_booking_the_probe_cannot_see(monkeypatch, arb_env):
    """6 GB booked, the card reporting 100 MB used (the allocation has not landed).
    Measured-only arithmetic said 8 GB free and let a 4.4 GB engine in on top."""
    arb = arb_env(_discrete())
    evicted = []
    arb.reserve("gemma", 6000, kind="llm", evict_fn=lambda: evicted.append("gemma"))
    mgr = _admission_mgr(monkeypatch, arb, prior_mb=4400, used_mb=100)

    mgr.load("eng", device="auto")

    assert evicted == ["gemma"], "the booking must be honoured, not out-voted by a stale probe"
    assert arb.reservation_of("gemma") is None
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4400


def test_admission_treats_a_sleeping_booking_as_free_memory(monkeypatch, arb_env):
    """The other direction, and the reason the max is safe: a child the router
    idle-unloaded holds nothing, so its booking must NOT block a speech load.
    Nothing is evicted — the memory really is there."""
    arb = arb_env(_discrete())
    evicted = []
    arb.reserve("gemma", 6000, kind="llm", evict_fn=lambda: evicted.append("gemma"))
    arb.sync_sleeping({"gemma"})
    mgr = _admission_mgr(monkeypatch, arb, prior_mb=4400, used_mb=100)

    mgr.load("eng", device="auto")

    assert evicted == [], "a sleeper holds no memory — evicting it frees nothing"
    assert arb.is_asleep("gemma"), "and it keeps its booking for the wake to claim"
    assert arb.reservation_of("tts:eng")["vram_mb"] == 4400


def test_admission_still_prices_on_the_probe_when_the_probe_is_worse(monkeypatch, arb_env):
    """Unchanged behaviour where the measurement leads: 3 GB held by programs we
    do not manage, nothing in our ledger, and a 4.4 GB engine no longer fits."""
    arb = arb_env(_discrete())
    mgr = _admission_mgr(monkeypatch, arb, prior_mb=4400, used_mb=6000)

    with pytest.raises(RuntimeError, match="not enough memory"):
        mgr.load("eng", device="auto")
    assert arb.reservation_of("tts:eng") is None
