import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto('http://127.0.0.1:5185/#generate', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const pauseNum = await page.$$eval('.generate-view__pause-num', els =>
  els.map(el => ({ class: el.className, width: getComputedStyle(el).width }))
);
const seed = await page.$eval('.generate-view__seed-input', el => ({
  class: el.className, width: getComputedStyle(el).width
}));
console.log(JSON.stringify({ pauseNum, seed }, null, 2));
await page.screenshot({ path: 'scripts/pause-seed.png', clip: { x: 0, y: 480, width: 1400, height: 220 } });
await browser.close();
