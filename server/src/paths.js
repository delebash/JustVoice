// SPDX-License-Identifier: MIT
// Data directory resolution — where the database + storage lives (the port of
// justvoice/paths.py). Paths are strings, as the kit's data_paths hands them out.
//
// Resolution order (THE family policy — the shape lives in the kit, never here:
// `@delebash/llm-runner/platform/data_paths`):
//   1. Explicit `--data-dir` CLI flag (handled by the CLI)
//   2. `JUSTVOICE_DATA_DIR` — the user's choice; also how the desktop shell hands down its
//      resolved root
//   3. `data/` beside the app (the DEFAULT — portable, in the install dir)
//   4. The OS app-data dir, only when the install dir is not writable

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "@delebash/llm-runner/platform/data_paths";

export const APP_NAME = "JustVoice";

// The checkout root in a source install: server/src/paths.js → repo. (A packaged build
// ignores this — the kit uses the executable's folder.)
export const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The app's data root, per the ONE family policy (user ruling 2026-08-14 — *"absolutely no
 * data ... stored anywhere but where the user has set the storage directory, which by
 * default will be the install directory for the app"*). The desktop shell resolves the
 * identical ladder before this process exists and hands the result down via
 * `JUSTVOICE_DATA_DIR`; keep the two in lock-step.
 *
 * Pre-release rule: this is a DEFAULT change, never a migration — data under an older
 * default stays where it is and is reachable by setting `JUSTVOICE_DATA_DIR`.
 */
export function defaultDataDir() {
  return resolveDataDir({ appName: APP_NAME, envVar: "JUSTVOICE_DATA_DIR", sourceRoot: SOURCE_ROOT });
}

/** Sub-path that the Rust core used for stores. */
export const storageRoot = (dataDir) => path.join(dataDir, "justvoice");
export const modelsRoot = (dataDir) => path.join(storageRoot(dataDir), "models");
export const cacheRoot = (dataDir) => path.join(dataDir, "cache");

/**
 * Speech-engine model files (phase ② of the 2026-08-13 redesign): PLAIN files per
 * <engine>/<variant>/ plus a files.json manifest — no HF cache layout, no blobs, no
 * symlinks. Deliberately the one place the location lives.
 */
export const speechCacheRoot = (dataDir) => path.join(dataDir, "speech-cache");
export const voicesRoot = (dataDir) => path.join(dataDir, "voices");
export const personasRoot = (dataDir) => path.join(dataDir, "personas");
export const lexiconsRoot = (dataDir) => path.join(dataDir, "lexicons");
export const projectsRoot = (dataDir) => path.join(dataDir, "projects");

/** Ad-hoc generation WAVs (MCP speak, future Generate-tab persistence). Created on ask. */
export function generationsRoot(dataDir) {
  const d = path.join(dataDir, "generations");
  mkdirSync(d, { recursive: true });
  return d;
}

export const settingsPath = (dataDir) => path.join(dataDir, "settings.json");
