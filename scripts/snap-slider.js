// One-shot Playwright check: snap the Generate page slider area + read
// the computed background-color of the slider thumb so we can settle the
// purple-vs-green question with actual rendered pixels, not source CSS.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5181/#generate';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const ranges = await page.$$eval('input[type="range"]', els =>
  els.map(el => {
    const cs = getComputedStyle(el);
    const thumb = window.getComputedStyle(el, '::-webkit-slider-thumb');
    const rootCs = getComputedStyle(document.documentElement);
    return {
      classList: el.className,
      width: cs.width,
      height: cs.height,
      accentColor: cs.accentColor,
      background: cs.background,
      backgroundColor: cs.backgroundColor,
      appearance: cs.appearance,
      webkitAppearance: cs.webkitAppearance,
      thumbBackground: thumb.background,
      thumbBackgroundColor: thumb.backgroundColor,
      cssVarAccent: rootCs.getPropertyValue('--accent'),
      cssVarAccentHue: rootCs.getPropertyValue('--accent-hue'),
      cssVarJtorig: rootCs.getPropertyValue('--jtorig'),
    };
  })
);
console.log(JSON.stringify(ranges, null, 2));

await page.screenshot({ path: 'scripts/slider-snap.png', fullPage: false });
await browser.close();
