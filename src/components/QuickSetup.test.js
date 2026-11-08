// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The voice engine setup's confirm step says what the speech runtime's download costs on this
// computer — the kit's own size for the build it picks here (the runtime status's
// `downloadBytes`, the field the kit's Speech tab shows), never a typed range.
import { h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, test, vi } from "vitest";
import { createApp } from "vue";

const status = vi.hoisted(() => ({ downloadBytes: 0, picks: null }));
vi.mock("../stores/api.js", () => ({
  useApi: () => ({
    safeRequest: vi.fn(async (url, fallback) => {
      if (url === "/v1/ai/runtimes/audiocpp/engine/status") return { installed: false, downloadBytes: status.downloadBytes };
      if (url === "/v1/book-voices/picks") return status.picks ?? fallback;
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
  reportError: vi.fn(),
  errorText: (e) => String(e?.message ?? e),
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
  // the engines step reads the voice sets' best picks from their store (latest-models D12)
  const pinia = createPinia();
  setActivePinia(pinia);
  app = createApp(QuickSetup).use(pinia);
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

test("the engines step says the voices for books: each best pick, its mark and its commercial use (latest-models D12)", async () => {
  status.picks = {
    picks: [
      { model: "voxcpm2", engine: "voxcpm2", name: "VoxCPM2", set: "sell", label: "Best voices you can sell", sellable: true, commercial: "Yes", roles: ["characters"] },
      { model: "fish_drama3-fishdrama3", engine: "fish_drama3", name: "Fish Audio Drama 3", set: "sell", label: "Best voices you can sell", sellable: true, commercial: "Conditional", roles: ["narrator"] },
      { model: "breeze_tts", engine: "breeze_tts", name: "BreezeTTS 2", set: "best", label: "Best acting — not for sale", sellable: false, commercial: "Separate licence", roles: ["characters", "narrator"] },
    ],
  };
  try {
    await mount();
    const text = (r, sel) => r.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? null;
    const rows = [...el.querySelectorAll(".quick-setup__picks .jv-inline-row")].map((r) => [text(r, ".quick-setup__engine-name"), text(r, ".ev-pick"), text(r, ".ev-lic")]);
    expect(rows).toEqual([
      ["VoxCPM2", "Best voices you can sell · plays the characters", "Commercial use: Yes"],
      ["Fish Audio Drama 3", "Best voices you can sell · narrates", "Commercial use: Conditional"],
      ["BreezeTTS 2", "Best acting — not for sale · plays the characters and narrates", "Commercial use: Separate licence"],
    ]);
    expect(el.querySelector(".quick-setup__picks .ev-pick--not-for-sale")?.textContent).toBe("Best acting — not for sale · plays the characters and narrates");
  } finally {
    status.picks = null;
  }
});
