// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// THE BOOT SMOKE (parity batch slice 11) — imports the REAL main.js and lets the
// REAL boot run against a stubbed transport. This is the gate that kills the
// TDZ-crash class: build:vite compiles the module graph without executing it and
// biome doesn't check .vue identifiers, so a "used before initialization" in any
// imported module ships past a green build — JV's did, live, 2026-08-05. An
// import-time throw, a boot-chain throw, or a mount that renders nothing all
// fail here.
import { beforeAll, expect, it, vi } from "vitest";

beforeAll(() => {
  // The renderer is a thin client — every route answers minimal-but-shaped JSON
  // so the boot chain runs to mount. Route-aware, default {}.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = String(typeof input === "string" ? input : input?.url || "");
      let body = {};
      if (url.includes("/v1/health")) body = { status: "ok", product: "justvoice" };
      else if (url.includes("/v1/prefs")) body = { prefs: {} };
      else if (url.includes("/v1/projects")) body = { projects: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })),
  );
  // Node ships an EXPERIMENTAL localStorage global that is undefined without
  // --localstorage-file and shadows jsdom's — give the app a working one.
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("EventSource", class {
    constructor() { this.readyState = 0; }
    addEventListener() {}
    close() {}
  });
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
});

it("the app boots to a mounted shell (TDZ / boot-crash smoke)", async () => {
  document.body.innerHTML = '<div id="app-boot"></div><div id="app"></div>';
  await import("./main.js");
  // boot() is async — wait for the mount (router.isReady + prefs boot ride it).
  const el = document.getElementById("app");
  await vi.waitFor(() => {
    if (window.__bootErr) throw window.__bootErr;
    expect(el.childElementCount).toBeGreaterThan(0);
  }, { timeout: 8000, interval: 100 });
}, 15000);
