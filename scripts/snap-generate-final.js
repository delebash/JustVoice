// Post-CSS-rebuild verification: every slider visible (including
// disabled pitch), correct sizes everywhere, no JW bloat causing stomp.
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto('http://127.0.0.1:5187/#generate', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

const sliders = await page.$$eval('input[type="range"]', els =>
  els.map(el => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      disabled: el.disabled,
      visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0',
      width: Math.round(rect.width), height: Math.round(rect.height),
      accentColor: cs.accentColor,
      opacity: cs.opacity,
    };
  })
);

const widths = {
  pauseNum: await page.$$eval('.generate-view__pause-num', a => a.map(e => getComputedStyle(e).width)),
  seed:     await page.$eval('.generate-view__seed-input', e => getComputedStyle(e).width).catch(() => null),
  num:      await page.$$eval('.generate-view__num', a => a.map(e => getComputedStyle(e).width)),
  grid:     await page.$eval('.generate-view__grid', e => `${getComputedStyle(e).rowGap} / ${getComputedStyle(e).columnGap}`),
  floating: await page.$eval('.jv-floating', e => `${getComputedStyle(e).padding} r=${getComputedStyle(e).borderRadius}`),
};
console.log(JSON.stringify({ sliders, widths }, null, 2));
await page.screenshot({ path: 'scripts/generate-rebuild.png', fullPage: true });
await browser.close();
