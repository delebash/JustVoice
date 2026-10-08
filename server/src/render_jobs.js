// SPDX-License-Identifier: MIT
// Persistent render jobs — the RenderJob/RenderJobBlock orchestrator (the port of
// justvoice/render_jobs.py).
//
// The tables shipped with the v1.0 design freeze and sat dead — no creator, no worker — until
// Stage 2 of the 2026-08-08 scheduler work (docs/plans/2026-08-08-vram-think.md §7). A job
// turns a set of blocks into per-block renders driven through the SynthScheduler: every block
// is submitted as its OWN one-item set, so the pool drains engine-major across the whole job
// (and anything else queued) while failures stay isolated per block — block 7 failing never
// costs block 8 its render.
//
// Each finished block persists Generation + default Take exactly like the single-block door
// (`persistBlockTake`, shared with takes_api — one source, they must never drift). A job
// survives restart as rows: the boot sweep (`sweepStaleJobs`) marks interrupted queued/running
// jobs "paused"; `resumeJob` re-enqueues only the blocks that aren't completed.
//
// Since Studio Slice 4 (2026-10-04) a take keeps its audio, the seed it was made with and its
// inputs key (line_takes.js), and becomes the line's ★ take. A job made with `fresh` renders
// past the render cache — "↻ Re-render all".
//
// JavaScript: a job's runner is a background async task (Python's daemon thread); its cancel
// flag an AsyncEvent. The database is the app's one handle (`database/session.getDb()`); a row
// is re-read where Python opened a new session.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { AsyncEvent, background } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyRound, pyStr, strip, ValueError } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { personaForBlock } from "./api/_speaker_helpers.js";
import * as appState from "./app_state.js";
import { writeWavContainer } from "./audio/wav.js";
import * as session from "./database/session.js";
import {
  Block,
  Generation,
  Project,
  RenderJob,
  RenderJobBlock,
  Scene,
  Speaker,
  Take,
  utcnow,
  uuid,
} from "./database/models.js";
import * as exportVoicelines from "./export_voicelines.js";
import * as lineTakes from "./line_takes.js";
import * as mediaPaths from "./media_paths.js";
import { generationsRoot } from "./paths.js";
import * as self from "./render_jobs.js";
import * as synthScheduler from "./synth_scheduler.js";
import * as voiceModel from "./voice_model.js";

export const log = getLogger("justvoice.render_jobs");

const _TERMINAL = ["completed", "failed", "cancelled"];

export const _running = new Set(); // job ids with a live runner
export const _cancelEvents = new Map();
export const _liveHandles = new Map(); // job id → scheduler SetHandles

const marks = (n) => Array(n).fill("?").join(", ");

/** The app's database (Python's `_open_db`: "database not initialized" before boot). */
const _db = () => session.getDb();

// ── the one block-persistence shape ──────────────────────────────────

/**
 * Generation + the line's new ★ Take for one rendered block — THE single persistence shape,
 * shared by POST /v1/blocks/{id}/render and the job runner. `rl` is the render
 * (`render_core.RenderedLine`): its audio is kept on disk, with the seed and inputs key it was
 * made from, so the chapter can play it and Render can tell when it goes stale (line_takes.js).
 * The line's other takes are kept and stop being ★ — nothing is overwritten. `newSeed`: the
 * take rolled its own seed (↻ New take). `block` is the block row, or the job runner's plain
 * copy that already carries `persona_id`. Returns the new take row.
 */
export function persistBlockTake(h, state, block, rl, { newSeed = false } = {}) {
  const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [block.scene_id], Scene);
  // The persona that voiced it (line → speaker → persona); the job runner hands a plain copy
  // that already carries it.
  let personaId = block.persona_id ?? null;
  if (personaId === null) {
    const found = personaForBlock(h, block);
    personaId = found !== null ? found.id : null;
  }
  const frame = 2 * Math.max(1, rl.channels) * Math.max(1, rl.sampleRate);
  const genId = uuid();
  const file = path.join(generationsRoot(state.dataDir), `${genId}.wav`);
  writeFileSync(file, writeWavContainer(rl.pcm, rl.sampleRate, rl.channels));
  const takeId = uuid();
  h.tx(() => {
    h.insert(Generation, {
      id: genId,
      block_id: block.id,
      persona_id: personaId,
      project_id: scene ? scene.project_id : null,
      chapter_id: block.scene_id,
      text: block.text,
      engine: rl.engine || state.engines.current() || "managed",
      model: rl.model || null,
      seed: rl.seed ?? null,
      instruct: block.direction || null,
      cache_key: rl.inputsKey || null,
      status: "completed",
      source: newSeed ? lineTakes.NEW_TAKE : lineTakes.CHAPTER_RENDER,
      duration_sec: pyRound(rl.pcm.length / frame, 3),
      audio_path: mediaPaths.storeMediaPath(file),
    });
    h.update(Take, { is_default: false }, "block_id = ? and is_default = 1", [block.id]);
    h.insert(Take, { id: takeId, block_id: block.id, generation_id: genId, is_default: true });
  });
  return h.get(Take, takeId);
}

