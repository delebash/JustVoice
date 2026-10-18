// SPDX-License-Identifier: MIT
// The book's exports as jobs the Export panel follows (decided 2026-10-07) (the port of
// justvoice/api/export_jobs_api.py).
//
// `POST /v1/projects/{id}/export_m4b` renders and masters every chapter, then encodes the book,
// and answers only at the end — minutes with nothing to show. These are the same work, reported
// as it goes: start one, poll it ("Rendering line 12 of 340" while the lines with no take are
// rendered, then chapter 2 of 4, then "Encoding the book"), cancel it, then fetch the file.
//
// Each job has an AbortController (2026-10-13, the narrowings review R2 and R4): its cancel route
// and deleting its book abort it. The render phase passes its signal to the scheduler, which
// withdraws the lines still waiting (the line rendering finishes); the chapters check it
// between chapters.
//
// * M4B — the book, one file with chapter marks.
// * Chapter audio — a zip of each chapter joined (`chapters/NN Title.wav`) and mastered to the
//   book's target (`masters/NN Title.wav`); without ffmpeg, the chapters only, the job's `note`
//   saying so. The package itself (`GET /v1/projects/{id}/export`) is Overview's, and stays as
//   it is.
//
// Jobs live in memory and a finished file in the temp folder until it is fetched; the old M4B
// door stays for anything that calls it directly. Python built the file in a worker thread; here
// the build is the job's own async task.

import { randomUUID } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { attachment, Hono } from "@delebash/core/platform";
import { safeTitle } from "@delebash/core/platform/filename";
import { getLogger } from "@delebash/core/platform/log";
import { ZipWriter } from "@delebash/core/platform/zip";
import { getState } from "../app_state.js";
import { Project } from "../database/models.js";
import * as session from "../database/session.js";
import { ApiError, badRequest, HttpError, notFound } from "../errors.js";
import * as exportAudiobook from "../export_audiobook.js";
import * as synthScheduler from "../synth_scheduler.js";
import { m4bAuthor } from "./projects_api.js";
import * as renderChapterApi from "./render_chapter_api.js";

const log = getLogger("justvoice.api.export_jobs_api");
const errText = (e) => e?.message ?? String(e);

/** The jobs, by id (Python's module-level `_jobs`). */
export const _jobs = new Map();

class _Cancelled extends Error {}

const _public = (job) => ({
  id: job.id,
  status: job.status,
  done: job.done,
  total: job.total,
  step: job.step,
  error: job.error,
  // What the file leaves out, said once it is made — the chapter zip without ffmpeg (R8).
  note: job.note,
  filename: job.filename,
});

/** The chapter zip's note without ffmpeg (the user's words, 2026-10-15). */
export const NO_MASTERS = "No masters — ffmpeg isn't installed, so the zip holds the chapter WAVs only.";

/** Abort the job: its cancel route, or its book deleted. */
function _abort(job) {
  if (!job.abort.signal.aborted) job.abort.abort(new _Cancelled());
}

function _chapterStep(job, i, n, scene) {
  if (job.abort.signal.aborted) throw new _Cancelled();
  job.done = i;
  return `Chapter ${i + 1} of ${n} · ${scene.title || `Chapter ${scene.position + 1}`}`;
}

/** The render phase: the lines with no take in use, counted on the job as they land. */
async function _warm(projectId, job) {
  const st = getState();
  const what = job.media_type === "audio/mp4" ? "the M4B export" : "the chapter WAVs export";
  await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), {
    owner: synthScheduler.workOwner(what),
    signal: job.abort.signal,
    onProgress: (done, total) => {
      // The line rendering when the job was cancelled still lands; it must not write over
      // "Cancelled" (2026-10-13, the implementation review's problem 17).
      if (job.abort.signal.aborted) return;
      Object.assign(job, { done, total, step: `Rendering line ${Math.min(done + 1, total)} of ${total}` });
    },
  });
  if (job.abort.signal.aborted) throw new _Cancelled();
}

/** `tempfile.mkstemp(prefix="jv-export-", suffix=…)` — a file of its own, in a folder of its
 * own (removed with it). */
function tempFile(suffix) {
  const dir = mkdtempSync(path.join(tmpdir(), "jv-export-"));
  return path.join(dir, `export${suffix}`);
}
const removeTemp = (p) => rmSync(path.dirname(p), { recursive: true, force: true });

async function _m4b(job, projectId, name, author) {
  const progress = (i, n, scene) => {
    job.total = n + 1; // every chapter, then the encode
    job.step = _chapterStep(job, i, n, scene);
  };
  const chapters = await exportAudiobook.assembleProject(getState(), projectId, { progress });
  if (!chapters.length) throw badRequest("project has no scenes to export");
  if (job.abort.signal.aborted) throw new _Cancelled();
  job.done = chapters.length;
  job.step = "Encoding the book";
  const m4b = await exportAudiobook.muxM4b(chapters, name, author);
  const p = tempFile(".m4b");
  writeFileSync(p, m4b);
  return p;
}

/** Each chapter joined once, its WAV in `chapters/` and — with ffmpeg — its master in `masters/`.
 * Without ffmpeg there are no masters (raw audio filed as a master would be false), and the job
 * says so in `note` (2026-10-15, the narrowings review R8; it refused the whole zip before). */
