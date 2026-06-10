// Side-by-side screenshots of the same view on the new SPA vs the legacy GUI.
// Boot the Python server first; both UIs are mounted under the same origin.
//   New:    http://localhost:17494/
//   Legacy: http://localhost:17494/legacy/
import { chromium } from "playwright";
import { mkdir } from "fs/promises";

const BASE = process.env.BASE || "http://localhost:17494";
const OUT = process.env.OUT || "E:/Dev/Web/justvoice-new/scripts/_shots";
const TAB = process.env.TAB || "Overview";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

const slug = TAB.toLowerCase().replace(/\s+/g, "-");

// — New SPA —
{
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  try {
    await page.getByRole("button", { name: TAB, exact: true }).click();
    await page.waitForTimeout(700);
  } catch (e) {
    console.error(`new: could not click tab '${TAB}': ${e.message}`);
  }
  await page.screenshot({ path: `${OUT}/new-${slug}.png`, fullPage: true });
  await page.close();
}

// — Legacy GUI —
{
  const page = await ctx.newPage();
  await page.goto(BASE + "/legacy/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  try {
    await page.getByRole("button", { name: TAB, exact: true }).click();
    await page.waitForTimeout(700);
  } catch (e) {
    console.error(`legacy: could not click tab '${TAB}': ${e.message}`);
  }
  await page.screenshot({ path: `${OUT}/legacy-${slug}.png`, fullPage: true });
  await page.close();
}

console.log(`saved ${OUT}/new-${slug}.png and ${OUT}/legacy-${slug}.png`);
await browser.close();
