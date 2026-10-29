// SPDX-License-Identifier: MIT
// The book's exports as jobs the Export panel follows (decided 2026-10-07) (the port of
// justvoice/api/export_jobs_api.py).
//
// `POST /v1/projects/{id}/export_m4b` renders and masters every chapter, then encodes the book,
// and answers only at the end — minutes with nothing to show. These are the same work, reported
// as it goes: start one (202 with the job), follow it ("Rendering line 12 of 340" while the lines
// with no take are rendered, then chapter 2 of 4, then "Encoding the book"), cancel it, then fetch
// the file.
//
// The jobs are the kit's job registry (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4
// step 6, §5 item 13 — platform/jobs.js JobRegistry): following one and its Cancel are the kit's
// routes, GET and DELETE /v1/jobs/:id (makeJobsRouter, mounted in app.js), the screen's side the
// kit's runServerJob (src/services/exportRun.js). A job's step is its `message`; its own fields
// (`data`) are the step's `done` and `total`, the file's `filename` and its `note`; its `progress`
// the share of the work done — every line to render, every chapter, the encode, each one step.
// One export of a kind runs per book: a second start answers the running one. The finished file
// is JustVoice's to hand over (GET /v1/export_jobs/:id/file, once); it goes with its job — once
// fetched, or when the registry forgets a job nobody fetched (its `onForget`).
//
// The job's signal (the registry's AbortController, 2026-10-13, the narrowings review R2 and R4):
// Cancel and deleting its book abort it. The render phase passes it to the scheduler, which
// withdraws the lines still waiting (the line rendering finishes); the chapters check it between
// chapters.
//
// * M4B — the book, one file with chapter marks.
// * Chapter audio — a zip of each chapter joined (`chapters/NN Title.wav`) and mastered to the
//   book's target (`masters/NN Title.wav`); without ffmpeg, the chapters only, the job's `note`
//   saying so. The package itself (`GET /v1/projects/{id}/export`) is Overview's, and stays as
//   it is.
//
// Jobs live in memory (the registry's) and a finished file in the temp folder until it is fetched;
// the old M4B door stays for anything that calls it directly. The book's one-click run (book_run.js)
// starts, follows and cancels its M4B through `startM4bExport`, `exportJob` and `cancelExportJob`.

import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { attachment, Hono, JobRegistry } from "@delebash/core/platform";
import { safeTitle } from "@delebash/core/platform/filename";
import { ZipWriter } from "@delebash/core/platform/zip";
import { getState } from "../app_state.js";
import { Project } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import * as exportAudiobook from "../export_audiobook.js";
import * as synthScheduler from "../synth_scheduler.js";
import { m4bAuthor } from "./projects_api.js";
import * as renderChapterApi from "./render_chapter_api.js";

/** A started export's own record, by its job's id — `{projectId, filename, mediaType, note, path,
 * fetched}`: its file once made, and whether the file route is handing it over. Gone with its job. */
const _exports = new Map();

const removeTemp = (p) => rmSync(path.dirname(p), { recursive: true, force: true });

/** The export jobs — the kit's registry. A finished job stays until its file is fetched (the
 * book's one-click run keeps its M4B waiting to be saved): no sweep (`keepMs` Infinity). Forgotten,
 * its file goes with it — unless the file route is handing it over, which removes it once sent. */
export const jobs = new JobRegistry({
  keepMs: Number.POSITIVE_INFINITY,
  onForget: (job) => {
    const e = _exports.get(job.id);
    _exports.delete(job.id);
    if (e?.path && !e.fetched) removeTemp(e.path);
  },
});

const KIND = { m4b: "export-m4b", chapters: "export-chapters" };

/** The chapter zip's note without ffmpeg (the user's words, 2026-10-15). */
export const NO_MASTERS = "No masters — ffmpeg isn't installed, so the zip holds the chapter WAVs only.";

/** What a job says as it goes: its step's words (`message`), the step's done and total (its own
 * fields), and its share of the work — every line to render, every chapter, the M4B's encode, one
 * step each (the registry's progress only grows; each step's own count restarts). */
class Steps {
  constructor(ctx, { chapters, encode }) {
    Object.assign(this, { ctx, lines: 0, linesDone: 0, chapters, chaptersDone: 0, encode: encode ? 1 : 0, encoded: 0 });
  }
  say(message, done, total) {
    const all = this.lines + this.chapters + this.encode;
    this.ctx.update({ done, total });
    this.ctx.progress(all ? (this.linesDone + this.chaptersDone + this.encoded) / all : 0, message);
  }
  chapter(i, n, scene, total = n) {
    this.ctx.signal.throwIfAborted();
    Object.assign(this, { chapters: n, chaptersDone: i });
    this.say(`Chapter ${i + 1} of ${n} · ${scene.title || `Chapter ${scene.position + 1}`}`, i, total);
  }
}

