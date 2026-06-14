// SPDX-License-Identifier: GPL-3.0-or-later
// C4 verification: per-variant Source override UI.
// Asserts: pill renders with manifest provenance, opens a dialog with
// the editor + manifest default, Save calls PUT /sources/{variant} and
// the pill flips to "override" provenance; opening again offers
// "Reset to default" which calls DELETE.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8759";
const CHROME = process.env.JV_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(900);

const head = page.locator(".ev-ghead", { hasText: "chatterbox" }).first();
await head.click(); await page.waitForTimeout(400);

const firstRow = page.locator(".ev-model").first();
const sourcePill = firstRow.locator(".ev-source-pill");
ck("C4: a Source pill renders on the model row", await sourcePill.isVisible());
ck("C4: pill is in 'manifest' (default) state",
   !((await sourcePill.getAttribute("class")) || "").includes("ev-source-pill--override"));
ck("C4: pill text shows the source host", /Source ·/.test(await sourcePill.innerText()));

await sourcePill.click();
await page.waitForTimeout(300);
const dlg = page.locator(".jv-overlay .jv-modal").first();
ck("C4: source dialog opens", await dlg.isVisible());
ck("C4: HF / URL mode toggle present", (await dlg.locator(".jv-pill", { hasText: /HuggingFace|Direct URL/ }).count()) === 2);
ck("C4: manifest default is shown", /Manifest default/.test(await dlg.innerText()));
await page.screenshot({ path: `${SHOTS}/engines-c4-dialog.png` });

// Fill an HF override and Save.
await dlg.locator("input").first().fill("my-org/chatterbox-fork");
await dlg.locator("button", { hasText: "Save override" }).click();
await page.waitForTimeout(900);

// Pill should now be in override state.
ck("C4: pill flipped to override state",
   ((await sourcePill.getAttribute("class")) || "").includes("ev-source-pill--override"));
ck("C4: pill text shows 'hf: my-org/chatterbox-fork'",
   /my-org\/chatterbox-fork/.test(await sourcePill.innerText()));

await page.screenshot({ path: `${SHOTS}/engines-c4-override.png` });

// Re-open dialog and reset.
await sourcePill.click();
await page.waitForTimeout(300);
const dlg2 = page.locator(".jv-overlay .jv-modal").first();
ck("C4: Reset to default button is now shown for override",
   (await dlg2.locator("button", { hasText: "Reset to default" }).count()) === 1);
await dlg2.locator("button", { hasText: "Reset to default" }).click();
await page.waitForTimeout(900);
ck("C4: pill reverted to manifest after reset",
   !((await sourcePill.getAttribute("class")) || "").includes("ev-source-pill--override"));

// Confirm settings round-trip via API.
const after = await page.evaluate(async (B) => {
  const r = await fetch(B + "/v1/settings"); return (await r.json()).engines.engine_overrides || {};
}, BASE);
ck("C4: settings.json no longer holds the override",
   !after.chatterbox || !Object.keys(after.chatterbox.sources || {}).length,
   JSON.stringify(after).slice(0, 80));

ck("No JS/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
