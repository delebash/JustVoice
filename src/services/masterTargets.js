// SPDX-License-Identifier: MIT
//
// A mastering target by its name — ONE wording on Overview's dropdown, the
// top bar's Master chip, Render's target pill and Export's Master row
// (decided 2026-10-06, the one-wording audit B9/C7: Export printed the raw
// preset id, *acx*, or *default*, where Overview showed the real target). The
// ids are the server's (mastering.MASTER_PRESET_NAMES, plus "none" = raw).

export const MASTER_TARGETS = [
  { id: "none", label: "None — raw" },
  { id: "acx", label: "ACX" },
  { id: "inaudio", label: "iAudio" },
  { id: "podcast", label: "Podcast" },
  { id: "youtube", label: "YouTube" },
];

// The target a project gets when it stores none (server mastering.KIND_MASTER_DEFAULTS).
const KIND_MASTER = { audiobook: "acx", podcast: "podcast" };

/** The target a project masters to: its own, else its kind's, else none. */
export const projectMaster = (project) =>
  project?.mastering_preset || KIND_MASTER[project?.project_type] || "none";

/** "acx" → "ACX"; an id this list doesn't know shows as it is. */
export function masterLabel(id) {
  return MASTER_TARGETS.find((t) => t.id === (id || "none"))?.label || id;
}
