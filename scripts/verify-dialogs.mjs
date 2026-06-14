// SPDX-License-Identifier: GPL-3.0-or-later
//
// verify-dialogs.mjs — behavioral verification of the library editor
// dialogs (Personas / Render presets / Lexicons) by driving the REAL UI
// in a headless browser. This is the standing check for these dialogs:
// it asserts the agreed contract — create opens the editor DIRECTLY (no
// prompt-then-popup), Cancel discards, Save persists, built-ins are
// read-only, the close ✕ never overlaps header actions — and saves a
// screenshot at each key state.
//
// Run it against a running server:
//   1. cd server && JUSTVOICE_DATA_DIR=/tmp/jv-verify justvoice-server serve \
//        --host 127.0.0.1 --port 8745
//   2. JV_BASE=http://127.0.0.1:8745 node scripts/verify-dialogs.mjs
//
// Env: JV_BASE (server URL), JV_CHROME (chromium path), JV_SHOTS (screenshot dir).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.JV_BASE || "http://127.0.0.1:8745";
const CHROME =
  process.env.JV_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOTS = process.env.JV_SHOTS || "/tmp/jv-shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const api = {
  async presets(page) {
    return page.evaluate(async (b) => (await (await fetch(b + "/v1/presets")).json()).presets, BASE);
  },
  async lexicons(page) {
    return page.evaluate(async (b) => (await (await fetch(b + "/v1/lexicons")).json()).lexicons, BASE);
  },
  async personas(page) {
    return page.evaluate(async (b) => (await (await fetch(b + "/v1/personas")).json()).personas, BASE);
  },
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_CERT|favicon|404/.test(m.text())) errors.push("console: " + m.text()); });

async function go(hash) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: "networkidle" });
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(700);
}
const dlg = () => page.locator(".jv-overlay .jv-modal");
async function shot(name) { await page.screenshot({ path: `${SHOTS}/${name}.png` }); }

// ═══════════════ RENDER PRESETS ═══════════════
await go("#presets");
{
  const before = (await api.presets(page)).length;
  // create opens directly
  await page.locator("button", { hasText: "+ New preset" }).click();
  await page.waitForTimeout(400);
  await shot("presets-1-create");
  check("Presets: create opens editor directly", await dlg().isVisible());
  check("Presets: title = 'New render preset'", (await dlg().locator(".jv-modal__title").innerText()) === "New render preset");
  check("Presets: name field empty (no prompt-first)", (await dlg().locator(".jv-form-row", { hasText: "Name" }).locator("input").inputValue()) === "");
  check("Presets: footer Save+Cancel", (await dlg().locator("footer button", { hasText: /^Save$/ }).count()) === 1 && (await dlg().locator("footer button", { hasText: /^Cancel$/ }).count()) === 1);
  // cancel creates nothing
  await dlg().locator("footer button", { hasText: /^Cancel$/ }).click();
  await page.waitForTimeout(300);
  check("Presets: Cancel on create persists nothing", (await api.presets(page)).length === before, `before=${before} after=${(await api.presets(page)).length}`);
  // save persists
  await page.locator("button", { hasText: "+ New preset" }).click();
  await page.waitForTimeout(300);
  await dlg().locator(".jv-form-row", { hasText: "Name" }).locator("input").fill("Verify Preset");
  await dlg().locator("footer button", { hasText: /^Save$/ }).click();
  await page.waitForTimeout(700);
  const after = await api.presets(page);
  check("Presets: Save persists (+1, right name)", after.length === before + 1 && after.some((p) => p.name === "Verify Preset"));
  check("Presets: dialog closed after Save", (await dlg().count()) === 0);
  // built-in read-only
  const narration = page.locator("tbody tr", { hasText: "Narration" }).first();
  check("Presets: built-in row Delete disabled", await narration.locator("button", { hasText: "Delete" }).isDisabled());
  await narration.click();
  await page.waitForTimeout(400);
  await shot("presets-2-builtin-readonly");
  check("Presets: built-in name field disabled", await dlg().locator(".jv-form-row", { hasText: "Name" }).locator("input").isDisabled());
  check("Presets: built-in footer = Close (no Save)", (await dlg().locator("footer button", { hasText: /^Save$/ }).count()) === 0 && (await dlg().locator("footer button", { hasText: /^Close$/ }).count()) === 1);
  await dlg().locator("footer button", { hasText: /^Close$/ }).click();
  await page.waitForTimeout(300);
  // edit existing: cancel discards, save persists
  const userRow = page.locator("tbody tr", { hasText: "Verify Preset" }).first();
  await userRow.click(); await page.waitForTimeout(300);
  await dlg().locator(".jv-form-row", { hasText: "Name" }).locator("input").fill("CANCELLED");
  await dlg().locator("footer button", { hasText: /^Cancel$/ }).click(); await page.waitForTimeout(500);
  check("Presets: edit Cancel discards", (await api.presets(page)).some((p) => p.name === "Verify Preset"));
  await userRow.click(); await page.waitForTimeout(300);
  await dlg().locator(".jv-form-row", { hasText: "Name" }).locator("input").fill("Verify Preset 2");
  await dlg().locator("footer button", { hasText: /^Save$/ }).click(); await page.waitForTimeout(600);
  check("Presets: edit Save persists", (await api.presets(page)).some((p) => p.name === "Verify Preset 2"));
}

