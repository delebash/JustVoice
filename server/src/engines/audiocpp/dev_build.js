// SPDX-License-Identifier: MIT
// A development build of audio.cpp — what `npm run dev` runs instead of the pinned release.
//
// `scripts/audiocpp-dev.js` builds our fork's checkout beside this one (`../audio.cpp`, into
// `build/jv-dev`) before the app starts and names its bin folder in JUSTVOICE_AUDIOCPP_BUILD
// (docs/dev/TASKS.md, "`npm run dev` always runs the latest audio.cpp"). With it set, the kit's
// audio.cpp runtime runs it in place of an installed build (installLlm's
// `runtimeExeOverrides.audiocpp`, app.js — round E):
// - its server is that build's, never a downloaded one;
// - every feature the kit knows is on, both what the app offers and what the build answers for
//   (kit_settings.js `shippedHas`, `runtimeHas`) — the dev build is the fork's latest;
// - its backend comes from the build's own CMake cache;
// - the runtime row says it is the development build (`version`, "dev · 73a2b82e + local changes").
//
// Reading the build is the kit's since 2026-11-08 (`@delebash/core/runner/dev_build` `devBuild` — one
// module for every app, moved there from this file and JustDirect's): its server, backend, commit,
// version, and a packaged app ignoring the variable. What stays ours: the variable's name, the info
// file our build script writes beside the server (`jv-dev-build.json`: commit, dirty, source), and a
// memo — dsp_client and kit_settings ask on every call.

import { DEV_ENGINES, devBuild } from "@delebash/core/runner/dev_build";

export const ENV = "JUSTVOICE_AUDIOCPP_BUILD";
/** What scripts/audiocpp-dev.js writes beside the server: `{commit, dirty, source, built}`. */
export const INFO_FILE = "jv-dev-build.json";
export const SERVER_EXE = DEV_ENGINES.audiocpp.server;

// The answer is kept until `current.cacheClear()`.
const memo = { has: false, value: null };

/** The development build `npm run dev` pointed this server at, or null: the kit's
 * `{binDir, exe, backend, commit, dirty, source, version}`. */
export function current() {
  if (memo.has) return memo.value;
  memo.value = devBuild("audiocpp", ENV, { infoFile: INFO_FILE });
  memo.has = true;
  return memo.value;
}
current.cacheClear = () => {
  memo.has = false;
  memo.value = null;
};
