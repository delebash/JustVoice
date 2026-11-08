// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Make the audiobook — the one-click run's card (the one-click plan's slice 5), mounted in each
// state its mock draws (services/mock/bookRunMock.js): one start, the model each step runs on, the
// cost on a cloud route, the progress, the states a run stops in, and what to check afterwards.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const slot = (tag, cls) => ({ setup: (_p, { slots }) => () => h(tag, { class: cls }, slots.default?.()) });
vi.mock("@delebash/ui", () => ({
  withAiTask: vi.fn(),
  UiButton: {
    props: ["label", "disabled", "loading"],
    emits: ["click"],
    setup: (p, { emit }) => () => h("button", { disabled: p.disabled, onClick: () => emit("click") }, p.label),
  },
  UiProgress: { props: ["value", "max"], setup: (p) => () => h("progress", { value: p.value, max: p.max }) },
  UiCheckbox: {
    props: ["modelValue", "label"],
    emits: ["update:modelValue"],
    setup: (p, { emit }) => () =>
      h("label", { class: "checkbox" }, [
        h("input", { type: "checkbox", checked: p.modelValue, onChange: (e) => emit("update:modelValue", e.target.checked) }),
        p.label,
      ]),
  },
  UiTag: slot("span", "tag"),
  // The select as its options; a change sends the option's value.
  UiSelect: {
    props: ["modelValue", "options", "placeholder"],
    emits: ["update:modelValue"],
    setup: (p, { emit }) => () =>
      h("select", { class: "select", value: p.modelValue, onChange: (e) => emit("update:modelValue", e.target.value) }, [
        h("option", { value: "" }, p.placeholder),
        ...p.options.map((o) => h("option", { value: o.value }, o.label)),
      ]),
  },
  LuFeatureChip: {
    props: ["resolvedProviderName", "resolvedModel"],
    setup: (p) => () => h("span", { class: "chip" }, `${p.resolvedProviderName} · ${p.resolvedModel}`),
  },
  // The table as rows of cells, each column's slot or its value.
  UiTable: {
    props: ["data", "columns", "rowClass"],
    setup: (p, { slots }) => () =>
      h("table", [
        h("thead", [h("tr", p.columns.map((c) => h("th", c.header)))]),
        h("tbody", p.data.map((row) => h("tr", { class: p.rowClass?.(row) || "" }, p.columns.map((c) => h("td", slots[c.id] ? slots[c.id]({ row }) : String(row[c.id] ?? "")))))),
      ]),
  },
}));

const { default: BookRunCard } = await import("./BookRunCard.vue");
const { REVIEW, UNIT, mockPlan, mockRun } = await import("../services/mock/bookRunMock.js");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

async function mount(props) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const events = [];
  app = createTestApp(BookRunCard, {
    unit: UNIT,
    ...props,
    ...Object.fromEntries(["onStart", "onStop", "onResume", "onSave", "onGo", "onRouting", "onStopForCast", "onVoiceSet"].map((k) => [k, (...a) => events.push([k, ...a])])),
  });
  app.mount(el);
  for (let i = 0; i < 3; i++) await nextTick();
  return events;
}

const text = (sel) => [...el.querySelectorAll(sel)].map((n) => n.textContent.trim());
const buttons = () => text("button");
const headers = () => text(".book-run__steps thead th");
const cells = (row) => [...el.querySelectorAll(".book-run__steps tbody tr")[row].querySelectorAll("td")].map((n) => n.textContent.trim());

