// SPDX-License-Identifier: GPL-3.0-or-later
// Screenshot the voice-library design preview (v3) key states.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import { mkdirSync } from "fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT || path.join(root, "scripts", "_shots");
const EXE = process.env.CHROME || "/tmp/chrome-headless-shell-linux64/chrome-headless-shell";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } });
await page.goto("file://" + path.join(root, "preview", "voice-library-preview.html"));
await page.waitForTimeout(700);

// 1. Studio default — audiobook project, narrator band, picking for Idris
await page.screenshot({ path: `${OUT}/01-studio-audiobook.png` });

// 2. Engine dropdown open — installed / available-to-install / external sections
await page.locator("#lib-combo .combo-btn").click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/02-engine-dropdown.png` });

// 3. Switch library to Kokoro (installed, not loaded) → load banner + dormant rows
await page.locator("#lib-combo .combo-item", { hasText: "Kokoro" }).first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/03-lib-kokoro-not-loaded.png` });

// 4. Switch to Qwen3 (not installed) → install banner
await page.locator("#lib-combo .combo-btn").click();
await page.waitForTimeout(150);
await page.locator("#lib-combo .combo-item", { hasText: "Qwen3-TTS" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/04-lib-qwen3-not-installed.png` });

// 5. Switch to external provider → instantly ready, no banner
await page.locator("#lib-combo .combo-btn").click();
await page.waitForTimeout(150);
await page.locator("#lib-combo .combo-item", { hasText: "Kokoro FastAPI" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/05-lib-external-ready.png` });

// 6. Assign from Kokoro while not loaded → auto load-then-assign flow (progress)
await page.locator("#lib-combo .combo-btn").click();
await page.waitForTimeout(150);
// item order: Chatterbox(0), Kokoro(1), Qwen3(2), Kokoro FastAPI(3)
await page.locator("#lib-combo .combo-item").nth(1).click();
await page.waitForTimeout(200);
await page.locator(".voice-row", { hasText: "af_alloy" }).click();
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/06-load-in-progress.png` });
await page.waitForTimeout(2800);
await page.screenshot({ path: `${OUT}/07-after-load-assigned.png` });

// 8. Game project — no narrator band, NPC labels, per-line render
await page.locator("#proj-combo .combo-btn").click();
await page.waitForTimeout(150);
await page.locator("#proj-combo .combo-item", { hasText: "Harbor Lights" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/08-studio-game-project.png` });

// 9b. Script tab (audiobook attribution view)
await page.locator('.nav-item[data-tab="studio"]').click();
await page.waitForTimeout(250);
await page.locator("#proj-combo .combo-btn").click();
await page.waitForTimeout(150);
await page.locator("#proj-combo .combo-item", { hasText: "Stillwater" }).click();
await page.waitForTimeout(250);
await page.locator(".studio-tab", { hasText: "Script" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/10-script-audiobook.png` });

// 9c. Render tab (audiobook chapters)
await page.locator(".studio-tab", { hasText: "Render" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/11-render-audiobook.png` });

// 9d. Game: Lines tab + per-line render
await page.locator("#proj-combo .combo-btn").click();
await page.waitForTimeout(150);
await page.locator("#proj-combo .combo-item", { hasText: "Harbor Lights" }).click();
await page.waitForTimeout(250);
await page.locator(".studio-tab", { hasText: "Lines" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/12-lines-game.png` });
await page.locator(".studio-tab", { hasText: "Render" }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/13-render-game.png` });

// 9. Voices view — combobox + carded table
await page.locator('.nav-item[data-tab="voices"]').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/09-voices-view.png` });

await browser.close();
console.log("done →", OUT);
