// Pixel-level check: read the rendered dimensions of the elements we
// just resized, so we can verify the diff actually shipped instead of
// trusting the source-CSS read. Reports row-gap, numeric-input width,
// textarea heights, floating bar padding/radius, chip-card radius.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5183/#generate';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// Open the advanced details so we can measure its textarea.
await page.evaluate(() => {
  document.querySelector('.generate-view__advanced')?.setAttribute('open', '');
});
await page.waitForTimeout(200);

const grid = await page.$eval('.generate-view__grid', el => {
  const cs = getComputedStyle(el);
  return { rowGap: cs.rowGap, columnGap: cs.columnGap };
});
const num = await page.$eval('.generate-view__num input, input.generate-view__num', el => {
  const cs = getComputedStyle(el);
  return { width: cs.width };
}).catch(() => null);
const delivery = await page.$eval('textarea.generate-view__delivery-textarea', el => {
  const cs = getComputedStyle(el);
  return { minHeight: cs.minHeight, height: cs.height };
}).catch(() => null);
const advanced = await page.$eval('textarea.generate-view__advanced-textarea', el => {
  const cs = getComputedStyle(el);
  return { minHeight: cs.minHeight, height: cs.height };
}).catch(() => null);
const example = await page.$eval('textarea.generate-view__example-textarea', el => {
  const cs = getComputedStyle(el);
  return { minHeight: cs.minHeight, height: cs.height };
}).catch(() => null);
const floating = await page.$eval('.generate-view__floating', el => {
  const cs = getComputedStyle(el);
  return { padding: cs.padding, borderRadius: cs.borderRadius };
});
const chip = await page.$eval('.generate-view__floating .jv-chip-card', el => {
  const cs = getComputedStyle(el);
  return { padding: cs.padding, borderRadius: cs.borderRadius };
});
const srcTags = await page.$$eval('.generate-view__src-tag', els =>
  els.map(el => ({ text: el.textContent.trim(), background: getComputedStyle(el).backgroundColor }))
);

console.log(JSON.stringify({ grid, num, delivery, advanced, example, floating, chip, srcTags }, null, 2));

await page.screenshot({ path: 'scripts/generate-after.png', fullPage: true });
await browser.close();
