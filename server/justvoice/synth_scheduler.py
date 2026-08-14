# SPDX-License-Identifier: MIT
"""The synthesis scheduler — one worker, one pending pool, engine-major order.

Every multi-line render submits its line-set here and waits; interactive
singles ride the same pool with priority. The worker drains the pool grouped
by engine: stay on the current engine until no pending line anywhere needs
it, then move to the engine of the OLDEST pending line — the FIFO pick makes
starvation impossible, the pool-wide drain lets newer sets free-ride a loaded
engine. Design record: docs/plans/2026-08-08-vram-think.md §7-7d.

Multi-line producers use WARM sets (`warm_lines`): items render into the
render cache and the producer's existing assembly loop re-reads it — the
cache is the hand-off, no audio crosses this boundary, and warm errors are
logged, never raised, so the assembly loop stays the sole error surface
(exact-outcome parity with the sequential loops this replaces). Singles
submit result-bearing items and re-raise the item's error.

A set's remaining items are withdrawn on its first failure (parity with the
sequential loops, which abort on first error). Cancelling a set withdraws
its pending items; an in-flight item finishes — line-boundary semantics.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class _Item:
    fn: Callable[[], Any]
    engine_id: str
    set_id: int
    order: int  # global submit order — the FIFO fairness key
    result: Any = None
    error: BaseException | None = None


class SetHandle:
    """One submitted set. Completion = every item finished, the set failed
    (remainder withdrawn), or the set was cancelled."""

    def __init__(self, scheduler: "SynthScheduler", set_id: int, items: list[_Item]):
        self._scheduler = scheduler
        self.set_id = set_id
        self.items = items
        self.done = threading.Event()
        self.error: BaseException | None = None
        self.cancelled = False

    def wait(self, timeout: float | None = None) -> bool:
        return self.done.wait(timeout)

    async def wait_async(self) -> None:
        """Await completion without holding the event loop. On cancellation
        (client disconnect) withdraw the set's pending items and re-raise."""
        try:
            await asyncio.get_running_loop().run_in_executor(None, self.done.wait)
        except asyncio.CancelledError:
            self._scheduler.cancel(self.set_id)
            raise

    def raise_if_failed(self) -> None:
        if self.error is not None:
            raise self.error