async function _chaptersZip(job, projectId, { masters = true } = {}) {
  const st = getState();
  const scenes = exportAudiobook.projectScenes(projectId);
  if (!scenes.length) throw badRequest("project has no scenes to export");
  job.total = scenes.length;
  // STORED, as Python wrote them: WAV barely compresses, and a book is hundreds of MB.
  const zf = new ZipWriter({ compression: "stored" });
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    job.step = _chapterStep(job, i, scenes.length, scene);
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
  return p;
}

async function _run(job, projectId, build) {
  try {
    await _warm(projectId, job);
    const p = await build();
    Object.assign(job, { path: p, done: job.total, step: "Done", status: "done" });
  } catch (e) {
    if (e instanceof _Cancelled) Object.assign(job, { status: "cancelled", step: "Cancelled" });
    else if (e instanceof ApiError) Object.assign(job, { status: "error", error: String(e.detail) });
    else {
      // the panel shows it; the server keeps running
      log.exception(`export job ${job.id} failed`, e);
      Object.assign(job, { status: "error", error: errText(e) });
    }
  }
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

function _start(projectId, filename, mediaType, build, { note = null } = {}) {
  const job = {
    id: randomUUID().replaceAll("-", ""),
    project_id: projectId,
    status: "running",
    done: 0,
    total: 0,
    step: "Starting",
    error: null,
    note,
    filename,
    media_type: mediaType,
    path: null,
    abort: new AbortController(),
  };
  _jobs.set(job.id, job);
  const out = _public(job);
  // Held on the job; it starts after this answer is made (asyncio.create_task's order).
  job.task = Promise.resolve().then(() => _run(job, projectId, () => build(job)));
  return out;
}

function _job(jobId) {
  const job = _jobs.get(jobId);
  if (job === undefined) throw notFound(`export job ${jobId}`);
  return job;
}

/** Stop a deleted book's running exports (`DELETE /v1/projects/{id}`; 2026-10-13, the
 * narrowings review R4). Returns how many were running. */
export function cancelProjectExports(projectId) {
  let n = 0;
  for (const job of _jobs.values()) {
    if (job.project_id !== projectId || job.status !== "running") continue;
    _abort(job);
    n += 1;
  }
  return n;
}

/**
 * Start the book's M4B export job → the job as its routes show it — the route's body, a function
 * so the one-click run calls it too (its last step). The Save dialog suggests the book's title as
 * written (the kit's safeTitle — JustWrite's rule, copied to the kit; JustWrite still keeps its
 * own; 2026-10-13, the narrowings review R7). 404 for an unknown book, 503 without ffmpeg.
 */
export function startM4bExport(projectId) {
  const [name, author] = _project(projectId);
  _needFfmpeg("M4B export");
  return _start(projectId, `${safeTitle(name)}.m4b`, "audio/mp4", (job) => _m4b(job, projectId, name, author));
}

/** An export job as its routes show it, and its task (resolves once it ends) — or null when it is
 * unknown (fetched, or gone with a restart: jobs live in memory). */
export function exportJob(jobId) {
  const job = _jobs.get(jobId);
  return job === undefined ? null : { ..._public(job), task: job.task };
}

/** Cancel an export job (its cancel route's). Unknown → false. */
export function cancelExportJob(jobId) {
  const job = _jobs.get(jobId);
  if (job === undefined) return false;
  _abort(job);
  return true;
}

export function router() {
  const app = new Hono();
  app.post("/v1/projects/:project_id/export_m4b/start", (c) => c.json(startM4bExport(c.req.param("project_id"))));

  app.post("/v1/projects/:project_id/export_chapters/start", (c) => {
    const projectId = c.req.param("project_id");
    const [name] = _project(projectId);
    const masters = exportAudiobook.haveFfmpeg();
    const note = masters ? null : NO_MASTERS;
    return c.json(
      _start(projectId, `${safeTitle(name)} chapters.zip`, "application/zip", (job) => _chaptersZip(job, projectId, { masters }), { note }),
    );
  });

  app.get("/v1/export_jobs/:job_id", (c) => c.json(_public(_job(c.req.param("job_id")))));

  app.post("/v1/export_jobs/:job_id/cancel", (c) => {
    const job = _job(c.req.param("job_id"));
    cancelExportJob(job.id);
    return c.json(_public(job));
  });

  /** The finished file, once; the job and its temp file go with it. */
  app.get("/v1/export_jobs/:job_id/file", (c) => {
    const jobId = c.req.param("job_id");
    const job = _job(jobId);
    if (job.status !== "done" || !job.path) throw badRequest(`export job ${jobId} is ${job.status}`);
    const p = job.path;
    _jobs.delete(jobId);
    const size = statSync(p).size;
    const stream = createReadStream(p);
    stream.once("close", () => removeTemp(p));
    return c.body(Readable.toWeb(stream), 200, {
      "content-type": job.media_type,
      // RFC 6266/5987: a quote or a title outside ASCII survives (the kit's attachment()).
      "content-disposition": attachment(job.filename),
      "content-length": String(size),
    });
  });
  return app;
}
