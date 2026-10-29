// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// What JustVoice puts in the kit's Speech tab (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md
// §4 step 5): an engine's foot — its licence and Delete downloaded models through the kit's own
// Delete — and a model's facts — its chips, and its load options saved through our route, the model
// loaded again through the kit's Load service (loadRuntimeModel) when the server let it go — and the Loaded now rail above the
// models, with Unload through the kit's route.
import { readFileSync } from "node:fs";
import { h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";
import { i18n } from "../i18n/index.js";

const api = vi.hoisted(() => ({ del: vi.fn(), put: vi.fn(), post: vi.fn(), safeRequest: vi.fn(), request: vi.fn(), patch: vi.fn() }));
const ui = vi.hoisted(() => ({ confirmDialog: vi.fn(), pushToast: vi.fn(), reportError: vi.fn(), openExternal: vi.fn(), loadRuntimeModel: vi.fn() }));
vi.mock("@delebash/ui", () => ({
  ...api,
  ...ui,
  lastError: { value: null },
  get: vi.fn(),
  requestBlob: vi.fn(),
  postForm: vi.fn(),
  serverUrl: () => "",
  languageName: (c) => ({ en: "English", ja: "Japanese" })[c] || "",
  UiButton: {
    props: ["label", "intent"],
    emits: ["click"],
    setup: (p, { emit }) => () => h("button", { onClick: () => emit("click") }, p.label),
  },
  UiSelect: {
    props: ["modelValue", "options"],
    emits: ["update:modelValue"],
    setup: (p, { emit }) => () =>
      h("select", { value: p.modelValue, onChange: (e) => emit("update:modelValue", e.target.value) }, p.options.map((o) => h("option", { value: o.value }, o.label))),
  },
  UiChip: {
    props: ["selected"],
    emits: ["click"],
    setup: (p, { emit, slots }) => () => h("button", { class: p.selected ? "chip on" : "chip", onClick: () => emit("click") }, slots.default?.()),
  },
}));
vi.mock("./DeliveryKnobs.vue", () => ({ default: { props: ["knobs"], setup: (p) => () => h("div", { class: "knobs" }, p.knobs.map((k) => k.label).join(",")) } }));

const { default: SpeechEngineFoot } = await import("./SpeechEngineFoot.vue");
const { default: SpeechEngineHead } = await import("./SpeechEngineHead.vue");
const { default: SpeechFilters } = await import("./SpeechFilters.vue");
const { default: SpeechModelFacts } = await import("./SpeechModelFacts.vue");
const { default: SpeechLoadedRail } = await import("./SpeechLoadedRail.vue");
const { useEnginesStore } = await import("../stores/engines.js");

const POCKET = { id: "pocket", name: "Pocket TTS", kind: "tts", backend: "managed", terms: { gates: "download", owner: "Kyutai" }, terms_accepted: false };
const QWEN = { id: "qwen3", name: "Qwen3-TTS", kind: "tts", backend: "managed", catalog_status: "supported", default_variant_id: "qwen3-cv-0.6b" };
const VARIANT = {
  id: "qwen3-cv-1.7b",
  name: "Qwen3-TTS CustomVoice 1.7B",
  description: "Nine voices you direct in words.",
  languages: ["en", "ja"],
  voice_cloning: false,
  preset_voices: 9,
  directed_by: "words",
  hf_repo: "org/qwen3",
  runtime_options: [
    { key: "qwen3_tts.attn", label: "Attention", type: "choice", featured: true, value: "flash", default: "flash", choices: [{ value: "flash", label: "Flash" }, { value: "eager", label: "Eager" }] },
    { key: "qwen3_tts.pool", label: "Memory pool", type: "number", featured: false, value: null, default: "0", choices: [] },
  ],
};

let app;
let el;
beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of [...Object.values(api), ...Object.values(ui)]) fn.mockReset();
});
afterEach(() => {
  app?.unmount();
  el?.remove();
});

async function mount(component, props) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const pinia = createPinia();
  setActivePinia(pinia);
  const engines = useEnginesStore();
  engines.items = [POCKET, QWEN];
  engines.loaded = true;
  engines.models = { qwen3: [VARIANT] };
  app = createTestApp(component, props).use(pinia).use(i18n);
  app.mount(el);
  await nextTick();
  return engines;
}
const texts = (sel) => [...el.querySelectorAll(sel)].map((n) => n.textContent.trim());
const flush = () => new Promise((r) => setTimeout(r, 0));

