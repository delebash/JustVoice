// Reusable capture: mock step + app state side by side.
import { chromium } from "playwright-core";
const [,, mockHash, appHash, outPrefix, projectLabel, extra] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1480, height: 1050 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0,150)));
if (mockHash) {
  await page.goto(`file:///home/user/JustVoice/preview/journeys-preview.html#${mockHash}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `docs/gui-parity/${outPrefix}-mock.png` });
}
await page.goto(`http://127.0.0.1:17494/ui/#${appHash}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
if (projectLabel) {
  const sel = page.locator(".studio__project-select, .chapter-view select").first();
  if (await sel.count()) {
    const opts = await sel.locator("option").allTextContents();
    const m = opts.find(o => o.includes(projectLabel));
    if (m) { await sel.selectOption({ label: m }); await page.waitForTimeout(1200); }
  }
}
if (extra === "selectChar") {
  const card = page.locator(".studio__char-card").nth(1);
  if (await card.count()) { await card.click(); await page.waitForTimeout(400); }
}
if (extra === "tabScript") { await page.locator(".studio__step", { hasText: "Script" }).click(); await page.waitForTimeout(900); }
if (extra === "tabRender") { await page.locator(".studio__step", { hasText: "Render" }).click(); await page.waitForTimeout(1300); }
await page.screenshot({ path: `docs/gui-parity/${outPrefix}-app.png` });
console.log(outPrefix, "errors:", errs.length ? errs : "none");
await browser.close();
