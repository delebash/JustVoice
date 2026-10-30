// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// THE BOOT SMOKE (parity batch slice 11) — the skeleton (stub environment +
// mount assertion + why this gate exists: the TDZ-crash class, which JV hit
// live 2026-08-05) is the kit's registerBootSmoke; this file keeps JustVoice's
// parts: the start-up, the fetch route map and the boot-error probe.
//
// The start-up is Quasar's (app-structure §Q.4): the root App.vue, Pinia from
// stores/index.js, the router from router/index.js, the boot files awaited in
// quasar.config.js order (i18n.js, jv.js), then the router installed and the app
// mounted — the steps Quasar's generated client entry takes, run here by hand
// because that entry only exists inside a Quasar build. Quasar is installed as in
// the real app: the layout and the kit's controls are Quasar components.
import { registerBootSmoke } from "@delebash/ui/test/bootSmoke.js";
// Quasar installed as in the real app — the kit's controls are Quasar components
import { createTestApp } from "@delebash/ui/quasar/install.js";
import { expect, test } from "vitest";

// the booted app, for the checks after the smoke
let booted = null;

registerBootSmoke({
  boot: async () => {
    const { default: App } = await import("./App.vue");
    const { default: createStore } = await import("./stores/index.js");
    const { default: createRouter } = await import("./router/index.js");
    const { default: i18nBoot } = await import("./boot/i18n.js");
    const { default: jvBoot } = await import("./boot/jv.js");
    const app = createTestApp(App);
    booted = app;
    const store = await createStore({});
    app.use(store);
    const router = await createRouter({ store });
    await i18nBoot({ app, router, store });
    await jvBoot({ app, router, store });
    app.use(router);
    app.mount("#app");
  },
  routes: {
    "/v1/health": { status: "ok", product: "justvoice" },
    "/v1/prefs": {}, // the prefs DOCUMENT is the top-level object (empty = defaults)
    "/v1/projects": { projects: [] },
  },
  // boot() is async and surfaces failures on window.__bootErr — rethrow so the
  // waitFor loop fails fast with the real error instead of timing out.
  ready: () => {
    if (window.__bootErr) throw window.__bootErr;
  },
});

test("renderer errors reach the server's log (the kit's installErrorReporting, app-structure §15)", () => {
  expect(typeof booted?.config.errorHandler).toBe("function");
});

test("the access token is the kit's own: the one its token page keeps rides every request", async () => {
  const { getServerToken, serverFetch, setServerToken } = await import("@delebash/ui");
  const { useApi } = await import("./stores/api.js");
  // kept the way the kit's connection page keeps one (ConnectionError → setServerToken)
  setServerToken("kept-by-the-kit");
  await serverFetch("http://127.0.0.1:17494/v1/health");
  const [, init] = globalThis.fetch.mock.calls.at(-1);
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer kept-by-the-kit");
  // Settings → Server's field keeps it in the same place
  const api = useApi();
  api.setToken("typed-in-settings");
  expect(getServerToken()).toBe("typed-in-settings");
  expect(api.token).toBe("typed-in-settings");
  setServerToken("");
});
