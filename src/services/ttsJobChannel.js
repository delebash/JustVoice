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

// ── Loading an engine's weights ──────────────────────────────────────────────
//
// A load is NOT a job: there is no `/v1/jobs/{id}` to poll, so the request's own
// promise is the entire lifecycle. That makes `start()` the work and the first
// status reading terminal.
//
// This lives here, shared, because it was written twice — once on the Speech
// engines tab and once on the Voices page — and both copies faked the channel
// with `start: async () => {}` and an empty `statusUrl`. The bar was driven by
// hand around it (`arm` … `await request` … `apply({terminal:"done"})`), which
// meant DownloadBar's **Retry** re-entered `start()`, found a no-op, and then
// polled a stub 1000 times at 1.2 s: twenty minutes of "loading" that loaded
// nothing. With the real request as `start()`, Retry retries the load.
export function engineLoadChannel(api, engineId, { model_variant = null, device = "auto" } = {}) {
  return {
    start: async () => {
      await api.request(`/v1/engines/${engineId}/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device, model_variant }),
      });
      // The announce lives HERE, not at the call site, because DownloadBar's
      // Retry calls start() directly — outside whatever `await task.start()`
      // the caller wrote. A retry that succeeded would otherwise load the
      // model and leave every surface showing "not loaded".
      window.dispatchEvent(new Event("jv:health-refresh"));
    },
    // No status endpoint: the fetch is a stub and the first read is terminal,
    // so the poll loop ends on its first pass once start() resolves.
    statusUrl: "",
    fetch: async () => ({}),
    read: () => ({ terminal: "done" }),
    cancel: () => api.request(`/v1/engines/${engineId}/cancel-load`, { method: "POST" }),
    // The only two captions this bar will ever show, so they name the
    // operation rather than a download's "Getting ready" / "Ready".
    armPhase: "Loading model",
    donePhase: "Loaded",
  };
}

/** A ready task for loading one engine (optionally one variant of it). */
export function makeEngineLoadTask(api, engineId, opts = {}) {
  return createDownloadTask(engineLoadChannel(api, engineId, opts));
}
