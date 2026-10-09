// SPDX-License-Identifier: MIT
//
// The design mocks — pages in the app itself, on the kit's own components and
// made-up data, so a mock looks exactly like what ships (decided 2026-10-04,
// docs/plans/2026-10-04-persona-voice-making.md §2). Dev only:
// router/index.js adds these under `import.meta.env.DEV`, so a packaged app
// never carries them. Open them under `npm run dev`.
//
// `meta.nav` keeps the rail on Personas; `meta.lede` keeps that rail item's
// lede on the list (AppShell.vue hides it on a sub-page otherwise).

export const mockRoutes = [
  {
    path: "/mock/personas",
    name: "mock-personas",
    component: () => import("./MockPersonasView.vue"),
    meta: { nav: "personas", lede: true },
  },
  {
    path: "/mock/personas/:id",
    name: "mock-persona",
    component: () => import("./MockPersonaEditorView.vue"),
    meta: { nav: "personas" },
  },
  // Studio Slice 4 (2026-10-04): Render's chapter grid, one chapter's lines,
  // and Script's chapter grid with the chapter verbs (D7).
  {
    path: "/mock/render",
    name: "mock-render",
    component: () => import("./MockStudioView.vue"),
    meta: { nav: "studio", lede: true, step: "render" },
  },
  {
    path: "/mock/render/:id",
    name: "mock-render-chapter",
    component: () => import("./MockStudioView.vue"),
    meta: { nav: "studio", lede: true, step: "render" },
  },
  {
    path: "/mock/script",
    name: "mock-script",
    component: () => import("./MockStudioView.vue"),
    meta: { nav: "studio", lede: true, step: "script" },
  },
];
