// SPDX-License-Identifier: GPL-3.0-or-later
//
// Behavioral verification of the EnginesView C1 + C2 fixes from
// docs/plans/2026-06-14-engines-download-contract.md:
//
//   C1: per-(engine, variant) state — clicking Download on variant A
//       must NOT also light up variant B's button as "Downloading".
//   C2: refresh-after-install actually re-reads /v1/engines/{id}/models
//       so the per-variant on_disk + the button verb update without a
//       page reload.
//
// We don't actually fetch weights — we route the install POST through
// page.route() and serve fake job state, then poll-tick it ourselves.
// This isolates the UI behavior from any model-download work.
//
// Run against a fresh server:
//   cd server && JUSTVOICE_DATA_DIR=/tmp/jv-eng justvoice-server serve \
//     --host 127.0.0.1 --port 8758
//   JV_BASE=http://127.0.0.1:8758 node scripts/verify-engines-c1c2.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8758";
const CHROME = process.env.JV_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CERT|favicon|404/.test(m.text())) errors.push(m.text()); });

// ── Fake install backend ──────────────────────────────────────────────
// We intercept the install POST to capture which variant the renderer
// is downloading. /v1/jobs/{id} returns a job whose state we tick in a
// timer (so the renderer's poll sees real progress).
const JOBS = new Map(); // jobId -> { engine, variant, bytes_downloaded, bytes_total, phase }
let jobCounter = 0;

async function setupRoutes() {
  await page.route("**/v1/engines/*/install", async (route) => {
    const url = new URL(route.request().url());
    const engineId = url.pathname.split("/")[3];
    const body = JSON.parse(route.request().postData() || "{}");
    const variant = body.model_variant || null;
    const jobId = `fake-${++jobCounter}`;
    JOBS.set(jobId, {
      engine: engineId,
      variant,
      bytes_downloaded: 0,
      bytes_total: 100 * 1024 * 1024,
      phase: "connecting",
    });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: jobId }) });
  });
  await page.route("**/v1/jobs/*", async (route) => {
    const jobId = route.request().url().split("/").pop().split("?")[0];
    const j = JOBS.get(jobId);
    if (!j) { await route.fulfill({ status: 404, body: "{}" }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      job_id: jobId, engine_id: j.engine, model_variant: j.variant,
      phase: j.phase, bytes_downloaded: j.bytes_downloaded, bytes_total: j.bytes_total,
      current_file: "fake-weights.safetensors", error: null,
    }) });
  });
}
await setupRoutes();

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(1000);

// Find the Chatterbox group + expand it.
const chevron = page.locator(".ev-ghead", { hasText: "chatterbox" }).first();
await chevron.click(); await page.waitForTimeout(400);

// Two Download buttons should be visible (one per variant).
const downloads = page.locator(".ev-model:has(.vn) >> text=/Download/");
const downloadCount = await downloads.count();
ck("Both Chatterbox variants show a Download button", downloadCount >= 2, `count=${downloadCount}`);

// Click the FIRST variant's Download.
await downloads.nth(0).click();
await page.waitForTimeout(200);

// The first button should now read "Downloading…" and the SECOND must
// still read "Download …". This is the C1 assertion.
const firstLabel = (await downloads.nth(0).innerText()).trim();
const secondLabel = (await downloads.nth(1).innerText()).trim();
ck("First variant button flipped to 'Downloading…'", /Downloading…/.test(firstLabel), firstLabel);
ck("Second variant stays 'Download'", !/Downloading…/.test(secondLabel), secondLabel);

await page.screenshot({ path: `${SHOTS}/engines-c1-mid-download.png` });

// Tick the fake job to completion + capture progress mid-flight.
const job = [...JOBS.values()][0];
job.phase = "downloading";
job.bytes_downloaded = 50 * 1024 * 1024;
await page.waitForTimeout(900);
job.phase = "completed";
job.bytes_downloaded = job.bytes_total;
await page.waitForTimeout(1200);

// C2: post-completion the first variant's button should NOT still say
// "Downloading…" — refresh + variant invalidation should have re-read
// /models. (We don't simulate on_disk flipping to true since that
// requires server cooperation; the success of C1 is: the verb LEFT
// "Downloading…" without a page reload.)
const firstLabelPost = (await downloads.nth(0).innerText()).trim();
ck("First variant verb advanced after completion (no stale 'Downloading…')",
   !/Downloading…/.test(firstLabelPost), firstLabelPost);

await page.screenshot({ path: `${SHOTS}/engines-c1-after-download.png` });

ck("No JS/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed · screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
