// SPDX-License-Identifier: MIT
// One pause between lines for Studio's Render, the export and ACX QC (decided 2026-09-29):
// Settings → generation.pause_between_lines_ms (the port of tests/test_pause_between_lines.py).
//
// Found on the walkthrough: Render joined lines with 250 ms (the request model's default) and
// export/QC with a hardcoded 600 ms, so The Keystone was 505 s auditioned and 522 s exported —
// what you heard was not what shipped.
//
// Python called the route function directly; here POST /v1/render_chapter runs on a bare app
// holding the render_chapter router (render_helpers.js `viaRoutes`). The route names its queue
// owner from the database (`_sceneOwner`), so the test opens one: Python's two route tests pass
// only after an earlier test in the run has initialized the database — run alone, they fail
// with "database not initialized" (measured 2026-10-08, pytest on this file alone).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import { router as renderChapterRouter } from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import * as session from "../src/database/session.js";
import { BetweenLines, ChapterLine, construct, GenerationSettings, Settings } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import * as synthScheduler from "../src/synth_scheduler.js";
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

test("the_default_is_600_ms_what_export_always_used", () => {
  expect(construct(GenerationSettings, {}).pause_between_lines_ms).toBe(600);
  expect(construct(BetweenLines, {}).silence_ms, "None = the setting").toBeNull();
});

function fakes(pauseMs) {
  const gaps = [];
  const settings = construct(Settings, {});
  settings.generation.pause_between_lines_ms = pauseMs;
  const state = { settings: { get: () => settings } };
  appState.cfg.state = state;
  const line = construct(ChapterLine, { voice: "v", text: "Hello." });
  vi.spyOn(renderChapterApi, "_resolveSceneToLines").mockResolvedValue([line, line]);
  vi.spyOn(renderCore, "renderLine").mockResolvedValue({});
  vi.spyOn(synthScheduler, "warmLines").mockResolvedValue(undefined);
  vi.spyOn(renderCore, "concatLines").mockImplementation(async (_rendered, silenceMs) => {
    gaps.push(silenceMs);
    return {};
  });
  vi.spyOn(renderChapterApi, "_masterScenePcm").mockImplementation(async (_c, t) => [Buffer.from("RIFF"), t, null]);
  vi.spyOn(renderChapterApi, "_sceneMasterTarget").mockReturnValue([null, "none"]);
  return gaps;
}

/** POST /v1/render_chapter with `body`. */
const renderChapter = (body) =>
  viaRoutes([renderChapterRouter], async (app) => {
    const r = await app.inject({ method: "POST", url: "/v1/render_chapter", payload: body });
    expect(r.statusCode, r.body).toBe(200);
  });

test("render_export_and_qc_use_the_same_setting", async () => {
  const gaps = fakes(777);
  // Studio's Render (scene mode, no gap in the request).
  await renderChapter({ scene_id: "s1" });
  // Export and ACX QC.
  await renderChapterApi.renderSceneToWav(appState.getState(), "s1", { master: false });
  expect(gaps).toEqual([777, 777]);
});

test("a_caller_that_sends_a_gap_still_gets_it", async () => {
  const gaps = fakes(777);
  await renderChapter({ scene_id: "s1", between_lines: { silence_ms: 120 } });
  expect(gaps).toEqual([120]);
});
