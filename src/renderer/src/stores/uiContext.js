// SPDX-License-Identifier: MIT
//
// uiContext — a tiny global slot for "where am I" breadcrumb segments.
// Any view that has internal context (current project, current scene,
// current sub-tab) writes its trail here on mount + watch changes; the
// topbar in App.vue reads it and renders the breadcrumb.
//
// Each segment is { label, href? }. The href is the navigation target
// when the user clicks the segment (commonly "#projects" to jump back to
// the project list). The first segment is implicit (the view label
// itself — provided by App's currentView.label), so views only push
// the deeper context.
//
// Plan Q7 / Slice 1 — location awareness in nested workspaces.

import { defineStore } from "pinia";

export const useUiContext = defineStore("uiContext", {
  state: () => ({
    breadcrumb: [],  // [{ label, href? }]
  }),
  actions: {
    set(segments) {
      this.breadcrumb = Array.isArray(segments) ? segments : [];
    },
    clear() {
      this.breadcrumb = [];
    },
  },
});
