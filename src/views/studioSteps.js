// SPDX-License-Identifier: MIT
//
// Studio's step order — extracted so it can be pinned by a test without
// mounting the 3000-line view.
//
// STUDIO IS THE PROJECT'S HOME (ruled 2026-09-27: "studio stays as container",
// "open project always lands on overview"). Every project opens on Overview —
// its settings and where each step stands — which is not a step of the work,
// so it carries no number.
//
// PROSE KINDS: Discover → Script → Cast → Render → Export (redesign §8.5).
// Discover is its own step because it is a different verb: it reads the prose
// for names not yet in the cast and, on confirmation, CREATES personas. Script
// (Analyze) can only choose from personas that exist, so Discover runs first.
//
// GAME PROJECTS: Lines → Cast → Render → Export. Their lines arrive from the
// writers' sheet with speakers already attached, so there is nothing to
// discover and nothing to attribute — step 1 is the lines grid itself.

export const STEP_LABELS = {
  overview: "Overview",
  discover: "Discover",
  script: "Script",
  lines: "Lines",
  cast: "Cast",
  render: "Render",
  export: "Export",
};

const PROSE_STEPS = ["discover", "script", "cast", "render", "export"];
const GAME_STEPS = ["lines", "cast", "render", "export"];

/** The numbered step keys for a project kind, in order. Unknown/absent kind = prose. */
export function stepKeysFor(projectType) {
  return projectType === "game_voicelines" ? [...GAME_STEPS] : [...PROSE_STEPS];
}

/** The strip as it renders: Overview (unnumbered), then the numbered steps. */
export function stepsFor(projectType) {
  return [
    { key: "overview", label: STEP_LABELS.overview },
    ...stepKeysFor(projectType).map((key, i) => ({
      key,
      label: `${i + 1} · ${STEP_LABELS[key]}`,
    })),
  ];
}

/** Every project opens here — whatever its kind. */
export function firstStepFor() {
  return "overview";
}

/** Is `key` a stop on this kind's strip (Overview included)? */
export function isStepFor(projectType, key) {
  return stepsFor(projectType).some((s) => s.key === key);
}
