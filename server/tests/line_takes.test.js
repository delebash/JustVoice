// SPDX-License-Identifier: MIT
// Studio Slice 4 (decided 2026-10-04; docs/plans/2026-10-04-slice-4-render.md) — a line's takes
// and its state (the port of tests/test_line_takes.py).
//
// Pins: a line's state in §8.16's words; a take keeps its audio and what it was made from; the
// line's own numbers make it stale and win over the persona (G7); ↻ New take keeps its own seed
// (G1); the chapter, its captions and the game export play the ★ take (D4).
//
// Python drove these through the app's endpoints. Here the render routes are the real ones
// (POST /v1/blocks/{id}/render, GET /v1/scenes/{id}/render_lines, the render jobs, POST
// /v1/projects/{id}/lexicon) on a bare app over the test's state (render_helpers.js
// `viaRoutes`); PATCH /v1/blocks/{id} is still render_helpers.js's shim and the book is written
// straight to the database and stores — projects_api (POST /v1/projects, /scenes, /blocks,
// /speakers, DELETE /v1/scenes/{id}) is API agent 3's. Not ported here, waiting for it:
// test_a_takes_audio_goes_with_it (its last step deletes the chapter through DELETE
// /v1/scenes/{id}) and test_deleting_a_chapter_closes_the_gap: test.todo.
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import { endState, useState } from "./engines_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import { router as renderJobsRouter } from "../src/api/render_jobs_api.js";
import { router as renderLinesRouter } from "../src/api/render_lines_api.js";
import * as session from "../src/database/session.js";
import { Project, Take, uuid } from "../src/database/models.js";
import { exportVoicelines } from "../src/export_voicelines.js";
import { mediaFile } from "../src/media_paths.js";
import * as renderCore from "../src/render_core.js";
import { lineInputsKey, RenderedLine } from "../src/render_core.js";
import { ZipReader } from "@delebash/llm-runner/platform/zip";
import { book, lines, metaOf, patchLineOverride, patchMetadata, patchText, renderBlock, states, unwrap, viaRoutes } from "./render_helpers.js";
import * as renderJobs from "../src/render_jobs.js";

let st;
let calls;
beforeEach(() => {
  st = useState();
  // fake_speech: the speech model, faked — a short sound that records the real inputs key, so a
  // take reads "rendered" until something it was made from changes. Its length follows the
  // text, so a take's words can be told apart.
  calls = [];
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    const { voice, text, ...rest } = kw;
    calls.push({ text, ...rest });
    const key = await lineInputsKey(s, voice, text, {
      language: kw.language,
      delivery: kw.delivery,
      seed: kw.seed,
      lexicons: kw.lexicons,
      effects: kw.effects,
    });
    const pcm = Buffer.alloc(2 * 100 * [...text].length);
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(1, i);
    return new RenderedLine({
      pcm,
      sampleRate: 16000,
      channels: 1,
      effectiveDelivery: { ...(kw.delivery || {}) },
      inputsKey: key || "",
      seed: kw.seed ?? null,
    });
  });
});
afterEach(() => endState());

const h = () => session.getDb();

test("a_line_states_its_state", async () => {
  // A line nobody says (no speaker).
  const nobody = book(st, ["Nobody says this."], { cast: false });
  h().update("blocks", { speaker_id: null }, { id: nobody.blocks[0] });
  expect(await states(st, nobody.sid)).toEqual(["needs a speaker"]);

  const uncast = book(st, ["Uncast."], { cast: false });
  expect(await states(st, uncast.sid)).toEqual(["needs a voice"]);

  const b = book(st, ["Cast."]);
  expect(await states(st, b.sid)).toEqual(["ready"]);
  await renderBlock(st, b.blocks[0]);
  const page = await lines(st, b.sid);
  expect(page.lines.map((l) => l.state)).toEqual(["rendered"]);
  expect(page.counts).toEqual({ lines: 1, needs_speaker: 0, needs_voice: 0, ready: 0, rendered: 1, stale: 0 });
  const live = page.lines[0].live;
  // GET live.audio_url serves the take's file (the API wave's route): the file is there.
  expect(live.audio_url).toBe(`/v1/generations/${live.generation_id}/audio`);
  const gen = h().get("generations", live.generation_id);
  expect(existsSync(mediaFile(gen.audio_path))).toBe(true);
});

