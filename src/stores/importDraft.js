// SPDX-License-Identifier: MIT
//
// importDraft — hands the picked file + dry-run result from New project's dialog (or the
// re-import dialog) to the full-page review (#importreview). Module
// singleton (not Pinia): File objects can't ride sessionStorage, and
// the draft dies with the page by design.

const draft = {
  file: null,        // File
  source: "",        // adapter id
  standard: null,    // dry-run StandardImport
  projectId: null,   // update-in-place target (re-import)
  splitOn: "auto",   // book_prose chapter-split strategy
  create: null,      // New project's {name, project_type, language} — they win over the file's
};

export function setImportDraft({ file, source, standard, projectId = null, splitOn = "auto", create = null }) {
  draft.create = create;
  draft.file = file;
  draft.source = source;
  draft.standard = standard;
  draft.projectId = projectId;
  draft.splitOn = splitOn;
}

export function getImportDraft() {
  return draft.file && draft.standard ? { ...draft } : null;
}

export function updateImportStandard(standard, splitOn = null) {
  draft.standard = standard;
  if (splitOn) draft.splitOn = splitOn;
}

export function clearImportDraft() {
  draft.file = null;
  draft.source = "";
  draft.standard = null;
  draft.projectId = null;
  draft.splitOn = "auto";
  draft.create = null;
}
