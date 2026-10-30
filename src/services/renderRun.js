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
// audio made, × real time, time left. While none of its lines has started, it
// carries what is ahead of it in the queue (`waiting`), and while the line
// rendering now loads its model, that model (`loading`) — the strip says so.
//
//   followRender  a render job of a chapter that this window didn't start —
//                 another window, an earlier page load, JustWrite, MCP — that
//                 the server reports on the chapter (`running_job`), followed
//                 as the same kind of task, Cancel included (2026-10-13, the
//                 narrowings review R3: "wherever it was started"). An open page
//                 notices one when the window regains focus (2026-10-15).
//   chapterRenderTask  the task rendering a chapter: its own, or the one
//                 following a job over several chapters — "rendering…" on each
//                 of them, with one progress strip (2026-10-15).

// The kit's one rule for a file's name — the same module the server names exports with (it is
// pure, for both sides; JustWrite's renderer imports it too).
import { safeTitle } from "@delebash/core/platform/filename";
import { reportError, saveBlob, withAiTask } from "@delebash/ui";

const TERMINAL = new Set(["completed", "failed", "cancelled", "paused"]);
const JSON_HEADERS = { "Content-Type": "application/json" };
/** Waits `ms`, or rejects as soon as `signal` aborts. */
const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
});

/**
 * Follow a render job to its end, reporting each poll. Cancels it on the server
 * when `signal` aborts — whether that lands between polls, during the wait or
 * during a poll's request (2026-10-13, the implementation review's problem 6).
 */
