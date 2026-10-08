// SPDX-License-Identifier: MIT
// JustVoice ↔ the shared llm-runner (the port of tests/test_llm_runner_mount.py). JustVoice's
// only concern is that the kit's runner router is MOUNTED on the app and serves the shared
// camelCase contract; the kit's own tests live in the kit.
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

test("runner_router_mounted_and_camelcase", async () => {
  const { c } = await appClient();
  // /config serves the engine defaults (camelCase) and /models the catalog view.
  let r = await c.get("/v1/llm-runner/config");
  expect(r.status).toBe(200);
  let body = r.json();
  expect(body.llamacpp.pinnedBuild).toBeTruthy(); // camelCase — the Vue llm-ui reads this shape
  expect(body.llamacpp ?? {}).not.toHaveProperty("pinned_build");

  r = await c.get("/v1/llm-runner/models");
  expect(r.status).toBe(200);
  body = r.json();
  // The catalog is WIRED to the shared DB store, and the shared seed populates it — so the
  // runner has real models to offer.
  expect(body.catalogWired).toBe(true);
  expect(body.models.length).toBeGreaterThan(0);
});

test("hardware_endpoint_mounted_and_camelcase", async () => {
  const { c } = await appClient();
  const r = await c.get("/v1/llm-runner/hardware");
  expect(r.status).toBe(200);
  const body = r.json();
  expect(["windows", "macos", "linux"]).toContain(body.platform);
  // camelCase aliases on the wire, not snake_case attribute names.
  expect(body).toHaveProperty("cpuCores");
  expect(body).toHaveProperty("ramMb");
  expect(body).not.toHaveProperty("cpu_cores");
});
