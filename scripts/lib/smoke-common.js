// SPDX-License-Identifier: MIT
// Shared browser lookup for every JV script that drives the renderer with
// Playwright — JustVoice's DOOR to the family implementation in
// `../just-llm-runner/scripts/lib/exec-resolve.mjs` (target-tree P7): it binds
// JV's env override (JV_CHROME) and re-exports the lookup. Import from HERE;
// never re-fork the lookup, and never hardcode a browser path.
//
// WHY the law: until 2026-07-29 each JV script carried its own Linux-only copy
// — the seven verify/parity scripts hardcoded /opt/pw-browsers/chromium-1194/
// chrome-linux/chrome outright — so none of them could find a browser on
// Windows and the renderer gate was documented as runnable when it was not.
// JustWrite hit the identical bug intra-repo (20 copies), and then the two
// repos' "one homes" forked ACROSS repos — the kit is now the single
// implementation (Linux/Windows/macOS layouts, headless_shell builds skipped,
// `undefined` as the SUCCESS value that lets Playwright resolve from its own
// registry).

import {
  chromeLaunchOptions as kitChromeLaunchOptions,
  findChrome as kitFindChrome,
} from "../../../just-llm-runner/scripts/lib/exec-resolve.mjs";

/** Path to a usable Chromium executable, or `undefined` (a SUCCESS value —
 *  Playwright then resolves from its own registry). `JV_CHROME` overrides. */
export const findChrome = () => kitFindChrome({ env: "JV_CHROME" });

/**
 * Launch options carrying the resolved browser, if one was found. Spread into
 * `chromium.launch({ ...chromeLaunchOptions(), headless: true })` so a
 * `undefined` result omits `executablePath` entirely.
 */
export const chromeLaunchOptions = () => kitChromeLaunchOptions({ env: "JV_CHROME" });
