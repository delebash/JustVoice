// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// Channels doesn't claim routing it doesn't do (2026-10-15, P-also1): "Multi-device broadcast
// supported" is gone, and with no device list the form has no device field.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { createTestApp } from "@delebash/ui/quasar/install.js";

const stub = (tag) => ({ props: ["label", "modelValue"], setup: (p, { slots }) => () => h(tag, [p.label, slots.default?.()]) });
vi.mock("@delebash/ui", () => ({
  pushToast: vi.fn(),
  confirmDialog: vi.fn(),
  UiButton: stub("button"),
  UiInput: stub("input"),
  UiTextarea: stub("textarea"),
  UiField: stub("label"),
  UiCheckbox: stub("span"),
  UiTag: stub("span"),
  UiTable: { setup: (_p, { slots }) => () => h("div", slots.empty?.()) },
}));
vi.mock("../services/projects.js", () => ({ channelsService: { list: async () => ({ channels: [] }) } }));
vi.mock("../services/native.js", () => ({ listAudioOutputDevices: async () => [] }));

const { default: AudioChannelsSection } = await import("./AudioChannelsSection.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});

test("channels_claims_no_routing_it_lacks", async () => {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(AudioChannelsSection);
  app.mount(el);
  for (let i = 0; i < 3; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  expect(el.textContent).toContain("Route personas to specific audio outputs.");
  expect(el.textContent).not.toContain("Multi-device broadcast");
  expect(el.textContent).not.toContain("Devices (comma-separated IDs)");
});
