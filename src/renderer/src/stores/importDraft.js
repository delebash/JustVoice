// SPDX-License-Identifier: GPL-3.0-or-later
//
// importDraft — hands the picked file + dry-run result from the small
// import dialog to the full-page review (#importreview). Module
// singleton (not Pinia): File objects can't ride sessionStorage, and
// the draft dies with the page by design.

const draft = {
  file: null,        // File
  source: "",        // adapter id
  standard: null,    // dry-run StandardImport
  projectId: null,   // update-in-place target (re-import)
};

export function setImportDraft({ file, source, standard, projectId = null }) {
  draft.file = file;
  draft.source = source;
  draft.standard = standard;
  draft.projectId = projectId;
}

export function getImportDraft() {
  return draft.file && draft.standard ? { ...draft } : null;
}

export function updateImportStandard(standard) {
  draft.standard = standard;
}

export function clearImportDraft() {
  draft.file = null;
  draft.source = "";
  draft.standard = null;
  draft.projectId = null;
}
