// SPDX-License-Identifier: MIT
//
// The book's exports as kit tasks the Export panel's strip follows (decided
// 2026-10-07): the server's export job (`api/export_jobs_api.js`) reports its
// render phase line by line ("Rendering line 12 of 340", 2026-10-13), then each
// chapter as it is mastered (then, for the M4B, the encode); Cancel stops it —
// at once while lines render (2026-10-13), else after the chapter being
// mastered. The M4B answered only at the end before — minutes with nothing on
// screen. `kind`: "m4b" the book, "chapters" each chapter's WAV and master in a
// zip (the chapters only without ffmpeg, the job's `note` saying so —
// 2026-10-15, the narrowings review R8).

import { withAiTask } from "@delebash/llm-ui";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ENDED = new Set(["done", "error", "cancelled"]);

// What Cancel does, in the strip's hint (the user's words, 2026-10-15: "Cancel
// stops after the chapter it is on" was no longer true while lines render).
const CANCEL = "Cancel stops at once while lines render, or after the chapter being mastered.";

const KINDS = {
  m4b: { feature: "export-m4b", path: "export_m4b", what: "M4B audiobook",
    hint: `Chapters joined and mastered, then the book encoded — ${CANCEL}` },
  chapters: { feature: "export-chapters", path: "export_chapters", what: "chapter WAVs + masters",
    hint: `Each chapter joined, then mastered — ${CANCEL}` },
};

/** Run an export; resolves to { blob, filename, note } once the file is made — `note`, what
 *  the file leaves out (the server's words), or null. */
export function exportRun(api, project, kind = "m4b") {
  const k = KINDS[kind];
  return withAiTask({
    feature: k.feature,
    label: `${project.name || "Book"} → ${k.what}`,
    meta: { projectId: project.id },
  }, async (task) => {
    let job = await api.request(`/v1/projects/${project.id}/${k.path}/start`, { method: "POST", signal: task.signal });
    for (;;) {
      task.setProgress(job.done, job.total || 1, job.total ? undefined : "preparing", k.hint);
      task.setStats(job.step ? [job.step] : []);
      if (ENDED.has(job.status)) break;
      if (task.signal.aborted) {
        await api.safeRequest(`/v1/export_jobs/${job.id}/cancel`, null, { method: "POST" });
        throw new DOMException("Export cancelled", "AbortError");
      }
      await wait(1000);
      job = await api.request(`/v1/export_jobs/${job.id}`, { signal: task.signal });
    }
    if (job.status === "cancelled") throw new DOMException("Export cancelled", "AbortError");
    if (job.status === "error") throw new Error(job.error || "the export failed");
    const blob = await api.requestBlob(`/v1/export_jobs/${job.id}/file`, { signal: task.signal });
    return { blob, filename: job.filename, note: job.note || null };
  });
}

/**
 * What a `saveBlob` result says: where the file went (and its folder, for Open
 * folder), that it went to Downloads, or that nothing was saved.
 */
export function savedMessage(res, filename) {
  if (res?.path) {
    return { kind: "success", message: `Saved ${filename} to ${res.path}`, folder: res.path.replace(/[\\/][^\\/]*$/, "") };
  }
  if (res?.downloaded) return { kind: "success", message: `Saved ${filename} to your Downloads folder.`, folder: null };
  return { kind: "info", message: "Export cancelled — nothing was saved.", folder: null };
}
