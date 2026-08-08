// SPDX-License-Identifier: MIT
// Verifies docs/plans/2026-06-15-engines-one-button.md:
//   - One action button per model row — no separate Download.
//   - Clicking Load on a not-on-disk variant kicks /install first
//     (server routes it to spawn_prefetch), polls the job to
//     completion, THEN posts /load. Strip shows phases throughout.
//   - C4 Source ▾ pill is gone from the UI.
//   - Sibling variant is unaffected (C1 still holds).

import { chromium } from "playwright";
import { chromeLaunchOptions } from "./lib/smoke-common.js";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8762";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const R = [];
const ck = (n, c, d = "") => { R.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };

const browser = await chromium.launch({ ...chromeLaunchOptions() });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CERT|favicon|404/.test(m.text())) errors.push(m.text()); });

// Track which endpoints were hit and in what order — proves the
// renderer is doing prefetch-then-load (the Ollama semantic).
const callOrder = [];
const JOBS = new Map();
let jobCounter = 0;
let loadHit = false;

await page.route("**/v1/engines/*/install", async (route) => {
  const url = new URL(route.request().url());
  const engineId = url.pathname.split("/")[3];
  const body = JSON.parse(route.request().postData() || "{}");
  callOrder.push({ kind: "install", engine: engineId, variant: body.model_variant });
  const jobId = `fake-${++jobCounter}`;
  JOBS.set(jobId, {
    engine: engineId, variant: body.model_variant,
    bytes_downloaded: 0, bytes_total: 50 * 1024 * 1024,
    phase: "downloading", error: null,
  });
  await route.fulfill({ status: 202, contentType: "application/json",
    body: JSON.stringify({ job_id: jobId, engine_id: engineId, model_variant: body.model_variant }) });
});

// Slow the fake so the strip is visibly mounted (5 polls @ 600ms ≈ 3s).
// The job stays in 'downloading' for the first 3 polls, then completes.
await page.route("**/v1/jobs/*", async (route) => {
  const u = new URL(route.request().url());
  const jobId = u.pathname.split("/").pop();
  if (route.request().method() === "DELETE") {
    const j = JOBS.get(jobId); if (j) j.phase = "failed";
    await route.fulfill({ status: 202, body: "{}" }); return;
  }
  const j = JOBS.get(jobId);
  if (!j) { await route.fulfill({ status: 404, body: "{}" }); return; }
  if (j.phase === "downloading") {
    j.poll_count = (j.poll_count || 0) + 1;
    j.bytes_downloaded = Math.min(j.bytes_total, j.poll_count * 8 * 1024 * 1024);
    if (j.poll_count >= 6) { j.bytes_downloaded = j.bytes_total; j.phase = "completed"; }
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    job_id: jobId, engine_id: j.engine, model_variant: j.variant,
    phase: j.phase, bytes_downloaded: j.bytes_downloaded, bytes_total: j.bytes_total,
    current_file: "model.safetensors", error: j.error,
  })});
});

await page.route("**/v1/engines/*/load", async (route) => {
  const engineId = new URL(route.request().url()).pathname.split("/")[3];
  callOrder.push({ kind: "load", engine: engineId });
  loadHit = true;
  await route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ engine_id: engineId, device: "auto", model_variant: "chatterbox-multilingual-v2" }) });
});

await page.goto(`${BASE}/#engines`, { waitUntil: "networkidle" });
await page.evaluate(() => { window.location.hash = "#engines"; });
await page.waitForTimeout(900);

const head = page.locator(".ev-ghead", { hasText: "chatterbox" }).first();
await head.click(); await page.waitForTimeout(400);

// ── C4 surface is gone ────────────────────────────────────────────
ck("C4: no per-row Source ▾ pill anywhere", (await page.locator(".ev-source-pill").count()) === 0);

// ── One action button per row ─────────────────────────────────────
const firstRow = page.locator(".ev-model").first();
const primaryBtns = firstRow.locator("button.jv-btn--primary, .jv-btn--primary");
const labels = (await primaryBtns.allInnerTexts()).map(s => s.trim()).filter(Boolean);
ck("One-button: exactly one primary action per variant row",
   labels.length === 1, `labels=${JSON.stringify(labels)}`);
ck("One-button: label is the merged 'Load' verb (no separate Download)",
   /Load/.test(labels[0] || ""), labels[0] || "");

// ── Click Load → renderer does install BEFORE load ────────────────
await primaryBtns.first().click();
// Check the strip mounts WHILE the fake job is still downloading. The
// fake is paced so polls 1–5 stay 'downloading' (~3s window).
await page.waitForTimeout(1500);

const strip = page.locator(".jv-install-strip").first();
ck("Strip is rendered during the merged op", await strip.count() > 0);

await page.screenshot({ path: `${SHOTS}/onebutton-mid-download.png` });

// Wait for completion (server's fake hits 'completed' after a few polls
// then renderer posts /load).
let waited = 0;
while (!loadHit && waited < 6000) {
  await page.waitForTimeout(200); waited += 200;
}

ck("Renderer hit /install BEFORE /load (Ollama semantic)",
   callOrder.length >= 2 && callOrder[0].kind === "install" && callOrder.at(-1).kind === "load",
   `order=${callOrder.map(c => c.kind).join("→")}`);

// ── Sibling variant unaffected ────────────────────────────────────
const rows = page.locator(".ev-model");
const secondRowBtn = rows.nth(1).locator(".jv-btn--primary").first();
const secondLabel = (await secondRowBtn.innerText()).trim();
ck("C1 still holds: sibling variant button is NOT 'Downloading…'",
   !/Downloading/.test(secondLabel), `label=${secondLabel}`);

await page.screenshot({ path: `${SHOTS}/onebutton-row.png` });

ck("No JS/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const fail = R.filter(x => !x).length;
console.log(`\n${R.length - fail}/${R.length} passed · screenshots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
