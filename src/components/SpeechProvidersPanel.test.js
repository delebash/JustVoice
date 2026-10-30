// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The speech servers you run and the cloud speech APIs (AI Settings → Speech, SpeechProvidersPanel):
// Save and Remove take effect at once — through the server's own routes, which register and unregister
// the provider live and keep settings.engines.external (POST /v1/engines/external, DELETE
// /v1/engines/external/{id}) — never a settings PATCH, which the running server reads only at its next
// start. A blank key on an edit keeps the saved one.
import { h } from "vue";
import { createPinia } from "pinia";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const api = vi.hoisted(() => ({ request: vi.fn(), safeRequest: vi.fn(), get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
const ui = vi.hoisted(() => ({ confirmDialog: vi.fn(), pushToast: vi.fn() }));
vi.mock("@delebash/ui", () => ({
  ...api,
  ...ui,
  lastError: { value: null },
  requestBlob: vi.fn(),
  postForm: vi.fn(),
  serverUrl: () => "",
  getServerToken: () => "",
  setServerToken: vi.fn(),
  UiButton: {
    props: ["label"],
    emits: ["click"],
    setup: (p, { emit }) => () => h("button", { onClick: () => emit("click") }, p.label),
  },
}));
// the form: Save and Remove, with what the user typed
const typed = vi.hoisted(() => ({ payload: null }));
vi.mock("./TtsProviderForm.vue", () => ({
  default: {
    emits: ["save", "cancel", "delete"],
    setup: (_p, { emit }) => () =>
      h("div", { class: "form" }, [
        h("button", { class: "save", onClick: () => emit("save", typed.payload) }, "Save"),
        h("button", { class: "remove", onClick: () => emit("delete") }, "Remove provider"),
      ]),
  },
}));

const { default: SpeechProvidersPanel } = await import("./SpeechProvidersPanel.vue");

const SAVED = { id: "kokoro-local", name: "Kokoro server", provider_type: "openai-compat", base_url: "http://localhost:8880", api_key: "secret", model: "kokoro", voices: [], response_format: "wav", self_hosted: true };
let wrapper;
beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(ui)]) fn.mockReset();
  api.safeRequest.mockResolvedValue({ engines: { external: [SAVED] } });
  api.request.mockImplementation(async (url) => (url === "/v1/settings" ? { engines: { external: [SAVED] } } : {}));
});
afterEach(() => wrapper?.unmount());

const calls = () => api.request.mock.calls.map(([url, o]) => [o?.method || "GET", url, o?.body ? JSON.parse(o.body) : undefined]);

test("an edit's Save registers it at once through the server's route, keeping the saved key", async () => {
  wrapper = mount(SpeechProvidersPanel, { props: { scope: "selfhosted" }, global: { plugins: [createPinia()] } });
  await flushPromises();
  await wrapper.findAll("button").find((b) => b.text() === "Edit").trigger("click");
  typed.payload = { id: "kokoro-local", name: "Kokoro (desk)", providerType: "openai-compat", baseUrl: "http://localhost:8880", apiKey: "", tts_model: "kokoro", voices: ["af_bella"], response_format: "wav", self_hosted: true };
  await wrapper.find(".save").trigger("click");
  await flushPromises();
  const writes = calls().filter(([m]) => m !== "GET");
  expect(writes).toEqual([
    ["POST", "/v1/engines/external", { id: "kokoro-local", name: "Kokoro (desk)", provider_type: "openai-compat", base_url: "http://localhost:8880", api_key: "secret", model: "kokoro", voices: ["af_bella"], response_format: "wav", self_hosted: true }],
  ]);
  expect(ui.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Kokoro (desk) saved." }));
});

test("Remove unregisters it at once through the server's route", async () => {
  wrapper = mount(SpeechProvidersPanel, { props: { scope: "selfhosted" }, global: { plugins: [createPinia()] } });
  await flushPromises();
  await wrapper.findAll("button").find((b) => b.text() === "Edit").trigger("click");
  ui.confirmDialog.mockResolvedValue(true);
  await wrapper.find(".remove").trigger("click");
  await flushPromises();
  expect(calls().filter(([m]) => m !== "GET")).toEqual([["DELETE", "/v1/engines/external/kokoro-local", undefined]]);
  expect(ui.pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "Kokoro server deleted." }));
});