test("before a run: one start, each step's model, nothing to pay on this computer", async () => {
  const events = await mount({ plan: mockPlan(), run: null });
  expect(el.querySelector(".jv-card__title").textContent).toBe("Make the audiobook");
  expect(headers()).toEqual(["Step", "Runs on"]);
  expect(cells(0)).toEqual(["Discover the speakers", "Built-in provider — llama.cpp · gemma-4-26b-a4b-qat"]);
  expect(cells(3)).toEqual(["Analyze — who speaks each line", "Built-in provider — llama.cpp · gemma-4-26b-a4b-qatLocal"]);
  expect(cells(6)).toEqual(["Design the voices", "Qwen3-TTS VoiceDesign → VoxCPM2 · narrator Fish Audio Drama 3 Commercial use: Conditional"]);
  // The narrator's licence word, as the Speech tab shows it, its hover the licence's words (the
  // characters' VoxCPM2 is a plain Yes: no chip).
  const chip = el.querySelector(".book-run__steps .ev-lic");
  expect(chip.className).toBe("ev-lic ev-lic--warn");
  expect(chip.title).toContain("Fish Audio Community License v1.0 · JustVoice's reading, checked 2026-10-18");
  expect(cells(9)).toEqual(["Render every line", "Each speaker's persona"]);
  expect(cells(11)).toEqual(["Master and export the M4B", "FFmpeg"]);
  expect(el.querySelector(".book-run__cost").textContent).toContain("nothing to pay");
  expect(buttons()).toEqual(["▶ Make audiobook"]);
  await new DOMWrapper(el.querySelector("button")).trigger("click");
  expect(events).toEqual([["onStart"]]);
});

test("on a cloud route: each step's estimate, the price on the button", async () => {
  await mount({ plan: mockPlan({ frontier: true }), run: null });
  expect(headers()).toEqual(["Step", "Runs on", "Estimate"]);
  expect(cells(3)).toEqual(["Analyze — who speaks each line", "Claude (Anthropic) · claude-opus-5-5Frontier", "23,200 tokens · $0.34"]);
  expect(buttons()).toEqual(["▶ Make audiobook — up to about $0.76"]);
});

test("blocked: what is in the way, and no start", async () => {
  await mount({ plan: mockPlan({ blocked: true }), run: null });
  expect(text(".jv-banner--warn")).toEqual([
    "No language model is set up for the AI steps. AI Settings ➜",
    "Set the book's Language below first — its voices are made in it.",
    "Fish Audio Drama 3's licence isn't accepted on this computer. Accept it to make the narrator's voice. Fish Audio Drama 3's licence ➜",
  ]);
  expect(cells(0)[1]).toBe("No model set");
  expect(el.querySelector("button[disabled]")?.textContent).toBe("▶ Make audiobook");
});

test("blocked by a licence: its link opens the engine's licence to accept", async () => {
  const events = await mount({ plan: mockPlan({ blocked: true }), run: null });
  await new DOMWrapper([...el.querySelectorAll("button")].find((b) => b.textContent === "Fish Audio Drama 3's licence ➜")).trigger("click");
  expect(events).toEqual([["onGo", "terms", "fish_drama3"]]);
});

test("Voices: the voices you can sell, or the best acting not for sale — picked before a run", async () => {
  const events = await mount({ plan: mockPlan(), run: null });
  const select = el.querySelector(".book-run__voices select");
  expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
    "Your own models",
    "Voices you can sell — VoxCPM2 · narrator Fish Audio Drama 3",
    "Best acting — not for sale — BreezeTTS 2",
  ]);
  expect(select.value).toBe("sell");
  expect(el.querySelector(".book-run__voices .ev-lic").textContent).toBe("Commercial use: Conditional");
  select.value = "best";
  await new DOMWrapper(select).trigger("change");
  expect(events.map(([k, set]) => [k, set.key, set.clone_model])).toEqual([["onVoiceSet", "best", "breeze_tts"]]);
});

test("Voices isn't offered while a run goes on", async () => {
  await mount({ plan: mockPlan(), run: mockRun("running"), elapsed: 1 });
  expect(el.querySelector(".book-run__voices")).toBeNull();
});

test("running: the step and chapter it is on, the time so far, Stop", async () => {
  const events = await mount({ plan: mockPlan(), run: mockRun("running"), elapsed: 784 });
  expect(text(".tag")).toContain("Running");
  expect(headers()).toEqual(["Step", "Runs on", "Status"]);
  expect(el.querySelector(".book-run__progress .jv-hint").textContent).toBe(
    "Direction · 1 of 2 chapters — CHAPTER VIII. The Queen’s Croquet-Ground · 13:04 so far · 64,132 tokens in",
  );
  expect(el.querySelectorAll(".jv-row--selected").length).toBe(1);
  expect(cells(8)[2]).toBe("Running · 1 of 2 chapters — CHAPTER VIII. The Queen’s Croquet-Ground");
  expect(buttons()).toEqual(["Stop"]);
  await new DOMWrapper(el.querySelector("button")).trigger("click");
  expect(events).toEqual([["onStop"]]);
});

