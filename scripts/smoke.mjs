// SPDX-License-Identifier: GPL-3.0-or-later
//
// Headless smoke test — drives the real renderer against a running
// `justvoice-server serve` and asserts every view renders with zero
// JS errors. This is the regression harness that caught the import-
// staleness bug during the 2026-06-13/14 data-layer rebuild; keep it
// green before merging UI changes.
//
// Usage:
//   1. Start the server:   justvoice-server serve --host 127.0.0.1 --port 8741
//   2. Build the renderer: npm run build:vite
//   3. Run:                node scripts/smoke.mjs
//
// Env overrides:
//   JV_BASE    base URL of the running server (default http://127.0.0.1:8741/)
//   JV_CHROME  path to a Chromium/Chrome binary. If unset, tries the
//              Playwright cache, then a few common locations.
//
// Exits non-zero if any view throws a JS error or fails to render, so
// it can gate CI / a pre-merge check.

import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// playwright is a CJS package; import via require to get { chromium }.
const { chromium } = require("playwright");

const BASE = process.env.JV_BASE || "http://127.0.0.1:8741/";

function findChrome() {
  if (process.env.JV_CHROME && existsSync(process.env.JV_CHROME)) return process.env.JV_CHROME;
  // Common prebuilt Playwright location (used in the dev container).
  const roots = ["/opt/pw-browsers", `${process.env.HOME || ""}/.cache/ms-playwright`];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith("chromium")) continue;
      const exe = `${root}/${dir}/chrome-linux/chrome`;
      if (existsSync(exe)) return exe;
    }
  }
  // Fall back to Playwright's own resolution (works if `npx playwright
  // install chromium` succeeded).
  return undefined;
}

// Sidebar tabs that should always be reachable for an audiobook project.
const TABS = [
  "HOME", "PROJECTS", "CHAPTERS", "STUDIO", "GENERATE", "CAPTURES",
  "VOICES", "PERSONAS", "LEXICONS", "EFFECTS", "PRESETS", "ENGINES",
  "LABS", "SETTINGS",
];

const exe = findChrome();
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();

let currentTab = "boot";
const errorsByTab = {};
const record = (msg) => { (errorsByTab[currentTab] ??= []).push(msg); };
page.on("pageerror", (e) => record("PAGEERROR: " + e.message.slice(0, 200)));
page.on("console", (m) => {
  // Ignore benign network noise (favicon / external cert) — only real JS.
  if (m.type() === "error" && !/ERR_CERT|404|favicon/.test(m.text())) {
    record("CONSOLE: " + m.text().slice(0, 180));
  }
});

let failed = 0;
try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  for (const tab of TABS) {
    currentTab = tab;
    try {
      await page.locator(`text=${tab}`).first().click({ timeout: 5000 });
      await page.waitForTimeout(800);
      const bodyChars = await page.evaluate(
        () => document.querySelector(".jv-content, main")?.innerText?.length || 0,
      );
      const errs = errorsByTab[tab] || [];
      const ok = errs.length === 0 && bodyChars > 0;
      if (!ok) failed++;
      console.log(`${ok ? "✓" : "✗"} ${tab.padEnd(10)} bodyChars=${bodyChars} errors=${errs.length}`);
      errs.slice(0, 4).forEach((e) => console.log("      " + e));
    } catch (e) {
      failed++;
      console.log(`✗ ${tab.padEnd(10)} NAV-FAIL ${String(e.message || e).slice(0, 100)}`);
    }
  }
} finally {
  await browser.close();
}

if (failed) {
  console.error(`\nSMOKE FAILED: ${failed} view(s) errored.`);
  process.exit(1);
}
console.log("\nSMOKE PASSED: all views rendered, zero JS errors.");
