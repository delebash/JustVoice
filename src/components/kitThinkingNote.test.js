// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The kit's thinking control under a model that can't stop thinking (Claude Opus 5.5, Fable,
// Mythos — the narrowings review, P41, approved 2026-10-15): Off sends effort "low" (the kit's
// Claude adapter), and the control says "This model always thinks — Off makes it think less."
// for those models only. The model's fact comes from the resolved route (`alwaysThinks`). Both
// surfaces that render the control are mounted: the Lab's ConfigColumn (JustVoice's AI console)
// and the feature chip's popover. Mounted with plain `createApp`; fetch is stubbed (JustWrite's
// LuFeatureChip.save.test.js is the donor harness).
import { createPinia } from "pinia";
import { h, nextTick } from "vue";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DOMWrapper } from "@vue/test-utils";
import ConfigColumn from "@delebash/ui/components/ConfigColumn.vue";
import LuFeatureChip from "@delebash/ui/components/LuFeatureChip.vue";
// Quasar installed as in the real app — the kit's controls are Quasar components
import { createTestApp } from "@delebash/ui/quasar/install.js";
import { i18n } from "../i18n/index.js";

const NOTE = "This model always thinks — Off makes it think less.";
const CLAUDE = { id: "claude", name: "Anthropic", type: "anthropic" };
const ROUTE = {
  feature: "critique", action: "", providerId: "claude", model: "claude-opus-5-5",
  presetId: "p1", presetName: "Judgment", presetSource: "assigned",
  think: false, level: "", reasoningWord: "", value: null, valueSource: "",
  configured: true, detail: "", context: null, alwaysThinks: true,
};
// The models the stubbed server says can't stop thinking (the adapter's GENERATIONS decide it).
const ALWAYS = new Set(["claude-opus-5-5", "claude-fable-5-1"]);

let app;
let host;
let presetModel = ROUTE.model; // the chip seeds its pin from the preset

function jsonOk(obj) {
  return {
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : "") },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = new URL(String(url), "http://127.0.0.1:17494");
    if (u.pathname === "/v1/ai/resolved-route") {
      const model = u.searchParams.get("model") || ROUTE.model;
      return jsonOk({ ...ROUTE, model, alwaysThinks: ALWAYS.has(model) });
    }
    if (u.pathname === "/v1/llm-providers") return jsonOk({ providers: [CLAUDE] });
    if (u.pathname === "/v1/ai/engine-presets") {
      return jsonOk({ presets: [{ id: "p1", name: "Judgment", providerId: "claude", model: presetModel, think: false, reasoningEffort: "" }] });
    }
    if (u.pathname === "/v1/ai/preset-assignments") return jsonOk({ features: { critique: "p1" } });
    if (u.pathname.startsWith("/v1/ai/reasoning-map/")) {
      return jsonOk({ provider: "claude", rows: ["low", "medium", "high", "xhigh", "max"].map((level) => ({ level, word: level, tokens: null })) });
    }
    return jsonOk({});
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  host?.remove();
  vi.unstubAllGlobals();
});

async function flush(times = 15) {
  for (let i = 0; i < times; i++) {
    await nextTick();
    await Promise.resolve();
  }
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

async function mountColumn(model) {
  app = createTestApp({
    render: () => h(ConfigColumn, {
      action: "critique",
      providers: [CLAUDE],
      modelValue: { pin: { providerId: "claude", model }, reasoningEffort: "", samplers: [] },
    }),
  });
  app.directive("tooltip", {}); // host-registered in the real app; a no-op here
  app.use(createPinia()).use(i18n);
  app.mount(host);
  await flush();
}

test("the Lab column says it under a model that always thinks", async () => {
  await mountColumn("claude-opus-5-5");
  expect(host.textContent).toContain(NOTE);
});

test("the Lab column says nothing under a model that can turn thinking off", async () => {
  await mountColumn("claude-sonnet-5-5");
  expect(host.querySelector(".cc-reason")).toBeTruthy(); // the Reasoning control is there
  expect(host.textContent).not.toContain(NOTE);
});

async function openChip(route, pinned = route.model) {
  presetModel = pinned;
  app = createTestApp({
    render: () => h(LuFeatureChip, {
      feature: "critique", label: "Critique", editable: true, route,
      resolvedProviderName: "Anthropic", resolvedModel: route.model,
    }),
  });
  app.directive("tooltip", {});
  app.use(i18n);
  app.mount(host);
  await flush();
  await new DOMWrapper(document.querySelector(".afc-chip")).trigger("click");
  await flush();
}

test("the feature chip's popover says it for the route's model", async () => {
  await openChip(ROUTE);
  expect(document.body.textContent).toContain(NOTE);
});

test("the feature chip's popover says nothing when the route's model can turn thinking off", async () => {
  await openChip({ ...ROUTE, model: "claude-sonnet-5-5", alwaysThinks: false });
  expect(document.body.textContent).toContain("Thinking");
  expect(document.body.textContent).not.toContain(NOTE);
});

test("the feature chip follows a repointed pin: the server's answer for the new model", async () => {
  // The preset pins Fable 5.1 while the route the popover opened on is Sonnet 5.5 — the pin being
  // written decides, so the route is asked for Fable 5.1.
  await openChip({ ...ROUTE, model: "claude-sonnet-5-5", alwaysThinks: false }, "claude-fable-5-1");
  expect(document.body.textContent).toContain(NOTE);
});