test("before a run: the stop when the cast is ready is on, and clearing it says so", async () => {
  const events = await mount({ plan: mockPlan(), run: null });
  const box = el.querySelector(".book-run__option input");
  expect(el.querySelector(".book-run__option").textContent).toBe("Stop when the cast is ready, to hear the voices before the render");
  expect(box.checked).toBe(true);
  box.checked = false;
  await new DOMWrapper(box).trigger("change");
  expect(events).toEqual([["onStopForCast", false]]);
});

test("the cast is ready: the run waits before the render, the note opens Cast, Continue goes on", async () => {
  const events = await mount({ plan: mockPlan(), run: mockRun("waiting") });
  expect(text(".tag")).toContain("Waiting for you");
  expect(el.querySelector(".jv-banner--info").textContent).toContain(
    "The cast is ready. Listen to each voice on Cast and change any you want, then Continue — it renders every line, checks the takes and makes the M4B.",
  );
  expect(cells(8)[2]).toBe("Done · 2 chapters");
  for (const row of [9, 10, 11]) expect(cells(row)[2]).toBe("Waiting");
  expect(el.querySelector(".book-run__option")).toBeNull(); // set before a run, not while one waits
  expect(buttons()).toEqual(["Open Cast ➜", "▶ Continue"]);
  await new DOMWrapper([...el.querySelectorAll("button")].find((b) => b.textContent === "Open Cast ➜")).trigger("click");
  await new DOMWrapper([...el.querySelectorAll("button")].find((b) => b.textContent === "▶ Continue")).trigger("click");
  expect(events).toEqual([["onGo", "cast"], ["onResume"]]);
});

test("no FFmpeg yet: the export step says so, and the note opens AI Settings → FFmpeg", async () => {
  const events = await mount({ plan: mockPlan({ noFfmpeg: true }), run: null });
  expect(cells(11)).toEqual(["Master and export the M4B", "FFmpeg — not installed"]);
  expect(el.querySelector(".jv-banner--info").textContent)
    .toContain("FFmpeg isn't installed, so the run will stop before the M4B. Install it in AI Settings → FFmpeg, then Resume.");
  await new DOMWrapper(el.querySelector(".jv-banner--info button")).trigger("click");
  expect(events).toEqual([["onGo", "ai", "runtime-ffmpeg"]]);
});

test("paused after a restart, stopped, or stopped on a problem: why, and Resume", async () => {
  await mount({ plan: mockPlan(), run: mockRun("paused") });
  expect(text(".tag")).toContain("Paused");
  expect(el.querySelector(".jv-banner--warn").textContent).toContain("The app closed while this ran.");
  expect(buttons()[0]).toBe("▶ Resume");
  app.unmount();
  el.remove();
  await mount({ plan: mockPlan(), run: mockRun("failed") });
  expect(text(".tag")).toContain("Stopped on a problem");
  expect(el.querySelector(".jv-banner--danger").textContent).toContain("FFmpeg isn't installed");
  expect(el.querySelectorAll(".jv-row--attention").length).toBe(1);
  expect(cells(11)[2]).toBe("Stopped here");
});

test("done: the M4B to save, what to check with a link to each, and the run's numbers", async () => {
  const events = await mount({ plan: mockPlan(), run: mockRun("done") });
  expect(text(".tag")).toContain("Done");
  expect(el.querySelector(".jv-banner--success").textContent).toBe("Done. Made in 42:38 · 67,512 tokens in, 9,236 out.");
  expect(buttons().slice(0, 2)).toEqual(["⬇ Save the M4B", "↻ Run again"]);
  const review = [...el.querySelectorAll(".book-run__review tbody tr")].map((r) => r.textContent);
  expect(review.length).toBe(4);
  expect(review[2]).toContain("line 23 — its take misses words");
  await new DOMWrapper(el.querySelectorAll(".book-run__review button")[0]).trigger("click");
  expect(events.at(-1)).toEqual(["onGo", "script", { sceneId: REVIEW.script[0].scene_id, focus: "check" }]);
  expect(el.querySelector(".book-run__numbers summary").textContent).toBe("Model, tokens and time for each step");
  expect(el.querySelectorAll(".book-run__numbers tbody tr").length).toBe(12);
});
