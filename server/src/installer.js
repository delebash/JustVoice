// SPDX-License-Identifier: MIT
// Engine install jobs — the speech runtime, and model downloads into the speech cache (the port
// of justvoice/installer.py).
//
// Background-task pattern: `POST /v1/engines/{id}/install` returns 202 with a job_id; the work
// runs as a background task. Progress is observable via `GET /v1/jobs/{job_id}`.
// - `spawnManagedInstall` — the shared speech runtime (audio.cpp + eSpeak NG), through
//   `EngineManager.install` (the 2026-10-01 switch: one install for every engine).
// - `spawnPrefetch` — one model variant's file(s) into the speech cache as plain files +
//   files.json (the kit's chunked, resumable downloader).
// - `spawnJapaneseDictionaryInstall` — the optional Japanese dictionary (gap 7).
//
// Each `spawn…` returns the job id; `.task` on the module's `cfg.tasks` map holds the running
// promise (tests await it — Python joined nothing, it polled the job).

import { background } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { ValueError } from "@delebash/llm-runner/platform/py";
import { DownloadCancelled } from "@delebash/llm-runner/runner/download";
import * as japanese from "./engines/audiocpp/japanese.js";
import * as manager from "./engines/manager.js";
import * as modelCatalog from "./engines/model_catalog.js";
import { construct, JobStatus } from "./models.js";
import * as speechCache from "./speech_cache.js";

const log = getLogger("justvoice.installer");

// ─── Install job control (cancel) ──────────────────────────────────────
// A set-once flag per job id that long-running download loops poll; `cancel(jobId)` lets the
// DELETE /v1/jobs/{id} endpoint signal it without touching internals.
const CANCELLED = new Set();

/** The running task of each job (its promise) — what a test awaits. */
export const cfg = { tasks: new Map() };

/** Signal an install job to stop at the next safe checkpoint. Idempotent. */
export function cancel(jobId) {
  CANCELLED.add(jobId);
}

export function _isCancelled(jobId) {
  return CANCELLED.has(jobId);
}

export function _clearCancel(jobId) {
  CANCELLED.delete(jobId);
}

const msg = (e) => e?.message ?? String(e);

function run(jobId, fn) {
  const task = background(`install job ${jobId}`, fn, log);
  cfg.tasks.set(jobId, task);
  return task;
}

/**
 * Background install for an engine — the shared speech runtime. Runs
 * `EngineManager.install()` as a background task; mirrors progress + cancellation into the job
 * state the GUI polls. Throws ValueError for an unknown engine.
 */
export function spawnManagedInstall(state, engineId, repair = false) {
  const mgr = manager.getManager();
  const manifest = mgr.getManifest(engineId);
  if (manifest === null) throw new ValueError(`no managed engine with id ${engineId}`);

  // Reuse the engine id + a stable suffix so the GUI's "watch this job" mapping doesn't have
  // to deal with a UUID.
  const jobId = `install-${engineId}-managed`;
  // Reset cancel flag in case this engine was cancelled previously.
  _clearCancel(jobId);
  state.jobSet(
    jobId,
    construct(JobStatus, { job_id: jobId, engine_id: engineId, model_variant: "managed", phase: "connecting", bytes_downloaded: 0, bytes_total: 0 }),
  );

  run(jobId, async () => {
    try {
      const progress = (phase, line) => {
        // The live download line goes in current_file so the GUI shows it, and on the rolling
        // log tail so a failed install can be debugged from the GUI.
        state.jobUpdate(jobId, { phase, current_file: (line || "").slice(0, 200) });
        state.jobAppendLog(jobId, line ? `[${phase}] ${line}` : `[${phase}]`);
      };
      await mgr.install(engineId, {
        progress,
        cancelCheck: () => _isCancelled(jobId),
        force: repair,
        onBytes: (done, tot) => state.jobUpdate(jobId, { phase: "downloading", bytes_downloaded: done, bytes_total: tot || 0 }),
      });
      state.jobUpdate(jobId, { phase: "completed" });
      state.jobAppendLog(jobId, "[completed] install finished successfully");
    } catch (e) {
      log.exception(`managed install failed for ${engineId}`, e);
      let err = msg(e);
      if (err.toLowerCase().includes("cancelled")) err = "cancelled by user";
      state.jobUpdate(jobId, { phase: "failed", error: err });
      state.jobAppendLog(jobId, `[failed] ${err}`);
    } finally {
      _clearCancel(jobId);
    }
  });
  return jobId;
}

/** Kick off the optional Japanese dictionary's download (gap 7). Returns the job id; the
 * runtime row's bar polls it like an engine install. */
