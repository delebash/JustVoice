// SPDX-License-Identifier: MIT
// Application-wide state container (the port of justvoice/app_state.py). Holds long-lived
// singletons: the engine registry, the four stores (settings/voices/personas/lexicons), the
// render cache, and the data dir. `setState` at boot, `getState` everywhere after.

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getLogger } from "@delebash/core/platform/log";
import { RuntimeError } from "@delebash/core/platform/py";
import { RenderCache } from "./cache.js";
import { cacheRoot } from "./paths.js";
import { LexiconStore, PersonaStore, SettingsStore, VoiceStore } from "./storage/index.js";

const log = getLogger("justvoice.app_state");

// The engine registry is another slice's module (engines/registry.js). Loaded here when it
// exists; until it does, `state.engines` is null unless the host passes one.
let EngineRegistry = null;
const ENGINES = new URL("./engines/index.js", import.meta.url);
try {
  ({ EngineRegistry } = await import(ENGINES.href));
} catch (e) {
  // Only the engines package itself being absent is tolerated — a missing module INSIDE it
  // is a real error.
  // (Node names the file by its path, vitest by its URL.)
  const m = String(e?.message);
  const missing = /Cannot find module/.test(m) && (m.includes(fileURLToPath(ENGINES)) || m.includes(ENGINES.href));
  if (!missing) throw e;
  log.debug("engines/index.js not ported yet — AppState.engines starts null");
}

export class AppState {
  /** `engines` overrides the engine registry (a test's, or the host's). */
  constructor(dataDir, { engines } = {}) {
    this.dataDir = dataDir;
    mkdirSync(dataDir, { recursive: true });
    this.settings = new SettingsStore(dataDir);
    this.voices = new VoiceStore(dataDir);
    this.personas = new PersonaStore(dataDir);
    this._renderCache = new RenderCache(cacheRoot(dataDir), this.settings.get().cache.max_memory_entries);
    this.lexicons = new LexiconStore(dataDir);
    this.engines = engines !== undefined ? engines : EngineRegistry ? new EngineRegistry() : null;
  }
}

// Singleton — set during boot, read everywhere. `cfg.state` is assignable from tests (Python
// monkeypatched the module global).
export const cfg = { state: null };

export function setState(state) {
  cfg.state = state;
}

export function getState() {
  if (cfg.state === null) throw new RuntimeError("AppState not initialized — call set_state() during boot");
  return cfg.state;
}
