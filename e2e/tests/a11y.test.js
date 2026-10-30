// SPDX-License-Identifier: MIT
// Accessibility — every page of the REAL desktop app against WCAG 2.2 AA (app-structure §17), checked by axe-core,
// Deque's engine and the standard automated check (playwright.dev/docs/accessibility-testing), in the light theme
// and the dark one. axe finds what a machine can — names, roles, contrast, ARIA misuse; the keyboard path through a
// screen and its reading order stay a person's review. The kit template's e2e/tests/a11y.test.js, over JustVoice's
// pages. Hermetic like the smoke suite (lib/driver.js).
//
// Before: `npm run build:unpacked` (the harness drives what was last built). Run: `npm test` from the app's root.

import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";
import { AxeBuilder } from "@axe-core/playwright";
import { Driver, waitFor } from "../lib/driver.js";

// WCAG 2.0, 2.1 and 2.2, levels A and AA — axe's tags (github.com/dequelabs/axe-core/blob/develop/doc/API.md)
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// every page in the sidebar (src/router/routes.js), by its route
const PAGES = ["home", "projects", "lines", "studio", "captures", "voices", "personas", "lexicons", "effects", "ai", "settings"];

const d = new Driver();
let page;

before(async () => {
  await d.launch();
  page = d.page;
  await page.waitForSelector(".app-shell", { timeout: 30_000 });
  // a fresh install opens the kind picker ("What are you making?") on Projects: closed, as a user would, so the
  // pages are what axe reads
  await page.locator(".ui-modal", { hasText: "What are you making?" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".ui-modal").waitFor({ state: "detached" });
});

after(async () => {
  await d.close();
});

/** axe's violations on what the window shows now, as lines a failure can be read from. Legacy mode: axe otherwise
 *  gathers its results in a blank page it opens, and Playwright's Electron opens none ("Target.createTarget: Not
 *  supported" — measured by docgen's session on its built app, 2026-10-29); legacy mode skips that page and only
 *  loses cross-origin frames, which the app has none of (axe-core-npm's playwright README, setLegacyMode). */
async function violations() {
  // every finite animation and transition ended first (the Web Animations API's document.getAnimations): a nav row
  // that just stopped being the current one read mid-fade in the template's dark run (2026-10-29)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => {})),
    ),
  );
  const { violations: found } = await new AxeBuilder({ page }).withTags(TAGS).setLegacyMode().analyze();
  return found.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const scheme of ["light", "dark"]) {
  test(`every page meets WCAG 2.2 AA in the ${scheme} theme`, async () => {
    await page.emulateMedia({ colorScheme: scheme }); // the theme follows the system until a user picks one
    const found = {};
    for (const name of PAGES) {
      await d.navigate(`#/${name}`);
      await page.waitForURL(new RegExp(`#/${name}`));
      await waitFor(async () => (await page.locator(".jv-content").innerText()).trim().length > 0, { what: `${name} drawn` });
      // the theme follows the system through a media-query listener: waited for, not read at once (the first page
      // after the switch can draw before it fires)
      await waitFor(async () => (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === scheme, {
        what: `the ${scheme} theme`,
      });
      const v = await violations();
      if (v.length) found[name] = v;
    }
    // every page's findings at once, not only the first page's
    assert.deepEqual(found, {}, `${scheme}`);
  });
}