export async function followJob(api, job, { signal, onProgress } = {}) {
  let j = job;
  onProgress?.(j);
  try {
    while (!TERMINAL.has(j.status)) {
      signal?.throwIfAborted();
      await wait(700, signal);
      j = await api.request(`/v1/render_jobs/${j.id}?include_blocks=true`, { signal });
      onProgress?.(j);
    }
  } catch (e) {
    if (!signal?.aborted) throw e;
    await api.safeRequest(`/v1/render_jobs/${j.id}/cancel`, null, { method: "POST" });
    throw new DOMException("Render cancelled", "AbortError");
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

/**
 * What a waiting run waits for — the first thing ahead of it in the queue
 * (decided 2026-10-07): "waiting — 2 · Bigger Inside is ahead: 40 lines on
 * Chatterbox Turbo" for a chapter's render, "waiting — the M4B export is
 * rendering 12 lines first" for other work; when more is ahead after it,
 * ", and 12 more lines". "" when nothing is ahead.
 */
export function waitingText(waiting) {
  const g = waiting?.groups?.[0];
  if (!g) return "";
  const lines = (n) => `${n.toLocaleString()} line${n === 1 ? "" : "s"}`;
  const first = g.kind === "chapter"
    ? `waiting — ${g.label} is ahead: ${lines(g.lines)}${g.model ? ` on ${g.model}` : ""}`
    : `waiting — ${g.label} is rendering ${lines(g.lines)} first`;
  const more = (waiting.lines || 0) - g.lines;
  return more > 0 ? `${first}, and ${more.toLocaleString()} more line${more === 1 ? "" : "s"}` : first;
}

/** "loading Qwen3-TTS CustomVoice — 8 s" while the line rendering now loads its model (2026-10-07); "" otherwise. */
export function loadingText(loading) {
  return loading?.model ? `loading ${loading.model} — ${Math.round(loading.seconds || 0)} s` : "";
}

/** One poll of a run, onto its task: the line states, the line rendering now, what it waits for, the figures. */
function report(task, job, startedAt) {
  task.update({
    render: {
      lines: Object.fromEntries((job.blocks || []).map((b) => [b.block_id, b.status])),
      current: job.current?.[0] || null,
      waiting: job.waiting || null,
      loading: job.loading || null,
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

/** A started line job, followed onto its task to its end. Resolves to the finished job. */
async function followLines(api, task, job, onProgress) {
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
}

/** ⚡ Render N ready / ↻ Re-render all on one chapter, as a kit task. Resolves to the finished job. */
export function renderLines(api, { sceneId, title, which, onProgress }) {
  return withAiTask({
    feature: "render-lines",
    label: `${title} → ${which === "all" ? "a new take for every line" : "takes for the ready lines"}`,
    meta: { sceneId },
  }, async (task) => followLines(api, task, await startLines(api, sceneId, which, task.signal), onProgress));
}

/**
 * A chapter's render job started elsewhere (`running_job` on its render_lines
 * or render_state), as the same kit task ⚡ Render N ready makes — its
 * strip, lit line and Cancel. Its label is the chapter's title. Resolves to the
 * finished job.
 */
export function followRender(api, { sceneId, title, job, onProgress }) {
  return withAiTask({
    feature: "render-lines",
    label: title,
    meta: { sceneId, jobId: job.id },
  }, (task) => followLines(api, task, job, onProgress));
}

/** 🎧 Run ACX QC's hover while it waits for a render (the user's words, 2026-10-15, the
 *  narrowings review B3) — the chapter grid and its mock. */
export const QC_WAITS = "Waits for the render to finish — the check renders lines that have no take.";

/** Is a render of this chapter running in this window (any of Render's kit tasks)? */
export function chapterRunning(tasks, sceneId) {
  return tasks.visibleTasks.some((t) => ["render-lines", "render-scene"].includes(t.feature)
    && t.meta?.sceneId === sceneId && tasks.isRunning(t.id));
}

/** Is this render job already followed in this window (`followRender`'s task, still running)?
 *  A job over several chapters is followed once, not once per chapter (2026-10-13, the
 *  implementation review's problem 8). */
export function jobFollowed(tasks, jobId) {
  return tasks.visibleTasks.some((t) => t.meta?.jobId === jobId && tasks.isRunning(t.id));
}

/**
 * The running task rendering a chapter, or null: one of this window's runs of it, or — `jobId`,
 * the render job the server reports over it (`running_job`) — the one task following that job. A
 * render over several chapters shows "rendering…" on each of its chapters, with one progress
 * strip, under the chapter it was followed from (2026-10-15, the narrowings review R3).
 */
export function chapterRenderTask(tasks, sceneId, jobId = null) {
  return tasks.visibleTasks.find((t) => tasks.isRunning(t.id) && (
    (["render-lines", "render-scene"].includes(t.feature) && t.meta?.sceneId === sceneId)
    || (!!jobId && t.meta?.jobId === jobId))) || null;
}

/**
 * A chapter's ▶ Render as a kit task: takes for its ready lines, then the
 * chapter joined from every line's ★ take and mastered (POST
 * /v1/render_chapter, scene mode — it refuses, naming why, while any line
 * can't render). Resolves to { url, filename, blob } of the chapter's WAV.
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
      blob: audio, // what its ⬇ Download saves (saveChapterWav)
      url: URL.createObjectURL(audio),
      // The chapter's label as written, minus only what a Windows file name can't hold — "3 · The
      // Keystone.wav" (2026-10-15, the narrowings review R7; "3_The_Keystone.wav" before).
      filename: `${safeTitle(title)}.wav`,
    };
    task.update({ result });
    return result;
  });
}

/** A chapter's ⬇ Download: its WAV through the kit's door for a file to save (app-structure §19) — the
 * desktop's Save dialog, a browser's download — never an `<a download>` (the family guard's check 11). */
export async function saveChapterWav(result) {
  if (!result?.blob) return null;
  try {
    return await saveBlob(result.blob, result.filename);
  } catch (e) {
    reportError(e);
    return null;
  }
}

/** Where a server media path (a take's `/v1/generations/{id}/audio`) plays from. */
export function mediaUrl(api, path) {
  return path ? `${String(api.serverUrl || "").replace(/\/$/, "")}${path}` : null;
}
