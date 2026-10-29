// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The AI page hands the kit's Speech tab (AiModelsArea `runtimeTabs.audiocpp`, round E §4 step 5) our
// grouping by engine, our filter, its answers, and our pieces in its `runtime-audiocpp-<slot>` slots —
// and no tab of its own.
import { h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, test, vi } from "vitest";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const seen = vi.hoisted(() => ({ props: null }));
const SLOTS = ["group-head", "group-foot", "filters", "model", "before-models", "after-models"];
vi.mock("@delebash/ui", () => ({
  safeRequest: vi.fn(async () => null),
  request: vi.fn(),
  lastError: { value: null },
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  requestBlob: vi.fn(),
  postForm: vi.fn(),
  serverUrl: () => "",
  pageFlow: () => ({}),
  useModelApply: () => ({}),
  // the kit's area: each Speech slot rendered with the scope the kit tab gives it
  AiModelsArea: {
    props: ["runtimeTabs", "appTabs", "hwCells", "initialTab"],
    setup: (p, { slots }) => {
      seen.props = p;
      const group = { key: "pocket", label: "Pocket TTS" };
      const scope = { group, models: [], shown: [], refresh: () => {}, filters: {}, model: { id: "pocket-en" }, loaded: null, engine: {} };
      return () => h("div", SLOTS.map((n) => h("section", { "data-slot": n }, slots[`runtime-audiocpp-${n}`]?.(scope))));
    },
  },
}));
const stub = (name) => ({ default: { inheritAttrs: false, setup: (_p, { attrs }) => () => h("i", { "data-c": name, "data-engine": attrs["engine-id"] ?? attrs.engineId ?? "" }) } });
vi.mock("../components/SpeechEngineHead.vue", () => stub("head"));
vi.mock("../components/SpeechEngineFoot.vue", () => stub("foot"));
vi.mock("../components/SpeechFilters.vue", () => stub("filters"));
vi.mock("../components/SpeechModelFacts.vue", () => stub("model"));
vi.mock("../components/SpeechPickingCard.vue", () => stub("picking"));
vi.mock("../components/SpeechLoadedRail.vue", () => ({ default: { props: ["engine", "models", "refresh"], setup: (p) => () => h("i", { "data-c": "rail", "data-engine": p.engine ? "yes" : "" }) } }));
vi.mock("../components/SpeechProvidersPanel.vue", () => ({ default: { props: ["scope"], setup: (p) => () => h("i", { "data-c": `providers-${p.scope}` }) } }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: {}, name: "ai", fullPath: "/ai" }), useRouter: () => ({ replace: vi.fn() }) }));

const { default: AiPage } = await import("./AiPage.vue");
const { useEnginesStore } = await import("../stores/engines.js");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

test("the Speech tab is the kit's, with our pieces in its slots and our rules on its props", async () => {
  el = document.createElement("div");
  document.body.appendChild(el);
  const pinia = createPinia();
  setActivePinia(pinia);
  app = createTestApp(AiPage).use(pinia);
  app.mount(el);
  await nextTick();

  const inSlot = (n) => [...el.querySelectorAll(`[data-slot="${n}"] [data-c]`)].map((x) => x.dataset.c);
  expect(inSlot("group-head")).toEqual(["head"]);
  expect(el.querySelector('[data-slot="group-head"] [data-c]').dataset.engine).toBe("pocket");
  expect(inSlot("group-foot")).toEqual(["foot"]);
  expect(inSlot("filters")).toEqual(["filters"]);
  expect(inSlot("model")).toEqual(["model"]);
  expect(inSlot("before-models")).toEqual(["rail", "picking"]);
  expect(el.querySelector('[data-slot="before-models"] [data-c="rail"]').dataset.engine).toBe("yes"); // the tab's engine reaches it
  expect(inSlot("after-models")).toEqual(["providers-selfhosted", "providers-cloud"]);
  // no Speech engines tab of our own any more
  expect(seen.props.appTabs ?? []).toEqual([]);

  // its grouping by engine and its filter read our facts
  const engines = useEnginesStore();
  engines.items = [{ id: "pocket", name: "Pocket TTS", backend: "managed", kind: "tts", licence: { commercial: "Conditional" } }];
  engines.models = { pocket: [{ id: "pocket-en", voice_cloning: true }] };
  const { group, filter, onChanged, onTermsRequired } = seen.props.runtimeTabs.audiocpp.props;
  expect(group({ id: "pocket-en" })).toEqual({ key: "pocket", label: "Pocket TTS" });
  expect(filter({ id: "pocket-en", fit: "ok" }, { cloning: true, commercial: "Conditional" })).toBe(true);
  expect(filter({ id: "pocket-en", fit: "ok" }, { commercial: "Yes" })).toBe(false);

  // its `changed` reaches every surface; its `terms-required` opens the engine's terms with the retry
  const events = [];
  window.addEventListener("jv:health-refresh", () => events.push("refresh"));
  window.addEventListener("jv:engine-terms", (e) => events.push(e.detail));
  onChanged({ what: "load", id: "pocket-en" });
  const retry = () => {};
  onTermsRequired({ model: { id: "pocket-en" }, retry });
  expect(events).toEqual(["refresh", { engine: "pocket", onAccepted: retry }]);
});
