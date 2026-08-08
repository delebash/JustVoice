// Screenshot a view scrolled down so we can see content below the fold.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:17494";
const OUT = process.env.OUT || "E:/Dev/Web/justvoice-new/scripts/_shots";
const TAB = process.env.TAB || "Engines";
const SCROLL = Number(process.env.SCROLL || 500);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: TAB, exact: true }).click();
await page.waitForTimeout(700);
await page.evaluate((y) => {
  const main = document.querySelector(".app-shell > main");
  if (main) main.scrollTop = y;
}, SCROLL);
await page.waitForTimeout(300);
const slug = TAB.toLowerCase().replace(/\s+/g, "-");
await page.screenshot({ path: `${OUT}/new-${slug}-scroll${SCROLL}.png` });
console.log(`saved ${OUT}/new-${slug}-scroll${SCROLL}.png`);
await browser.close();