// ═══════════════ LEXICONS ═══════════════
await go("#lexicons");
{
  const before = (await api.lexicons(page)).length;
  // create opens directly with name + scope fields
  await page.locator(".jv-lib-toolbar button", { hasText: "+ New lexicon" }).click();
  await page.waitForTimeout(400);
  await shot("lexicons-1-create");
  check("Lexicons: create opens editor directly", await dlg().isVisible());
  check("Lexicons: header eyebrow 'New lexicon'", (await dlg().locator(".jv-modal__eyebrow").innerText()).trim().toLowerCase() === "new lexicon");
  check("Lexicons: Name field present in dialog", (await dlg().locator(".lex__field", { hasText: "Name" }).locator("input").count()) >= 1);
  check("Lexicons: Scope select present in dialog", (await dlg().locator(".lex__scope-row select").count()) >= 1);
  // ✕ does NOT overlap Export (header ✕ vs body Export button)
  const x = await dlg().locator(".jv-modal__close").boundingBox();
  const exp = await dlg().locator("button", { hasText: "Export" }).boundingBox();
  const overlap = x && exp && !(x.x + x.width < exp.x || exp.x + exp.width < x.x || x.y + x.height < exp.y || exp.y + exp.height < x.y);
  check("Lexicons: close ✕ does not overlap Export", !overlap, overlap ? "BOXES OVERLAP" : "clear");
  // add 2 entries to the draft (no API yet)
  for (const [g, a] of [["Beauchamp", "bee-chum"], ["Worcestershire", "wuss-ter-sher"]]) {
    await dlg().locator(".lex__entry-grid input").nth(0).fill(g);
    await dlg().locator(".lex__entry-grid input").nth(2).fill(a);
    await dlg().locator("button", { hasText: /Add entry/ }).click();
    await page.waitForTimeout(150);
  }
  await shot("lexicons-2-entries");
  check("Lexicons: 2 entries in draft table", (await dlg().locator(".lex__table tbody tr").count()) === 2, `${await dlg().locator(".lex__table tbody tr").count()} rows`);
  check("Lexicons: entries NOT yet on server (draft)", (await api.lexicons(page)).length === before);
  // cancel discards
  await dlg().locator("footer button", { hasText: /^Cancel$/ }).click(); await page.waitForTimeout(400);
  check("Lexicons: Cancel creates nothing", (await api.lexicons(page)).length === before, `after=${(await api.lexicons(page)).length}`);
  // create + name + 1 entry + Save persists
  await page.locator(".jv-lib-toolbar button", { hasText: "+ New lexicon" }).click(); await page.waitForTimeout(300);
  await dlg().locator(".lex__field", { hasText: "Name" }).locator("input").fill("Verify Lexicon");
  await dlg().locator(".lex__entry-grid input").nth(0).fill("Stillwater");
  await dlg().locator(".lex__entry-grid input").nth(2).fill("still-water");
  await dlg().locator("button", { hasText: /Add entry/ }).click(); await page.waitForTimeout(150);
  await dlg().locator("footer button", { hasText: /^Save$/ }).click(); await page.waitForTimeout(700);
  await shot("lexicons-3-saved");
  let lex = (await api.lexicons(page)).find((l) => l.name === "Verify Lexicon");
  check("Lexicons: Save persists (lexicon + 1 entry)", !!lex && (lex.entries || []).length === 1 && lex.entries[0].grapheme === "Stillwater", lex ? `${(lex.entries || []).length} entries` : "not found");
  check("Lexicons: dialog closed after Save", (await dlg().count()) === 0);
  // per-entry delete: discard on Cancel
  const row = page.locator("tbody tr", { hasText: "Verify Lexicon" }).first();
  await row.click(); await page.waitForTimeout(400);
  await dlg().locator(".lex__table tbody tr").first().locator("button", { hasText: "Delete" }).click();
  await page.waitForTimeout(200);
  check("Lexicons: entry delete removes from draft table", (await dlg().locator(".lex__table tbody tr").count()) === 0);
  await dlg().locator("footer button", { hasText: /^Cancel$/ }).click(); await page.waitForTimeout(500);
  lex = (await api.lexicons(page)).find((l) => l.name === "Verify Lexicon");
  check("Lexicons: entry-delete Cancel discards (server unchanged)", !!lex && (lex.entries || []).length === 1);
  // per-entry delete: persist on Save
  await page.locator("tbody tr", { hasText: "Verify Lexicon" }).first().click(); await page.waitForTimeout(400);
  await dlg().locator(".lex__table tbody tr").first().locator("button", { hasText: "Delete" }).click(); await page.waitForTimeout(200);
  await dlg().locator("footer button", { hasText: /^Save$/ }).click(); await page.waitForTimeout(600);
  lex = (await api.lexicons(page)).find((l) => l.name === "Verify Lexicon");
  check("Lexicons: entry-delete Save persists (0 entries)", !!lex && (lex.entries || []).length === 0, lex ? `${(lex.entries || []).length}` : "?");
  // rename
  await page.locator("tbody tr", { hasText: "Verify Lexicon" }).first().click(); await page.waitForTimeout(400);
  await dlg().locator(".lex__field", { hasText: "Name" }).locator("input").fill("Verify Lexicon Renamed");
  await dlg().locator("footer button", { hasText: /^Save$/ }).click(); await page.waitForTimeout(600);
  check("Lexicons: rename persists", (await api.lexicons(page)).some((l) => l.name === "Verify Lexicon Renamed"));
}

