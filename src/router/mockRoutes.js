// SPDX-License-Identifier: MIT
//
// The design mocks — pages in the app itself, on the kit's own components and
// made-up data, so a mock looks exactly like what ships (decided 2026-10-04,
// docs/plans/2026-10-04-persona-voice-making.md §2). Dev only:
// router/routes.js adds these to the layout's pages under `import.meta.env.DEV`, so a packaged
// app never carries them. Open them under `npm run dev`.
//
// `meta.nav` keeps the rail on Personas; `meta.lede` keeps that rail item's
// lede on the list (the layout hides it on a sub-page otherwise).

export const mockRoutes = [
  {
    path: "mock/personas",
    name: "mock-personas",
    component: () => import("../pages/mock/MockPersonasPage.vue"),
    meta: { nav: "personas", lede: true },
  },
  {
    path: "mock/personas/:id",
    name: "mock-persona",
    component: () => import("../pages/mock/MockPersonaEditorPage.vue"),
    meta: { nav: "personas" },
  },
  // The persona page with its Effects chain editor open — the chain list drawn compact, each
  // step one row (the build's question 9, 2026-10-15; mock `_s11`). The build waits for the user
  // to look at it.
  {
    path: "mock/personas/:id/effects",
    name: "mock-persona-effects",
    component: () => import("../pages/mock/MockPersonaEditorPage.vue"),
    meta: { nav: "personas" },
  },
  // Voices with its filters folded behind one Filters button at phone width (decided 2026-10-16,
  // TASKS "The run's last questions" 6). The build waits for the user to look at it.
  {
    path: "mock/voices",
    name: "mock-voices",
    component: () => import("../pages/mock/MockVoicesPage.vue"),
    meta: { nav: "voices", lede: true },
  },
  // Studio Slice 4 (2026-10-04): Render's chapter grid, one chapter's lines,
  // and Script's chapter grid with the chapter verbs (D7).
  {
    path: "mock/render",
    name: "mock-render",
    component: () => import("../pages/mock/MockStudioPage.vue"),
    meta: { nav: "studio", lede: true, step: "render" },
  },
  {
    path: "mock/render/:id",
    name: "mock-render-chapter",
    component: () => import("../pages/mock/MockStudioPage.vue"),
    meta: { nav: "studio", lede: true, step: "render" },
  },
  {
    path: "mock/script",
    name: "mock-script",
    component: () => import("../pages/mock/MockStudioPage.vue"),
    meta: { nav: "studio", lede: true, step: "script" },
  },
  // The one-click audiobook's run and its card on a book's Overview (the one-click plan's slice 5,
  // 2026-10-16): ?state=new|price|blocked|running|paused|stopped|failed|done, ?route=frontier.
  {
    path: "mock/one-click",
    name: "mock-one-click",
    component: () => import("../pages/mock/MockOneClickPage.vue"),
    meta: { nav: "studio", lede: true },
  },
  // Discover's Speakers found from the server's grouping of the scans' names, with Merge found
  // names (decided 2026-10-16, TASKS "The one-click run's leftovers, rethought", item 6 and
  // answers 3–4): ?state=unchecked|merging|merged|stale|failed|noscans, ?by=run (merged and stale
  // by Make the audiobook). The build waits for the user to look at it.
  {
    path: "mock/discover",
    name: "mock-discover",
    component: () => import("../pages/mock/MockDiscoverPage.vue"),
    meta: { nav: "studio", lede: true, step: "discover" },
  },
  // Engine list slice 4 (2026-10-11): Speech engines with every audio.cpp model, its licence,
  // status, testing, memory fit, filters and sort; since the adoption plan's slice 5 (2026-10-16)
  // the seven engines described by our own files built like every other, from the server's own
  // answers. Other states: ?ai (an AI model on the card), ?runtime=none, ?empty.
  {
    path: "mock/speech-engines",
    name: "mock-speech-engines",
    component: () => import("../pages/mock/MockSpeechEnginesPage.vue"),
    meta: { nav: "ai" },
  },
];
