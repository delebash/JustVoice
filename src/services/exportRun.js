// SPDX-License-Identifier: MIT
//
// The book's M4B export as a kit task the Export panel's strip follows (decided
// 2026-10-07): the server's export job (`api/export_jobs_api.py`) reports each
// chapter as it is mastered, then the encode; Cancel stops it between chapters.
// It answered only at the end before — minutes with nothing on screen.

import { withAiTask } from "@delebash/llm-ui";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ENDED = new Set(["done", "error", "cancelled"]);

/** Run the export; resolves to { blob, filename } once the file is made. */
export function exportM4bRun(api, project) {
  return withAiTask({
    feature: "export-m4b",
    label: `${project.name || "Book"} → M4B audiobook`,
    meta: { projectId: project.id },
  }, async (task) => {
    let job = await api.request(`/v1/projects/${project.id}/export_m4b/start`, { method: "POST", signal: task.signal });
    for (;;) {
      task.setProgress(job.done, job.total || 1, job.total ? undefined : "preparing",
        "Chapters joined and mastered, then the book encoded — Cancel stops after the chapter it is on");
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
    return { blob, filename: job.filename };
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
