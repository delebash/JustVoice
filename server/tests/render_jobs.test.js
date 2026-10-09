// SPDX-License-Identifier: MIT
// Render jobs (Stage 2, 2026-08-08) — the RenderJob/RenderJobBlock orchestrator over the
// SynthScheduler (the port of tests/test_render_jobs.py).
//
// Pins: a job renders every block and persists Generation + default Take per block; a failing
// block is ISOLATED (the rest keep rendering); resume re-runs only unfinished blocks; cancel
// withdraws queued blocks at the line boundary; the boot sweep pauses interrupted jobs.
//
// test_api_roundtrip drives the routes on a bare app holding the render_jobs router, as Python's
// minimal FastAPI app did (render_helpers.js `viaRoutes`). Python's threads are async tasks:
// `_waitTerminal` polls with a short sleep.
import { existsSync } from "node:fs";
import { AsyncEvent, sleep } from "@delebash/llm-runner/platform/asyncutil";
import { ValueError } from "@delebash/llm-runner/platform/py";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import { router as renderJobsRouter } from "../src/api/render_jobs_api.js";
import * as appState from "../src/app_state.js";
import * as session from "../src/database/session.js";
import { Block, Generation, Project, RenderJob, RenderJobBlock, Scene, Speaker, Take, uuid } from "../src/database/models.js";
import * as manager from "../src/engines/manager.js";
import * as exportVoicelines from "../src/export_voicelines.js";
import { mediaFile } from "../src/media_paths.js";
import { RenderedLine } from "../src/render_core.js";
import * as renderJobs from "../src/render_jobs.js";
import { getScheduler, workOwner } from "../src/synth_scheduler.js";
import * as voiceModel from "../src/voice_model.js";
import { inject, tmpDb, tmpPath } from "./helpers.js";
import { viaRoutes } from "./render_helpers.js";

const TERMINAL = ["completed", "failed", "cancelled"];

const fakeState = (dataDir) => ({
  personas: { get: () => null },
  engines: { current: () => "fake-engine" },
  voices: { get: () => null },
  dataDir,
});

/** A rendered line as renderBlockTake returns it (Slice 4): audio, the seed and inputs key it
 * was made from. */
const line = (seed = null) =>
  new RenderedLine({ pcm: Buffer.alloc(100), sampleRate: 24000, channels: 1, effectiveDelivery: {}, inputsKey: "key-1", seed });

let h;
beforeEach(() => {
  // job_env: render_jobs on the test DB + a fake app state (with a data folder, where a take's
  // audio is kept).
  h = tmpDb();
  session.cfg.handle = h;
  appState.cfg.state = fakeState(tmpPath());
  // The worker's idle transition re-probes the resident engine's memory; nothing is resident.
  vi.spyOn(manager, "getManager").mockReturnValue({ bumpEngineReservation: async () => {} });
});

afterEach(async () => {
  // Let a runner that is still finishing settle before its database goes.
  for (let i = 0; i < 100 && renderJobs._running.size; i++) await sleep(10);
  session.cfg.handle = null;
  h.close();
  appState.cfg.state = null;
});

function seedProject(texts) {
  const pid = uuid();
  const sid = uuid();
  h.insert(Project, { id: pid, name: "Game", project_type: "game_voicelines" });
  h.insert(Scene, { id: sid, project_id: pid, position: 0 });
  const ids = texts.map((text, i) => {
    const id = uuid();
    h.insert(Block, { id, scene_id: sid, position: i, text });
    return id;
  });
  return [pid, sid, ids];
}

async function waitTerminal(jobId, timeout = 10) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout * 1000) {
    const s = renderJobs.jobStatus(jobId);
    if (s && TERMINAL.includes(s.status)) return s;
    await sleep(5);
  }
  throw new Error(`job never finished: ${JSON.stringify(renderJobs.jobStatus(jobId))}`);
}

const fakeRender = (fn) => vi.spyOn(exportVoicelines, "renderBlockTake").mockImplementation(fn);