// ═══════════════ PERSONAS ═══════════════
await go("#personas");
{
  const before = (await api.personas(page)).length;
  await page.locator("button", { hasText: "+ New persona" }).click();
  await page.waitForTimeout(400);
  await shot("personas-1-create");
  check("Personas: create opens editor directly", await dlg().isVisible());
  check("Personas: canonical header (eyebrow 'New persona' + ✕)", (await dlg().locator(".jv-modal__header .jv-modal__eyebrow").innerText()).trim().toLowerCase() === "new persona" && (await dlg().locator(".jv-modal__header .jv-modal__close").count()) === 1);
  // cancel discards
  await dlg().locator("footer button", { hasText: /^Cancel$/ }).click(); await page.waitForTimeout(300);
  check("Personas: Cancel creates nothing", (await api.personas(page)).length === before);
  // save persists
  await page.locator("button", { hasText: "+ New persona" }).click(); await page.waitForTimeout(300);
  await dlg().locator(".personas__field", { hasText: "Name" }).locator("input").first().fill("Verify Persona");
  await dlg().locator("footer button", { hasText: /^Save$/ }).click(); await page.waitForTimeout(700);
  check("Personas: Save persists (+1)", (await api.personas(page)).some((p) => p.name === "Verify Persona"));
}

check("No JS/console errors during run", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed · screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
