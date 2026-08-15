// SPDX-License-Identifier: MIT
// native.js — JustVoice's calls into its own Tauri shell.
//
// The family shape (2026-08-15), same file, same job in all three apps: ordinary
// module exports, one per `#[tauri::command]`, so a command's NAME as a string
// exists in exactly ONE place. Before this, `invoke` was imported ad hoc at four
// call sites across a store and a view, and a renamed command would have had to
// be found by grepping for a string literal.
//
// The commands live in `src-tauri/src/lib.rs`. Every native dialog is a Rust
// command rather than the JS dialog plugin — the family shape, so a dialog can't
// appear at two different layers across the three apps.
//
// NOT here: `@tauri-apps/api/event` listeners. Events are a different channel
// (the shell pushing to the renderer), and JustWrite subscribes to them directly
// in App.vue too — same shape, deliberately.
//
// SCOPE NOTE, so this file isn't mistaken for an inventory: the shell registers
// 23 commands and the renderer calls FIVE. The other 18 — dictation, hotkeys,
// system-audio capture, accessibility permissions, server start/stop/restart —
// have no caller in `src/`. That is recorded, not acted on (your call,
// 2026-08-15: "no on jv stuff").

import { invoke } from "@tauri-apps/api/core";
import { isTauriShell } from "@delebash/llm-ui";

/** Is a desktop shell there to answer? The kit owns the one test. */
export const hasShell = () => isTauriShell();

// ─── Native dialogs (Rust commands — see lib.rs) ─────────────────────

/** Folder picker. Resolves the chosen path, or null if the user cancelled. */
export function pickDirectory({ title, defaultPath } = {}) {
  if (!hasShell()) return Promise.resolve(null);
  return invoke("pick_directory", { title, defaultPath }).catch(() => null);
}

// ─── The portable data root ──────────────────────────────────────────

/** `{ root, default, portable }`, or null outside the shell. */
export function storageGetRoot() {
  if (!hasShell()) return Promise.resolve(null);
  return invoke("storage_get_root").catch(() => null);
}

/** MOVE all app data to `newRoot` and respawn the server. Throws on failure; the
 *  caller reloads the webview once it resolves. Pick the folder with
 *  `pickDirectory` first. */
export function storageRelocate(newRoot) {
  return invoke("storage_relocate", { newRoot });
}

// ─── The shell's own switches ────────────────────────────────────────

/** The family headless ruling (2026-08-04): keep the server up on window close. */
export function setKeepRunning(keepRunning) {
  if (!hasShell()) return Promise.resolve();
  return invoke("set_keep_server_running", { keepRunning: !!keepRunning }).catch(() => {});
}

// ─── Audio devices ───────────────────────────────────────────────────

/** OS audio outputs for the Channels view. `[]` outside the shell — and today
 *  `[]` inside it too: the command is a placeholder that returns an empty list
 *  (`lib.rs`), which is why the picker is always empty. */
export function listAudioOutputDevices() {
  if (!hasShell()) return Promise.resolve([]);
  return invoke("list_audio_output_devices").catch(() => []);
}
