// SPDX-License-Identifier: MIT
//
// Session snapshot — views paint instantly from the last visit's data
// and refresh silently. Canonical helper (RULE #1) for the pattern
// already used by Engines, Home, and now Projects: never hold a page
// blank while a fetch resolves for data we showed seconds ago.
// sessionStorage on purpose: dies with the app session, so stale data
// never survives a restart.

export function readSnapshot(key) {
  try {
    return JSON.parse(window.sessionStorage?.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function writeSnapshot(key, data) {
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(data));
  } catch { /* storage full — next visit just fetches */ }
}
