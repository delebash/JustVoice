// SPDX-License-Identifier: MIT
// GET /v1/render/cache-stats — the Studio Render cache banner (the port of
// tests/test_render_cache_stats.py).
//
// Probes each block's render-cache key without rendering. The same pattern as
// render_chapter_scene_mode.test.js: a test database as the module's, a fake state. Python
// called the route function directly; here the route runs on a bare app holding the
// render_chapter router (render_helpers.js `viaRoutes`), and the unknown project's ApiError is
// its 404.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import { router as renderChapterRouter } from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { construct, Persona, utcNow } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import { tmpDb } from "./helpers.js";
import { viaRoutes } from "./render_helpers.js";

let h;
beforeEach(() => {
  h = tmpDb();
  session.cfg.handle = h;
});
afterEach(() => {
  session.cfg.handle = null;
  h.close();
  appState.cfg.state = null;
});

const persona = (pid, voiceId = "voice-1") => {
  const now = utcNow();
  return construct(Persona, { id: pid, name: `P ${pid}`, voice_id: voiceId, default_delivery: {}, created_at: now, updated_at: now });
};

const state = (personas) => ({ personas: { get: (pid) => personas[pid] ?? null } });

/** speaker_fixtures.speaker_played_by: this book's speaker played by `personaId`. */
function speakerPlayedBy(sceneId, personaId) {
  const projectId = h.get(Scene, sceneId).project_id;
  const id = uuid();
  h.insert(Speaker, { id, project_id: projectId, name: `Speaker ${personaId}`, persona_id: personaId });
  return id;
}

function seed(nBlocks = 3) {
  h.insert(Project, { id: "proj-1", name: "P", project_type: "audiobook" });
  h.insert(Scene, { id: "scene-1", project_id: "proj-1", position: 0, title: "Ch 1" });
  const sid = speakerPlayedBy("scene-1", "p1");
  for (let i = 0; i < nBlocks; i++) h.insert(Block, { scene_id: "scene-1", position: i, text: `line ${i}`, speaker_id: sid });
}

/** GET /v1/render/cache-stats?project_id=… → `[status, body]`. */
const cacheStats = (projectId) =>
  viaRoutes([renderChapterRouter], async (app) => {
    const r = await app.inject({ method: "GET", url: `/v1/render/cache-stats?project_id=${projectId}` });
    return [r.statusCode, JSON.parse(r.body)];
  });

test("cache_stats_counts_uncached_lines", async () => {
  seed(3);
  appState.cfg.state = state({ p1: persona("p1") });
  // Voice can't resolve to an engine in this barebones state → the probe answers no per line;
  // the endpoint must count them as not cached rather than crash.
  vi.spyOn(renderCore, "probeLineCached").mockResolvedValue(false);
  const [status, r] = await cacheStats("proj-1");
  expect(status).toBe(200);
  expect(r.total).toBe(3);
  expect(r.cached).toBe(0);
  expect(r.scenes[0].scene_id).toBe("scene-1");
  expect(r.scenes[0].total).toBe(3);
});

test("cache_stats_counts_cached_lines", async () => {
  seed(4);
  appState.cfg.state = state({ p1: persona("p1") });
  const hits = [true, true, true, false];
  vi.spyOn(renderCore, "probeLineCached").mockImplementation(async () => hits.shift());
  const [, r] = await cacheStats("proj-1");
  expect(r.total).toBe(4);
  expect(r.cached).toBe(3);
});

test("cache_stats_unknown_project_404s", async () => {
  const [status] = await cacheStats("nope");
  expect(status).toBe(404);
});

test("cache_stats_scene_less_project_is_empty_not_404", async () => {
  // A real project with nothing in it yet answers 200 with zero coverage. Home/Studio/Chapter
  // probe this on mount; only an unknown id is a 404.
  h.insert(Project, { id: "proj-empty", name: "Empty", project_type: "audiobook" });
  const [status, r] = await cacheStats("proj-empty");
  expect(status).toBe(200);
  expect(r.project_id).toBe("proj-empty");
  expect([r.total, r.cached, r.scenes]).toEqual([0, 0, []]);
});
