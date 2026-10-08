// SPDX-License-Identifier: MIT
// The app boots cleanly and registers the expected routes (the port of tests/test_app_boot.py).
// Smoke test — if createApp() throws, the server is broken; if the documented contract
// endpoints are missing, the JustWrite consumer breaks.
//
// Python read the paths from the OpenAPI document; Fastify has none, so the routes are asked
// for directly (`hasRoute`). `contract_endpoints_registered` names three routers the API wave's
// later agents port (voices, lexicons, personas): it checks the two that exist now and is
// completed when they land.
import { afterEach, expect, test } from "vitest";
import { closeApps, makeApp } from "./app_helpers.js";

afterEach(closeApps);

/** Every registered method + path (Fastify's routing table, as text). */
function routePaths(app) {
  return app.printRoutes({ commonPrefix: false });
}

test("app_creates_without_error", async () => {
  const app = await makeApp();
  expect(app).not.toBeNull();
  expect(typeof app.hasRoute).toBe("function");
});

test("contract_endpoints_registered", async () => {
  const app = await makeApp();
  // The ported halves of the contract set; /v1/voices, /v1/lexicons and /v1/personas join
  // when agents 2/3 register their routers.
  const contract = ["/v1/settings", "/v1/engines"];
  const missing = contract.filter((p) => !app.hasRoute({ method: "GET", url: p }));
  expect(missing).toEqual([]);
});

test("no_v0_routes_leaked", async () => {
  const app = await makeApp();
  const table = routePaths(app);
  expect(table).not.toMatch(/\/api\/v0|(^|\s)\/v0/m);
});
