// SPDX-License-Identifier: MIT
// Test helpers for the render layer's suites (wave C): the fakes the Python render tests
// build again and again (_Cache, _FakeManifest, _FakeManager — the catalog and the kit's speech
// runtime since round E — the SimpleNamespace state),
// PyFloat-free views for assertions, and a small "book" — a project, a chapter, its lines, a
// speaker and a persona written straight to the database and stores.
//
// The routes the Python tests drove: POST /v1/blocks/{id}/render (takes_api), GET
// /v1/scenes/{id}/render_lines (render_lines_api) and PATCH /v1/blocks/{id} (projects_api —
// `patchLineOverride`, `patchMetadata`, `patchText`) are the real routes, served by a bare app
// holding just their routers (`viaRoutes`) over the test's own module state (`useState()`). The
// bare app reads bodies as the real app does (the kit's `installPyFloatBodies`), so a route sees
// what was sent (`c.get("sentBody")`) and a free field keeps Python's floats.
import { closeApp, createServer, installPyFloatBodies } from "@delebash/core/platform";
import { PyFloat, pyJsonParse } from "@delebash/core/platform/pyjson";
import { vi } from "vitest";
import { router as projectsRouter } from "../src/api/projects_api.js";
import { router as renderLinesRouter } from "../src/api/render_lines_api.js";
import { router as takesRouter } from "../src/api/takes_api.js";
import * as session from "../src/database/session.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as modelCatalog from "../src/engines/model_catalog.js";
import { EngineRegistry } from "../src/engines/registry.js";
import { inject } from "./helpers.js";

/** A value with every PyFloat read as its number (for toEqual). */
export function unwrap(v) {
  if (v instanceof PyFloat) return v.v;
  if (Array.isArray(v)) return v.map(unwrap);
  if (v instanceof Set) return new Set([...v].map(unwrap));
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, unwrap(x)]));
  if (v !== null && typeof v === "object" && !Buffer.isBuffer(v) && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  }
  return v;
}

/** The render cache's fake (`_Cache`). */
export class FakeCache {
  constructor() {
    this.d = new Map();
  }
  has(scope, key) {
    return this.d.has(`${scope}\u0000${key}`);
  }
  get(scope, key) {
    return this.d.get(`${scope}\u0000${key}`) ?? null;
  }
  put(scope, key, data) {
    this.d.set(`${scope}\u0000${key}`, data);
  }
}

/** `_FakeManifest` — the fields render_core and voice_model read off a manifest. */
export function fakeManifest(id, { tags = false, kind = "tts", staticVoices = [] } = {}) {
  return { id, kind, capabilities: { paralinguistic_tags: tags }, staticVoices };
}

/** `_FakeManager` — the engine catalog and the kit's speech runtime, faked: records each line
 * (`synths`) and the load it made when its engine wasn't the resident one (`loads`); a line answers
 * `pcm` at `rate`. */
export class FakeSpeech {
  constructor(manifests, { pcm = null, rate = 16000, current = {} } = {}) {
    this._m = new Map(Object.entries(manifests));
    this.loads = [];
    this.synths = [];
    this.current = { ...current };
    this.pcm = pcm ?? pcmOf(100, 0x0100); // b"\x00\x01" * 100
    this.rate = rate;
  }
  getManifest(id) {
    return this._m.get(id) ?? null;
  }
  manifests() {
    return new Map(this._m);
  }
  currentFor(kind) {
    return this.current[kind] ?? null;
  }
  /** One line (kit_speech.js `speak`): its engine's model loaded first when another is resident. */
  async speak(engineId, _versionId, body) {
    const kind = this._m.get(engineId)?.kind ?? "tts";
    if (this.current[kind] !== engineId) {
      this.loads.push([engineId, "auto"]);
      this.current[kind] = engineId;
    }
    this.synths.push([engineId, { ...body }]);
    return [this.pcm, { sample_rate: this.rate, channels: 1, is_wav_container: false }];
  }
}

/** Point the catalog (engines/model_catalog.js) and the speech runtime (kit_speech.js) at `fake`
 * for this test. */
export function useSpeech(fake) {
  vi.spyOn(modelCatalog, "getManifest").mockImplementation((id) => fake.getManifest(id));
  vi.spyOn(modelCatalog, "manifests").mockImplementation(() => fake.manifests());
  vi.spyOn(kitSpeech, "currentFor").mockImplementation((kind) => fake.currentFor(kind));
  vi.spyOn(kitSpeech, "currentVariantId").mockReturnValue(null);
  vi.spyOn(kitSpeech, "speak").mockImplementation((engineId, versionId, body) => fake.speak(engineId, versionId, body));
  return fake;
}

/** The SimpleNamespace state the render tests build. */
export function renderState({ cache = null, voices = null, lexicons = null, engines = null, enabled = null, textMax = 5000 } = {}) {
  const settings = {
    limits: { text_max_chars: textMax },
    cache: { enabled: enabled ?? cache !== null },
    generation: { max_chunk_chars: 800, crossfade_ms: 50 },
  };
  const st = {
    settings: { get: () => settings },
    engines: engines ?? new EngineRegistry(),
    voices: voices ?? { get: () => null },
    lexicons: lexicons ?? { get: () => null },
  };
  if (cache !== null) st._renderCache = cache;
  return st;
}

