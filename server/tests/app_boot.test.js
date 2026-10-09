// SPDX-License-Identifier: MIT
// The app boots cleanly and registers the expected routes (the port of tests/test_app_boot.py).
// Smoke test — if createApp() throws, the server is broken; if the documented contract
// endpoints are missing, the JustWrite consumer breaks.
//
// Python read the paths from the OpenAPI document; the JavaScript server has none, so the routes
// are read from the app's own routing table (Hono's `app.routes`).
import { afterEach, expect, test } from "vitest";
import { closeApps, makeApp } from "./app_helpers.js";

afterEach(closeApps);

/** Every registered method + path (Hono's routing table, as text — one "METHOD /path" a line). */
function routePaths(app) {
  return app.routes.map((r) => `${r.method} ${r.path}`).join("\n");
}

/** Does the app answer `method path` with a route of its own? */
const hasRoute = (app, method, path) => app.routes.some((r) => r.method === method && r.path === path);

test("app_creates_without_error", async () => {
  const app = await makeApp();
  expect(app).not.toBeNull();
  expect(typeof app.fetch).toBe("function");
});

test("contract_endpoints_registered", async () => {
  const app = await makeApp();
  // Spot-check the most load-bearing contract endpoints.
  const contract = ["/v1/voices", "/v1/lexicons", "/v1/personas", "/v1/settings", "/v1/engines"];
  const missing = contract.filter((p) => !hasRoute(app, "GET", p));
  expect(missing).toEqual([]);
});

test("no_v0_routes_leaked", async () => {
  const app = await makeApp();
  const table = routePaths(app);
  expect(table).not.toMatch(/\/api\/v0|(^|\s)\/v0/m);
});
