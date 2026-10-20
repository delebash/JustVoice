// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// The connection-error page says why the desktop app's server didn't start when its shell knows
// (approved 2026-10-15): another program holds the port (the narrowings review, P6), or another
// JustVoice server holds the data folder (the shell's words, the kit's platform/data_lock.js).
import { nextTick } from "vue";
import { afterEach, expect, test, vi } from "vitest";
// Quasar installed as in the real app — the kit's controls are Quasar components
import { createTestApp } from "@delebash/ui/quasar/install.js";
import { i18n } from "../i18n/index.js";

const status = vi.fn();
vi.mock("../services/native.js", () => ({ shellServerStatus: () => status() }));
vi.mock("@delebash/ui", async () => ({
  ConnectionError: (await import("@delebash/ui/common/components/ConnectionError.vue")).default,
  serverUrl: () => "http://127.0.0.1:17494",
}));

const { default: ConnectionErrorPage } = await import("./ConnectionErrorPage.vue");

let app;
let el;
afterEach(() => {
  app?.unmount();
  el?.remove();
  status.mockReset();
});

async function mount() {
  el = document.createElement("div");
  document.body.appendChild(el);
  app = createTestApp(ConnectionErrorPage).use(i18n);
  app.mount(el);
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
}

test("another program on the port: the approved words, with the port", async () => {
  status.mockResolvedValue({ url: "http://127.0.0.1:17600", portTaken: 17600, dataFolderInUse: null });
  await mount();
  expect(el.textContent).toContain(
    "Port 17600 is in use by another program — close that program, then press Retry.",
  );
});

test("another JustVoice server on the data folder: the shell's words, as they are", async () => {
  const words = "Another JustVoice server is using this data folder (E:\\JV\\data) — stop it first.";
  status.mockResolvedValue({ url: null, portTaken: null, dataFolderInUse: words });
  await mount();
  expect(el.textContent).toContain(words);
  expect(el.textContent).not.toContain("is in use by another program");
});

test("the template's three (2026-10-20): another person's JustVoice, a reserved port, the server's own error", async () => {
  status.mockResolvedValue({ url: null, portTaken: 17494, portOtherUser: 17494, dataFolderInUse: null });
  await mount();
  expect(el.textContent).toContain("Another person signed in to this computer has JustVoice open, on port 17494.");
  expect(el.textContent).not.toContain("is in use by another program");
  app.unmount();
  el.remove();

  status.mockResolvedValue({ url: null, portTaken: null, portReserved: 17494, dataFolderInUse: null });
  await mount();
  expect(el.textContent).toContain("Windows has reserved port 17494 for another use (Hyper-V, WSL or Docker), so JustVoice can't use it.");
  app.unmount();
  el.remove();

  status.mockResolvedValue({ url: null, portTaken: null, dataFolderInUse: null, serverError: "the database couldn't be opened" });
  await mount();
  expect(el.textContent).toContain("Its server stopped as it started: the database couldn't be opened");
});

test("nothing known (a browser, or the server simply down): no extra sentence", async () => {
  status.mockResolvedValue(null);
  await mount();
  expect(el.textContent).toContain("It isn't responding at");
  expect(el.textContent).not.toContain("is in use by another program");
  expect(el.textContent).not.toContain("is using this data folder");
});
