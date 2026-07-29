// Shared browser lookup for every JV script that drives the renderer with Playwright.
//
// WHY this exists: until 2026-07-29 each script carried its own copy, and every copy
// looked in Linux locations only — `smoke.mjs` scanned `/opt/pw-browsers` and
// `~/.cache/ms-playwright` for `<dir>/chrome-linux/chrome`, and the seven verify/parity
// scripts hardcoded `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` outright, pinned
// to a browser version. On Windows, Playwright installs to
// `%LOCALAPPDATA%\ms-playwright\chromium-<ver>\chrome-win64\chrome.exe`, so none of them
// could find a browser on the user's box: the renderer gate was documented as runnable and
// was not. JustWrite hit the identical bug and fixed it on 2026-07-19
// (`justwrite-app/tests/lib/smoke-common.js`); this is the same fix, JV-side.
//
// Import from here. Never re-fork the lookup, and never hardcode a browser path — a
// hardcoded path silently selects nothing (or a headless_shell build that lacks the
// surface these scripts drive) and the launch fails with an unhelpful error.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Per-platform browser layout under <root>/<chromium-dir>/, in probe order.
const LAYOUTS = [
  "chrome-linux/chrome",
  "chrome-win64/chrome.exe",
  "chrome-win/chrome.exe",
  "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
];

function browserRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return [
    // The dev container's PREBUILT browsers — not a Playwright registry location,
    // which is the whole reason this scan exists.
    "/opt/pw-browsers",
    home ? join(home, ".cache", "ms-playwright") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : "",
  ].filter(Boolean);
}

/**
 * Path to a usable Chromium executable, or `undefined`.
 *
 * `undefined` is a SUCCESS value, not a failure: with `executablePath` omitted, Playwright
 * resolves the browser from its own registry, which is the normal path on a stock
 * Windows/macOS dev box. The scan exists for installs Playwright does NOT know about, such
 * as the container's `/opt/pw-browsers`. `JV_CHROME` overrides everything.
 *
 * headless_shell builds are skipped on purpose — they lack the full browser surface these
 * scripts drive, and selecting one breaks the launch.
 */
export function findChrome() {
  if (process.env.JV_CHROME && existsSync(process.env.JV_CHROME)) return process.env.JV_CHROME;
  for (const root of browserRoots()) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue; // unreadable root — try the next one
    }
    for (const dir of entries) {
      if (!dir.startsWith("chromium") || dir.includes("headless_shell")) continue;
      for (const layout of LAYOUTS) {
        const exe = join(root, dir, layout);
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

/**
 * Launch options carrying the resolved browser, if one was found.
 *
 * Spread into `chromium.launch({ ...chromeLaunchOptions(), headless: true })` so that a
 * `undefined` result omits `executablePath` entirely rather than passing it explicitly.
 */
export function chromeLaunchOptions() {
  const exe = findChrome();
  return exe ? { executablePath: exe } : {};
}