// ── job lifecycle ────────────────────────────────────────────────────

/** Scope → ordered block ids. "blocks" keeps the caller's order; the other scopes walk scene
 * position → block position. Empty-text blocks are excluded everywhere (nothing to render). */
export function _expandScope(h, projectId, scope, scopeIds) {
  if (scope === "blocks") {
    const rows = scopeIds.length ? h.all(`select * from ${Block} where id in (${marks(scopeIds.length)})`, scopeIds, Block) : [];
    const byId = new Map(rows.map((b) => [b.id, b]));
    const missing = scopeIds.filter((i) => !byId.has(i));
    if (missing.length) throw new ValueError(`unknown block ids: ${missing.slice(0, 5).join(", ")}`);
    return scopeIds.filter((i) => strip(byId.get(i).text || ""));
  }
  if (scope === "scene" || scope === "project") {
    let sql = `select ${Block}.* from ${Block} join ${Scene} on ${Block}.scene_id = ${Scene}.id where ${Scene}.project_id = ?`;
    const params = [projectId];
    if (scope === "scene") {
      sql += ` and ${Scene}.id in (${scopeIds.length ? marks(scopeIds.length) : "select null where 0"})`;
      params.push(...scopeIds);
    }
    sql += ` order by ${Scene}.position, ${Block}.position`;
    return h
      .all(sql, params, Block)
      .filter((b) => strip(b.text || ""))
      .map((b) => b.id);
  }
  throw new ValueError(`unknown scope '${scope}'`);
}

/**
 * Create the job + its per-block rows (all pending). A job with zero renderable blocks is born
 * completed — nothing to run. `fresh` renders every block past the render cache (kept with the
 * ids, so a resumed job keeps it). Returns the job row. Throws ValueError on an unknown block
 * id or scope.
 */
export function createJob(projectId, scope, scopeIds, { fresh = false } = {}) {
  const h = _db();
  const ids = scopeIds || [];
  const blockIds = _expandScope(h, projectId, scope, ids);
  const jobId = uuid();
  h.tx(() => {
    h.insert(RenderJob, {
      id: jobId,
      project_id: projectId,
      scope,
      scope_ids_json: pyJson(fresh ? { ids, fresh: true } : ids),
      status: blockIds.length ? "queued" : "completed",
      total_blocks: blockIds.length,
      finished_at: blockIds.length ? null : utcnow(),
    });
    for (const bid of blockIds) h.insert(RenderJobBlock, { job_id: jobId, block_id: bid, status: "pending" });
  });
  return h.get(RenderJob, jobId);
}


/** Start the runner. Idempotent — one live runner per job. */
export function startJob(jobId) {
  if (_running.has(jobId)) return false;
  _running.add(jobId);
  _cancelEvents.set(jobId, new AsyncEvent());
  background(`render-job-${jobId.slice(0, 8)}`, () => self._runJob(jobId), log);
  return true;
}

/** Cancel: withdraw the job's queued lines at the next line boundary. A job with no live
 * runner (queued/paused rows) goes terminal directly. */
export function cancelJob(jobId) {
  const live = _running.has(jobId);
  const evt = _cancelEvents.get(jobId) ?? null;
  const handles = [...(_liveHandles.get(jobId) || [])];
  if (evt !== null) evt.set();
  if (live) {
    const scheduler = synthScheduler.getScheduler();
    for (const hd of handles) scheduler.cancel(hd.setId);
    return jobStatus(jobId);
  }
  const h = _db();
  const job = h.get(RenderJob, jobId);
  if (job === null) return null;
  if (!_TERMINAL.includes(job.status)) h.update(RenderJob, { status: "cancelled", finished_at: utcnow() }, { id: jobId });
  return jobStatus(jobId);
}

