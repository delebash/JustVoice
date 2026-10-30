// SPDX-License-Identifier: MIT
// The smoke suite — the REAL desktop app (Electron, the built UI from app://) driven through
// Playwright (app-structure §10, §18; the kit template's e2e shape). What scripts/e2e.js checked
// against a browser tab until 2026-10-29, now in the app's own window: a fresh install opens the
// kind picker; a CSV line list comes in through New project and its review as a game project whose
// lines keep their ids; a labelled .md is read as a podcast script; every page opens with no error;
// a voice's preview asks before it loads a model (409); a backup streams a zip. No speech or
// language model is needed or loaded. Hermetic (lib/driver.js): a temp data folder, the harness's
// own server, the shell's JUSTVOICE_DEV_NO_SERVER=1. One launch shared by the tests, in order.
//
// Before: `npm run build:unpacked` (the harness drives what was last built). Run: `npm test` from
// the app's root.

import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { Driver, waitFor } from "../lib/driver.js";

const CSV = `id,scene,character,text
E2E_Q01_A,Test Quest,Tester,"First test line."
E2E_Q01_B,Test Quest,Tester,"Second test line."
`;
const MD = `# E2E Episode

ALPHA: Hello from the e2e suite. [warm]

BETA: And from speaker two.
`;
// every page in the sidebar (src/router/routes.js), by its route
const PAGES = ["home", "projects", "lines", "studio", "captures", "voices", "personas", "lexicons", "effects", "ai", "settings"];

const d = new Driver();
let page;
const pageErrors = [];

before(async () => {
  await d.launch();
  page = d.page;
  page.on("pageerror", (e) => pageErrors.push(`${page.url().split("#")[1] || "?"}: ${String(e).slice(0, 200)}`));
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
});

after(async () => {
  await d.close();
});

/** Close whatever modal is open (the once-ever AI offer, a picker) with Esc, as a user would. */
async function closeModals() {
  const modals = page.locator(".ui-modal");
  for (let i = 0; i < 5 && (await modals.count()); i++) {
    await page.keyboard.press("Escape");
    await waitFor(async () => (await modals.count()) === 0, { timeout: 2_000, what: "the modal closed" }).catch(() => {});
  }
  assert.deepEqual(await modals.allInnerTexts(), [], "no modal left over the page");
}

test("the window is the app's", async () => {
  assert.equal(await page.title(), "JustVoice");
  assert.match(page.url(), /^app:\/\/justvoice\//);
  assert.equal(await page.locator("#app-boot").count(), 0, "the boot plate is gone once the app shows");
});

test("a fresh install opens the kind picker on Projects", async () => {
  await page.waitForURL(/#\/projects/);
  await page.locator(".ui-modal", { hasText: "What are you making?" }).waitFor();
});

test("a CSV line list comes in through New project and its review: a game project, its lines' ids kept", async () => {
  const csv = path.join(d.tmp, "e2e-lines.csv");
  writeFileSync(csv, CSV);
  const picker = page.locator(".ui-modal", { hasText: "What are you making?" });
  await picker.locator("input[type=file]").setInputFiles(csv);
  await picker.locator(".jv-drop__row", { hasText: "e2e-lines.csv" }).waitFor();
  const create = picker.locator("button", { hasText: "Create project ➜" });
  await waitFor(() => create.isEnabled(), { what: "the file read and Create enabled" });
  await create.click();

  await page.waitForURL(/#\/importreview/);
  await page.locator("button", { hasText: /^Import 1 chapter/ }).click();

  const game = await waitFor(async () => (await d.api("/projects")).projects.find((p) => p.project_type === "game_voicelines"), {
    what: "the game project on the server",
  });
  assert.equal(game.name, "e2e-lines");
  const { lines } = await d.api(`/projects/${game.id}/lines`);
  assert.deepEqual(
    lines.map((l) => l.line_id),
    ["E2E_Q01_A", "E2E_Q01_B"],
  );

  // the first project opened is the moment for the once-ever AI offer (no AI set up in a fresh folder)
  const offer = page.locator(".ui-modal", { hasText: "Set up AI features" });
  await offer.waitFor();
  await offer.locator("button", { hasText: "Skip for now" }).click();
  await offer.waitFor({ state: "detached" });
});

test("a labelled .md is read as a podcast script (the file's content decides between the two .md readers)", async () => {
  await closeModals();
  const md = path.join(d.tmp, "e2e-episode.md");
  writeFileSync(md, MD);
  await d.navigate("#/projects");
  await page.locator("button", { hasText: "⬇ Import" }).click();
  const picker = page.locator(".ui-modal", { hasText: "What are you making?" });
  await picker.locator("input[type=file]").setInputFiles(md);
  const readAs = picker.locator('.ui-select-trigger[title^="Read it as"] .ui-select-value');
  await readAs.waitFor();
  assert.equal((await readAs.textContent()).trim(), "Podcast script (markdown)");
  await closeModals();
});

test("every page opens with no error", async () => {
  for (const name of PAGES) {
    await d.navigate(`#/${name}`);
    await page.waitForURL(new RegExp(`#/${name}`));
    await waitFor(async () => (await page.locator(".jv-content").innerText()).trim().length > 0, { what: `${name} drawn` });
  }
  assert.deepEqual(pageErrors, []);
});

test("a voice's preview asks before it loads a model (409, the client's ask-before-load)", async () => {
  const r = await d.fetch("/voices/af_heart/preview", { method: "POST" });
  assert.equal(r.status, 409);
});

test("a backup streams a zip", async () => {
  const r = await d.fetch("/data/backup?exclude=generations,captures");
  assert.equal(r.status, 200);
  const head = new Uint8Array(await r.arrayBuffer()).slice(0, 2);
  assert.equal(String.fromCharCode(...head), "PK");
});
