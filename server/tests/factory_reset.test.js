// SPDX-License-Identifier: MIT
// The factory reset (data_admin.runFactoryReset — POST /v1/data/reset) must survive a DB
// whose tables drifted from the schema (user-hit 2026-06-12: a table the schema declares was
// missing from the real database → the wipe 500'd). The port of tests/test_factory_reset.py.
// Python monkeypatched the module globals; here the database module's `cfg` and the app
// state's `cfg` are assigned and put back.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as appState from "../src/app_state.js";
import * as dataAdmin from "../src/data_admin.js";
import * as session from "../src/database/session.js";
import * as managerModule from "../src/engines/manager.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { construct, pyClone, Settings } from "../src/models.js";
import { PersonaStore } from "../src/storage/personas.js";
import { tmpDb, tmpPath } from "./helpers.js";

class FakeSettingsStore {
  constructor() {
    this._s = construct(Settings, {});
  }
  get() {
    return pyClone(this._s);
  }
  set(next) {
    this._s = next;
    return next;
  }
}

let saved;
beforeEach(() => {
  saved = { handle: session.cfg.handle, dbPath: session.cfg.dbPath, state: appState.cfg.state };
});
afterEach(() => {
  session.cfg.handle = saved.handle;
  session.cfg.dbPath = saved.dbPath;
  appState.cfg.state = saved.state;
});

/** Force the drop-tables fallback — the file-delete path targets the module's real DB. */
function useTmpDb() {
  const h = tmpDb();
  session.cfg.handle = h;
  session.cfg.dbPath = null;
  return h;
}

test("factory_reset_survives_missing_table", async () => {
  const h = useTmpDb();
  // Simulate schema/DB drift: drop a table the schema still declares.
  h.exec("DROP TABLE IF EXISTS webhooks");
  h.insert("projects", { id: "p1", name: "P", project_type: "audiobook" });
  appState.cfg.state = { settings: new FakeSettingsStore() };

  const cleared = await dataAdmin.runFactoryReset();
  expect(cleared).toBeGreaterThan(0);
  expect(h.count("projects")).toBe(0);
});

test("factory_reset_preserves_server_section", async () => {
  useTmpDb();
  const store = new FakeSettingsStore();
  const s = store.get();
  s.server.port = 4242;
  s.logging.level = "debug";
  store.set(s);
  appState.cfg.state = { settings: store };

  await dataAdmin.runFactoryReset();
  const after = store.get();
  expect(after.server.port).toBe(4242); // reachability survives
  expect(after.logging.level).toBe("info"); // everything else defaults
});

test("factory_reset_clears_file_stores", async () => {
  // Personas (and the other file-backed stores) must not survive a reset — user-hit
  // 2026-06-12: 'reset' brought every character back.
  useTmpDb();
  const dataDir = path.join(tmpPath(), "data");
  const personas = new PersonaStore(dataDir);
  personas.create("Mara", { voice_id: null });
  expect(personas.list().length).toBe(1);

  const state = { settings: new FakeSettingsStore(), dataDir, personas };
  appState.cfg.state = state;

  await dataAdmin.runFactoryReset();

  // The in-memory store was re-instantiated empty AND the files are gone.
  expect(state.personas.list()).toEqual([]);
  const pdir = path.join(dataDir, "personas");
  expect(existsSync(pdir) ? readdirSync(pdir).filter((n) => n.endsWith(".json")) : []).toEqual([]);
});

test("factory_reset_unloads_engines", async () => {
  // A fresh install has no engine resident — reset must unload the managed slots and drop
  // runtime-registered external providers (user-hit 2026-06-12: engine still showed loaded
  // after reset).
  useTmpDb();
  const unloaded = [];
  vi.spyOn(managerModule, "getManager").mockReturnValue({
    async unload(kind = null) {
      unloaded.push(kind);
      return { previous_engine: "kokoro" };
    },
  });
  const backend = {
    meta: { engineId: "ext-tts", displayName: "Ext", backend: "openai" },
    unloadCalled: false,
    ready: () => true,
    unload() {
      this.unloadCalled = true;
    },
  };
  const registry = new EngineRegistry();
  registry.register(backend);
  registry.setCurrent("ext-tts");
  const state = { settings: new FakeSettingsStore(), engines: registry };
  appState.cfg.state = state;

  await dataAdmin.runFactoryReset();

  expect(unloaded).toEqual([null]); // all managed slots unloaded
  expect(backend.unloadCalled).toBe(true);
  expect(state.engines).not.toBe(registry); // fresh, empty registry
  expect(state.engines.registeredIds()).toEqual([]);
  expect(state.engines.current()).toBeNull();
});