/** Re-run a job's unfinished blocks (pending + failed + interrupted running). Completed blocks
 * are never re-rendered. No-op on a job whose runner is live or whose blocks are all
 * completed. */
export function resumeJob(jobId) {
  const h = _db();
  const job = h.get(RenderJob, jobId);
  if (job === null) return null;
  if (_running.has(jobId)) return jobStatus(jobId);
  const unfinished = h.value(
    `select count(*) from ${RenderJobBlock} where job_id = ? and status in ('pending', 'failed', 'running')`,
    [jobId],
  );
  if (!unfinished) return jobStatus(jobId);
  h.update(RenderJob, { status: "queued", finished_at: null }, { id: jobId });
  startJob(jobId);
  return jobStatus(jobId);
}

/** The job as the API shows it (a wire dict), or null. */
export function jobStatus(jobId, { includeBlocks = false } = {}) {
  const h = _db();
  const job = h.get(RenderJob, jobId);
  if (job === null) return null;
  const out = {
    id: job.id,
    project_id: job.project_id,
    scope: job.scope,
    status: job.status,
    total_blocks: job.total_blocks || 0,
    completed_blocks: job.completed_blocks || 0,
    failed_blocks: job.failed_blocks || 0,
    audio_seconds: _audioSeconds(h, jobId),
    current: _currentLines(h, jobId),
    waiting: job.status === "running" ? _waiting(jobId) : null,
  };
  // The line rendering now may be loading its model first (2026-10-07).
  out.loading = out.current.length ? _loading() : null;
  if (includeBlocks) {
    out.blocks = h
      .all(`select * from ${RenderJobBlock} where job_id = ?`, [jobId], RenderJobBlock)
      .map((r) => ({ block_id: r.block_id, status: r.status, generation_id: r.generation_id }));
  }
  return out;
}

/** Boot sweep: jobs a dead server left queued/running become 'paused' (their rows survive;
 * resume re-runs the unfinished blocks). */
export function sweepStaleJobs() {
  const h = _db();
  const jobs = h.all(`select id from ${RenderJob} where status in ('queued', 'running')`);
  if (jobs.length) h.tx(() => jobs.forEach((j) => h.update(RenderJob, { status: "paused" }, { id: j.id })));
  return jobs.length;
}

/** Seconds of audio the job's finished lines made — Render's "3:12 of audio" and its × real
 * time (decided 2026-10-07). */
function _audioSeconds(h, jobId) {
  const total = h.value(
    `select sum(${Generation}.duration_sec) from ${Generation} join ${RenderJobBlock} on ${RenderJobBlock}.generation_id = ${Generation}.id ` +
      `where ${RenderJobBlock}.job_id = ? and ${RenderJobBlock}.status = 'completed'`,
    [jobId],
  );
  return pyRound(Number(total || 0.0), 2);
}

/** The lines rendering now — each with its number in its chapter (the one Render shows) and
 * its speaker's name: "line 47 · Narrator". */
function _currentLines(h, jobId) {
  const out = [];
  // Newest first: a line that has finished but is still being saved reads running for a moment
  // beside the one that just started.
  const rows = h.all(
    `select * from ${RenderJobBlock} where job_id = ? and status = 'running' order by updated_at desc`,
    [jobId],
    RenderJobBlock,
  );
  for (const jb of rows) {
    const block = h.get(Block, jb.block_id);
    if (block === null) continue;
    const scene = h.get(Scene, block.scene_id);
    const project = scene ? h.get(Project, scene.project_id) : null;
    const n = scene ? (lineTakes.heardBlocks(h, scene, project).find(([, b]) => b.id === block.id)?.[0] ?? null) : null;
    const speaker = block.speaker_id ? h.get(Speaker, block.speaker_id) : null;
    out.push({ block_id: block.id, n, speaker: speaker ? speaker.name : null });
  }
  return out;
}

/** A scheduler key ("kokoro:kokoro") as the model's name ("Kokoro"); null for a line whose
 * voice didn't resolve. */
function _modelLabel(key) {
  const k = key || "";
  const i = k.indexOf(":");
  const engine = i < 0 ? k : k.slice(0, i);
  const model = i < 0 ? "" : k.slice(i + 1);
  if (!model || engine.startsWith("?")) return null;
  try {
    return voiceModel.modelName(model, engine);
  } catch {
    // a name is a nicety; the key still says which
    return model;
  }
}

