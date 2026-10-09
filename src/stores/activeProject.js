// SPDX-License-Identifier: MIT
//
// activeProject — the app-wide "what am I working on" slot (journeys
// contract: the open project's kind reshapes the sidebar vocabulary,
// the topbar shows Project/Kind/Master chips, and Home's Continue card
// resumes it). Views that open or select a project call `open(p)` with
// the /v1/projects record; AppShell.vue and Home read it. Persists across
// reloads server-side via /v1/prefs (key: `activeProject`).

import { defineStore } from "pinia";
import { readPref, writePref } from "../services/prefs.js";
import { projectKindByNav } from "../services/projectKinds.js";

// project_type (API) → nav kind (journeys KIND_NAV vocabulary).
const KIND_BY_TYPE = {
  audiobook: "audiobook",
  game_voicelines: "game",
  podcast: "podcast",
  custom: "text",
};


function load() {
  const p = readPref("activeProject", {});
  return p && typeof p === "object" ? p : {};
}

export const useActiveProject = defineStore("activeProject", {
  state: () => {
    const saved = load();
    return {
      id: saved.id || null,
      name: saved.name || "",
      projectType: saved.projectType || "",
      master: saved.master || "",
      openedAt: saved.openedAt || 0,
    };
  },
  getters: {
    kind: (s) => (s.id ? (KIND_BY_TYPE[s.projectType] || "text") : ""),
    kindIcon() { return projectKindByNav(this.kind)?.icon || ""; },
    kindLabel() { return projectKindByNav(this.kind)?.name.toLowerCase() || ""; },
  },
  actions: {
    open(p) {
      if (!p?.id) return;
      this.id = p.id;
      this.name = p.name || p.id;
      this.projectType = p.project_type || "";
      this.master = p.mastering_preset || "";
      this.openedAt = Date.now();
      this._persist();
    },
    clear() {
      this.id = null;
      this.name = "";
      this.projectType = "";
      this.master = "";
      this.openedAt = 0;
      this._persist();
    },
    _persist() {
      writePref("activeProject", {
        id: this.id, name: this.name, projectType: this.projectType,
        master: this.master, openedAt: this.openedAt,
      });
    },
  },
});