class SynthScheduler:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Condition(self._lock)
        self._pending: list[_Item] = []
        self._handles: dict[int, SetHandle] = {}
        self._remaining: dict[int, int] = {}
        self._interactive: set[int] = set()
        self._next_set = 1
        self._next_order = 1
        self._current_engine: str | None = None
        self._worker: threading.Thread | None = None
        # The 2026-08-13 VRAM wiring (step 4): True while the worker is
        # actively draining — the coarse tts-busy signal (Q1's
        # never-evict-busy) lives at THIS transition, not per line.
        self._busy_active = False

    # ── submit / cancel ──────────────────────────────────────────────

    def submit(
        self,
        specs: list[tuple[str, Callable[[], Any]]],
        *,
        interactive: bool = False,
    ) -> SetHandle:
        """`specs` = (engine_id, zero-arg callable) per line, position order.
        The engine id is only a grouping key — an unresolvable voice submits
        under a sentinel key and its callable raises the real error."""
        with self._wake:
            set_id = self._next_set
            self._next_set += 1
            items: list[_Item] = []
            for engine_id, fn in specs:
                items.append(
                    _Item(fn=fn, engine_id=engine_id, set_id=set_id, order=self._next_order)
                )
                self._next_order += 1
            handle = SetHandle(self, set_id, items)
            self._handles[set_id] = handle
            self._remaining[set_id] = len(items)
            if interactive:
                self._interactive.add(set_id)
            self._pending.extend(items)
            if not items:
                self._finish_locked(set_id)
            else:
                self._ensure_worker_locked()
                self._wake.notify_all()
            return handle

    def cancel(self, set_id: int) -> None:
        with self._wake:
            handle = self._handles.get(set_id)
            if handle is None or handle.done.is_set():
                return
            handle.cancelled = True
            kept = [i for i in self._pending if i.set_id != set_id]
            dropped = len(self._pending) - len(kept)
            self._pending = kept
            if dropped:
                self._remaining[set_id] -= dropped
            if self._remaining.get(set_id, 0) <= 0:
                self._finish_locked(set_id)

    # ── worker ───────────────────────────────────────────────────────

    def _ensure_worker_locked(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(
                target=self._run, name="synth-scheduler", daemon=True
            )
            self._worker.start()

    def _pick_locked(self) -> _Item:
        """Interactive first (a live user beats batch, at a line boundary);
        else stay on the current engine while anything needs it; else the
        OLDEST pending line names the next engine."""
        interactive = [i for i in self._pending if i.set_id in self._interactive]
        if interactive:
            item = min(interactive, key=lambda i: i.order)
        else:
            on_current = [i for i in self._pending if i.engine_id == self._current_engine]
            pool = on_current or self._pending
            item = min(pool, key=lambda i: i.order)
        self._pending.remove(item)
        self._current_engine = item.engine_id
        return item

    def _set_busy_locked(self, active: bool) -> None:
        """tts-busy at the worker's idle↔active transitions (the 2026-08-13
        VRAM wiring, step 4 — Q1's never-evict-busy): while the pool drains,
        the resident TTS engine is not an eviction victim, so an LLM admission
        mid-render takes its proceed-with-warning branch instead of killing
        the render. Coarse by design — one flag for the whole drain, released
        the moment the pool empties. Best-effort: bare tests run without the
        shared stack (no ledger → nothing to protect)."""
        if active == self._busy_active:
            return
        self._busy_active = active
        if not active:
            # Busy→idle: one FRESH high-water re-probe of the resident engine
            # (the 2026-08-13 redesign — TTS memory peaks at generate(); the
            # per-line bumps ride a TTL cache and can be ~2 s stale, this one
            # catches the settled peak). On a daemon thread: the probe can
            # shell out for ~1 s and this transition runs under `_wake`.
            def _bump() -> None:
                try:
                    from .engines.manager import get_manager

                    get_manager().bump_engine_reservation("tts", fresh=True)
                except Exception:  # noqa: BLE001
                    pass

            threading.Thread(target=_bump, name="tts-highwater", daemon=True).start()
        try:
            from llm_runner.runner.arbiter import get_arbiter

            arb = get_arbiter()
        except Exception:  # noqa: BLE001 — no kit in this process
            return
        (arb.busy_begin if active else arb.busy_end)("tts")

    def _run(self) -> None:
        while True:
            with self._wake:
                while not self._pending:
                    self._set_busy_locked(False)
                    self._wake.wait()
                self._set_busy_locked(True)
                item = self._pick_locked()
            try:
                item.result = item.fn()
            except BaseException as e:  # noqa: BLE001 — recorded per item, re-raised at the submitter
                item.error = e
            with self._wake:
                self._remaining[item.set_id] -= 1
                handle = self._handles.get(item.set_id)
                if item.error is not None and handle is not None and handle.error is None:
                    handle.error = item.error
                    # Abort-on-first-error parity: withdraw the set's rest.
                    kept = [i for i in self._pending if i.set_id != item.set_id]
                    self._remaining[item.set_id] -= len(self._pending) - len(kept)
                    self._pending = kept
                if self._remaining.get(item.set_id, 0) <= 0:
                    self._finish_locked(item.set_id)

    def _finish_locked(self, set_id: int) -> None:
        handle = self._handles.pop(set_id, None)
        self._remaining.pop(set_id, None)
        self._interactive.discard(set_id)
        if handle is not None:
            handle.done.set()


# ── warm-set helpers (the multi-line producers' door) ─────────────────


async def warm_specs(specs: list[tuple[str, Callable[[], Any]]]) -> None:
    """Submit one advisory warm set and wait. Failures are logged, not
    raised — the caller's own render loop is the error surface (§7d)."""
    if not specs:
        return
    handle = get_scheduler().submit(specs)
    await handle.wait_async()
    if handle.error is not None:
        log.info("warm set finished early (the render loop surfaces it): %s", handle.error)


async def warm_lines(state, line_kwargs: list[dict]) -> None:
    """Warm the render cache for these render_line calls, engine-grouped.
    Each kwargs dict must be EXACTLY what the assembly loop will pass —
    same args, same cache key, guaranteed hit."""
    from .render_core import _resolve_engine_for_voice, render_line

    specs: list[tuple[str, Callable[[], Any]]] = []
    for kw in line_kwargs:
        engine_id = _resolve_engine_for_voice(state, kw["voice"]) or f"?voice:{kw['voice']}"
        specs.append((engine_id, lambda kw=kw: render_line(state, **kw)))
    await warm_specs(specs)


# ── singleton ─────────────────────────────────────────────────────────

_scheduler: SynthScheduler | None = None
_scheduler_lock = threading.Lock()


def get_scheduler() -> SynthScheduler:
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = SynthScheduler()
        return _scheduler
