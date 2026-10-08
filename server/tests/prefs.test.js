// SPDX-License-Identifier: MIT
// /v1/prefs — renderer UI preferences (real rows, not localStorage). The port of
// tests/test_prefs.py; one more check is the port's own.
import { afterEach, expect, test } from "vitest";
import * as session from "../src/database/session.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

const c_ = async (dir) => (await appClient(dir)).c;

test("empty", async () => {
  expect((await (await c_(tmpPath())).get("/v1/prefs")).json()).toEqual({});
});

test("patch_returns_merged_and_persists_real_json", async () => {
  const c = await c_(tmpPath());
  const merged = (await c.patch("/v1/prefs", { json: { appearance: { theme: "dark", accentHue: 200 }, hiddenVoices: ["v1", "v2"] } })).json();
  expect(merged.appearance).toEqual({ theme: "dark", accentHue: 200 });
  expect(merged.hiddenVoices).toEqual(["v1", "v2"]);
  expect((await c.get("/v1/prefs")).json()).toEqual(merged);
});

test("partial_patch_keeps_other_keys", async () => {
  const c = await c_(tmpPath());
  await c.patch("/v1/prefs", { json: { appearance: { theme: "dark" }, autoLoadEngine: "always" } });
  await c.patch("/v1/prefs", { json: { hiddenVoices: ["v9"] } });
  const doc = (await c.get("/v1/prefs")).json();
  expect(doc.appearance).toEqual({ theme: "dark" });
  expect(doc.autoLoadEngine).toBe("always");
  expect(doc.hiddenVoices).toEqual(["v9"]);
});

test("wholesale_per_key_allows_deletion", async () => {
  const c = await c_(tmpPath());
  // A map entry can be removed by sending the smaller value — what the settings deep-merge
  // can't do.
  await c.patch("/v1/prefs", { json: { voiceGenderOverrides: { a: "female", b: "male" } } });
  await c.patch("/v1/prefs", { json: { voiceGenderOverrides: { a: "female" } } });
  expect((await c.get("/v1/prefs")).json().voiceGenderOverrides).toEqual({ a: "female" });
});

test("a_whole_number_float_is_stored_as_python_wrote_it", async () => {
  // JS-only (the port's own check): PATCH /v1/prefs opts in to Python's float literals, so
  // `1.0` is stored as json.dumps wrote it — not as `1`.
  const { c } = await appClient(tmpPath());
  const r = await c.patch("/v1/prefs", { body: '{"appearance": {"scale": 1.0, "hue": 200, "big": 1e3}}', headers: { "content-type": "application/json" } });
  expect(r.status).toBe(200);
  const row = session.getDb().get("prefs", "appearance");
  expect(row.value).toBe('{"scale": 1.0, "hue": 200, "big": 1000.0}');
});

test("persist_across_instances_and_clear", async () => {
  const dir = tmpPath();
  const c = await c_(dir);
  await c.patch("/v1/prefs", { json: { appearance: { theme: "dark" } } });
  const c2 = await c_(dir); // a new app instance, same SQLite file
  expect((await c2.get("/v1/prefs")).json()).toEqual({ appearance: { theme: "dark" } });
  expect((await c2.delete("/v1/prefs")).status).toBe(204);
  expect((await c2.get("/v1/prefs")).json()).toEqual({});
});
