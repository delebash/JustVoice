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
import { findChrome, waitForServerReady } from "./lib/smoke-common.js";

const require = createRequire(import.meta.url);
// playwright is a CJS package; import via require to get { chromium }.
const { chromium } = require("playwright");

// 17494 is JV's real port (src-tauri/src/lib.rs SERVER_PORT); this default said
// 8741 — a port JV never listens on — until the 2026-08-04 docs campaign.
const BASE = process.env.JV_BASE || "http://127.0.0.1:17494/";

// Sidebar tabs that should always be reachable for an audiobook project.
// ENGINES left the nav with the 2026-08-06 sidebar fold (8b7e05a — engines
// live under AI Settings → Speech engines now); AI SETTINGS replaces it here.
const TABS = [
  "HOME", "PROJECTS", "CHAPTERS", "STUDIO", "GENERATE", "CAPTURES",
  "VOICES", "PERSONAS", "LEXICONS", "EFFECTS", "PRESETS", "AI SETTINGS",
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
const record = (msg) => {
  if (!errorsByTab[currentTab]) errorsByTab[currentTab] = [];
  errorsByTab[currentTab].push(msg);
};
page.on("pageerror", (e) => record(`PAGEERROR: ${e.message.slice(0, 200)}`));
page.on("console", (m) => {
  // Ignore benign network noise (favicon / external cert) — only real JS.
  if (m.type() === "error" && !/ERR_CERT|404|favicon/.test(m.text())) {
    record(`CONSOLE: ${m.text().slice(0, 180)}`);
  }
});

let failed = 0;
try {
  // Wait for the server to be genuinely ready, not merely answering /health:
  // during first-boot seeding + engine discovery the page renders but every
  // nav click blows its 5 s timeout, and the whole run goes red on a healthy
  // app (the 2026-08-14 first-run false red).
  await waitForServerReady(BASE, { log: (m) => console.log(`… ${m}`) });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // Dismiss the first-run dialog before driving anything (2026-08-14). A fresh
  // data dir has no projects, so JustVoice opens "What are you making?" — the
  // real first-launch experience — and its modal overlay intercepts EVERY
  // pointer event, so all 14 nav clicks time out on an app that is rendering
  // perfectly. That false red was blamed on machine contention twice and
  // re-run until green; the actual cause was this overlay, caught by reading
  // Playwright's own actionability log ("ui-modal-overlay intercepts pointer
  // events"). JustWrite's smoke skips its boot splash for the same reason.
  for (let i = 0; i < 5 && (await page.locator(".ui-modal-overlay").count()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const stuckOverlays = await page.locator(".ui-modal-overlay").count();
  if (stuckOverlays) {
    failed++;
    console.log(`✗ FIRST-RUN  ${stuckOverlays} modal overlay(s) would not dismiss — every`
      + " click below would fail; fix the dialog, don't re-run the gate");
  } else {
    console.log("✓ FIRST-RUN   no modal blocking the app");
  }

  // Dismiss the BOOT SPLASH (2026-08-22). App.vue's `.splash` is a full-screen
  // overlay shown while warm-on-boot loads the default local chat model. It is
  // NOT a modal, so the Escape loop above does nothing to it, and it intercepts
  // every pointer event exactly like the first-run overlay did — so on any data
  // dir with `warmDefaultOnStartup: true` all 14 nav clicks time out on a
  // completely healthy app. That is a false red of the same family as the
  // 2026-08-14 one, and it cost a full diagnosis to find because the NAV-FAIL
  // message below truncates Playwright's actionability log at 100 chars, hiding
  // the "<div class=\"splash\"> intercepts pointer events" line that names it.
  //
  // The app is not at fault and the gate must not wait it out either: warming a
  // 26B model takes minutes and is not what this gate measures. The kit's
  // BootModelLoad ships the universal escape for exactly this — click it, the
  // same thing a user does.
  if (await page.locator(".splash").count()) {
    const skip = page.locator(".lu-bootload__skip");
    if (await skip.count()) await skip.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector(".splash", { state: "detached", timeout: 10000 }).catch(() => {});
    if (await page.locator(".splash").count()) {
      failed++;
      console.log("✗ SPLASH      boot splash would not dismiss — every click below would"
        + " fail; check BootModelLoad's escape, don't re-run the gate");
    } else {
      console.log("✓ SPLASH      boot splash dismissed (warm-on-boot was loading a model)");
    }
  } else {
    console.log("✓ SPLASH      no boot splash (warm-on-boot off, or nothing to warm)");
  }

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
    if (problems.length) { failed++; console.log(`✗ SHELL       ${problems.join(" | ")}`); }
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
      for (const e of errs.slice(0, 4)) console.log(`      ${e}`);
    } catch (e) {
      failed++;
      // Keep the "intercepts pointer events" line. Playwright puts WHY a click
      // failed in its actionability log, and the old 100-char slice cut it off
      // right before the answer — 14 identical "Timeout 5000ms exceeded" lines
      // that named nothing, which is what made the 2026-08-22 splash false red
      // cost a full diagnosis. Show the timeout, then any interception line.
      const msg = String(e.message || e);
      const why = msg.split("\n").find((l) => l.includes("intercepts pointer events"));
      console.log(`✗ ${tab.padEnd(10)} NAV-FAIL ${msg.split("\n")[0].slice(0, 100)}`);
      // Playwright colours its log. Strip the SGR codes without putting a
      // control character in a regex, which biome bans however it is escaped.
      if (why) {
        const ESC = String.fromCharCode(27);
        const plain = why.split(ESC).map((s) => s.replace(/^\[\d+m/, "")).join("");
        console.log(`      ${plain.trim()}`);
      }
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
