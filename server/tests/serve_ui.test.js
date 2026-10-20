// SPDX-License-Identifier: MIT
// The built UI through the kit's serveUi (decided 2026-10-20, the template's): the page and its
// files with ETags (a repeat is a 304), Vite's hashed assets kept a year, the rest revalidated; a
// write there is 405 with Allow, and an unknown write under /v1 or /mcp stays the API's 404.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

async function withUi() {
  const ui = tmpPath();
  mkdirSync(path.join(ui, "assets"), { recursive: true });
  writeFileSync(path.join(ui, "index.html"), "<!doctype html><title>JustVoice</title>");
  writeFileSync(path.join(ui, "assets", "index-abc123.js"), "console.log(1)");
  vi.stubEnv("JUSTVOICE_UI_DIR", ui);
  return (await appClient()).c;
}

test("the page and its files: revalidated, hashed assets kept, a repeat answered 304", async () => {
  const c = await withUi();
  const page = await c.get("/");
  expect(page.status).toBe(200);
  expect(page.headers["content-type"]).toMatch(/text\/html/);
  expect(page.headers["cache-control"]).toBe("no-cache");
  const asset = await c.get("/assets/index-abc123.js");
  expect(asset.status).toBe(200);
  expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  const again = await c.get("/", { headers: { "if-none-match": page.headers.etag } });
  expect(again.status).toBe(304);
});

test("a write to the UI is 405 with Allow; an unknown API write stays 404", async () => {
  const c = await withUi();
  const r = await c.post("/some/page", { json: {} });
  expect(r.status).toBe(405);
  expect(r.headers.allow).toBe("GET, HEAD");
  expect((await c.post("/v1/no-such-route", { json: {} })).status).toBe(404);
});
