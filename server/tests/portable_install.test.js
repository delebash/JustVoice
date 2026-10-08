// SPDX-License-Identifier: MIT
// The portable-install rules (the port of tests/test_portable_install.py; user ruling
// 2026-08-14). Media rows store paths RELATIVE to the data root, so Settings → Storage →
// Change folder moves the files without orphaning every capture and take.
//
// Python booted create_app(data_dir) for the binding media_paths reads (the app state); here
// the same state is set directly — initDb + setState(new AppState(dir)).
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { AppState, cfg as stateCfg, setState } from "../src/app_state.js";
import { mediaFile, storeMediaPath } from "../src/media_paths.js";
import { closeModuleDb, initDbAt, tmpPath } from "./helpers.js";

afterEach(() => {
  stateCfg.state = null;
  closeModuleDb();
});

function boot(dir) {
  initDbAt(dir);
  setState(new AppState(dir));
}

test("capture_audio_is_stored_relative_to_the_data_root", () => {
  const tmp = tmpPath();
  boot(tmp);
  const stored = storeMediaPath(path.join(tmp, "captures", "c1.wav"));
  expect(stored).toBe("captures/c1.wav");
  expect(path.isAbsolute(stored)).toBe(false);
});

test("stored_media_resolves_under_the_current_data_root", () => {
  const tmp = tmpPath();
  boot(tmp);
  expect(mediaFile("captures/c1.wav")).toBe(path.join(tmp, "captures", "c1.wav"));
});

test("a_moved_data_folder_still_finds_its_files", () => {
  // THE regression: Change-folder copies the data elsewhere and deletes the old root. With
  // absolute rows every file was orphaned; relative rows resolve against whatever root the
  // server booted with.
  const tmp = tmpPath();
  const [old, next] = [path.join(tmp, "old"), path.join(tmp, "new")];
  boot(old);
  const stored = storeMediaPath(path.join(old, "captures", "c1.wav"));

  // The user moves the data folder; the server reboots on the new root.
  mkdirSync(path.join(next, "captures"), { recursive: true });
  writeFileSync(path.join(next, "captures", "c1.wav"), "RIFF");
  boot(next);

  expect(mediaFile(stored)).toBe(path.join(next, "captures", "c1.wav"));
  expect(statSync(mediaFile(stored)).isFile()).toBe(true);
});

test("a_file_outside_the_data_root_keeps_its_absolute_path", () => {
  // Not ours to relocate — rewriting it would break the reference.
  const tmp = tmpPath();
  boot(tmp);
  const outside = path.join(path.dirname(tmp), "elsewhere", "voice.wav");
  const stored = storeMediaPath(outside);
  expect(path.isAbsolute(stored)).toBe(true);
  expect(mediaFile(stored)).toBe(outside);
});

test("legacy_absolute_rows_still_resolve", () => {
  // No migration (pre-release rule): rows written before this change are absolute and keep
  // working exactly as they did.
  const tmp = tmpPath();
  boot(tmp);
  const legacy = path.join(tmp, "captures", "old.wav");
  expect(mediaFile(legacy)).toBe(legacy);
});