test("job_completes_and_persists_takes", async () => {
  const [projectId, , blockIds] = seedProject(["Line one.", "Line two."]);
  fakeRender(async () => line(7));
  const job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");
  expect(s.completed_blocks).toBe(2);
  expect(s.failed_blocks).toBe(0);

  const detail = renderJobs.jobStatus(job.id, { includeBlocks: true });
  expect(detail.blocks.every((b) => b.status === "completed")).toBe(true);
  expect(detail.blocks.every((b) => b.generation_id)).toBe(true);

  const gens = h.all(`select * from ${Generation}`, [], Generation);
  expect(gens.length).toBe(2);
  expect(new Set(gens.map((g) => g.source))).toEqual(new Set(["chapter_render"]));
  expect(new Set(gens.map((g) => g.engine))).toEqual(new Set(["fake-engine"]));
  expect(h.count(Take)).toBe(2);
  // A take keeps its audio, its seed and what it was made from, and its real length (Slice 4)
  // — 50 frames at 24 kHz, not a 16 kHz guess.
  for (const g of gens) {
    expect(g.audio_path && existsSync(mediaFile(g.audio_path))).toBe(true);
    expect(g.seed).toBe(7);
    expect(g.cache_key).toBe("key-1");
    expect(g.duration_sec).toBe(Math.round((50 / 24000) * 1000) / 1000);
  }
});

test("a_new_take_is_the_only_star", async () => {
  // Rendering a line again keeps the old take and makes the new one ★ — the old default is
  // cleared (it wasn't before Slice 4).
  const [projectId, , blockIds] = seedProject(["Line one."]);
  fakeRender(async () => line());
  for (let i = 0; i < 2; i++) {
    const job = renderJobs.createJob(projectId, "blocks", blockIds);
    renderJobs.startJob(job.id);
    await waitTerminal(job.id);
  }
  const takes = h.all(`select * from ${Take} where block_id = ?`, [blockIds[0]], Take);
  expect(takes.length).toBe(2);
  expect(takes.filter((t) => t.is_default).length).toBe(1);
});

test("a_fresh_job_renders_past_the_cache", async () => {
  // ↻ Re-render all is a job made with `fresh`: every block renders with useCache false.
  const [projectId, , blockIds] = seedProject(["Line one."]);
  const seen = [];
  fakeRender(async (st, p, b, kw) => {
    seen.push(kw);
    return line();
  });
  const job = renderJobs.createJob(projectId, "blocks", blockIds, { fresh: true });
  renderJobs.startJob(job.id);
  await waitTerminal(job.id);
  expect(seen).toEqual([{ useCache: false }]);
});

test("failed_block_is_isolated", async () => {
  const [projectId, , blockIds] = seedProject(["Fine.", "BOOM"]);
  fakeRender(async (st, persona, block) => {
    if (block.text === "BOOM") throw new Error("engine exploded");
    return line();
  });
  const job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  const s = await waitTerminal(job.id);
  // The failure did NOT stop the other block.
  expect(s.status).toBe("completed");
  expect(s.completed_blocks).toBe(1);
  expect(s.failed_blocks).toBe(1);
  const detail = renderJobs.jobStatus(job.id, { includeBlocks: true });
  expect(new Set(detail.blocks.map((b) => b.status))).toEqual(new Set(["completed", "failed"]));
});

test("resume_reruns_only_unfinished_blocks", async () => {
  const [projectId, , blockIds] = seedProject(["Fine.", "BOOM"]);
  const calls = [];
  fakeRender(async (st, persona, block) => {
    calls.push(block.text);
    if (block.text === "BOOM" && calls.filter((c) => c === "BOOM").length === 1) throw new Error("first attempt fails");
    return line();
  });
  const job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  let s = await waitTerminal(job.id);
  expect(s.failed_blocks).toBe(1);

  renderJobs.resumeJob(job.id);
  s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");
  expect(s.completed_blocks).toBe(2);
  expect(s.failed_blocks).toBe(0);
  // The already-completed block was NOT re-rendered on resume.
  expect(calls.filter((c) => c === "Fine.").length).toBe(1);
  expect(h.count(Generation)).toBe(2);
});

