// SPDX-License-Identifier: MIT
// Engine registry — one engine current at a time (the port of justvoice/engines/registry.py).
//
// Owns the set of registered backends (runtime-registered ones: the external OpenAI-compatible
// servers and cloud TTS providers) + which is current. Handlers call
// `registry.synthesize(...)`, which routes to the right backend. Python's RLock guarded state
// that never spans an await, so it is gone here (one event loop).

import { KeyError } from "@delebash/llm-runner/platform/py";

export class EngineRegistry {
  constructor() {
    this._engines = new Map();
    this._current = null;
  }

  register(engine) {
    const id = engine.meta.engineId;
    this._engines.set(id, engine);
    if (this._current === null && engine.ready()) this._current = id;
  }

  unregister(id) {
    if (!this._engines.has(id)) return false;
    this._engines.delete(id);
    if (this._current === id) this._current = null;
    return true;
  }

  has(id) {
    return this._engines.has(id);
  }

  get(id) {
    return this._engines.get(id) ?? null;
  }

  current() {
    return this._current;
  }

  setCurrent(id) {
    this._current = id;
  }

  clearCurrent() {
    const was = this._current;
    this._current = null;
    return was;
  }

  /** Sorted, as Python's `sorted(keys)` (code-point order). */
  registeredIds() {
    return [...this._engines.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  all() {
    return [...this._engines.values()];
  }

  async synthesize(engineId, req) {
    const engine = this.get(engineId);
    if (engine === null) throw new KeyError(`engine not registered: ${engineId}`);
    return engine.synthesize(req);
  }
}
