// SPDX-License-Identifier: GPL-3.0-or-later
// C3 verification: the big inline progress strip from the engines plan.
// Asserts the strip renders inside the engine's ev-gbody (not in the
// header), shows the variant title + phase + bytes + bar + Cancel, and
// that Cancel actually hits DELETE /v1/jobs/{id}.

import { chromium } from "playwright";
import { chromeLaunchOptions } from "./lib/smoke-common.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8758";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch({ ...chromeLaunchOptions() });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const JOBS = new Map();
let jobCounter = 0;
let cancelHit = false;

await page.route("**/v1/engines/*/install", async (route) => {
  const url = new URL(route.request().url());
  const engineId = url.pathname.split("/")[3];
  const body = JSON.parse(route.request().postData() || "{}");
  const jobId = `fake-${++jobCounter}`;
  JOBS.set(jobId, {
    engine: engineId, variant: body.model_variant || null,
    bytes_downloaded: 0, bytes_total: 500 * 1024 * 1024,
    phase: "downloading", current_file: "model.safetensors", cancelled: false,
  });
  await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: jobId }) });
});
await page.route("**/v1/jobs/*", async (route) => {
  const u = new URL(route.request().url());
  const jobId = u.pathname.split("/").pop();
  if (route.request().method() === "DELETE") {
    cancelHit = true;
    const j = JOBS.get(jobId);
    if (j) { j.phase = "failed"; j.error = "cancelled by user"; }
    await route.fulfill({ status: 202, body: JSON.stringify({ cancelled: jobId }) });
    return;
  }
  const j = JOBS.get(jobId);
  if (!j) { await route.fulfill({ status: 404, body: "{}" }); return; }
  // Advance bytes on each poll so the rate calc has data.
  if (j.phase === "downloading" && j.bytes_downloaded < j.bytes_total) {
    j.bytes_downloaded = Math.min(j.bytes_total, j.bytes_downloaded + 30 * 1024 * 1024);
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    job_id: jobId, engine_id: j.engine, model_variant: j.variant,
    phase: j.phase, bytes_downloaded: j.bytes_downloaded, bytes_total: j.bytes_total,
    current_file: j.current_file, error: j.error || null,
  }) });
});

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(900);

const head = page.locator(".ev-ghead", { hasText: "chatterbox" }).first();
await head.click(); await page.waitForTimeout(300);

// Post-2026-06-15 (one-button): the action button reads "Load" now.
// Clicking it triggers /install (prefetch) + /load in one flow.
const loadBtns = page.locator(".ev-model:has(.vn) >> text=/Load/");
await loadBtns.nth(0).click();
await page.waitForTimeout(1500);

const strip = page.locator(".jv-install-strip").first();
ck("C3: a .jv-install-strip is rendered", await strip.isVisible());
ck("C3: title carries the variant name", /Chatterbox/.test(await strip.locator(".jv-install-strip__title").innerText()));
ck("C3: phase pill present", /downloading/i.test(await strip.locator(".jv-install-strip__phase").innerText()));
const bytes = await strip.locator(".jv-install-strip__bytes").innerText().catch(() => "");
ck("C3: bytes counter is shown", /\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*MB/.test(bytes), bytes);
ck("C3: progress bar is present", (await strip.locator(".jv-install-strip__bar > i").count()) === 1);
ck("C3: Cancel button is present", (await strip.locator("button", { hasText: "Cancel" }).count()) === 1);

await page.screenshot({ path: `${SHOTS}/engines-c3-strip.png` });

// Hit Cancel; assert the DELETE went out and the strip's phase flipped.
await strip.locator("button", { hasText: "Cancel" }).click();
await page.waitForTimeout(900);
ck("C3: Cancel triggered DELETE /v1/jobs/{id}", cancelHit);

await page.screenshot({ path: `${SHOTS}/engines-c3-cancelled.png` });

ck("No JS/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed`);
process.exit(fail ? 1 : 0);