/** The render phase: the lines with no take in use, counted on the job as they land. */
async function _warm(projectId, kind, steps) {
  const st = getState();
  const { signal } = steps.ctx;
  const what = kind === "m4b" ? "the M4B export" : "the chapter WAVs export";
  await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), {
    owner: synthScheduler.workOwner(what),
    signal,
    onProgress: (done, total) => {
      // The line rendering when the job was cancelled still lands; it must not write over the
      // cancel (2026-10-13, the implementation review's problem 17).
      if (signal.aborted) return;
      Object.assign(steps, { lines: total, linesDone: done });
      steps.say(`Rendering line ${Math.min(done + 1, total)} of ${total}`, done, total);
    },
  });
  signal.throwIfAborted();
}

/** `tempfile.mkstemp(prefix="jv-export-", suffix=…)` — a file of its own, in a folder of its
 * own (removed with it). */
function tempFile(suffix) {
  const dir = mkdtempSync(path.join(tmpdir(), "jv-export-"));
  return path.join(dir, `export${suffix}`);
}

async function _m4b(steps, projectId, name, author) {
  // every chapter, then the encode
  const progress = (i, n, scene) => steps.chapter(i, n, scene, n + 1);
  const chapters = await exportAudiobook.assembleProject(getState(), projectId, { progress });
  if (!chapters.length) throw badRequest("project has no scenes to export");
  steps.ctx.signal.throwIfAborted();
  steps.chaptersDone = chapters.length;
  steps.say("Encoding the book", chapters.length, chapters.length + 1);
  const m4b = await exportAudiobook.muxM4b(chapters, name, author);
  const p = tempFile(".m4b");
  writeFileSync(p, m4b);
  steps.encoded = 1;
  steps.say("Done", chapters.length + 1, chapters.length + 1);
  return p;
}

/** Each chapter joined once, its WAV in `chapters/` and — with ffmpeg — its master in `masters/`.
 * Without ffmpeg there are no masters (raw audio filed as a master would be false), and the job
 * says so in `note` (2026-10-15, the narrowings review R8; it refused the whole zip before). */
async function _chaptersZip(steps, projectId, { masters = true } = {}) {
  const st = getState();
  const scenes = exportAudiobook.projectScenes(projectId);
  if (!scenes.length) throw badRequest("project has no scenes to export");
  // STORED, as Python wrote them: WAV barely compresses, and a book is hundreds of MB.
  const zf = new ZipWriter({ compression: "stored" });
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    steps.chapter(i, scenes.length, scene);
    // The chapter's title as written, by the kit's rule as the zip's own name is (2026-10-15, the
    // narrowings review R7; letters and digits only before, the rest "_").
    const title = safeTitle(scene.title, `Chapter ${scene.position + 1}`);
    const name = `${String(i + 1).padStart(2, "0")} ${title}.wav`;
    const wavs = await renderChapterApi.renderSceneWavs(st, scene.id, { master: masters });
    zf.writestr(`chapters/${name}`, wavs.chapter);
    if (masters) zf.writestr(`masters/${name}`, wavs.master);
  }
  const p = tempFile(".zip");
  writeFileSync(p, zf.toBuffer());
  steps.chaptersDone = scenes.length;
  steps.say("Done", scenes.length, scenes.length);
  return p;
}

function _project(projectId) {
  const project = session.getDb().one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
  if (project === null) throw notFound(`project ${projectId}`);
  return [project.name, m4bAuthor(project)];
}

function _needFfmpeg(what) {
  if (!exportAudiobook.haveFfmpeg()) {
    throw new HttpError(503, `ffmpeg is not installed — required for ${what}. Install ffmpeg and restart the server.`);
  }
}

/** Start an export of `kind` ("m4b" | "chapters") of the book as a job of the registry → its
 * snapshot (the one already running for the book, when there is one). */
function _start(kind, projectId, filename, mediaType, build, { note = null } = {}) {
  let id = null;
  const snap = jobs.start({ kind: KIND[kind], key: projectId, label: filename, meta: { projectId } }, async (ctx) => {
    ctx.update({ done: 0, total: 0, filename, note });
    ctx.progress(0, "Starting");
    const steps = new Steps(ctx, { chapters: exportAudiobook.projectScenes(projectId).length, encode: kind === "m4b" });
    await _warm(projectId, kind, steps);
    // a running job isn't forgotten (the registry's forget refuses it), so its record is here
    _exports.get(id).path = await build(steps);
    // the job's result: what the screen saves it as, and what the file leaves out
    return { filename, note };
  });
  // the work starts after this (the registry's microtask), so its record is here before it ends
  id = snap.id;
  if (!_exports.has(id)) _exports.set(id, { projectId, filename, mediaType, note, path: null, fetched: false });
  return snap;
}

