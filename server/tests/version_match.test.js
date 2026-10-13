// SPDX-License-Identifier: MIT
// One version everywhere: the server's (server/package.json — /v1/health, the sidebar, Settings →
// Updates) is the desktop app's (package.json at the repo root — the installer, and what the
// updater compares).
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERSION } from "../src/version.js";

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

test("the server's version is the app's", () => {
  const app = read("../../package.json");
  const server = read("../package.json");
  expect(server.version).toBe(app.version);
  expect(VERSION).toBe(app.version);
});
