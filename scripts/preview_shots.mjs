// SPDX-License-Identifier: GPL-3.0-or-later
// Screenshot the voice-library design preview's key interactive states.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || path.join(root, "scripts", "_shots");
const EXE = process.env.CHROME || "/tmp/chrome-headless-shell-linux64/chrome-headless-shell";

import { mkdirSync } from "fs";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("file://" + path.join(root, "preview", "voice-library-preview.html"));
await page.waitForTimeout(600);

// 1. Voices default state
await page.screenshot({ path: `${OUT}/01-voices-default.png` });

// 2. Playing state on a ready voice
await page.getByRole("button", { name: "▶ Preview" }).first().click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/02-voices-playing.png` });
await page.waitForTimeout(2100);

// 3. Load confirm on Kokoro
await page.getByRole("button", { name: /Load engine \(~25s\)/ }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/03-voices-load-confirm.png` });

// 4. Loading progress
await page.getByRole("button", { name: "Load", exact: true }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/04-voices-loading.png` });

// 5. After load completes — groups flipped + toast
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/05-voices-after-load.png` });

// 6. Studio tab
await page.locator('.nav-item[data-tab="studio"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/06-studio.png` });

// 7. Studio: click a dormant voice → inline load confirm in the lib sidebar
await page.locator(".lib-voice.dormant").first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/07-studio-load-from-voice.png` });

await browser.close();
console.log("done →", OUT);