/** `n` copies of the 16-bit sample `v` (Python's `b"\x00\x10" * n` is 0x1000 = 4096). */
export const pcmOf = (n, v) => {
  const b = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) b.writeInt16LE(v, 2 * i);
  return b;
};

// ── the book shim ────────────────────────────────────────────────────────

const h = () => session.getDb();

/** A book with one chapter of `texts`, every line the Narrator's, played by a persona on
 * `voice` (Kokoro's af_heart) when `cast` — test_line_takes' `_book`, without the routes. */
export function book(st, texts, { cast = true, seed = null, voice = "af_heart", name = "Check" } = {}) {
  const pid = uuid();
  const sid = uuid();
  h().insert(Project, { id: pid, name, project_type: "audiobook" });
  h().insert(Scene, { id: sid, project_id: pid, position: 0, title: "One" });
  let persona = null;
  if (cast) {
    const dd = seed != null ? { models: { kokoro: { seed } } } : {};
    persona = st.personas.create("Warm narrator", { voice_id: voice, default_delivery: dd, language: "en-US" }).id;
  }
  const sp = uuid();
  h().insert(Speaker, { id: sp, project_id: pid, name: "Narrator", persona_id: persona });
  const blocks = texts.map((t, i) => {
    const id = uuid();
    h().insert(Block, { id, scene_id: sid, position: i, text: t, speaker_id: sp });
    return id;
  });
  return { pid, sid, blocks, persona, speaker: sp };
}

// ── the real routes, on a bare app ───────────────────────────────────────

export const TYPE_BASE = "https://justvoice.dev/errors/";

/**
 * `fn(app)` over a bare app holding only `routers` (Python's `FastAPI()` +
 * `include_router` + `install_error_handlers`). The routers read the module database and app
 * state at call time — the test's own (`useState()`, or `session.cfg.handle` +
 * `appState.cfg.state`). The app is closed afterwards.
 */
export async function viaRoutes(routers, fn) {
  const app = createServer({ typeBase: TYPE_BASE });
  installPyFloatBodies(app);
  for (const r of routers) app.route("/", r());
  try {
    return await fn(app);
  } finally {
    await closeApp(app);
  }
}

/** One request on a bare app holding `routers` → `{status, json(), content, headers}`. */
export async function routeCall(routers, method, url, json = undefined) {
  return viaRoutes(routers, async (app) => {
    const r = await inject(app, {
      method,
      url,
      ...(json !== undefined ? { payload: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
    });
    return { status: r.statusCode, headers: r.headers, text: r.body, content: r.rawPayload, json: () => JSON.parse(r.body) };
  });
}

/** POST /v1/blocks/{id}/render (takes_api): the production render, kept as the line's new ★
 * take → the take as the route answers it (`TakeResponse`). */
export async function renderBlock(_st, blockId, { newTake = false } = {}) {
  const r = await routeCall([takesRouter], "POST", `/v1/blocks/${blockId}/render`, { new_take: newTake });
  if (r.status !== 200) throw new Error(`render ${blockId}: ${r.status} ${r.text}`);
  return r.json();
}

/** PATCH /v1/blocks/{id} (projects_api) with `body` → the block as the route answers it
 * (`BlockResponse`). Throws `PATCH <id>: <status> <body>` when the route refuses. */
async function patchBlock(blockId, body) {
  const r = await routeCall([projectsRouter], "PATCH", `/v1/blocks/${blockId}`, body);
  if (r.status !== 200) throw new Error(`PATCH ${blockId}: ${r.status} ${r.text}`);
  return r.json();
}

/** PATCH /v1/blocks/{id} with `line_override`: merged into the metadata (a value sets, null
 * clears, a key left out is kept). A bad override is the route's 400 — thrown. */
export const patchLineOverride = (blockId, override) => patchBlock(blockId, { line_override: override });

/** PATCH /v1/blocks/{id} with `metadata` — the whole JSON replaced. */
export const patchMetadata = (blockId, metadata) => patchBlock(blockId, { metadata });

/** PATCH /v1/blocks/{id} with `text`. */
export const patchText = (blockId, text) => patchBlock(blockId, { text });

/** GET /v1/scenes/{id}/render_lines (render_lines_api). */
export async function lines(_st, sid) {
  const r = await routeCall([renderLinesRouter], "GET", `/v1/scenes/${sid}/render_lines`);
  if (r.status !== 200) throw new Error(`render_lines ${sid}: ${r.status} ${r.text}`);
  return r.json();
}
export const states = async (st, sid) => (await lines(st, sid)).lines.map((l) => l.state);

/** The block's metadata as stored. */
export const metaOf = (blockId) => pyJsonParse(h().get(Block, blockId).metadata_json || "{}");
