// Fixed-viewport screenshots of each tab, to SEE layout/scroll/control state.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:1430";
const OUT = process.env.OUT || "E:/Dev/Web/justvoice-new/scripts/_shots";
const TABS = (process.env.TABS || "Engines,Settings,Generate,Voices").split(",");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

const report = {};
for (const tab of TABS) {
  await page.getByRole("button", { name: tab, exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/tab-${tab.toLowerCase()}.png` });
  // Can the page scroll? Compare scrollable height to viewport on the real scroll node.
  const metrics = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      bodyScrollH: document.body.scrollHeight,
      docScrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
      mainScrollH: main ? main.scrollHeight : null,
      mainClientH: main ? main.clientHeight : null,
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
    };
  });
  report[tab] = metrics;
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
