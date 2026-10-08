// SPDX-License-Identifier: MIT
// Media paths as STORED in the database — the app-state binding (the port of
// justvoice/media_paths.py). The shape is the family's (the kit's platform/data_paths); this
// module only binds it to the running data root so call sites stay one line.
//
// The rule (user ruling 2026-08-14): a media file inside the data folder is stored RELATIVE
// to it — so Settings → Storage → Change folder, and a backup restored onto another machine
// or drive, leave every capture and take resolvable. Files outside the data folder keep
// their absolute path (they are not ours to relocate), and absolute rows written before the
// rule still resolve — so there is nothing to migrate.

import { fromDataRelative, toDataRelative } from "@delebash/llm-runner/platform/data_paths";
import * as appState from "./app_state.js";

/** The value to persist for `audio_path` and friends. */
export function storeMediaPath(p) {
  return toDataRelative(p, appState.getState().dataDir);
}

/** The real file a stored media path refers to. */
export function mediaFile(stored) {
  return fromDataRelative(stored, appState.getState().dataDir);
}
