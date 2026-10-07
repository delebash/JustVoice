# SPDX-License-Identifier: MIT
"""SynthScheduler policy tests — engine-major drain, FIFO fairness,
free-riding, interactive priority, abort-on-first-error, cancel.

Each test builds its own SynthScheduler (never the process singleton) and
holds the worker on a gate item so submissions queue deterministically
before the drain starts.
"""

from __future__ import annotations

import asyncio
import threading
import time

from justvoice.synth_scheduler import SynthScheduler, warm_specs


def _gated(sched: SynthScheduler) -> threading.Event:
    """Occupy the worker with a first item until the returned gate is set."""
    gate = threading.Event()
    started = threading.Event()

    def hold():
        started.set()
        gate.wait(5)

    sched.submit([("gate-engine", hold)])
    assert started.wait(5)
    return gate


def test_engine_major_within_one_set():
    sched = SynthScheduler()
    gate = _gated(sched)
    seq: list[str] = []
    handle = sched.submit(
        [
            ("A", lambda: seq.append("A1")),
            ("B", lambda: seq.append("B1")),
            ("A", lambda: seq.append("A2")),
            ("B", lambda: seq.append("B2")),
        ]
    )
    gate.set()
    assert handle.wait(5)
    assert seq == ["A1", "A2", "B1", "B2"]


def test_oldest_pending_line_names_the_next_engine():
    sched = SynthScheduler()
    gate = _gated(sched)
    seq: list[str] = []
    h1 = sched.submit([("B", lambda: seq.append("B-first"))])
    h2 = sched.submit([("A", lambda: seq.append("A-second"))])
    gate.set()
    assert h1.wait(5) and h2.wait(5)
    assert seq == ["B-first", "A-second"]


def test_newer_sets_free_ride_the_loaded_engine():
    sched = SynthScheduler()
    gate = _gated(sched)
    seq: list[str] = []
    h1 = sched.submit(
        [("A", lambda: seq.append("A-set1")), ("B", lambda: seq.append("B-set1"))]
    )
    h2 = sched.submit([("A", lambda: seq.append("A-set2"))])
    gate.set()
    assert h1.wait(5) and h2.wait(5)
    # Set 2's A line rides along while A is current; B waits.
    assert seq == ["A-set1", "A-set2", "B-set1"]


def test_interactive_jumps_at_the_line_boundary():
    sched = SynthScheduler()
    gate = _gated(sched)
    seq: list[str] = []
    batch = sched.submit(
        [("A", lambda: seq.append("A1")), ("A", lambda: seq.append("A2"))]
    )
    single = sched.submit([("B", lambda: seq.append("B!"))], interactive=True)
    gate.set()
    assert batch.wait(5) and single.wait(5)
    assert seq[0] == "B!"
    assert seq[1:] == ["A1", "A2"]


def test_first_failure_withdraws_the_rest_of_the_set():
    sched = SynthScheduler()
    seq: list[str] = []

    def boom():
        raise ValueError("synth exploded")

    handle = sched.submit(
        [
            ("A", lambda: seq.append("ok")),
            ("A", boom),
            ("A", lambda: seq.append("never")),
        ]
    )
    assert handle.wait(5)
    assert seq == ["ok"]
    assert isinstance(handle.error, ValueError)
    try:
        handle.raise_if_failed()
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_cancel_withdraws_pending_items():
    sched = SynthScheduler()
    gate = _gated(sched)
    seq: list[str] = []
    handle = sched.submit([("A", lambda: seq.append("x")), ("A", lambda: seq.append("y"))])
    sched.cancel(handle.set_id)
    gate.set()
    assert handle.wait(5)
    assert handle.cancelled is True
    assert handle.error is None
    time.sleep(0.05)
    assert seq == []


def test_single_item_result_round_trips():
    sched = SynthScheduler()
    handle = sched.submit([("A", lambda: 42)], interactive=True)
    assert handle.wait(5)
    handle.raise_if_failed()
    assert handle.items[0].result == 42


def test_empty_set_completes_immediately():
    sched = SynthScheduler()
    handle = sched.submit([])
    assert handle.done.is_set()


def test_warm_specs_swallows_failures():
    def boom():
        raise RuntimeError("no engine")

    # Must not raise — warm sets are advisory; the render loop is the
    # error surface (§7d of the 2026-08-08 plan).
    asyncio.run(warm_specs([("A", boom)]))


# ── what is ahead (decided 2026-10-07: Render says what a waiting render waits for) ──

CH2 = {"label": "2 · Bigger Inside", "kind": "chapter"}
M4B = {"label": "the M4B export", "kind": "work"}


def test_ahead_names_the_work_before_a_set_in_the_order_it_runs():
    sched = SynthScheduler()
    gate = _gated(sched)
    sched.submit([("B", lambda: None)] * 3, owner=CH2)
    sched.submit([("A", lambda: None)] * 2, owner=M4B)
    mine = sched.submit([("A", lambda: None)])
    ahead = sched.ahead([mine.set_id])
    assert ahead == {"lines": 6, "groups": [
        {"label": "other work", "kind": "work", "engine": "gate-engine", "lines": 1},
        {"label": "2 · Bigger Inside", "kind": "chapter", "engine": "B", "lines": 3},
        {"label": "the M4B export", "kind": "work", "engine": "A", "lines": 2},
    ]}
    gate.set()
    assert mine.wait(5)
    assert sched.ahead([mine.set_id]) is None


def test_ahead_follows_the_loaded_model_first():
    """A newer set on the model that is loaded goes before an older one on
    another model — so only the line running is ahead of it."""
    sched = SynthScheduler()
    gate = threading.Event()
    started = threading.Event()
    sched.submit([("A", lambda: (started.set(), gate.wait(5)))], owner=M4B)
    assert started.wait(5)
    sched.submit([("B", lambda: None)] * 4, owner=CH2)
    mine = sched.submit([("A", lambda: None)])
    assert sched.ahead([mine.set_id]) == {"lines": 1, "groups": [
        {"label": "the M4B export", "kind": "work", "engine": "A", "lines": 1}]}
    gate.set()
    assert mine.wait(5)


def test_ahead_is_none_while_the_sets_own_line_runs():
    sched = SynthScheduler()
    gate = threading.Event()
    started = threading.Event()
    mine = sched.submit([("A", lambda: (started.set(), gate.wait(5))), ("A", lambda: None)], owner=CH2)
    assert started.wait(5)
    assert sched.ahead([mine.set_id]) is None
    gate.set()
    assert mine.wait(5)
