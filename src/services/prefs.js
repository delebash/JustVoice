// SPDX-License-Identifier: MIT
// Renderer UI preferences — JustVoice's door to the family prefs client.
//
// The generic client (bootPrefs / readPref / writePref / flushPrefs + the
// unload flush) moved to the kit (target-tree P9 — this file was the donor);
// what stays here is JustVoice's own boot-time default below.

import { readPref, writePref } from "@delebash/llm-ui";
import { safeRequest } from "@delebash/llm-ui";

export { bootPrefs, readPref, writePref, flushPrefs } from "@delebash/llm-ui";

/** Boot-time default for the active-project slot: if no project is "open" yet
 *  (no `activeProject` pref), point it at the most-recently-updated project so
 *  the kind-driven sidebar reflects your work on launch — the same restore JW
 *  does. Server-derived (GET /v1/projects), no localStorage. Awaited after
 *  bootPrefs(), before mount. */
export async function ensureActiveProjectDefault() {
  if (readPref("activeProject")?.id) return; // a project is already the active slot
  const data = await safeRequest("/v1/projects", null);
  if (!data) return;
  const list = (data.projects || []).slice()
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const p = list[0];
  if (p) writePref("activeProject", {
    id: p.id, name: p.name || p.id, projectType: p.project_type || "",
    master: p.mastering_preset || "", openedAt: Date.now(),
  });
}
