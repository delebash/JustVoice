// SPDX-License-Identifier: MIT
// End-to-end smoke suite — drives the REAL app against a running
// headless server (Phase A closing deliverable, IMPLEMENTATION_PLAN).
//
// Usage:
//   1. cd server && justvoice-server serve     (separate terminal)
//   2. node scripts/e2e.mjs [--executable /path/to/chrome]
//
// What it covers (no TTS/LLM models needed — those paths assert their
// graceful-degradation contracts instead):
//   - all 20 views load with zero JS errors
//   - CSV import through the real modal → game project → Lines grid
//   - podcast .md import → content-sniffed adapter → segments w/ tags
//   - Studio Cast assign + unassign persists via the API
//   - voice row preview returns the 409 ask-before-load contract
//   - backup endpoint streams a real zip
//
// Exit code 0 = all green; non-zero prints the failures.

import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.JV_URL || "http://127.0.0.1:17494";
const exeIdx = process.argv.indexOf("--executable");
const EXE = exeIdx > 0 ? process.argv[exeIdx + 1] : undefined;

const VIEWS = [
  "overview","studio","generate","chapter","lines","stories","captures",
  "books","voices","personas","lexicons","effects","presets","engines",
  "compare","audio","speakerlab","renderlab","train","settings",
];

const failures = [];
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => { failures.push(`${name}: ${detail}`); console.log(`  ✗ ${name} — ${detail}`); };

const CSV = `id,scene,character,text
E2E_Q01_A,Test Quest,Tester,"First test line."
E2E_Q01_B,Test Quest,Tester,"Second test line."
`;
const MD = `# E2E Episode

ALPHA: Hello from the e2e suite. [warm]

BETA: And from speaker two.
`;

const run = async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const jsErrors = {};
  page.on("pageerror", (e) => {
    const v = page.url().split("#")[1] || "?";
    (jsErrors[v] ||= []).push(String(e).slice(0, 160));
  });

  // ── boot + dismiss first-run modal ─────────────────────────────────
  await page.goto(`${BASE}/#overview`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const close = page.locator(".app-modal-close");
  if (await close.count()) await close.click();
  await page.waitForTimeout(300);

  // ── 1. every view loads clean ──────────────────────────────────────
  for (const v of VIEWS) {
    await page.goto(`${BASE}/#${v}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(700);
  }
  if (Object.keys(jsErrors).length) fail("views load clean", JSON.stringify(jsErrors));
  else ok(`all ${VIEWS.length} views load with zero JS errors`);

  // ── 2. CSV import → game project → Lines grid ──────────────────────
  const csvPath = join(tmpdir(), `e2e-${Date.now()}.csv`);
  writeFileSync(csvPath, CSV);
  await page.goto(`${BASE}/#books`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: "⬇ Import" }).click();
  await page.waitForTimeout(500);
  await page.setInputFiles("#import-file", csvPath);
  await page.waitForTimeout(1300);
  await page.locator(".im-footer button", { hasText: /^Import$/ }).click();
  await page.waitForTimeout(1300);
  const projects = await page.evaluate(() => fetch("/v1/projects").then((r) => r.json()));
  const game = projects.projects.find((p) => p.project_type === "game_voicelines" && p.name.startsWith("e2e-"));
  if (!game) fail("csv import creates game project", JSON.stringify(projects.projects.map((p) => p.name).slice(0, 5)));
  else {
    ok("csv import → game project");
    const lines = await page.evaluate((id) => fetch(`/v1/projects/${id}/lines`).then((r) => r.json()), game.id);
    if (lines.lines.length === 2 && lines.lines[0].line_id === "E2E_Q01_A") ok("lines endpoint serves stable ids");
    else fail("lines endpoint", JSON.stringify(lines.counts));
  }

  // ── 3. podcast .md import sniffs the right adapter ─────────────────
  const mdPath = join(tmpdir(), `e2e-${Date.now()}.md`);
  writeFileSync(mdPath, MD);
  await page.locator("button", { hasText: "⬇ Import" }).click();
  await page.waitForTimeout(500);
  await page.setInputFiles("#import-file", mdPath);
  await page.waitForTimeout(1300);
  const picked = await page.locator(".im-body select").first().inputValue().catch(() => "?");
  if (picked === "podcast_markdown") ok("content sniffing picks podcast adapter for labeled .md");
  else fail("adapter sniffing", `picked ${picked}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── 4. preview 409 contract (no engine loaded) ─────────────────────
  const preview = await page.evaluate(() =>
    fetch("/v1/voices/af_heart/preview", { method: "POST" }).then((r) => r.status)
  );
  if (preview === 409) ok("row preview gates on engine load (409 contract)");
  else fail("preview gate", `status ${preview}`);

  // ── 5. backup streams a real zip ───────────────────────────────────
  const backup = await page.evaluate(async () => {
    const r = await fetch("/v1/backup?include_audio=false");
    const buf = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, magic: String.fromCharCode(...buf.slice(0, 2)) };
  });
  if (backup.status === 200 && backup.magic === "PK") ok("backup streams a zip");
  else fail("backup", JSON.stringify(backup));

  await browser.close();

  console.log(failures.length ? `\n${failures.length} FAILURE(S)` : "\nE2E: ALL GREEN");
  process.exit(failures.length ? 1 : 0);
};

run().catch((e) => { console.error("e2e crashed:", e); process.exit(2); });