test("cancel_withdraws_queued_blocks", async () => {
  const [projectId, , blockIds] = seedProject(["One.", "Two.", "Three."]);
  const entered = new AsyncEvent();
  const release = new AsyncEvent();
  fakeRender(async () => {
    entered.set();
    await release.wait(5000);
    return line();
  });
  const job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  expect(await entered.wait(5000)).toBe(true);
  renderJobs.cancelJob(job.id);
  release.set();
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("cancelled");
  expect(s.completed_blocks).toBeLessThanOrEqual(1);
  const detail = renderJobs.jobStatus(job.id, { includeBlocks: true });
  const statuses = detail.blocks.map((b) => b.status);
  expect(statuses.filter((x) => x === "pending").length).toBeGreaterThanOrEqual(2); // withdrawn, resume picks them up
});

test("boot_sweep_pauses_interrupted_jobs", () => {
  const [projectId] = seedProject(["One."]);
  h.insert(RenderJob, { project_id: projectId, scope: "project", status: "running" });
  expect(renderJobs.sweepStaleJobs()).toBe(1);
  expect(h.one(`select * from ${RenderJob}`, [], RenderJob).status).toBe("paused");
});

test("empty_scope_completes_immediately", () => {
  const pid = uuid();
  h.insert(Project, { id: pid, name: "Empty", project_type: "game_voicelines" });
  const job = renderJobs.createJob(pid, "project", []);
  expect(job.status).toBe("completed");
  expect(job.total_blocks || 0).toBe(0);
});

test("api_roundtrip", async () => {
  const [projectId, , blockIds] = seedProject(["One.", "Two."]);
  fakeRender(async () => line());
  await viaRoutes([renderJobsRouter], async (app) => {
    const call = async (method, url, json) => {
      const r = await inject(app, { method, url, ...(json !== undefined ? { payload: json } : {}) });
      return { status: r.statusCode, json: () => JSON.parse(r.body) };
    };
    let r = await call("POST", "/v1/render_jobs", { project_id: projectId, scope: "blocks", scope_ids: blockIds });
    expect(r.status).toBe(200);
    const jobId = r.json().id;

    const t0 = Date.now();
    let body = r.json();
    while (!TERMINAL.includes(body.status) && Date.now() - t0 < 10000) {
      await sleep(5);
      body = (await call("GET", `/v1/render_jobs/${jobId}`)).json();
    }
    // Always re-fetch WITH blocks — the job may already have been terminal in the POST
    // response, which carries no blocks list.
    body = (await call("GET", `/v1/render_jobs/${jobId}?include_blocks=true`)).json();
    expect(body.status).toBe("completed");
    expect(body.completed_blocks).toBe(2);
    expect(body.blocks.length).toBe(2);

    // Validation: scene/blocks scope requires ids.
    r = await call("POST", "/v1/render_jobs", { project_id: projectId, scope: "blocks" });
    expect(r.status).toBe(400);
    // Unknown job → 404.
    expect((await call("GET", "/v1/render_jobs/nope")).status).toBe(404);
  });
});

test("unknown_block_ids_reject", () => {
  const [projectId, , blockIds] = seedProject(["One."]);
  expect(() => renderJobs.createJob(projectId, "blocks", [blockIds[0], "ghost-id"])).toThrow(ValueError);
  expect(h.count(RenderJobBlock)).toBe(0);
});

test("a_line_reads_rendering_while_it_renders", async () => {
  // Render's progress (decided 2026-10-07): the line rendering now is marked running, named by
  // its number in the chapter and its speaker; once the run ends nothing is current and the
  // audio the lines made adds up.
  const [projectId, , blockIds] = seedProject(["Line one.", "Line two."]);
  const sp = uuid();
  h.insert(Speaker, { id: sp, project_id: projectId, name: "Narrator" });
  for (const id of blockIds) h.update(Block, { speaker_id: sp }, { id });

  const seen = {};
  let job;
  fakeRender(async (st, p, b) => {
    seen[b.id] = renderJobs.jobStatus(job.id, { includeBlocks: true });
    return line();
  });
  job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");

  blockIds.forEach((bid, i) => {
    const during = seen[bid];
    expect(Object.fromEntries(during.blocks.map((b) => [b.block_id, b.status]))[bid]).toBe("running");
    expect(during.current[0]).toEqual({ block_id: bid, n: i + 1, speaker: "Narrator" });
  });
  expect(s.current).toEqual([]);
  expect(s.audio_seconds).toBe(Math.round(((2 * 50) / 24000) * 100) / 100);
});

