// SPDX-License-Identifier: MIT
//
// Studio's step order — extracted so it can be pinned by a test without
// mounting the 2000-line view.
//
// PROSE KINDS START AT SCRIPT (ruling 12, 2026-08-15). The Script step is what
// CREATES the cast: runDiscoverSpeakers finds the speakers a manuscript names
// and promoteDiscovered POSTs them to /v1/projects/{id}/personas/promote, which
// makes the personas and links them to the project. Cast-first opened a cast
// holding only the auto-created Narrator, sent you to Script to populate it,
// and back again — a loop presented as a line.
//
// GAME PROJECTS KEEP CAST FIRST and have no Script step at all: their lines
// arrive from the writers' sheet with characters already attached, so there is
// nothing to discover.

export const STEP_LABELS = {
  cast: "Cast",
  script: "Script",
  render: "Render",
  export: "Export",
};

const PROSE_STEPS = ["script", "cast", "render", "export"];
const GAME_STEPS = ["cast", "render", "export"];

/** The step keys for a project kind, in order. Unknown/absent kind = prose. */
export function stepKeysFor(projectType) {
  return projectType === "game_voicelines" ? [...GAME_STEPS] : [...PROSE_STEPS];
}

/** The steps as the tab strip renders them — numbering is derived from order. */
export function stepsFor(projectType) {
  return stepKeysFor(projectType).map((key, i) => ({
    key,
    label: `${i + 1} · ${STEP_LABELS[key]}`,
  }));
}

/** The step a project opens on when nothing else has chosen one. */
export function firstStepFor(projectType) {
  return stepKeysFor(projectType)[0];
}
