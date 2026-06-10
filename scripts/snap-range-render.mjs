// Read the slider's actual rendered state: width, height, computed
// accent-color, appearance, whether the thumb is paintable. This tells
// us whether the slider is invisible (0px tall), unaccented (gray
// track + no fill), or correctly OS-default.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://127.0.0.1:5184/#generate', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const ranges = await page.$$eval('input[type="range"]', els =>
  els.map(el => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      classList: el.className,
      width: cs.width, height: cs.height,
      offsetW: rect.width, offsetH: rect.height,
      visibility: cs.visibility, display: cs.display, opacity: cs.opacity,
      accentColor: cs.accentColor,
      appearance: cs.appearance,
      webkitAppearance: cs.webkitAppearance,
      background: cs.background.slice(0, 60),
      color: cs.color,
    };
  })
);
console.log(JSON.stringify(ranges, null, 2));

await page.screenshot({ path: 'scripts/range-after-strip.png', clip: { x: 0, y: 400, width: 1400, height: 400 } });
await browser.close();
