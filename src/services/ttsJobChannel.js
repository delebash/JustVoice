// SPDX-License-Identifier: MIT
// The Speech-engines download channel (family parity batch 2026-08-06): JV's
// engine install/download flow — POST /v1/engines/{id}/install → { job_id } →
// GET /v1/jobs/{id} → DELETE /v1/jobs/{id} — IS the kit's channel contract
// (createDownloadTask: start / poll / cancel), so the managed-engine catalog
// drives the SAME task machinery and DownloadBar every LLM download uses.
// This replaced ~70 lines of hand EWMA/rate/ETA strip code in the old
// EnginesView (the C3 strip) — the kit's rate tracker owns that now.
import { createDownloadTask } from "@delebash/llm-ui";

const PHRASES = {
  connecting: "Connecting",
  resolving: "Getting ready",
  downloading: "Downloading",
  extracting: "Unpacking",
  installing: "Installing",
  verifying: "Checking files",
};

function friendlyJobPhase(detail) {
  const key = String(detail || "").toLowerCase().replaceAll(" ", "_");
  return PHRASES[key] || (detail ? String(detail).replaceAll("_", " ") : "Working");
}

/**
 * A channel over JV's job API for one engine install / model download.
 * `api` = the useApi() store (request + serverUrl); `startBody` rides the
 * install POST ({ model_variant } for a per-variant download, {} for an
 * engine-wide install).
 */
export function ttsJobChannel(api, engineId, startBody = {}) {
  let jobId = null;
  return {
    start: async () => {
      const accepted = await api.request(`/v1/engines/${engineId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(startBody),
      });
      jobId = accepted.job_id;
    },
    statusUrl: "job",   // unused — `fetch` below closes over the live job id
    fetch: () => api.request(`/v1/jobs/${jobId}`),
    read: (job) => {
      if (!job) return { detail: "connecting", status: "connecting" };
      if (job.phase === "failed") return { terminal: "error", error: job.error || "unknown error" };
      if (job.phase === "completed") return { terminal: "done" };
      return {
        detail: job.phase,
        done: job.bytes_downloaded || 0,
        total: job.bytes_total || 0,
        status: job.phase,
      };
    },
    cancel: async () => {
      if (jobId) await api.request(`/v1/jobs/${jobId}`, { method: "DELETE" });
    },
    friendly: friendlyJobPhase,
    pollMs: 800,
  };
}

/** A ready task for one engine install / variant download. */
export function makeEngineDownloadTask(api, engineId, startBody = {}) {
  return createDownloadTask(ttsJobChannel(api, engineId, startBody));
}
