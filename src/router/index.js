// SPDX-License-Identifier: MIT
// Vue Router — hash history (the Tauri webview has no server for real paths),
// lazy-loaded view components (app standard). The route NAME is the view id;
// App.vue's VIEWS array holds the sidebar metadata (label/icon/lane/visibleFor)
// keyed by the same id, and the per-use-case / per-kind filter decides which
// routes SHOW in the nav — it does not replace the router.
import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  { path: "/", redirect: "/home" },

  // ── Workflow ──────────────────────────────────────────────────────
  { path: "/home", name: "home", component: () => import("../views/HomeView.vue") },
  // The Home view was OverviewView at /overview until the family renderer-tree
  // alignment (target-tree P8) — old #overview deep links keep landing.
  { path: "/overview", redirect: "/home" },
  { path: "/projects", name: "projects", component: () => import("../views/ProjectsView.vue") },
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
  // The Voice engines page died in the parity batch (2026-08-06) — engines live
  // on the AI console's Speech engines tab. Every old #engines deep link (the
  // topbar pill, VoicesView's banner, Home's card) lands there.
  { path: "/engines", redirect: { path: "/ai", query: { tab: "speech-engines" } } },
  { path: "/ai", name: "ai", component: () => import("../views/AiView.vue") },

  // ── Hidden / pinned ───────────────────────────────────────────────
  { path: "/importreview", name: "importreview", component: () => import("../views/ImportReviewView.vue") },
  { path: "/labs", name: "labs", component: () => import("../views/LabsView.vue") },
  { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },

  // ── Legacy sub-tab deep-links ─────────────────────────────────────
  // Settings sub-tabs (#cache/#channels/#webhooks) and Labs sub-tabs
  // (#compare/#train/#renderlab/#audio) were top-level hashes. The
  // destination view reads the chosen sub-tab from sessionStorage on mount, so
  // set it here then redirect to the parent view.
  ...["cache", "channels", "webhooks"].map((sub) => ({
    path: `/${sub}`,
    redirect: () => {
      try { sessionStorage.setItem("jv.settings.sub", sub); } catch { /* ignore */ }
      return "/settings";
    },
  })),
  // The Speaker Lab died in the parity batch (2026-08-06) — attribution testing
  // is the AI console's Lab now (Routing by feature → the attribution action),
  // running the REAL pipeline via the labAdapters seam. Old #speakerlab deep
  // links land there with the guided action focused.
  {
    path: "/speakerlab",
    redirect: { path: "/ai", query: { tab: "features", action: "speaker_attribution.guided" } },
  },
  ...["compare", "train", "renderlab", "audio"].map((sub) => ({
    path: `/${sub}`,
    redirect: () => {
      try { sessionStorage.setItem("jv.labs.sub", sub); } catch { /* ignore */ }
      return "/labs";
    },
  })),

  // Unknown → Home.
  { path: "/:pathMatch(.*)*", redirect: "/home" },
];

// `initialDeepLink` was deleted 2026-08-15 with its only consumer. It captured
// the URL hash at module load so App.vue could tell a bookmarked route from the
// default landing — but first-run is a property of the INSTALL, not the URL,
// and using it as a gate meant a factory reset (which reloads #/settings) never
// re-opened onboarding on a genuinely fresh server.

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
