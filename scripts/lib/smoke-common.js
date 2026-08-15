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

// ── Server readiness — the ONE door every gate script waits on ────────────
// `/v1/health` answers 200 while the server is still doing first-boot work
// (SQLite seeding, engine-manifest discovery), and a renderer driven during
// that window renders fine but every nav click exceeds Playwright's 5 s
// actionability timeout — the whole suite goes red on a healthy app. That
// false red was misdiagnosed as "machine contention" twice on 2026-08-14 and
// re-run until green, which is how a gate teaches you to ignore it.
//
// Readiness here means the endpoints the views actually call are answering:
// settings (the DB seeded) and engines (manifests discovered). Returns the
// number of ms waited so a caller can report an unusually slow boot.
export async function waitForServerReady(base, { timeoutMs = 60000, log = () => {} } = {}) {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  const probes = ["/v1/health", "/v1/settings", "/v1/engines"];
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let ok = true;
    for (const path of probes) {
      try {
        const r = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) { ok = false; break; }
        await r.text();               // drain, so a slow body counts as not-ready
      } catch {
        ok = false;
        break;
      }
    }
    if (ok) {
      const waited = Date.now() - started;
      if (waited > 1500) log(`server took ${(waited / 1000).toFixed(1)}s to become ready`);
      return waited;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `server at ${root} never became ready within ${timeoutMs / 1000}s `
    + `(health/settings/engines still failing) — start it before running the gate`,
  );
}