function _startM4b(projectId) {
  const [name, author] = _project(projectId);
  _needFfmpeg("M4B export");
  return _start("m4b", projectId, `${safeTitle(name)}.m4b`, "audio/mp4", (steps) => _m4b(steps, projectId, name, author));
}

/** Resolves once job `id` has ended (at once when it isn't running). */
function _ended(id) {
  return new Promise((resolve) => {
    const off = jobs.subscribe(id, (ev) => {
      if (ev.type !== "end") return;
      off?.();
      resolve();
    });
    if (off === null) resolve();
  });
}

/** Stop a deleted book's running exports (`DELETE /v1/projects/{id}`; 2026-10-13, the
 * narrowings review R4). Returns how many were running. */
export function cancelProjectExports(projectId) {
  let n = 0;
  for (const job of jobs.list({ key: projectId })) {
    if (Object.values(KIND).includes(job.kind) && jobs.cancel(job.id)) n += 1;
  }
  return n;
}

/**
 * Start the book's M4B export job → the job as the one-click run reads it (`exportJob`'s shape) —
 * a function so the run calls it too (its last step). The Save dialog suggests the book's title as
 * written (the kit's safeTitle — JustWrite's rule, copied to the kit; JustWrite still keeps its
 * own; 2026-10-13, the narrowings review R7). 404 for an unknown book, 503 without ffmpeg.
 */
export function startM4bExport(projectId) {
  return exportJob(_startM4b(projectId).id);
}

/** An export job as the one-click run reads it — `{id, status, done, total, step, error, note,
 * filename, task}`, `task` resolving once it ends — or null when it is unknown (fetched, or gone
 * with a restart: jobs live in memory). */
export function exportJob(jobId) {
  const job = jobs.get(jobId);
  const e = _exports.get(jobId);
  if (job === null || e === undefined || e.fetched) return null;
  return {
    id: job.id,
    status: job.state,
    done: job.data.done ?? 0,
    total: job.data.total ?? 0,
    step: job.message || "Starting",
    error: job.error?.message ?? null,
    note: e.note,
    filename: e.filename,
    task: _ended(job.id),
  };
}

/** A finished export's file on disk (until it is fetched or its job forgotten), or null. */
export function exportFile(jobId) {
  return _exports.get(jobId)?.path ?? null;
}

/** Cancel an export job (the kit's DELETE /v1/jobs/:id does it for the screen). Not running → false. */
export function cancelExportJob(jobId) {
  return jobs.cancel(jobId);
}

export function router() {
  const app = new Hono();
  // 202 with the job (the kit's long-job shape — platform/jobs.js): following it and its Cancel
  // are the kit's /v1/jobs/:id
  app.post("/v1/projects/:project_id/export_m4b/start", (c) => c.json(_startM4b(c.req.param("project_id")), 202));

  app.post("/v1/projects/:project_id/export_chapters/start", (c) => {
    const projectId = c.req.param("project_id");
    const [name] = _project(projectId);
    const masters = exportAudiobook.haveFfmpeg();
    const note = masters ? null : NO_MASTERS;
    const snap = _start("chapters", projectId, `${safeTitle(name)} chapters.zip`, "application/zip", (steps) => _chaptersZip(steps, projectId, { masters }), { note });
    return c.json(snap, 202);
  });

  /** The finished file, once; the job goes with it, and its temp file once sent. */
  app.get("/v1/export_jobs/:job_id/file", (c) => {
    const jobId = c.req.param("job_id");
    const job = jobs.get(jobId);
    const e = _exports.get(jobId);
    if (job === null || e === undefined || e.fetched) throw notFound(`export job ${jobId}`);
    if (job.state !== "done" || !e.path) throw badRequest(`export job ${jobId} is ${job.state}`);
    e.fetched = true;
    jobs.forget(jobId);
    const p = e.path;
    const size = statSync(p).size;
    const stream = createReadStream(p);
    stream.once("close", () => removeTemp(p));
    return c.body(Readable.toWeb(stream), 200, {
      "content-type": e.mediaType,
      // RFC 6266/5987: a quote or a title outside ASCII survives (the kit's attachment()).
      "content-disposition": attachment(e.filename),
      "content-length": String(size),
    });
  });
  return app;
}
