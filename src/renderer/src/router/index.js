// SPDX-License-Identifier: GPL-3.0-or-later
// Vue Router — hash history (the Tauri webview has no server for real paths),
// lazy-loaded view components (app standard). The route NAME is the view id;
// App.vue's VIEWS array holds the sidebar metadata (label/icon/lane/visibleFor)
// keyed by the same id, and the per-use-case / per-kind filter decides which
// routes SHOW in the nav — it does not replace the router.
import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  { path: "/", redirect: "/overview" },

  // ── Workflow ──────────────────────────────────────────────────────
  { path: "/overview", name: "overview", component: () => import("../views/OverviewView.vue") },
  { path: "/books", name: "books", component: () => import("../views/BooksView.vue") },
  { path: "/chapter", name: "chapter", component: () => import("../views/ChapterView.vue") },
  { path: "/lines", name: "lines", component: () => import("../views/LinesView.vue") },
  { path: "/studio", name: "studio", component: () => import("../views/StudioView.vue") },
  { path: "/stories", name: "stories", component: () => import("../views/StoriesView.vue") },
  { path: "/generate", name: "generate", component: () => import("../views/GenerateView.vue") },
  { path: "/captures", name: "captures", component: () => import("../views/CapturesView.vue") },

  // ── Library ───────────────────────────────────────────────────────
  { path: "/voices", name: "voices", component: () => import("../views/VoicesView.vue") },
  { path: "/personas", name: "personas", component: () => import("../views/PersonasView.vue") },
  { path: "/lexicons", name: "lexicons", component: () => import("../views/LexiconsView.vue") },
  { path: "/effects", name: "effects", component: () => import("../views/EffectsView.vue") },
  { path: "/presets", name: "presets", component: () => import("../views/RenderPresetsView.vue") },
  { path: "/engines", name: "engines", component: () => import("../views/EnginesView.vue") },

  // ── Hidden / pinned ───────────────────────────────────────────────
  { path: "/importreview", name: "importreview", component: () => import("../views/ImportReviewView.vue") },
  { path: "/labs", name: "labs", component: () => import("../views/LabsView.vue") },
  { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },

  // ── Legacy sub-tab deep-links ─────────────────────────────────────
  // Settings sub-tabs (#cache/#channels/#webhooks) and Labs sub-tabs
  // (#compare/#train/#speakerlab/#renderlab/#audio) were top-level hashes. The
  // destination view reads the chosen sub-tab from sessionStorage on mount, so
  // set it here then redirect to the parent view.
  ...["cache", "channels", "webhooks"].map((sub) => ({
    path: `/${sub}`,
    redirect: () => {
      try { sessionStorage.setItem("jv.settings.sub", sub); } catch { /* ignore */ }
      return "/settings";
    },
  })),
  ...["compare", "train", "speakerlab", "renderlab", "audio"].map((sub) => ({
    path: `/${sub}`,
    redirect: () => {
      try { sessionStorage.setItem("jv.labs.sub", sub); } catch { /* ignore */ }
      return "/labs";
    },
  })),

  // Unknown → Home.
  { path: "/:pathMatch(.*)*", redirect: "/overview" },
];

// Raw initial view id from the URL hash, captured at module load — BEFORE the
// router runs its first navigation (which redirects "/" → /overview). App.vue
// uses it to tell a real deep-link from the default landing for first-run.
export const initialDeepLink = (typeof window !== "undefined"
  ? window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]
  : "");

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
