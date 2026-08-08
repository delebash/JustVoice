// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
//
// THE BOOT SMOKE (parity batch slice 11) — the skeleton (stub environment +
// mount assertion + why this gate exists: the TDZ-crash class, which JV hit
// live 2026-08-05) is the kit's registerBootSmoke; this file keeps JustVoice's
// parts: the fetch route map and the boot-error probe.
import { registerBootSmoke } from "@delebash/llm-ui/test/bootSmoke.js";

registerBootSmoke({
  boot: () => import("./main.js"),
  routes: {
    "/v1/health": { status: "ok", product: "justvoice" },
    "/v1/prefs": {}, // the prefs DOCUMENT is the top-level object (empty = defaults)
    "/v1/projects": { projects: [] },
  },
  // boot() is async and surfaces failures on window.__bootErr — rethrow so the
  // waitFor loop fails fast with the real error instead of timing out.
  ready: () => {
    if (window.__bootErr) throw window.__bootErr;
  },
});
