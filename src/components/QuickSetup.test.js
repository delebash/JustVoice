// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The voice engine setup's confirm step says what the speech runtime's download costs on this
// computer — the kit's own size for the build it picks here (the runtime status's
// `downloadBytes`, the field the kit's Speech tab shows), never a typed range.
import { h, nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
import { createApp } from "vue";

const status = vi.hoisted(() => ({ downloadBytes: 0 }));
vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    safeRequest: vi.fn(async (url, fallback) => {
      if (url === "/v1/ai/runtimes/audiocpp/engine/status") return { installed: false, downloadBytes: status.downloadBytes };
      if (url === "/v1/system/info") return { gpus: [{ name: "RTX 4060", vram_mb: 8188 }] };
      return fallback;
    }),
    request: vi.fn(async () => ({})),
  }),
}));
const stub = (tag = "div") => ({ setup: (_p, { slots }) => () => h(tag, slots.default?.()) });
vi.mock("@delebash/ui", () => ({
  AppModal: { setup: (_p, { slots }) => () => h("div", [slots.default?.(), slots.footer?.()]) },
  DownloadBar: stub(),
  UiButton: stub("button"),
  UiCheckbox: stub("span"),
  UiSelect: stub("span"),
  UiTag: stub("span"),
  createDownloadTask: vi.fn(),
  fmtBytes: (b) => `${Math.round(b / 1024 / 1024)} MB`,
  pushToast: vi.fn(),
  runtimeEngineChannel: vi.fn(),
}));
const { default: QuickSetup } = await import("./QuickSetup.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
});
const flush = () => new Promise((r) => setTimeout(r, 0));
async function mount() {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createApp(QuickSetup);
  app.mount(el);
  for (let i = 0; i < 4; i++) await flush();
  await nextTick();
  return el.querySelector(".quick-setup__note--est").textContent.replace(/\s+/g, " ").trim();
}

test("the speech runtime's download is the kit's size for this computer", async () => {
  status.downloadBytes = 1024 * 1024 * 1024;
  const note = await mount();
  expect(note).toContain("Every engine runs on one speech runtime — it downloads now (about 1024 MB for this computer).");
  expect(note).not.toContain("460");
});

test("with no size from the kit, the sentence says none", async () => {
  status.downloadBytes = 0;
  const note = await mount();
  expect(note).toContain("Every engine runs on one speech runtime — it downloads now. Each engine's model");
});
