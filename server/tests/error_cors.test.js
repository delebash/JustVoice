// SPDX-License-Identifier: MIT
// Unhandled server errors reach the browser as real 500s, not "blocked by CORS" (the port of
// tests/test_error_cors.py): the catch-all envelope answers inside the CORS hook, so the 500
// carries Access-Control-Allow-Origin.
import { closeApp } from "@delebash/llm-runner/platform";
import { afterEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { closeApps, client } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

test("unhandled_error_is_json_500_with_cors", async () => {
  vi.stubEnv("JUSTVOICE_DATA_DIR", tmpPath());
  // createApp() with no folder reads JUSTVOICE_DATA_DIR (the family ladder). A route added
  // after createApp — after the app's own, so after the UI's file server, which passes a path
  // it has no file for on.
  const app = await createApp();
  app.get("/v1/_test/boom", async () => {
    throw new Error("kaboom for the test");
  });
  try {
    const r = await client(app).get("/v1/_test/boom", { headers: { Origin: "http://localhost:1430" } });
    expect(r.status).toBe(500);
    // The whole point: the error response went through the CORS hook.
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:1430");
    expect(r.json().detail).toContain("kaboom");
  } finally {
    await closeApp(app);
  }
});
