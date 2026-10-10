// SPDX-License-Identifier: MIT
// Single source of truth for version + product strings (the port of justvoice/version.py;
// justvoice/__init__.py's `__version__` / `__api_version__` are the same two values).

import pkg from "../package.json" with { type: "json" };

export const PRODUCT = "JustVoice";
// The app's version — the server package's, which a release sets with the desktop app's
// (package.json at the repo root); the sidebar and Settings → Updates show it (/v1/health).
export const VERSION = pkg.version;
// What a render's cache key carries in the version's place (render_core._inputsKey). It was the
// app version, 0.0.1, so every take recorded so far holds it; frozen there so a version bump never
// marks every rendered line stale (decided 2026-10-10, TASKS "Four answers", 1). A change to how a
// line renders has its own key parts (the DSP and pitch-engine versions in audio/effects.js).
export const RENDER_KEY_VERSION = "0.0.1";
export const API_VERSION = "v1";
export const DEFAULT_PORT = 17494;
