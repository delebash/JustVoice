import { chromium } from "playwright";
const TABS = ["Overview","Generate","Chapter","Voices","Compare","Train","Personas","Lexicons","Engines","Cache","Settings"];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on("console", m => { if (m.type()==="error") errs.push(m.text()); });
p.on("pageerror", e => errs.push(`PAGEERROR: ${e.message}`));
await p.goto("http://localhost:1430", { waitUntil:"networkidle" });
await p.waitForTimeout(600);
const out = {};
for (const t of TABS) {
  const before = errs.length;
  await p.getByRole("button", { name: t, exact: true }).click();
  await p.waitForTimeout(700);
  const blocks = await p.locator("main .block").count();
  out[t] = { blocks, newErrors: errs.slice(before) };
}
console.log(JSON.stringify(out, null, 2));
await b.close();