/** What the job's next line waits behind — the work ahead of it in the queue, each with its
 * model (decided 2026-10-07: "waiting — 2 · Bigger Inside is ahead: 40 lines on Chatterbox
 * Turbo"). null while one of its own lines is rendering, or before its lines are queued. */
function _waiting(jobId) {
  const handles = [...(_liveHandles.get(jobId) || [])];
  if (!handles.length) return null;
  const ahead = synthScheduler.getScheduler().ahead(handles.map((hd) => hd.setId));
  if (!ahead) return null;
  ahead.groups = ahead.groups.map(({ engine, ...g }) => ({ label: g.label, kind: g.kind, lines: g.lines, model: _modelLabel(engine) }));
  return ahead;
}

function _loading() {
  return voiceModel.loadingNow();
}

/** The line was deleted — with its book, its chapter or on its own — before the queue reached
 * it (2026-10-07). */
export class LineGone extends Error {
  constructor(message) {
    super(message);
    this.name = "LineGone";
  }
}

/** Who the job's lines are for, as Render names it: its chapter ("2 · Bigger Inside"), or its
 * book when it spans several (2026-10-07). */
function _jobOwner(h, job, sceneIds) {
  if (sceneIds.size === 1) {
    const scene = h.get(Scene, [...sceneIds][0]);
    if (scene !== null) return synthScheduler.chapterOwner(scene);
  }
  const project = h.get(Project, job.project_id);
  return { label: project ? project.name : "a render", kind: "chapter" };
}

/**
 * Mark a job's line as rendering when the scheduler starts it, then render it (decided
 * 2026-10-07: Render lights the line). The runner marks it completed, failed or — when
 * withdrawn — pending again. A line whose row is gone was deleted (its book, its chapter, or
 * itself — the row goes with it): it is skipped, not rendered (decided 2026-10-07; a deleted
 * book's lines used to render on, each failing to save). Async.
 */
export async function _rendering(jbId, fn) {
  let gone = false;
  try {
    const h = _db();
    const jb = h.get(RenderJobBlock, jbId);
    gone = jb === null;
    if (jb !== null && jb.status === "pending") h.update(RenderJobBlock, { status: "running" }, { id: jbId });
  } catch (e) {
    // a progress mark never costs the line its render
    log.warning(`render job: marking ${jbId} rendering failed: ${e?.message ?? e}`);
  }
  if (gone) throw new LineGone("the line was deleted");
  return fn();
}

// ── the runner ───────────────────────────────────────────────────────

function _refreshCounters(h, jobId) {
  if (h.get(RenderJob, jobId) === null) return;
  const count = (status) => h.value(`select count(*) from ${RenderJobBlock} where job_id = ? and status = ?`, [jobId, status]);
  _setFields(h, RenderJob, jobId, { completed_blocks: count("completed"), failed_blocks: count("failed") });
}

/** Update only what changed — SQLAlchemy writes (and stamps `updated_at` on) a row only when an
 * attribute's value really changed. */
function _setFields(h, table, id, fields) {
  const row = h.get(table, id);
  if (row === null) return;
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => row[k] !== v));
  if (Object.keys(changed).length) h.update(table, changed, { id });
}

export function _jobIsFresh(job) {
  let opts;
  try {
    opts = JSON.parse(job.scope_ids_json || "[]");
  } catch {
    return false;
  }
  return opts !== null && typeof opts === "object" && !Array.isArray(opts) && Boolean(opts.fresh);
}