test("a_waiting_job_says_what_is_ahead", async () => {
  // Render's "waiting — the M4B export is rendering 1 line first" (decided 2026-10-07): while
  // other work holds the queue and none of the job's lines has started, its status names that
  // work; once its lines run, it says nothing.
  const [projectId, , blockIds] = seedProject(["Line one."]);
  fakeRender(async () => line());
  const gate = new AsyncEvent();
  const started = new AsyncEvent();
  getScheduler().submit(
    [
      [
        "?gate",
        async () => {
          started.set();
          await gate.wait(10000);
        },
      ],
    ],
    { owner: workOwner("the M4B export") },
  );
  expect(await started.wait(5000)).toBe(true);
  let job;
  try {
    job = renderJobs.createJob(projectId, "blocks", blockIds);
    renderJobs.startJob(job.id);
    const t0 = Date.now();
    while (!renderJobs._liveHandles.get(job.id) && Date.now() - t0 < 5000) await sleep(10);
    expect(renderJobs.jobStatus(job.id).waiting).toEqual({
      lines: 1,
      groups: [{ label: "the M4B export", kind: "work", model: null, lines: 1 }],
    });
  } finally {
    gate.set();
  }
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");
  expect(s.waiting).toBeNull();
});

test("a_deleted_line_is_skipped_not_rendered", async () => {
  // Deleting a book, a chapter or a line takes its job rows with it (the database's cascade;
  // this test DB doesn't enforce it, so the test deletes them). The queue then skips that line
  // instead of rendering it and failing to save it (decided 2026-10-07).
  const [projectId, , blockIds] = seedProject(["Kept.", "Deleted."]);
  const rendered = [];
  fakeRender(async (st, p, b) => {
    rendered.push(b.id);
    return line();
  });
  const gate = new AsyncEvent();
  const started = new AsyncEvent();
  getScheduler().submit(
    [
      [
        "?gate",
        async () => {
          started.set();
          await gate.wait(10000);
        },
      ],
    ],
    { owner: workOwner("other work") },
  );
  expect(await started.wait(5000)).toBe(true);
  let job;
  try {
    job = renderJobs.createJob(projectId, "blocks", blockIds);
    renderJobs.startJob(job.id);
    const t0 = Date.now();
    while (!renderJobs._liveHandles.get(job.id) && Date.now() - t0 < 5000) await sleep(10);
    h.delete(RenderJobBlock, { block_id: blockIds[1] });
    h.delete(Block, { id: blockIds[1] });
  } finally {
    gate.set();
  }
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");
  expect(rendered).toEqual([blockIds[0]]);
});

test("a_line_loading_its_model_says_so", async () => {
  // Render's "loading Qwen3-TTS CustomVoice — 8 s" (decided 2026-10-07): while the line rendering
  // now loads its model, the job carries the model and how long; once the run ends it carries
  // nothing.
  const [projectId, , blockIds] = seedProject(["Line one."]);
  const seen = {};
  let job;
  fakeRender(async () => {
    await voiceModel._notingLoad("qwen3", "qwen3-customvoice", async () => {
      seen.during = renderJobs.jobStatus(job.id);
    });
    return line();
  });
  job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  const s = await waitTerminal(job.id);
  const loading = seen.during.loading;
  expect(Boolean(loading.model)).toBe(true);
  expect(loading.seconds).toBeGreaterThanOrEqual(0);
  expect(s.loading).toBeNull();
});

test("a_line_deleted_while_it_renders_is_not_saved", async () => {
  // The line in flight when its book is deleted finishes, and is dropped quietly instead of
  // failing to save (2026-10-07).
  const [projectId, , blockIds] = seedProject(["Deleted mid-render."]);
  fakeRender(async (st, p, b) => {
    h.delete(RenderJobBlock, { block_id: b.id });
    h.delete(Block, { id: b.id });
    return line();
  });
  const saved = [];
  vi.spyOn(renderJobs, "persistBlockTake").mockImplementation((...a) => saved.push(a));
  const job = renderJobs.createJob(projectId, "blocks", blockIds);
  renderJobs.startJob(job.id);
  const s = await waitTerminal(job.id);
  expect(s.status).toBe("completed");
  expect(saved).toEqual([]);
});
