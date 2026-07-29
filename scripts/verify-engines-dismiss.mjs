// SPDX-License-Identifier: GPL-3.0-or-later
// Verifies the Dismiss button on failed install strips (user-reported
// 2026-06-15 with screenshot: FAILED strip stuck with no way to clear).

import { chromium } from "playwright";
import { chromeLaunchOptions } from "./lib/smoke-common.mjs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8763";

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ ...chromeLaunchOptions() });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const JOBS = new Map();
let jobCounter = 0;

await page.route("**/v1/engines/*/install", async (route) => {
  const jobId = `fake-${++jobCounter}`;
  JOBS.set(jobId, { phase: "downloading", bd: 0, bt: 50 * 1024 * 1024, polls: 0 });
  await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: jobId }) });
});
await page.route("**/v1/jobs/*", async (route) => {
  const jobId = new URL(route.request().url()).pathname.split("/").pop();
  if (route.request().method() === "DELETE") { await route.fulfill({ status: 202, body: "{}" }); return; }
  const j = JOBS.get(jobId);
  if (!j) { await route.fulfill({ status: 404, body: "{}" }); return; }
  j.polls += 1;
  // Fail on the 3rd poll with an HF-style error.
  if (j.polls >= 3) { j.phase = "failed"; j.error = "huggingface_hub is required for HF-distributed engines but isn't available in this Python environment"; }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    job_id: jobId, phase: j.phase, bytes_downloaded: j.bd, bytes_total: j.bt,
    current_file: "model.safetensors", error: j.error || null,
  })});
});

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(900);

await page.locator(".ev-ghead", { hasText: "Qwen3" }).first().click();
await page.waitForTimeout(300);
await page.locator(".ev-model:has(.vn) >> text=/Load/").nth(0).click();
await page.waitForTimeout(2400);  // 4 polls — should fail by poll 3

const strip = page.locator(".jv-install-strip").first();
ck("Strip mounted", await strip.count() > 0);
ck("Strip is on FAILED phase", /failed/i.test(await strip.locator(".jv-install-strip__phase").innerText().catch(() => "")));
ck("Strip carries the HF error message",
   /huggingface_hub is required/.test(await strip.innerText()));

const dismiss = strip.locator("button", { hasText: "Dismiss" });
ck("Dismiss button appears on FAILED strip", (await dismiss.count()) === 1);

await dismiss.click();
await page.waitForTimeout(400);

ck("After Dismiss: strip is gone", (await page.locator(".jv-install-strip").count()) === 0);

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
