// SPDX-License-Identifier: MIT
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
//   3. Run:                node scripts/smoke.js
//
// Env overrides:
//   JV_BASE    base URL of the running server (default http://127.0.0.1:8741/)
//   JV_CHROME  path to a Chromium/Chrome binary. If unset, tries the
//              Playwright cache, then a few common locations.
//
// Exits non-zero if any view throws a JS error or fails to render, so
// it can gate CI / a pre-merge check.

import { createRequire } from "node:module";
import { findChrome } from "./lib/smoke-common.js";

const require = createRequire(import.meta.url);
// playwright is a CJS package; import via require to get { chromium }.
const { chromium } = require("playwright");

// 17494 is JV's real port (src-tauri/src/lib.rs SERVER_PORT); this default said
// 8741 — a port JV never listens on — until the 2026-08-04 docs campaign.
const BASE = process.env.JV_BASE || "http://127.0.0.1:17494/";

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

  // ── App-shell structure guard (the keep-alike discipline; see the global
  // app standard "App shell structure"). Catches the regressions that hit on
  // 2026-06-24: rail not full-height → nav jumps between views; 100vh →
  // Compact dead space; rail self-scrolling instead of a fixed/scroll/fixed rail.
  {
    const s = await page.evaluate(() => {
      const root = document.querySelector(".app-shell");
      const rail = document.querySelector(".jv-sidebar");
      if (!root || !rail) return { missing: true };
      return {
        shellH: Math.round(root.getBoundingClientRect().height),
        vh: window.innerHeight,
        railH: rail.clientHeight,
        rootH: root.clientHeight,
        railSelfScroll: rail.scrollHeight - rail.clientHeight,
      };
    });
    const problems = [];
    if (s.missing) problems.push(".app-shell / .jv-sidebar missing");
    else {
      if (Math.abs(s.shellH - s.vh) > 2) problems.push(`shell ${s.shellH}px != viewport ${s.vh}px (dead space — use a height:100% chain, not 100vh)`);
      if (Math.abs(s.railH - s.rootH) > 2) problems.push(`rail ${s.railH}px != shell ${s.rootH}px (rail not full-height — nav jumps between views)`);
      if (s.railSelfScroll > 2) problems.push(`rail itself scrolls by ${s.railSelfScroll}px (use fixed top + scroll middle + fixed bottom)`);
    }
    if (problems.length) { failed++; console.log("✗ SHELL       " + problems.join(" | ")); }
    else console.log("✓ SHELL       fills viewport · rail full-height · single scroller");
  }

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
