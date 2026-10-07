// SPDX-License-Identifier: MIT
//
// Render's runs (Studio Slice 4, decided 2026-10-04 —
// docs/plans/2026-10-04-slice-4-render.md). One door for the chapter grid and
// a chapter's line page, so both start, follow and cancel a run the same way:
//
//   renderLines   a chapter's lines as a render job — "ready" gives each line
//                 with no take one (⚡ Render N ready), "all" a new take for
//                 every line that can render (↻ Re-render all). Each line
//                 renders on its own; one failing never costs the next.
//   renderChapter the chapter's ▶ Render: its ready lines get takes, then the
//                 chapter is joined from every line's ★ take and mastered.
//
// Both are kit tasks (cancel, retry, progress in the AI tasks panel).
// `renderChapter`'s task is feature "render-scene" with meta.sceneId — the
// grid's progress row finds it by that.
//
// As a run goes (decided 2026-10-07) each task carries `render`: every line's
// state in the run (pending · running · completed · failed), the line rendering
// now ({block_id, n, speaker}) and how many are done — the chapter page lights
// that line and re-reads its lines as each lands — and the strip's figures:
// audio made, × real time, time left.

import { withAiTask } from "@delebash/llm-ui";

const TERMINAL = new Set(["completed", "failed", "cancelled", "paused"]);
const JSON_HEADERS = { "Content-Type": "application/json" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Follow a render job to its end, reporting each poll. Cancels it when `signal` aborts. */
export async function followJob(api, job, { signal, onProgress } = {}) {
  let j = job;
  onProgress?.(j);
  while (!TERMINAL.has(j.status)) {
    if (signal?.aborted) {
      await api.safeRequest(`/v1/render_jobs/${j.id}/cancel`, null, { method: "POST" });
      throw new DOMException("Render cancelled", "AbortError");
    }
    await wait(700);
    j = await api.request(`/v1/render_jobs/${j.id}?include_blocks=true`, { signal });
    onProgress?.(j);
  }
  return j;
}

/** Start a chapter's line render: which = "ready" | "all". Returns the job. */
export function startLines(api, sceneId, which, signal) {
  return api.request(`/v1/scenes/${sceneId}/render_lines`, {
    method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ which }), signal,
  });
}

/** 192 → "3:12"; an hour or more → "1:02:05". */
export function clock(sec) {
  const t = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** The strip's figures for a run at `elapsed` seconds: audio made, × real time,
 *  time left — each once there is something to say. */
export function runFigures(job, elapsed) {
  const out = [];
  const audio = job.audio_seconds || 0;
  if (audio > 0) {
    out.push(`${clock(audio)} of audio`);
    if (elapsed > 0) out.push(`${(audio / elapsed).toFixed(1)}× real time`);
  }
  const done = (job.completed_blocks || 0) + (job.failed_blocks || 0);
  const left = (job.total_blocks || 0) - done;
  if (done > 0 && left > 0 && elapsed > 0) {
    const sec = (left * elapsed) / done;
    out.push(sec < 60 ? `about ${Math.max(1, Math.round(sec))} s left` : `about ${Math.round(sec / 60)} min left`);
  }
  return out;
}

/** One poll of a run, onto its task: the line states, the line rendering now, the figures. */
function report(task, job, startedAt) {
  task.update({
    render: {
      lines: Object.fromEntries((job.blocks || []).map((b) => [b.block_id, b.status])),
      current: job.current?.[0] || null,
      done: job.completed_blocks || 0,
    },
  });
  task.setStats(runFigures(job, (Date.now() - startedAt) / 1000));
}

function failedLine(job) {
  return job.failed_blocks
    ? `${job.failed_blocks} line${job.failed_blocks === 1 ? "" : "s"} failed to render — the rest kept their new takes.`
    : "";
}

/** ⚡ Render N ready / ↻ Re-render all on one chapter, as a kit task. Resolves to the finished job. */
export function renderLines(api, { sceneId, title, which, onProgress }) {
  return withAiTask({
    feature: "render-lines",
    label: `${title} → ${which === "all" ? "a new take for every line" : "takes for the ready lines"}`,
    meta: { sceneId },
  }, async (task) => {
    const job = await startLines(api, sceneId, which, task.signal);
    const t0 = Date.now();
    const done = await followJob(api, job, {
      signal: task.signal,
      onProgress: (j) => {
        task.setProgress(j.completed_blocks + j.failed_blocks, j.total_blocks || 1);
        report(task, j, t0);
        onProgress?.(j);
      },
    });
    if (done.status === "cancelled") throw new DOMException("Render cancelled", "AbortError");
    if (done.failed_blocks && !done.completed_blocks) throw new Error(failedLine(done));
    return done;
  });
}

/**
 * A chapter's ▶ Render as a kit task: takes for its ready lines, then the
 * chapter joined from every line's ★ take and mastered (POST
 * /v1/render_chapter, scene mode — it refuses, naming why, while any line
 * can't render). Resolves to { url, filename } of the chapter's WAV.
 */
export function renderChapter(api, { sceneId, projectId, title, onRetry }) {
  return withAiTask({
    feature: "render-scene",
    label: `${title} → chapter render`,
    onRetry,
    meta: { sceneId, projectId },
  }, async (task) => {
    const job = await startLines(api, sceneId, "ready", task.signal);
    const t0 = Date.now();
    const done = await followJob(api, job, {
      signal: task.signal,
      onProgress: (j) => {
        task.setProgress(j.completed_blocks + j.failed_blocks, (j.total_blocks || 0) + 1);
        report(task, j, t0);
      },
    });
    if (done.status === "cancelled") throw new DOMException("Render cancelled", "AbortError");
    if (done.failed_blocks) throw new Error(failedLine(done));
    let audio;
    try {
      audio = await api.request("/v1/render_chapter", {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ scene_id: sceneId }), signal: task.signal,
      });
    } catch (e) {
      // What is kept when the last step fails (decided 2026-10-07).
      const why = String(e?.message || "").match(/mastering: ([\s\S]*)$/);
      if (why) throw new Error(`Mastering failed — every line's take is kept; Retry masters again. ${why[1].trim()}`);
      throw e;
    }
    task.setProgress((done.total_blocks || 0) + 1, (done.total_blocks || 0) + 1);
    if (!(audio instanceof Blob)) return audio;
    const result = {
      url: URL.createObjectURL(audio),
      filename: `${title.replace(/[^a-z0-9_-]+/gi, "_")}.wav`,
    };
    task.update({ result });
    return result;
  });
}

/** Where a server media path (a take's `/v1/generations/{id}/audio`) plays from. */
export function mediaUrl(api, path) {
  return path ? `${String(api.serverUrl || "").replace(/\/$/, "")}${path}` : null;
}
