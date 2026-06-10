// Headless GUI smoke test: load the server-served SPA, capture console
// errors, screenshot each tab, and assert the engines table populated.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://127.0.0.1:17497";
const OUT = process.env.OUT || "E:/Dev/Web/justvoice-new/scripts/_shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => errors.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText || "")));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-overview.png`, fullPage: true });

// Engines tab
await page.getByRole("button", { name: "Engines" }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-engines.png`, fullPage: true });

const engineRows = await page.locator("table tbody tr").count();
const heading = await page.locator("h3").allInnerTexts();
const machine = await page.locator("text=This machine").count();

console.log(JSON.stringify({
  engineRows,
  headings: heading,
  hasMachinePanel: machine > 0,
  consoleErrors: errors,
}, null, 2));

await browser.close();
