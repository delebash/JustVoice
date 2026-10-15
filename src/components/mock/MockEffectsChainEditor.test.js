// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The Effects chain editor's mock (decided 2026-10-15, the build's question 9): each step one row —
// its name, its settings inline with their units, ↑ ↓ Remove — with the editor's own "Add effect:",
// "A / B it" and "Order matters" as built.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { createTestApp } from "@delebash/llm-ui/quasar/install.js";

vi.mock("@vueuse/integrations/useSortable", () => ({ useSortable: () => {} }));
vi.mock("../PagePlayer.vue", () => ({ default: { render: () => null } }));
vi.mock("../PlayTransport.vue", () => ({ default: { render: () => null } }));
const slot = (tag, cls) => ({ setup: (_p, { slots }) => () => h(tag, { class: cls }, slots.default?.()) });
vi.mock("@delebash/llm-ui", () => ({
  pushToast: vi.fn(),
  Icon: { render: () => h("i") },
  UiButton: { props: ["label", "disabled"], setup: (p) => () => h("button", { disabled: p.disabled }, p.label) },
  UiCheckbox: { render: () => h("input", { type: "checkbox" }) },
  UiInput: { render: () => h("input") },
  UiNumber: { props: ["modelValue", "min", "max"], setup: (p) => () => h("input", { class: "num", value: p.modelValue, "data-min": p.min, "data-max": p.max }) },
  UiSelect: { render: () => h("select") },
  UiTag: slot("span"),
  AppModal: { setup: (_p, { slots }) => () => h("div", { class: "modal" }, [slots.default?.(), slots.footer?.()]) },
}));

const { default: MockEffectsChainEditor } = await import("./MockEffectsChainEditor.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

const CHAIN = [
  { type: "eq_low", params: { cutoff_frequency_hz: 120, gain_db: -2, q: 0.7 } },
  { type: "chorus", params: {} },
];

async function mount() {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(MockEffectsChainEditor, { open: true, modelValue: CHAIN, contextLabel: "June", persona: { name: "June" } });
  app.mount(el);
  for (let i = 0; i < 3; i++) await nextTick();
}

const rows = () => [...el.querySelectorAll(".jv-chain__step")];
const settings = (row) =>
  [...row.querySelectorAll(".jv-chain__setting")].map((s) =>
    [s.querySelector(".jv-chain__label").textContent, s.querySelector(".num").value, s.querySelector(".jv-chain__unit")?.textContent ?? ""].join(" ").trim());

test("each_step_is_one_row_with_its_settings_and_units", async () => {
  await mount();
  expect(rows().map((r) => r.querySelector(".jv-chain__name").textContent)).toEqual(["EQ — Low shelf", "Chorus"]);
  expect(settings(rows()[0])).toEqual(["Cutoff 120 Hz", "Gain -2 dB", "Q 0.7"]);
  // A knob the chain leaves out shows the catalog's default — Chorus's are the DSP's own.
  expect(settings(rows()[1])).toEqual(["Rate 1 Hz", "Depth 0.25", "Centre delay 7 ms", "Feedback 0", "Mix 0.5"]);
  expect(rows()[0].querySelector(".jv-chain__actions").textContent).toBe("↑↓Remove");
  expect(el.textContent).not.toContain("step 1");
});

test("the_dialogs_other_parts_are_the_editors", async () => {
  await mount();
  for (const words of ["Load from preset…", "The chain", "drag to reorder", "Add effect:", "Save chain to Effects library", "A / B it", "▶ Dry", "▶ Wet", "same take, chain on / off", "Order matters"]) {
    expect(el.textContent).toContain(words);
  }
});

test("down_moves_a_step", async () => {
  await mount();
  [...rows()[0].querySelectorAll("button")].find((b) => b.textContent === "↓").click();
  await nextTick();
  expect(rows().map((r) => r.querySelector(".jv-chain__name").textContent)).toEqual(["Chorus", "EQ — Low shelf"]);
});
