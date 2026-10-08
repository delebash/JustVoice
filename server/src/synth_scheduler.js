// SPDX-License-Identifier: MIT
// The synthesis scheduler — one worker, one pending pool, engine-major order (the port of
// justvoice/synth_scheduler.py).
//
// Every multi-line render submits its line-set here and waits; interactive singles ride the
// same pool with priority. The worker drains the pool grouped by engine: stay on the current
// engine until no pending line anywhere needs it, then move to the engine of the OLDEST
// pending line — the FIFO pick makes starvation impossible, the pool-wide drain lets newer
// sets free-ride a loaded engine. Design record: docs/plans/2026-08-08-vram-think.md §7-7d.
//
// Multi-line producers use WARM sets (`warmLines`): items render into the render cache and
// the producer's existing assembly loop re-reads it — the cache is the hand-off, no audio
// crosses this boundary, and warm errors are logged, never raised, so the assembly loop stays
// the sole error surface. Singles submit result-bearing items and re-raise the item's error.
//
// A set's remaining items are withdrawn on its first failure (parity with the sequential
// loops, which abort on first error). Cancelling a set withdraws its pending items; an
// in-flight item finishes — line-boundary semantics.
//
// Every set says who it is for (`owner`: a label and a kind — a chapter's render or other
// work), so a render held behind another model's lines can say why (`ahead`, decided
// 2026-10-07): "waiting — 2 · Bigger Inside is ahead: 40 lines on Chatterbox Turbo".
//
// JavaScript: the worker is an async loop on the one event loop (Python's daemon thread +
// condition). It starts on the next microtask after a submit — so a run of synchronous
// submits queues whole before the drain picks — and ends when the pool is empty; the next
// submit starts it again. An item's callable may return a value or a promise. Python's lock
// guarded state no `await` splits, so none is needed.

import { AsyncEvent, background } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as arbiter from "@delebash/llm-runner/runner/arbiter";
import * as manager from "./engines/manager.js";
import * as renderCore from "./render_core.js";
import * as self from "./synth_scheduler.js";
import * as voiceModel from "./voice_model.js";

export const log = getLogger("justvoice.synth_scheduler");

/** One line of a set. `order` is the global submit order — the FIFO fairness key. */
export class _Item {
  constructor({ fn, engineId, setId, order }) {
    this.fn = fn;
    this.engineId = engineId;
    this.setId = setId;
    this.order = order;
    this.result = null;
    this.error = null;
  }
}

/** One submitted set. Completion = every item finished, the set failed (remainder withdrawn),
 * or the set was cancelled. */
export class SetHandle {
  constructor(scheduler, setId, items) {
    this._scheduler = scheduler;
    this.setId = setId;
    this.items = items;
    this.done = new AsyncEvent();
    this.error = null;
    this.cancelled = false;
  }

  /** Resolves true once done (false when `timeout` seconds pass first). */
  wait(timeout = null) {
    return this.done.wait(timeout == null ? undefined : timeout * 1000);
  }