test("what_makes_a_line_stale", async () => {
  const b = book(st, ["One.", "Two.", "Three."]);
  const [b0, b1, b2] = b.blocks;
  for (const id of b.blocks) await renderBlock(st, id);
  expect(await states(st, b.sid)).toEqual(["rendered", "rendered", "rendered"]);
  patchLineOverride(b0, { speed: 1.2 }); // its own numbers
  patchText(b1, "Two, changed."); // its words
  expect(await states(st, b.sid)).toEqual(["stale", "stale", "rendered"]);
  st.personas.update(b.persona, { default_delivery: { gain_db: 3 } }); // its persona
  expect(await states(st, b.sid)).toEqual(["stale", "stale", "stale"]);
  // Rendering again is the user's choice; it makes a new ★ take and keeps the old one.
  const take = await renderBlock(st, b2);
  const page = await lines(st, b.sid);
  expect(page.lines[2].state).toBe("rendered");
  expect(page.lines[2].takes).toBe(2);
  expect(take.is_default).toBe(true);
  expect(h().all(`select * from ${Take} where block_id = ?`, [b2], Take).filter((t) => t.is_default).length).toBe(1);
});

test("the_line_override_merges_and_is_checked", async () => {
  const b = book(st, ["One."]);
  const [b0] = b.blocks;
  patchMetadata(b0, { source_ref: "L1" });
  patchLineOverride(b0, { speed: 1.1, pause_after_ms: 900 });
  patchLineOverride(b0, { speed: null, pitch: -2 });
  const line = (await lines(st, b.sid)).lines[0];
  expect(unwrap(line.override)).toEqual({ pitch: -2.0, pause_after_ms: 900.0 });
  expect(metaOf(b0).source_ref).toBe("L1"); // the rest of the metadata is kept
  for (const bad of [{ speed: 5 }, { pause_after_ms: -1 }, { volume: 2 }]) {
    expect(() => patchLineOverride(b0, bad), JSON.stringify(bad)).toThrow(); // the route's 400
  }
});

test("the_lines_own_pause_wins_over_the_personas", async () => {
  // G7 (2026-10-04): a line's pause — the ⚙ hatch's or an import's — wins.
  const b = book(st, ["One."]);
  st.personas.update(b.persona, { default_delivery: { pause_after: 300 } });
  expect((await renderChapterApi._resolveSceneToLines(b.sid, st))[0].delivery.pause_after).toBe(300);
  patchLineOverride(b.blocks[0], { pause_after_ms: 1200 });
  expect((await renderChapterApi._resolveSceneToLines(b.sid, st))[0].delivery.pause_after).toBe(1200);
});

test("a_new_take_keeps_its_own_seed", async () => {
  // G1: ↻ New take rolls a seed and is judged against it; a take made with the persona's seed
  // goes stale when that seed changes.
  const b = book(st, ["One.", "Two."], { seed: 11 });
  const [b0, b1] = b.blocks;
  await renderBlock(st, b0);
  const rolled = await renderBlock(st, b1, { newTake: true });
  expect(rolled.new_seed).toBe(true);
  expect([null, 11]).not.toContain(calls.at(-1).seed);
  expect(await states(st, b.sid)).toEqual(["rendered", "rendered"]);
  st.personas.update(b.persona, { default_delivery: { models: { kokoro: { seed: 12 } } } });
  expect(await states(st, b.sid)).toEqual(["stale", "rendered"]);
});

