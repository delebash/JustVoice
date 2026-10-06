// SPDX-License-Identifier: MIT
//
// `npm run screenshots` — loads the running app's UI headless, saves a picture of
// every sidebar tab and prints any JS error a tab throws. It takes pictures; it is
// not the gate (`npm run smoke` is).
//
// Env overrides:
//   JV_BASE    base URL of the running server (default http://127.0.0.1:17494/ — the
//              app's own server)
//   JV_SHOTS   where the pictures go (default scripts/_shots, which git ignores)
//   JV_CHROME  path to a Chromium/Chrome binary (scripts/lib/smoke-common.js)
//
// Until 2026-10-06 this read `BASE` (default port 17497), wrote to a folder of a
// checkout that no longer exists, and waited on an "Engines" button the sidebar lost
// on 2026-08-06 — so it timed out on every run.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIDEBAR_TABS, findChrome, waitForServerReady } from "./lib/smoke-common.js";

const require = createRequire(import.meta.url);
// playwright is a CJS package; import via require to get { chromium }.
const { chromium } = require("playwright");

const BASE = process.env.JV_BASE || "http://127.0.0.1:17494/";
const OUT = process.env.JV_SHOTS || join(dirname(fileURLToPath(import.meta.url)), "_shots");
mkdirSync(OUT, { recursive: true });

const exe = findChrome();
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let current = "boot";
const errors = {};
const record = (msg) => {
  if (!errors[current]) errors[current] = [];
  errors[current].push(msg);
};
page.on("pageerror", (e) => record(`PAGEERROR: ${e.message.slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_CERT|404|favicon/.test(m.text())) record(`CONSOLE: ${m.text().slice(0, 180)}`);
});

try {
  await waitForServerReady(BASE, { log: (m) => console.log(`… ${m}`) });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // The first-run dialog and the boot splash catch every click — the smoke gate
  // explains both (scripts/smoke.js); here they are only cleared.
  for (let i = 0; i < 5 && (await page.locator(".ui-modal-overlay").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  if (await page.locator(".splash").count()) {
    const skip = page.locator(".lu-bootload__skip");
    if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector(".splash", { state: "detached", timeout: 10000 }).catch(() => {});
  }

  for (const [i, tab] of SIDEBAR_TABS.entries()) {
    current = tab;
    const file = join(OUT, `${String(i + 1).padStart(2, "0")}-${tab.toLowerCase().replace(/\s+/g, "-")}.png`);
    try {
      // The whole label, in the sidebar: `text=SETTINGS` alone matches AI SETTINGS first.
      await page.locator(".jv-sidebar").getByText(new RegExp(`^\\s*${tab}\\s*$`, "i")).first().click({ timeout: 5000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: file, fullPage: true });
      const errs = errors[tab] || [];
      console.log(`${errs.length ? "✗" : "✓"} ${tab.padEnd(12)} ${file}${errs.length ? `  errors=${errs.length}` : ""}`);
      for (const e of errs.slice(0, 4)) console.log(`      ${e}`);
    } catch (e) {
      console.log(`✗ ${tab.padEnd(12)} could not open: ${String(e?.message || e).split("\n")[0].slice(0, 160)}`);
    }
  }
} finally {
  await browser.close();
}
