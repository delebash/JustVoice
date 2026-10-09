// SPDX-License-Identifier: MIT
// The app's routes (Quasar's layout, app-structure §Q.1: router/routes.js holds them,
// router/index.js creates the router). The route NAME is the view id; layouts/MainLayout.vue's VIEWS
// array holds the sidebar metadata (label/icon/lane/visibleFor) keyed by the same id, and the
// per-use-case / per-kind filter decides which routes SHOW in the nav — it does not replace
// the router.

// The layout is imported, not lazy-loaded: every screen needs it, so a chunk of its own would only
// delay the first paint, and its components' styles stay in the entry stylesheet — ahead of the
// app's, where the app's rules have always won a tie with them. The pages are lazy.
import MainLayout from "../layouts/MainLayout.vue";
import { mockRoutes } from "./mockRoutes.js";

const pageRoutes = [
  { path: "", redirect: "/home" },

  // ── Workflow ──────────────────────────────────────────────────────
  { path: "home", name: "home", component: () => import("../pages/HomePage.vue") },
  // The Home view was OverviewView at /overview until the family renderer-tree
  // alignment (target-tree P8) — old #overview deep links keep landing.
  { path: "overview", redirect: "/home" },
  { path: "projects", name: "projects", component: () => import("../pages/ProjectsPage.vue") },
  { path: "lines", name: "lines", component: () => import("../pages/LinesPage.vue") },
  { path: "studio", name: "studio", component: () => import("../pages/StudioPage.vue") },
  { path: "captures", name: "captures", component: () => import("../pages/CapturesPage.vue") },

  // ── Library ───────────────────────────────────────────────────────
  { path: "voices", name: "voices", component: () => import("../pages/VoicesPage.vue") },
  { path: "personas", name: "personas", component: () => import("../pages/PersonasPage.vue") },
  // One persona on its own page (2026-10-03, the persona redesign — mock
  // `workbench`). `/personas/new` opens a blank one. `meta.nav` keeps the
  // rail on Personas.
  {
    path: "personas/:id",
    name: "persona",
    component: () => import("../pages/PersonaEditorPage.vue"),
    meta: { nav: "personas" },
  },
  { path: "lexicons", name: "lexicons", component: () => import("../pages/LexiconsPage.vue") },
  { path: "effects", name: "effects", component: () => import("../pages/EffectsPage.vue") },
  // The Voice engines page died in the parity batch (2026-08-06) — engines live
  // on the AI console's Speech engines tab. Every old #engines deep link (the
  // topbar pill, VoicesView's banner, Home's card) lands there.
  { path: "engines", redirect: { path: "/ai", query: { tab: "speech-engines" } } },
  { path: "ai", name: "ai", component: () => import("../pages/AiPage.vue") },

  // ── Hidden / pinned ───────────────────────────────────────────────
  { path: "importreview", name: "importreview", component: () => import("../pages/ImportReviewPage.vue") },
  { path: "settings", name: "settings", component: () => import("../pages/SettingsPage.vue") },

  // ── Legacy sub-tab deep-links ─────────────────────────────────────
  // Settings sub-tabs (#cache/#channels/#webhooks) were top-level hashes. The
  // destination view reads the chosen sub-tab from sessionStorage on mount, so
  // set it here then redirect to the parent view.
  ...["cache", "channels", "webhooks"].map((sub) => ({
    path: sub,
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
    path: "speakerlab",
    redirect: { path: "/ai", query: { tab: "features", action: "speaker_attribution.guided" } },
  },

  // The design mocks — dev only (router/mockRoutes.js).
  ...(import.meta.env.DEV ? mockRoutes : []),

];

// The CLI's shape: every page inside the app's layout (layouts/MainLayout.vue — the sidebar as
// Quasar's drawer, the title bar, the content scroller), so their paths are relative to it; the
// dictation window and the connection-error page outside it (boot/jv.js sends every route to one
// of them when that is what the start-up decided); unknown paths go Home, last.
const routes = [
  { path: "/", component: MainLayout, children: pageRoutes },
  { path: "/dictate", name: "dictate", component: () => import("../pages/DictatePage.vue") },
  { path: "/offline", name: "offline", component: () => import("../pages/ConnectionErrorPage.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/home" },
];

// `initialDeepLink` was deleted 2026-08-15 with its only consumer. It captured
// the URL hash at module load so the shell could tell a bookmarked route from the
// default landing — but first-run is a property of the INSTALL, not the URL,
// and using it as a gate meant a factory reset (which reloads #/settings) never
// re-opened onboarding on a genuinely fresh server.

export default routes;