  /** Await completion. On cancellation — `signal` aborted (a client disconnect) — withdraw the
   * set's pending items and throw the abort reason (Python re-raised CancelledError). */
  async waitAsync({ signal = null } = {}) {
    if (signal == null) {
      await this.done.wait();
      return;
    }
    if (signal.aborted) {
      this._scheduler.cancel(this.setId);
      throw signal.reason;
    }
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => {
        this._scheduler.cancel(this.setId);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.done.wait(), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  raiseIfFailed() {
    if (this.error != null) throw this.error;
  }
}

const OTHER_WORK = () => ({ label: "other work", kind: "work" });

export class SynthScheduler {
  constructor() {
    this._pending = [];
    this._handles = new Map();
    this._remaining = new Map();
    this._interactive = new Set();
    this._owners = new Map(); // set id → {label, kind} (2026-10-07)
    this._running = null; // the item the worker is on
    this._nextSet = 1;
    this._nextOrder = 1;
    this._currentEngine = null;
    this._worker = null; // the running drain (a promise) or null
    // The 2026-08-13 VRAM wiring (step 4): true while the worker is actively draining — the
    // coarse tts-busy signal (Q1's never-evict-busy) lives at THIS transition, not per line.
    this._busyActive = false;
  }

  // ── submit / cancel ──────────────────────────────────────────────

  /**
   * `specs` = `[engineId, zero-arg callable]` per line, position order. The engine id is only
   * a grouping key — an unresolvable voice submits under a sentinel key and its callable throws
   * the real error. `owner` names who the set is for — `{label: "2 · Bigger Inside", kind:
   * "chapter"}` or `{label: "the M4B export", kind: "work"}` — for `ahead`; a set without one
   * is "other work".
   */
  submit(specs, { interactive = false, owner = null } = {}) {
    const setId = this._nextSet++;
    const items = [];
    for (const [engineId, fn] of specs) {
      items.push(new _Item({ fn, engineId, setId, order: this._nextOrder++ }));
    }
    const handle = new SetHandle(this, setId, items);
    this._handles.set(setId, handle);
    this._remaining.set(setId, items.length);
    if (interactive) this._interactive.add(setId);
    this._owners.set(setId, owner || OTHER_WORK());
    this._pending.push(...items);
    if (!items.length) this._finish(setId);
    else this._ensureWorker();
    return handle;
  }

  cancel(setId) {
    const handle = this._handles.get(setId);
    if (handle === undefined || handle.done.isSet()) return;
    handle.cancelled = true;
    const kept = this._pending.filter((i) => i.setId !== setId);
    const dropped = this._pending.length - kept.length;
    this._pending = kept;
    if (dropped) this._remaining.set(setId, this._remaining.get(setId) - dropped);
    if ((this._remaining.get(setId) ?? 0) <= 0) this._finish(setId);
  }

  // ── what is ahead ────────────────────────────────────────────────

  /** The pending items in the order the worker will take them, if nothing else arrives —
   * `_pick`'s rule run to the end: interactive first, then the current engine's lines, then
   * the engine of the oldest line. */
  _order() {
    const byOrder = (a, b) => a.order - b.order;
    const interactive = this._pending.filter((i) => this._interactive.has(i.setId)).sort(byOrder);
    const out = [...interactive];
    let current = interactive.length ? interactive[interactive.length - 1].engineId : this._currentEngine;
    const byEngine = new Map();
    for (const item of this._pending.filter((i) => !this._interactive.has(i.setId)).sort(byOrder)) {
      if (!byEngine.has(item.engineId)) byEngine.set(item.engineId, []);
      byEngine.get(item.engineId).push(item);
    }
    const oldest = [...byEngine.values()].map((q) => q[0]).sort(byOrder);
    while (byEngine.size) {
      if (!byEngine.has(current)) {
        while (!byEngine.has(oldest[0].engineId)) oldest.shift();
        current = oldest.shift().engineId;
      }
      out.push(...byEngine.get(current));
      byEngine.delete(current);
    }
    return out;
  }

  /** What runs before the next line of these sets: `{lines: n, groups: [{label, kind,
   * engine, lines}, …]}` in the order they run, the line the worker is on first. null while one
   * of the sets' own lines is running, or when none is waiting (2026-10-07). */
  ahead(setIds) {
    const mine = new Set(setIds);
    if (this._running !== null && mine.has(this._running.setId)) return null;
    const before = this._running !== null ? [this._running] : [];
    let found = false;
    for (const item of this._order()) {
      if (mine.has(item.setId)) {
        found = true;
        break;
      }
      before.push(item);
    }
    if (!found) return null;
    const groups = [];
    for (const item of before) {
      const owner = this._owners.get(item.setId) || OTHER_WORK();
      const last = groups.length ? groups[groups.length - 1] : null;
      if (last && last.label === owner.label && last.engine === item.engineId) last.lines += 1;
      else groups.push({ label: owner.label, kind: owner.kind, engine: item.engineId, lines: 1 });
    }
    return { lines: before.length, groups };
  }

  // ── worker ───────────────────────────────────────────────────────

  _ensureWorker() {
    if (this._worker === null) this._worker = Promise.resolve().then(() => this._run());
  }

  /** Interactive first (a live user beats batch, at a line boundary); else stay on the current
   * engine while anything needs it; else the OLDEST pending line names the next engine. */
  _pick() {
    const minOrder = (xs) => xs.reduce((a, b) => (b.order < a.order ? b : a));
    const interactive = this._pending.filter((i) => this._interactive.has(i.setId));
    let item;
    if (interactive.length) item = minOrder(interactive);
    else {
      const onCurrent = this._pending.filter((i) => i.engineId === this._currentEngine);
      item = minOrder(onCurrent.length ? onCurrent : this._pending);
    }
    this._pending.splice(this._pending.indexOf(item), 1);
    this._currentEngine = item.engineId;
    return item;
  }

  /**
   * tts-busy at the worker's idle↔active transitions (the 2026-08-13 VRAM wiring, step 4 —
   * Q1's never-evict-busy): while the pool drains, the resident TTS engine is not an eviction
   * victim, so an LLM admission mid-render takes its proceed-with-warning branch instead of
   * killing the render. Coarse by design — one flag for the whole drain, released the moment the
   * pool empties. Best-effort: bare tests run without the shared stack.
   */
  _setBusy(active) {
    if (active === this._busyActive) return;
    this._busyActive = active;
    if (!active) {
      // Busy→idle: one FRESH high-water re-probe of the resident engine (the 2026-08-13
      // redesign — TTS memory peaks at generate(); the per-line bumps ride a TTL cache and can
      // be ~2 s stale, this one catches the settled peak). In the background: the probe can
      // shell out for ~1 s.
      background(
        "tts-highwater",
        async () => {
          try {
            await manager.getManager().bumpEngineReservation("tts", { fresh: true });
          } catch {
            /* best-effort */
          }
        },
        log,
      );
    }
    let arb;
    try {
      arb = arbiter.getArbiter();
    } catch {
      return; // no kit in this process
    }
    if (active) arb.busyBegin("tts");
    else arb.busyEnd("tts");
  }

  async _run() {
    try {
      while (this._pending.length) {
        this._setBusy(true);
        const item = this._pick();
        this._running = item;
        try {
          item.result = await item.fn();
        } catch (e) {
          // recorded per item, re-raised at the submitter
          item.error = e;
        }
        this._running = null;
        this._remaining.set(item.setId, this._remaining.get(item.setId) - 1);
        const handle = this._handles.get(item.setId);
        if (item.error != null && handle !== undefined && handle.error == null) {
          handle.error = item.error;
          // Abort-on-first-error parity: withdraw the set's rest.
          const kept = this._pending.filter((i) => i.setId !== item.setId);
          this._remaining.set(item.setId, this._remaining.get(item.setId) - (this._pending.length - kept.length));
          this._pending = kept;
        }
        if ((this._remaining.get(item.setId) ?? 0) <= 0) this._finish(item.setId);
      }
    } finally {
      this._worker = null;
      this._setBusy(false);
    }
  }

  _finish(setId) {
    const handle = this._handles.get(setId);
    this._handles.delete(setId);
    this._remaining.delete(setId);
    this._interactive.delete(setId);
    this._owners.delete(setId);
    if (handle !== undefined) handle.done.set();
  }
}

// ── warm-set helpers (the multi-line producers' door) ─────────────────

/** Submit one advisory warm set and wait (async). Failures are logged, not raised — the
 * caller's own render loop is the error surface (§7d). */
export async function warmSpecs(specs, { owner = null, signal = null } = {}) {
  if (!specs.length) return;
  const handle = self.getScheduler().submit(specs, { owner });
  await handle.waitAsync({ signal });
  if (handle.error != null) log.info(`warm set finished early (the render loop surfaces it): ${handle.error?.message ?? handle.error}`);
}

/** Warm the render cache for these renderLine calls, engine-grouped (async). Each options
 * object must be EXACTLY what the assembly loop will pass — same args, same cache key,
 * guaranteed hit. */
export async function warmLines(state, lineKwargs, { owner = null, signal = null } = {}) {
  const specs = [];
  for (const kw of lineKwargs) {
    specs.push([await voiceModel.modelKey(state, kw.voice), () => renderCore.renderLine(state, kw)]);
  }
  await self.warmSpecs(specs, { owner, signal });
}

/** A chapter's render, as Render names it: "2 · Bigger Inside". */
export function chapterOwner(scene) {
  const title = scene.title || `Chapter ${scene.position + 1}`;
  return { label: `${scene.position + 1} · ${title}`, kind: "chapter" };
}

/** Other work: "the M4B export", "a voice preview". */
export function workOwner(label) {
  return { label, kind: "work" };
}

// ── singleton ─────────────────────────────────────────────────────────

export const cfg = { scheduler: null };

export function getScheduler() {
  if (cfg.scheduler === null) cfg.scheduler = new SynthScheduler();
  return cfg.scheduler;
}