/** The job's runner (async; started by `startJob`). */
export async function _runJob(jobId) {
  const state = appState.getState();
  const cancelEvt = _cancelEvents.get(jobId) ?? new AsyncEvent();
  try {
    // Collect the work list (plain copies of the rows).
    const h = _db();
    const job = h.get(RenderJob, jobId);
    if (job === null) return;
    const fresh = _jobIsFresh(job);
    const work = [];
    let owner;
    h.tx(() => {
      _setFields(h, RenderJob, jobId, { status: "running", ...(job.started_at == null ? { started_at: utcnow() } : {}) });
      const workRows = h.all(
        `select * from ${RenderJobBlock} where job_id = ? and status in ('pending', 'failed', 'running')`,
        [jobId],
        RenderJobBlock,
      );
      for (const jb of workRows) {
        const block = h.get(Block, jb.block_id);
        if (block === null) {
          _setFields(h, RenderJobBlock, jb.id, { status: "failed" });
          continue;
        }
        const persona = personaForBlock(h, block);
        _setFields(h, RenderJobBlock, jb.id, { status: "pending" });
        const blockData = {
          id: block.id,
          scene_id: block.scene_id,
          speaker_id: block.speaker_id,
          persona_id: persona !== null ? persona.id : null,
          text: block.text,
          direction: block.direction,
          metadata_json: block.metadata_json,
        };
        const personaData = persona !== null ? { id: persona.id, name: persona.name } : null;
        work.push({ jbId: jb.id, block: blockData, persona: personaData });
      }
      owner = _jobOwner(h, job, new Set(work.map((w) => w.block.scene_id)));
      _refreshCounters(h, jobId);
    });
    // The scheduler's grouping key per line (async: it resolves the voice).
    for (const w of work) {
      let voice = null;
      if (w.persona !== null) {
        const storeP = state.personas.get(w.persona.id);
        if (storeP != null) voice = storeP.voice_id || null;
      }
      w.engineId = (voice ? await voiceModel.modelKey(state, voice) : null) || `?voice:${pyStr(voice)}`;
    }

    // Submit every block as its OWN one-item set: the pool groups engine-major across the
    // whole job; a failure fails one block only.
    const scheduler = synthScheduler.getScheduler();
    const handles = [];
    for (const { jbId, block, persona, engineId } of work) {
      const hd = scheduler.submit(
        [[engineId, () => self._rendering(jbId, () => exportVoicelines.renderBlockTake(state, persona, block, { useCache: !fresh }))]],
        { owner },
      );
      handles.push([jbId, block, hd]);
    }
    _liveHandles.set(
      jobId,
      handles.map(([, , hd]) => hd),
    );

    for (const [jbId, block, handle] of handles) {
      if (cancelEvt.isSet()) scheduler.cancel(handle.setId);
      await handle.wait();
      const item = handle.items[0];
      const db = _db();
      try {
        const jb = db.get(RenderJobBlock, jbId);
        if (handle.cancelled && item.error == null && item.result == null) {
          db.tx(() => {
            if (jb !== null) _setFields(db, RenderJobBlock, jbId, { status: "pending" }); // withdrawn — resume picks it up
            _refreshCounters(db, jobId);
          });
        } else if (item.error instanceof LineGone) {
          log.info(`render job ${jobId}: block ${block.id} was deleted — skipped`);
        } else if (item.error != null) {
          db.tx(() => {
            if (jb !== null) _setFields(db, RenderJobBlock, jbId, { status: "failed" });
            _refreshCounters(db, jobId);
          });
          log.warning(`render job ${jobId}: block ${block.id} failed: ${item.error?.message ?? item.error}`);
        } else if (jb === null) {
          // Deleted while it rendered — nothing left to save it to.
          log.info(`render job ${jobId}: block ${block.id} was deleted while it rendered — not saved`);
        } else {
          const take = self.persistBlockTake(db, state, block, item.result);
          db.tx(() => {
            _setFields(db, RenderJobBlock, jbId, { status: "completed", generation_id: take.generation_id });
            _refreshCounters(db, jobId);
          });
        }
      } catch (e) {
        log.exception(`render job ${jobId}: persisting block ${block.id} failed: ${e?.message ?? e}`);
        try {
          db.tx(() => {
            if (db.get(RenderJobBlock, jbId) !== null) _setFields(db, RenderJobBlock, jbId, { status: "failed" });
            _refreshCounters(db, jobId);
          });
        } catch {
          /* nothing more to do */
        }
      }
    }

    const db = _db();
    if (db.get(RenderJob, jobId) !== null) {
      db.tx(() => {
        _setFields(db, RenderJob, jobId, { status: cancelEvt.isSet() ? "cancelled" : "completed", finished_at: utcnow() });
        _refreshCounters(db, jobId);
      });
    }
  } catch (e) {
    log.exception(`render job ${jobId} crashed: ${e?.message ?? e}`);
    try {
      const db = _db();
      const job = db.get(RenderJob, jobId);
      if (job !== null && !_TERMINAL.includes(job.status)) db.update(RenderJob, { status: "failed", finished_at: utcnow() }, { id: jobId });
    } catch {
      /* nothing more to do */
    }
  } finally {
    _running.delete(jobId);
    _cancelEvents.delete(jobId);
    _liveHandles.delete(jobId);
  }
}
