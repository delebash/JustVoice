// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Home's recent generations: ⬇ saves the take's WAV through the kit's door for a file to save (app-structure §19,
// "Hand the viewer a file to save" — saveUrlAs: the desktop's Save dialog, a browser's download), named as the server
// names it (`<id>.wav`). It was an `<a href download>` at the server's address: the window's own link, which the
// family's guard (check 11) refuses and the desktop shell opened in the browser instead.
import { h, nextTick, reactive } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const GEN = { id: "gen-7", text: "The rain kept on.", voice: "June", take: 2, when: "2026-10-29T00:00:00Z", audio_url: "/v1/generations/gen-7/audio" };
const saveUrlAs = vi.fn(async () => ({ ok: true, downloaded: true }));

vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    serverUrl: "http://127.0.0.1:17494",
    // the rest unanswered: Home's own fallbacks fill them
    request: async (url) => {
      if (url.startsWith("/v1/takes/recent")) return { takes: [GEN] };
      throw new Error("offline");
    },
    safeRequest: async (_url, fallback) => fallback,
  }),
}));
const store = () => () => reactive({ items: [], reload: async () => {} });
vi.mock("../stores/projects.js", () => ({ useProjectsStore: store() }));
vi.mock("../stores/personas.js", () => ({ usePersonasStore: store() }));
vi.mock("../stores/voices.js", () => ({ useVoicesStore: store() }));
vi.mock("../stores/lexicons.js", () => ({ useLexiconsStore: store() }));
vi.mock("../stores/engines.js", () => ({ useEnginesStore: store() }));
vi.mock("../stores/onboarding.js", () => ({ useOnboarding: () => reactive({}) }));
vi.mock("../stores/activeProject.js", () => ({ useActiveProject: () => ({ id: null }) }));
vi.mock("../services/openProject.js", () => ({ openProjectInStudio: vi.fn() }));
const slot = (tag) => ({ setup: (_p, { slots }) => () => h(tag, slots.default?.()) });
vi.mock("@delebash/ui", () => ({
  saveUrlAs: (...args) => saveUrlAs(...args),
  pushToast: vi.fn(),
  reportError: vi.fn(),
  pageFlow: () => ({}),
  useAiTasksStore: () => reactive({ runningTasks: [], cancel() {}, togglePanel() {} }),
  useMemoryCells: () => ({ cells: [], start() {}, stop() {} }),
  UiButton: {
    props: ["label", "title", "as", "href", "download"],
    setup: (p, { slots, attrs }) => () =>
      h(p.as || "button", { title: p.title, href: p.href, download: p.download, onClick: attrs.onClick }, [p.label, slots.default?.()]),
  },
  UiTag: slot("span"),
  UiChip: slot("span"),
}));

const { default: HomePage } = await import("./HomePage.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  saveUrlAs.mockClear();
});

async function settle() {
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

test("a_recent_takes_download_saves_its_wav_through_the_kit", async () => {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(HomePage);
  app.component("QPage", slot("div"));
  app.mount(el);
  await settle();
  const button = el.querySelector('[title="Download WAV"]');
  expect(button?.textContent).toBe("⬇");
  expect(button.hasAttribute("download")).toBe(false);
  await new DOMWrapper(button).trigger("click");
  await settle();
  expect(saveUrlAs).toHaveBeenCalledWith("/v1/generations/gen-7/audio", "gen-7.wav");
});
