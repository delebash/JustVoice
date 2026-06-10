// Trigger an uninstall + screenshot the resulting toast to see what's "wrong".
// Target luxtts (no cost — not installed; uninstall is a near no-op).
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:17494";
const OUT = process.env.OUT || "E:/Dev/Web/justvoice-new/scripts/_shots";
const TARGET = process.env.TARGET || "luxtts";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (msg) => console.log("[browser]", msg.type(), msg.text()));
page.on("dialog", (d) => { console.log("[dialog]", d.message()); d.accept(); });

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Engines", exact: true }).click();
await page.waitForTimeout(700);
await page.evaluate((y) => { document.querySelector("main").scrollTop = y; }, 500);
await page.waitForTimeout(400);

// Open the prompt/confirm dialog by clicking Uninstall on the target row.
// First find a row containing the target engine name and click its Uninstall.
const row = page.locator("table tr").filter({ hasText: new RegExp(`^${TARGET}\\b`, "i") }).first();
const exists = await row.count();
console.log(`row count for ${TARGET}: ${exists}`);
if (!exists) {
  // Fallback: capture state for debugging.
  await page.screenshot({ path: `${OUT}/uninstall-no-row.png`, fullPage: true });
  await browser.close();
  process.exit(0);
}

await page.screenshot({ path: `${OUT}/uninstall-before.png`, fullPage: true });
const uninstallBtn = row.getByRole("button", { name: /Uninstall/i });
if (await uninstallBtn.count()) {
  await uninstallBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/uninstall-dialog.png`, fullPage: true });
  // Confirm the dialog.
  const confirmBtn = page.getByRole("button", { name: /^Uninstall$/, exact: true }).last();
  if (await confirmBtn.count()) {
    await confirmBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/uninstall-toast.png`, fullPage: true });
    console.log("saved uninstall sequence shots");
  } else {
    console.log("could not find confirm button");
    await page.screenshot({ path: `${OUT}/uninstall-no-confirm.png`, fullPage: true });
  }
} else {
  console.log("no Uninstall button on this row — engine probably not_installed");
  await page.screenshot({ path: `${OUT}/uninstall-no-button.png`, fullPage: true });
}

await browser.close();
