// SPDX-License-Identifier: GPL-3.0-or-later
//
// verify-no-fakes.mjs — asserts the "coming soon"-gated affordances are
// genuinely inert (disabled, no fake toast), so the UI never claims an
// action it can't perform. Covers the item-4 fakes: Compare (Refresh /
// Bulk QC), Captures (Record / Hotkey Change). Voices inspector buttons
// need an editable (cloned) voice + a loaded engine, so they're covered
// by build + static disabled markup, not here.
//
//   cd server && JUSTVOICE_DATA_DIR=/tmp/jv-vX justvoice-server serve --host 127.0.0.1 --port 8752 &
//   JV_BASE=http://127.0.0.1:8752 node scripts/verify-no-fakes.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8752";
const CHROME = process.env.JV_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (n, c, d = "") => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CERT|favicon|404/.test(m.text())) errors.push("c: " + m.text()); });
async function go(hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(700);
}
const toastCount = () => page.locator(".jv-toast, [data-sonner-toast], .toast").count();

// ── Compare ──
await go("#compare");
check("Compare: A/B core still present (Choose A / Run analysis)",
  (await page.locator("button", { hasText: "Choose A" }).count()) === 1 &&
  (await page.locator("button", { hasText: "Run analysis" }).count()) === 1);
check("Compare: 'Refresh from takes (soon)' is disabled",
  await page.locator("button", { hasText: /Refresh from takes/ }).isDisabled());
check("Compare: Bulk QC shows 'coming soon'",
  (await page.locator("h3", { hasText: "Bulk QC across takes" }).innerText()).toLowerCase().includes("coming soon"));
check("Compare: no live 'Run QC pass' button", (await page.locator("button", { hasText: "Run QC pass" }).count()) === 0);
await page.screenshot({ path: `${SHOTS}/comingsoon-compare.png` });

// ── Captures ──
await go("#captures");
check("Captures: Record button is disabled", await page.locator("button", { hasText: /^Record/ }).first().isDisabled());
check("Captures: Hotkey 'Change' buttons disabled",
  (await page.locator("button", { hasText: "Change" }).count()) >= 1 &&
  (await page.locator("button", { hasText: "Change" }).first().isDisabled()));
check("Captures: Hotkeys header shows 'coming soon'",
  (await page.locator("h3", { hasText: "Hotkeys" }).innerText()).toLowerCase().includes("coming soon"));
// Disabled buttons can't be clicked → assert no toast is sitting on screen.
const tc = await toastCount();
check("Captures: no fake toast present", tc === 0, `toasts=${tc}`);
await page.screenshot({ path: `${SHOTS}/comingsoon-captures.png` });

// ── Voices — seed an editable (designed) voice so the inspector's
//    sample-collection buttons render, then assert they're disabled. ──
const made = await page.evaluate(async (b) => {
  const r = await fetch(b + "/v1/voices/design", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "chatterbox", name: "Verify Editable Voice", prompt: "a calm narrator" }),
  });
  return r.ok ? (await r.json()) : null;
}, BASE);
check("Voices: seeded an editable voice via /v1/voices/design", !!made, made ? made.id : "POST failed");
await go("#voices");
check("Voices: page renders", (await page.locator(".voices-view, .jv-fill").count()) >= 1);
// Narrow to the one Designed voice so its ⚙ is unambiguous (the first
// ⚙ overall is a preset → read-only, no sample buttons).
await page.locator("button", { hasText: /^Designed/ }).first().click();
await page.waitForTimeout(400);
await page.locator("button", { hasText: "⚙" }).first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/comingsoon-voices.png` });
const addWav = page.locator("button", { hasText: /Add WAV file/ });
const recordInApp = page.locator("button", { hasText: /Record in-app/ });
const promote = page.locator("button", { hasText: /Promote from Captures/ });
check("Voices: inspector shows the sample buttons", (await addWav.count()) === 1 && (await recordInApp.count()) === 1 && (await promote.count()) === 1,
  `addWav=${await addWav.count()} rec=${await recordInApp.count()} promote=${await promote.count()}`);
check("Voices: 'Add WAV file' disabled", (await addWav.count()) === 1 && (await addWav.first().isDisabled()));
check("Voices: 'Record in-app' disabled", (await recordInApp.count()) === 1 && (await recordInApp.first().isDisabled()));
check("Voices: 'Promote from Captures' disabled", (await promote.count()) === 1 && (await promote.first().isDisabled()));

// ── Overview — the Captures stat must render a real number (the
//    capturesTotal ref-bag fix; no NaN/undefined). ──
await go("#overview");
const capStat = page.locator(".home__stat", { hasText: "Captures" }).locator(".home__display--num");
const capVal = (await capStat.count()) ? (await capStat.first().innerText()).trim() : "";
check("Overview: Captures stat renders a number", /^\d+$/.test(capVal), `value="${capVal}"`);
await page.screenshot({ path: `${SHOTS}/comingsoon-overview.png` });

check("No JS/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
