// SPDX-License-Identifier: MIT
//
// A book with narration needs a narrator (decided 2026-10-05: "if there is
// narration then we need a narrator, that is not an option"). Nothing makes one
// on its own (2026-09-29), so Discover proposes it and Script asks for it — and
// both add it through Cast's own door, `POST /v1/projects/{id}/narrator`: a
// speaker called Narrator (or the speaker already called that), cast with the
// library's persona called Narrator when there is exactly one, and the
// narration with no speaker moves to it.

import { pushToast } from "@delebash/llm-ui";
import { projectsService } from "./projects.js";

/** Narration lines in Script's chapter rows: read, not spoken. */
export function narrationOf(chapters) {
  return (chapters || []).reduce((n, c) => n + Math.max(0, (c.lines || 0) - (c.spoken || 0)), 0);
}

/** Does the cast ([{narrator}]) have a narrator? */
export function hasNarrator(cast) {
  return (cast || []).some((c) => c.narrator);
}

/** Add the book's narrator. Resolves to the lines of narration it took, or null when it failed. */
export async function addNarrator(projectId) {
  try {
    const r = await projectsService.addNarrator(projectId);
    const moved = r?.moved_lines || 0;
    pushToast({
      kind: "success",
      message: moved
        ? `Narrator added — ${moved.toLocaleString()} lines of narration are theirs now. Give them a persona on Cast.`
        : "Narrator added — give them a persona on Cast.",
    });
    return moved;
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't add the narrator: ${e?.message || e}` });
    return null;
  }
}
