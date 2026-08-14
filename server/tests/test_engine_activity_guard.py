# SPDX-License-Identifier: MIT
"""The manager's per-kind activity guard (2026-08-08 §7b P2-6).

Once endpoints await the scheduler instead of blocking the event loop, the
accidental serialization that used to prevent a load/unload from killing an
engine subprocess mid-synth is gone — the activity lock is its replacement.
This test pins the ordering: an unload of a slot WAITS for that slot's
in-flight synth call to finish before terminating the process.
"""

from __future__ import annotations

import threading
import time
from types import SimpleNamespace

from justvoice.engines.manager import EngineManager


class _Resp:
    status_code = 200
    headers = {
        "X-JustVoice-Sample-Rate": "16000",
        "X-JustVoice-Channels": "1",
        "content-type": "audio/wav",
    }
    content = b"x"


def _bare_manager() -> EngineManager:
    """An EngineManager without discovery — only the fields the guard uses."""
    mgr = EngineManager.__new__(EngineManager)
    mgr._manifests = {}
    mgr._loaded = {}
    mgr._current_variants = {}
    mgr._lock = threading.RLock()
    mgr._cancel_load_requests = set()
    mgr._activity_locks = {}
    mgr._resolved_devices = {}
    mgr._hw_cache = None
    mgr._hw_detected = True  # never shell out to nvidia-smi in a unit test
    mgr._probe_cache = {}
    return mgr


def test_unload_waits_for_inflight_synth():
    mgr = _bare_manager()
    events: list[tuple] = []
    release = threading.Event()

    class _Proc:
        manifest = SimpleNamespace(id="fake", kind="tts")

        def is_alive(self):
            return True

        def post(self, path, json=None, timeout=None):
            events.append(("post-start", path))
            release.wait(5)
            events.append(("post-end", path))
            return _Resp()

        def terminate(self):
            events.append(("terminate",))

    mgr._loaded["tts"] = _Proc()

    synth_thread = threading.Thread(target=lambda: mgr.synth("fake", {}))
    synth_thread.start()
    for _ in range(200):
        if ("post-start", "/synth") in events:
            break
        time.sleep(0.01)
    assert ("post-start", "/synth") in events

    unload_thread = threading.Thread(target=lambda: mgr.unload("tts"))
    unload_thread.start()
    time.sleep(0.15)
    # The guard holds: no terminate while the synth call is in flight.
    assert ("terminate",) not in events

    release.set()
    synth_thread.join(5)
    unload_thread.join(5)
    assert events.index(("post-end", "/synth")) < events.index(("terminate",))


def test_different_kind_is_not_blocked():
    mgr = _bare_manager()
    release = threading.Event()
    started = threading.Event()

    class _SlowProc:
        manifest = SimpleNamespace(id="fake-tts", kind="tts")

        def is_alive(self):
            return True

        def post(self, path, json=None, timeout=None):
            started.set()
            release.wait(5)
            return _Resp()

        def terminate(self):
            pass

    class _SttProc:
        manifest = SimpleNamespace(id="fake-stt", kind="stt")
        terminated = False

        def is_alive(self):
            return True

        def terminate(self):
            self.terminated = True

    mgr._loaded["tts"] = _SlowProc()
    stt = _SttProc()
    mgr._loaded["stt"] = stt

    synth_thread = threading.Thread(target=lambda: mgr.synth("fake-tts", {}))
    synth_thread.start()
    assert started.wait(5)
    # A different kind's unload proceeds while tts is mid-synth.
    out = mgr.unload("stt")
    assert out == {"previous_engine": "fake-stt"}
    assert stt.terminated is True
    release.set()
    synth_thread.join(5)
