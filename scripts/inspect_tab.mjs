// Dump computed style of the active tab in both UIs, side by side.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:17494";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

async function inspect(url, label) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const result = await page.evaluate(() => {
    const tab = document.querySelector(".tabs .tab.active, .tab.active");
    if (!tab) return { error: "no .tab.active found" };
    const cs = getComputedStyle(tab);
    return {
      borderBottom: cs.borderBottom,
      borderBottomColor: cs.borderBottomColor,
      borderBottomWidth: cs.borderBottomWidth,
      borderBottomStyle: cs.borderBottomStyle,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      marginBottom: cs.marginBottom,
      color: cs.color,
      fontWeight: cs.fontWeight,
      textContent: tab.textContent.trim(),
    };
  });
  console.log(label, JSON.stringify(result, null, 2));
  await page.close();
}

await inspect(BASE + "/", "NEW   ");
await inspect(BASE + "/legacy/", "LEGACY");
await browser.close();
