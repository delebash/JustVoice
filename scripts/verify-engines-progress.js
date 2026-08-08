// SPDX-License-Identifier: MIT
// Verifies the progress-accuracy fix from
// docs/plans/2026-06-14-engines-progress-accuracy.md:
//   - With bytes_total > 0 the bar reports REAL %, no fake 35%.
//   - With bytes_total === 0 the bar is indeterminate (stripes), no
//     fake percentage, and the metrics row reads "working…".
//   - When phase flips download → extracting WITH a unified bytes_total,
//     the bar keeps moving (the user-reported "freeze").
//
// We don't touch a real download — install POST + /v1/jobs are routed
// to a fake controlled by this script so we can advance bytes through
// every phase deterministically.

import { chromium } from "playwright";
import { chromeLaunchOptions } from "./lib/smoke-common.js";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8761";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

const browser = await chromium.launch({ ...chromeLaunchOptions() });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

// One mutable job we tick from the test.
const JOB = { id: null, phase: "downloading", bytes_downloaded: 0, bytes_total: 100 * 1024 * 1024 };

await page.route("**/v1/engines/*/install", async (route) => {
  JOB.id = `fake-${Date.now()}`;
  JOB.phase = "downloading"; JOB.bytes_downloaded = 0; JOB.bytes_total = 100 * 1024 * 1024;
  await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ job_id: JOB.id }) });
});
await page.route("**/v1/jobs/*", async (route) => {
  if (route.request().method() === "DELETE") {
    await route.fulfill({ status: 202, body: "{}" }); return;
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    job_id: JOB.id, engine_id: "chatterbox", model_variant: "chatterbox-multilingual-v2",
    phase: JOB.phase, bytes_downloaded: JOB.bytes_downloaded, bytes_total: JOB.bytes_total,
    current_file: "model.safetensors", error: null,
  })});
});

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(900);
const head = page.locator(".ev-ghead", { hasText: "chatterbox" }).first();
await head.click(); await page.waitForTimeout(400);

// Post-2026-06-15 (one-button): the action button reads "Load" now.
const loadBtns = page.locator(".ev-model:has(.vn) >> text=/Load/");
await loadBtns.nth(0).click();
await page.waitForTimeout(900);

const strip = page.locator(".jv-install-strip").first();
const bar = strip.locator(".jv-install-strip__bar > i");
const barEl = strip.locator(".jv-install-strip__bar");

async function barWidthPct() {
  const wPx = await bar.evaluate((el) => parseFloat(getComputedStyle(el).width));
  const parentPx = await barEl.evaluate((el) => parseFloat(getComputedStyle(el).width));
  return (wPx / parentPx) * 100;
}

// ── Mid-download with bytes_total > 0 → real percentage ─────────
JOB.bytes_downloaded = 40 * 1024 * 1024;  // 40%
JOB.phase = "downloading";
await page.waitForTimeout(900);
const w40 = await barWidthPct();
ck("bytes 40% renders ~40% width (real, not 35 placeholder)",
   Math.abs(w40 - 40) < 6, `width=${w40.toFixed(1)}%`);
ck("bar is NOT indeterminate during download",
   (await barEl.getAttribute("data-indeterminate")) !== "true");

// ── Switch to extracting WITH the unified total → bar keeps moving ──
JOB.phase = "extracting";
JOB.bytes_total = 100 * 1024 * 1024 + 60 * 1024 * 1024;   // +60MB unpacked
JOB.bytes_downloaded = 100 * 1024 * 1024;  // download done; extract just started
await page.waitForTimeout(900);
const wExtractStart = await barWidthPct();
ck("phase 'extracting' shows real bytes counter (not hidden)",
   /\d+\s*\/\s*\d+/.test(await strip.locator(".jv-install-strip__bytes").innerText().catch(() => "")));
ck("extract start: bar is at ~62.5% (100/160), not stuck at 40%",
   wExtractStart > 50 && wExtractStart < 75, `width=${wExtractStart.toFixed(1)}%`);
ck("extract phase NOT indeterminate (we have a known total)",
   (await barEl.getAttribute("data-indeterminate")) !== "true");

// Advance extract — bar must continue moving.
JOB.bytes_downloaded = 130 * 1024 * 1024;
await page.waitForTimeout(900);
const wExtractMid = await barWidthPct();
ck("bar advances during extract (no freeze)",
   wExtractMid > wExtractStart + 5,
   `was ${wExtractStart.toFixed(1)}% → now ${wExtractMid.toFixed(1)}%`);

await page.screenshot({ path: `${SHOTS}/progress-extract-moving.png` });

// ── Indeterminate phase (bytes_total = 0) → stripes + "working…" ──
JOB.phase = "installing-deps";
JOB.bytes_total = 0; JOB.bytes_downloaded = 0;
await page.waitForTimeout(900);
ck("indeterminate phase: data-indeterminate flag is set",
   (await barEl.getAttribute("data-indeterminate")) === "true");
ck("indeterminate phase: bytes counter is HIDDEN, 'working…' shown",
   /working/.test(await strip.innerText()));
const wInd = await barWidthPct();
ck("indeterminate phase: bar fills the track (stripes carry the motion)",
   wInd > 90, `width=${wInd.toFixed(1)}%`);

await page.screenshot({ path: `${SHOTS}/progress-indeterminate.png` });

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed · screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
