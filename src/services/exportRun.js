// SPDX-License-Identifier: MIT
//
// The book's exports as kit tasks the Export panel's strip follows (decided
// 2026-10-07): the server's export job (`api/export_jobs_api.js`) reports its
// render phase line by line ("Rendering line 12 of 340", 2026-10-13), then each
// chapter as it is mastered (then, for the M4B, the encode); Cancel stops it —
// at once while lines render (2026-10-13), else after the chapter being
// mastered. `kind`: "m4b" the book, "chapters" each chapter's WAV and master in a
// zip (the chapters only without ffmpeg, the job's `note` saying so —
// 2026-10-15, the narrowings review R8).
//
// Since round E (2026-10-29, plan §4 step 6) the job is the kit's job registry's
// and this its runServerJob: the start is the book's route (202 with the job),
// following it and Cancel the kit's /v1/jobs/:id, the strip's words the job's
// step and its note what the export does and what Cancel does (runServerJob's
// `note`, the task's stats line); the finished file is ours to fetch, once
// (GET /v1/export_jobs/:id/file).

import { runServerJob } from "@delebash/ui";

// What Cancel does, on the strip (the user's words, 2026-10-15: "Cancel stops
// after the chapter it is on" was no longer true while lines render).
const CANCEL = "Cancel stops at once while lines render, or after the chapter being mastered.";

const KINDS = {
  m4b: { feature: "export-m4b", path: "export_m4b", what: "M4B audiobook",
    note: `Chapters joined and mastered, then the book encoded — ${CANCEL}` },
  chapters: { feature: "export-chapters", path: "export_chapters", what: "chapter WAVs + masters",
    note: `Each chapter joined, then mastered — ${CANCEL}` },
};

/** Run an export; resolves to { blob, filename, note } once the file is made — `note`, what
 *  the file leaves out (the server's words), or null. A cancel rejects with an AbortError. */
export async function exportRun(api, project, kind = "m4b") {
  const k = KINDS[kind];
  let jobId = null;
  const done = await runServerJob({
    start: async () => {
      const job = await api.post(`/v1/projects/${project.id}/${k.path}/start`, {});
      jobId = job.id;
      return job;
    },
    feature: k.feature,
    label: `${project.name || "Book"} → ${k.what}`,
    meta: { projectId: project.id },
    // the job's step — "Rendering line 12 of 340", "Chapter 2 of 4 · …", "Encoding the book"
    describe: (job) => job.message || "",
    note: k.note,
  });
  const blob = await api.requestBlob(`/v1/export_jobs/${jobId}/file`);
  return { blob, filename: done?.filename, note: done?.note || null };
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
