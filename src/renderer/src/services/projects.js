// SPDX-License-Identifier: GPL-3.0-or-later
//
// Thin wrapper around the FastAPI /v1/projects surface. Lives outside the
// Pinia API store so it can be imported by BooksView + ImportModal without
// pulling those into Pinia's reactivity graph.
//
// Every call goes through `useApi().request()` so the server URL + bearer
// token come from the global config / fetch wrapper. We use the same
// content-type negotiation: JSON gets parsed automatically.

import { useApi } from "../stores/api.js";

/**
 * Fetch the list of import adapters the server supports.
 * Returns { adapters: AdapterInfo[], schema_version: string }.
 */
export async function listImportAdapters() {
  return await useApi().request("/v1/projects/import/adapters");
}

/**
 * List all committed projects on disk.
 * Returns { projects: ProjectRecord[] }.
 */
export async function listProjects() {
  return await useApi().request("/v1/projects");
}

/**
 * Run the multi-adapter import.
 *
 * @param {Object} opts
 * @param {string} opts.source   — adapter id ("justwrite" | "csv_lines" | ...)
 * @param {File|Blob} opts.file  — the source file
 * @param {boolean} [opts.dryRun] — true to preview without committing
 * @returns ImportRunResponse
 */
export async function runImport({ source, file, dryRun = false }) {
  if (!source) throw new Error("runImport: source is required");
  if (!file) throw new Error("runImport: file is required");

  const form = new FormData();
  form.append("source", source);
  form.append("dry_run", dryRun ? "true" : "false");
  form.append("file", file, file.name || `upload.${source}`);

  return await useApi().request("/v1/projects/import", {
    method: "POST",
    body: form,
    // Do NOT set Content-Type; the browser fills in the multipart boundary.
  });
}

/**
 * Convenience grouped export so callers can do
 *   import { projectsService } from "../services/projects.js";
 *   projectsService.import({...})
 */
export const projectsService = {
  listAdapters: listImportAdapters,
  list: listProjects,
  import: runImport,
};