test("the_chapter_plays_the_star_take", async () => {
  // D4: the chapter plays each line's ★ take — a stale one too, with its own words in the
  // captions — and renders only the lines with none.
  const b = book(st, ["Take me.", "No take."]);
  const [b0] = b.blocks;
  await renderBlock(st, b0);
  patchText(b0, "Take me, changed.");
  calls.length = 0;
  const ls = await renderChapterApi._resolveSceneToLines(b.sid, st);
  const kwargs = ls.map((line) => renderChapterApi._lineKwargs(line, `scene:${b.sid}`));
  const out = await renderChapterApi.renderSceneLines(st, ls, kwargs);
  expect(calls.map((c) => c.text)).toEqual(["No take."]); // only the line with no take rendered
  expect(out[0].pcm.length).toBe(2 * 100 * "Take me.".length); // the take's audio, its old words
  expect(renderChapterApi.playedTexts(ls)).toEqual(["Take me.", "No take."]);
  expect(await states(st, b.sid)).toEqual(["stale", "ready"]); // playing it rendered nothing new
});

const inject = async (app, method, url, json) => {
  const r = await app.inject({
    method,
    url,
    ...(json !== undefined ? { payload: JSON.stringify(json), headers: { "content-type": "application/json" } } : {}),
  });
  return { status: r.statusCode, json: () => JSON.parse(r.body), text: r.body };
};

test("render_lines_job_gives_the_ready_lines_takes", async () => {
  const b = book(st, ["One.", "Two."]);
  await viaRoutes([renderLinesRouter, renderJobsRouter], async (app) => {
    let job = (await inject(app, "POST", `/v1/scenes/${b.sid}/render_lines`, { which: "ready" })).json();
    expect(job.total_blocks).toBe(2);
    for (let i = 0; i < 200; i++) {
      if (["completed", "failed", "cancelled"].includes(job.status)) break;
      await sleep(50);
      job = (await inject(app, "GET", `/v1/render_jobs/${job.id}`)).json();
    }
    expect(job.status === "completed" && job.completed_blocks === 2).toBe(true);
    // Let the runner finish its bookkeeping before the next reads.
    for (let i = 0; i < 100 && renderJobs._running.size; i++) await sleep(10);
    expect(await states(st, b.sid)).toEqual(["rendered", "rendered"]);
    const again = (await inject(app, "POST", `/v1/scenes/${b.sid}/render_lines`, { which: "ready" })).json();
    expect(again.total_blocks === 0 && again.status === "completed").toBe(true);
    const state = (await inject(app, "GET", `/v1/projects/${b.pid}/render_state`)).json();
    expect(state.totals.rendered === 2 && state.chapters[0].scene_id === b.sid).toBe(true);
  });
});

test.todo("a_takes_audio_goes_with_it — waits for api/projects_api.js (DELETE /v1/scenes/{id})");
test.todo("deleting_a_chapter_closes_the_gap — waits for api/projects_api.js");

test("the_books_lexicon_is_made_once", async () => {
  // (POST /v1/projects is projects_api's: the book is written straight to the database.)
  const pid = uuid();
  h().insert(Project, { id: pid, name: "Stillness", project_type: "audiobook" });
  const first = await viaRoutes([renderLinesRouter], async (app) => {
    const one = (await inject(app, "POST", `/v1/projects/${pid}/lexicon`)).json();
    const again = (await inject(app, "POST", `/v1/projects/${pid}/lexicon`)).json();
    expect(one.created === true && one.name === "Stillness names").toBe(true);
    expect(again).toEqual({ ...one, created: false });
    return one;
  });
  expect(h().get(Project, pid).default_lexicon_id).toBe(first.lexicon_id);
});

test("the_game_export_ships_the_star_take", async () => {
  const b = book(st, ["Halt.", "Pass."]);
  const [b0] = b.blocks;
  await renderBlock(st, b0);
  patchText(b0, "Halt, changed.");
  calls.length = 0;
  const z = ZipReader.fromBuffer(await exportVoicelines(st, b.pid));
  const manifest = JSON.parse(z.read("manifest.json").toString("utf8"));
  expect(manifest.map((m) => m.text)).toEqual(["Halt.", "Pass."]); // the take's words ship
  expect(calls.map((c) => c.text)).toEqual(["Pass."]); // only the line with no take rendered
});