export function spawnJapaneseDictionaryInstall(state) {
  const jobId = "install-japanese-dictionary";
  _clearCancel(jobId);
  state.jobSet(
    jobId,
    construct(JobStatus, {
      job_id: jobId,
      engine_id: "japanese-dictionary",
      model_variant: japanese.VERSION,
      phase: "connecting",
      bytes_downloaded: 0,
      bytes_total: japanese.DOWNLOAD_BYTES,
    }),
  );
  run(jobId, async () => {
    try {
      await manager.installJapaneseDictionary({
        onBytes: (done, tot) => state.jobUpdate(jobId, { phase: "downloading", bytes_downloaded: done, bytes_total: tot || japanese.DOWNLOAD_BYTES }),
        cancelCheck: () => _isCancelled(jobId),
      });
      state.jobUpdate(jobId, { phase: "completed" });
      state.jobAppendLog(jobId, "[completed] Japanese dictionary installed");
    } catch (e) {
      // every failure is the job's answer
      log.exception("Japanese dictionary install failed", e);
      const err = e instanceof DownloadCancelled || e?.name === "DownloadCancelled" ? "cancelled by user" : msg(e);
      state.jobUpdate(jobId, { phase: "failed", error: err });
      state.jobAppendLog(jobId, `[failed] ${err}`);
    } finally {
      _clearCancel(jobId);
    }
  });
  return jobId;
}

/**
 * Kick off a model-only fetch in the background. Returns the job id (async: the variant's
 * source is resolved by the API layer's `resolveSource` first). Fetches the variant's pinned
 * file(s) into the speech cache; never touches the runtime. Throws ValueError for an unknown
 * engine or a variant with no download source.
 */
export async function spawnPrefetch(state, engineId, variantId) {
  const mgr = manager.getManager();
  const manifest = mgr.getManifest(engineId);
  if (manifest === null) throw new ValueError(`no managed engine with id ${engineId}`);
  const { resolveSource } = await import("./api/engine_sources_api.js");

  const variant = modelCatalog.modelsFor(engineId).find((v) => v.id === variantId) ?? null;
  const [source, provenance] = resolveSource(engineId, variantId);
  if (!source.hf_repo) {
    throw new ValueError(
      `engine ${engineId} variant '${variantId}' has no download source ` +
        "(catalog entry has no files and there is no operator override)",
    );
  }
  const jobId = `prefetch-${engineId}-${variantId}`;
  _clearCancel(jobId);
  const total = (source.size_mb || (variant ? variant.size_mb : 0) || 0) * 1024 * 1024;
  state.jobSet(
    jobId,
    construct(JobStatus, { job_id: jobId, engine_id: engineId, model_variant: variantId, phase: "connecting", bytes_downloaded: 0, bytes_total: total }),
  );
  state.jobAppendLog(jobId, `[connecting] source=${JSON.stringify(source)} provenance=${provenance}`);

  run(jobId, async () => {
    // Phase ② (plan doc §12): every fetch lands in the SPEECH CACHE as plain files + a
    // files.json manifest — never the HF hub-cache layout.
    try {
      state.jobUpdate(jobId, { phase: "connecting" });
      // The manifest's full multi-source spec when present (the speech-recognition model + its
      // aligner); an operator override carries a single repo and no pinned files → its whole
      // tree.
      const sources = source.sources || [{ hf_repo: source.hf_repo, revision: source.hf_revision ?? null, files: source.files ?? null }];
      await speechCache.fetchHfVariant(state.dataDir, engineId, variantId, sources, {
        onProgress: (done, tot) => state.jobUpdate(jobId, { phase: "downloading", bytes_downloaded: done, bytes_total: tot }),
        cancelCheck: () => _isCancelled(jobId),
      });
      state.jobUpdate(jobId, { phase: "completed" });
      state.jobAppendLog(jobId, "[completed] prefetch finished");
    } catch (e) {
      if (e instanceof DownloadCancelled || e?.name === "DownloadCancelled") {
        log.info(`prefetch cancelled for ${engineId}/${variantId}`);
        // The kit downloader's chunked partials (.part + .json maps) sit beside the plain
        // files — the next fetch resumes past completed chunks and skips complete files.
        state.jobAppendLog(jobId, "[cancelled] partial files kept for resume");
        state.jobUpdate(jobId, { phase: "failed", error: "cancelled by user" });
      } else {
        log.exception(`prefetch failed for ${engineId}/${variantId}`, e);
        state.jobUpdate(jobId, { phase: "failed", error: msg(e) });
        state.jobAppendLog(jobId, `[failed] ${msg(e)}`);
      }
    } finally {
      _clearCancel(jobId);
    }
  });
  return jobId;
}