test("an engine's foot says its licence waits, and deletes each of its downloaded models through the kit", async () => {
  const refresh = vi.fn();
  const models = [{ id: "pocket-en", name: "Pocket EN", onDisk: true }, { id: "pocket-fr", name: "Pocket FR", onDisk: false }, { id: "pocket-de", name: "Pocket DE", onDisk: true }];
  await mount(SpeechEngineFoot, { engineId: "pocket", models, refresh });
  expect(el.querySelector(".ev-gfoot span").textContent).toBe("Downloads wait until you accept its licence (Kyutai)");
  expect(texts("button")).toEqual(["Read and accept", "Delete downloaded models"]);

  ui.confirmDialog.mockResolvedValue(true);
  api.del.mockResolvedValue({});
  await new DOMWrapper(el.querySelectorAll("button")[1]).trigger("click");
  await flush();
  expect(api.del.mock.calls.map((c) => c[0])).toEqual(["/v1/ai/runtimes/audiocpp/models/pocket-en", "/v1/ai/runtimes/audiocpp/models/pocket-de"]);
  expect(refresh).toHaveBeenCalledOnce();
  expect(ui.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Pocket TTS models deleted." }));
});

test("a model's facts: its chips, its description, Hugging Face and Set as default", async () => {
  await mount(SpeechModelFacts, { model: { id: "qwen3-cv-1.7b", loading: "" } });
  expect(texts(".ev-cap")).toEqual(["2 languages", "BUILT-IN · 9", "✓ WRITTEN DIRECTION", "SUPPORTED"]);
  expect(el.querySelector(".ev-mfacts__desc").textContent).toBe("Nine voices you direct in words.");
  expect(texts("button")).toEqual(["View on Hugging Face", "Set as default"]);
  expect(el.querySelector(".knobs").textContent).toBe("Memory pool");
  expect(el.querySelector("summary").textContent).toBe("Load options (1)");
});

test("a changed load option is saved through our route, and the model the server let go loads again through the kit", async () => {
  const refresh = vi.fn();
  await mount(SpeechModelFacts, { model: { id: "qwen3-cv-1.7b", loading: "" }, refresh });
  api.put.mockResolvedValue({ reload: true });
  api.safeRequest.mockResolvedValue({ variants: [VARIANT] });
  ui.loadRuntimeModel.mockResolvedValue({ status: "loaded", held: { modelId: "qwen3-cv-1.7b" }, started: true });
  const select = el.querySelector(".ev-mplace select");
  select.value = "eager";
  select.dispatchEvent(new Event("change"));
  await flush();
  await flush();
  expect(api.put).toHaveBeenCalledWith("/v1/engines/qwen3/models/qwen3-cv-1.7b/runtime-options", { options: { "qwen3_tts.attn": "eager" } });
  expect(ui.loadRuntimeModel).toHaveBeenCalledWith("audiocpp", "qwen3-cv-1.7b", expect.objectContaining({ label: "Qwen3-TTS CustomVoice 1.7B" }));
  expect(api.post).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(2); // as it starts loading, and once it has
  // a licence its load waits for opens our terms dialog, which loads it again once accepted
  const terms = [];
  const heard = (ev) => terms.push(ev.detail.engine);
  window.addEventListener("jv:engine-terms", heard);
  ui.loadRuntimeModel.mock.calls[0][2].onTermsRequired({ model: { id: "qwen3-cv-1.7b" }, retry: vi.fn() });
  window.removeEventListener("jv:engine-terms", heard);
  expect(terms).toEqual(["qwen3"]);
});

test("an engine's head: its kind, its licence in plain words, testing, and Set as default saved as the default speech engine", async () => {
  const engines = await mount(SpeechEngineHead, { engineId: "pocket" });
  engines.items = [{ ...POCKET, licence: { name: "CC-BY-4.0", commercial: "Conditional", table: "Conditional", summary: "Credit Kyutai.", checked: "2026-10-11", url: "" }, tested: null, best_for: ["cloning"], description: "Clones on the CPU." }];
  await nextTick();
  expect(texts(".ev-caps > span")).toEqual(["TTS", "Commercial use: Conditional", "NOT TESTED BY JUSTVOICE YET"]);
  expect(texts(".ev-gnote > span")[0]).toBe("Clones on the CPU.");
  expect(texts(".ev-gnote > span")[1]).toBe("Best for: cloning");
  api.patch.mockResolvedValue({});
  await new DOMWrapper(el.querySelector("button")).trigger("click");
  await flush();
  expect(api.patch).toHaveBeenCalledWith("/v1/settings", { engines: { default_tts_engine: "pocket" } });
  expect(texts("button")).toEqual(["Default ✓"]);
});

test("the filters edit the tab's own object; Fits this card shows only with a card of its own", async () => {
  const filters = {};
  api.safeRequest.mockResolvedValue({ vramTotalMb: 8192, memArch: "discrete" });
  await mount(SpeechFilters, { filters });
  await flush();
  expect(texts(".chip")).toEqual(["Cloning", "Built-in voices", "Tested by JustVoice", "Takes direction", "Fits this card"]);
  await new DOMWrapper(el.querySelectorAll(".chip")[0]).trigger("click");
  expect(filters.cloning).toBe(true);
  // the sort, last (the engine list's second row): by name until one is picked
  const sort = el.querySelector("select[aria-label='Sort']");
  expect([...sort.options].map((o) => o.textContent)).toEqual(["Sort: name", "Sort: download size", "Sort: memory needed", "Sort: commercial use"]);
  expect(sort.value).toBe("name");
  sort.value = "memory";
  sort.dispatchEvent(new Event("change"));
  expect(filters.sort).toBe("memory");
});

test("Loaded now: what each kind holds, where it runs, and Unload through the kit's route", async () => {
  const refresh = vi.fn();
  const engine = { kinds: ["tts", "stt"], loaded: [{ modelId: "qwen3-cv-1.7b", placement: "gpu", kind: "tts", reason: "Fits the card" }] };
  await mount(SpeechLoadedRail, { engine, models: [{ id: "qwen3-cv-1.7b", name: "Qwen3-TTS CustomVoice 1.7B" }], refresh });
  expect(el.querySelector(".ev-rail-h").textContent).toBe("Loaded now");
  expect(texts(".ev-slot .k")).toEqual(["Speech", "Transcription"]);
  expect(texts(".ev-slot .nm")).toEqual(["Qwen3-TTS CustomVoice 1.7B", "— nothing loaded"]);
  // where it runs: the canonical quiet line (.jv-hint, design-law's 12.5px floor)
  expect(el.querySelector(".ev-slot .jv-hint").textContent).toBe("Graphics card");
  expect(el.querySelector(".ev-slot .jv-hint").title).toBe("Fits the card");
  expect(texts("button")).toEqual(["Unload"]);

  api.post.mockResolvedValue({});
  const events = [];
  const heard = () => events.push("refresh");
  window.addEventListener("jv:health-refresh", heard);
  await new DOMWrapper(el.querySelector("button")).trigger("click");
  await flush();
  window.removeEventListener("jv:health-refresh", heard);
  expect(api.post).toHaveBeenCalledWith("/v1/ai/runtimes/audiocpp/models/qwen3-cv-1.7b/unload", {});
  expect(events).toEqual(["refresh"]);
  expect(refresh).toHaveBeenCalledOnce();
});

test("Loaded now's text is never below design-law's 12.5px floor", () => {
  const css = readFileSync("src/css/app.scss", "utf8") // the run's folder is the app's (jsdom has no file: URL);
  const rules = css.split(/\r?\n/).filter((l) => /^\.ev-(rail|slot)/.test(l));
  expect(rules.length).toBeGreaterThan(0);
  const sizes = rules.flatMap((l) => [...l.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])));
  expect(sizes.filter((px) => px < 12.5)).toEqual([]);
});

test("Loaded now isn't shown while the runtime keeps no loaded set (not installed)", async () => {
  await mount(SpeechLoadedRail, { engine: { installed: false }, models: [] });
  expect(el.querySelector(".ev-rail")).toBe(null);
});
