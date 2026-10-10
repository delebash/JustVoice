// SPDX-License-Identifier: MIT
// native.js — JustVoice's calls into its own desktop shell.
//
// The family shape (2026-08-15), same file, same job in all three apps: ordinary module
// exports, one per shell command, so a command's NAME as a string exists in exactly ONE
// place. Since the Electron move (2026-10-08) the shell is the kit's shared Electron main
// module (`@delebash/llm-runner/shell`, configured in src-electron/electron-main.js); this file is the
// ONLY reader of its one preload object, `window.appShell` (`invoke(command, args)`,
// `on(event, fn)`). These throw on failure where noted and callers use try/catch; a
// cancelled dialog resolves null. Outside the desktop app (Vite dev in a browser, the
// headless `serve` UI) every call answers the browser's way: null / [] / a no-op.
//
// Every native dialog is a shell command rather than a renderer API — the family shape, so
// a dialog can't appear at two different layers across the apps.

import { isDesktopShell } from "@delebash/llm-ui";

/** Is a desktop shell there to answer? The kit owns the one test. */
export const hasShell = () => isDesktopShell() && !!window.appShell;

const call = (command, args) => window.appShell.invoke(command, args);

// ─── Native dialogs ──────────────────────────────────────────────────

/** Folder picker. Resolves the chosen path, or null if the user cancelled. */
export function pickDirectory({ title, defaultPath } = {}) {
  if (!hasShell()) return Promise.resolve(null);
  return call("pickDirectory", { title, defaultPath }).catch(() => null);
}

/**
 * Save-as for binary blobs (2026-10-07, from JustWrite — the same function): every export
 * comes through here via the kit's `saveBlob` (configureFileSave in boot/jv.js). The bytes cross
 * to the shell as one Uint8Array (structured clone). Resolves `{ ok, path }`, or null if the
 * user cancelled; throws anything else.
 */
export async function saveFile({ blob, suggestedName, title, filterName, filterExt, defaultDir }) {
  if (!hasShell()) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return call("saveFile", { bytes, suggestedName, title, filterName, filterExt, defaultDir });
}

// ─── The portable data root ──────────────────────────────────────────

/** `{ root, default, portable }`, or null outside the shell. */
export function storageGetRoot() {
  if (!hasShell()) return Promise.resolve(null);
  return call("storageGetRoot").catch(() => null);
}

/** MOVE all app data to `newRoot`. Throws on failure. On success the app restarts itself
 *  (Chromium's own files live under the data root and can only move with a restart), so
 *  nothing after this call runs. Pick the folder with `pickDirectory` first. */
export function storageRelocate(newRoot) {
  return call("storageRelocate", { newRoot });
}

// ─── The shell's own switches ────────────────────────────────────────

/** The family headless ruling (2026-08-04): keep the server up on window close. */
export function setKeepRunning(keepRunning) {
  if (!hasShell()) return Promise.resolve();
  return call("setKeepRunning", { keepRunning: !!keepRunning }).catch(() => {});
}

// ─── Openers (handed to the kit's installLlmUi as `external`) ────────

/** Open a web link in the user's browser. */
export function openUrl(url) {
  return call("openExternal", { url });
}

/** Show a local folder (or file) in the OS file manager. */
export function openPath(path) {
  return call("openPath", { path });
}

// ─── The shell's pushes (the tray) ───────────────────────────────────

/** Subscribe to a shell event (`tray:open-settings`, `tray:about`, `tray:copy-url`).
 *  Returns the unsubscribe function; outside the shell, a no-op. */
export function onShellEvent(event, fn) {
  if (!hasShell()) return () => {};
  return window.appShell.on(event, fn);
}

// ─── Updates (the shell's electron-updater, 2026-10-09) ─────────────

/** The desktop app's updater for the kit's UpdatesPanel — its status, check, download, "Restart
 *  now", and the shell's `update:status` push. Null outside the desktop app. */
export function desktopUpdater() {
  if (!hasShell()) return null;
  return {
    status: () => call("updateStatus"),
    check: () => call("updateCheck"),
    download: () => call("updateDownload"),
    install: () => call("updateInstall"),
    onStatus: (fn) => window.appShell.on("update:status", fn),
  };
}

// ─── Audio devices ───────────────────────────────────────────────────

/** OS audio outputs for the Channels view. `[]` — as it was under Tauri, whose command was a
 *  placeholder returning an empty list; the picker stays empty until the feature is built. */
export function listAudioOutputDevices() {
  return Promise.resolve([]);
}

// ─── The dictation window (never created — study §7.1) ──────────────

/** The dictation window's messages to and from the main window. The Tauri shell carried
 *  them between windows; that window is never created, and the Electron shell has no
 *  window-to-window channel — the dictation feature adds one. Until then, no-ops. */
export function dictateEmit(_event, _payload) {
  return Promise.resolve();
}

/** See `dictateEmit`. Returns the unsubscribe function (a no-op). */
export function onDictateEvent(_event, _fn) {
  return () => {};
}
