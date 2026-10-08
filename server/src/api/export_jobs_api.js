// SPDX-License-Identifier: MIT
// The book's exports as jobs the Export panel follows (decided 2026-10-07) (the port of
// justvoice/api/export_jobs_api.py).
//
// `POST /v1/projects/{id}/export_m4b` renders and masters every chapter, then encodes the book,
// and answers only at the end — minutes with nothing to show. These are the same work, reported
// as it goes: start one, poll it (chapter 2 of 4, then "Encoding the book"), cancel it between
// chapters, then fetch the file.
//
// * M4B — the book, one file with chapter marks.
// * Chapter audio — a zip of each chapter joined (`chapters/NN Title.wav`) and mastered to the
//   book's target (`masters/NN Title.wav`). The package itself (`GET /v1/projects/{id}/export`)
//   is Overview's, and stays as it is.
//
// Jobs live in memory and a finished file in the temp folder until it is fetched; the old M4B
// door stays for anything that calls it directly. Python built the file in a worker thread; here
// the build is the job's own async task.

import { randomUUID } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { strip } from "@delebash/llm-runner/platform/py";
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
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
  filename: job.filename,
});

/** `re.sub(r"[^A-Za-z0-9._ -]+", "_", name or "").strip() or fallback`. */
export const _safe = (name, fallback) => strip((name || "").replace(/[^A-Za-z0-9._ -]+/g, "_")) || fallback;

function _chapterStep(job, i, n, scene) {
  if (job.cancel) throw new _Cancelled();
  job.done = i;
  return `Chapter ${i + 1} of ${n} · ${scene.title || `Chapter ${scene.position + 1}`}`;
}

async function _warm(projectId, job) {
  const st = getState();
  job.step = "Rendering the lines that have no take yet";
  const what = job.media_type === "audio/mp4" ? "the M4B export" : "the chapter WAVs export";
  await synthScheduler.warmLines(st, await exportAudiobook.collectProjectLineKwargs(st, projectId), { owner: synthScheduler.workOwner(what) });
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
  if (job.cancel) throw new _Cancelled();
  job.done = chapters.length;
  job.step = "Encoding the book";
  const m4b = await exportAudiobook.muxM4b(chapters, name, author);
  const p = tempFile(".m4b");
  writeFileSync(p, m4b);
  return p;
}

async function _chaptersZip(job, projectId) {
  const st = getState();
  const scenes = exportAudiobook.projectScenes(projectId);
  if (!scenes.length) throw badRequest("project has no scenes to export");
  job.total = scenes.length;
  // KIT-GAP: Python wrote these members STORED (WAV barely compresses, and a book is hundreds of
  // MB); the kit's ZipWriter writes DEFLATED only. The members and their bytes are the same.
  const zf = new ZipWriter();
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    job.step = _chapterStep(job, i, scenes.length, scene);
    const title = _safe(scene.title, `Chapter ${scene.position + 1}`);
    const name = `${String(i + 1).padStart(2, "0")} ${title}.wav`;
    zf.writestr(`chapters/${name}`, await renderChapterApi.renderSceneToWav(st, scene.id, { master: false }));
    zf.writestr(`masters/${name}`, await renderChapterApi.renderSceneToWav(st, scene.id, { master: true }));
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

function _start(projectId, filename, mediaType, build) {
  const job = {
    id: randomUUID().replaceAll("-", ""),
    status: "running",
    done: 0,
    total: 0,
    step: "Starting",
    error: null,
    filename,
    media_type: mediaType,
    path: null,
    cancel: false,
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

export async function router(app) {
  app.post("/v1/projects/:project_id/export_m4b/start", async (req) => {
    const projectId = req.params.project_id;
    const [name, author] = _project(projectId);
    _needFfmpeg("M4B export");
    return _start(projectId, `${_safe(name, "book").replaceAll(" ", "_")}.m4b`, "audio/mp4", (job) => _m4b(job, projectId, name, author));
  });

  app.post("/v1/projects/:project_id/export_chapters/start", async (req) => {
    const projectId = req.params.project_id;
    const [name] = _project(projectId);
    _needFfmpeg("mastered chapters");
    return _start(projectId, `${_safe(name, "book").replaceAll(" ", "_")}_chapters.zip`, "application/zip", (job) => _chaptersZip(job, projectId));
  });

  app.get("/v1/export_jobs/:job_id", async (req) => _public(_job(req.params.job_id)));

  app.post("/v1/export_jobs/:job_id/cancel", async (req) => {
    const job = _job(req.params.job_id);
    job.cancel = true;
    return _public(job);
  });

  /** The finished file, once; the job and its temp file go with it. */
  app.get("/v1/export_jobs/:job_id/file", async (req, reply) => {
    const jobId = req.params.job_id;
    const job = _job(jobId);
    if (job.status !== "done" || !job.path) throw badRequest(`export job ${jobId} is ${job.status}`);
    const p = job.path;
    _jobs.delete(jobId);
    const size = statSync(p).size;
    const stream = createReadStream(p);
    stream.once("close", () => removeTemp(p));
    return reply
      .type(job.media_type)
      .header("content-disposition", `attachment; filename="${job.filename}"`)
      .header("content-length", String(size))
      .send(stream);
  });
}
