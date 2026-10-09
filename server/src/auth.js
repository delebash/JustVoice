// SPDX-License-Identifier: MIT
// JustVoice's auth SEAM — the settings read behind the family bearer-auth middleware (the
// port of justvoice/auth.py; the kit's platform/auth.js `bearerAuth`). The POLICY
// (token check, loopback bypass, the lockout escape) lives once in the kit; what stays here
// is where this app keeps its auth config — the SettingsStore's `auth` section, read live
// per /v1 request.

import * as appState from "./app_state.js";

/**
 * `[tokens, requireForLoopback]` from settings. Never throws: before the AppState exists
 * (early boot) it answers "no auth", so a config glitch can't lock the user out.
 */
export function readAuth() {
  let settings;
  try {
    settings = appState.getState().settings.get();
  } catch (e) {
    if (e?.name === "RuntimeError") return [[], false];
    throw e;
  }
  return [[...(settings.auth.tokens || [])], Boolean(settings.auth.require_for_loopback)];
}
