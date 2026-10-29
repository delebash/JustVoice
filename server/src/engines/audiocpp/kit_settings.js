// SPDX-License-Identifier: MIT
// The kit's audio.cpp runtime's own settings — its runner settings `<name>:audiocpp`, read through
// the kit's runtime config (llm/stores.js getRuntimeConfig), each at the kit's default where it holds
// none (runner/config.js DEFAULT_AUDIOCPP_SETTINGS). They were JustVoice's `engines.speech_runtime`
// until round E (docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1). The transcription hook
// reads one request's limit here; the DSP program its start and request limits, the values it read
// before; a take's check the runaway limit.
//
// And what a build of it can do (round E, §4 step 2 — the kit's runtimes.js `buildHas`, from its
// `defaults.features`): the build this app ships (the kit's tested one, which its Update installs —
// what the app offers) and the build pinned on this computer (what runs here); `npm run dev`'s own
// build, the fork's latest, has every feature.

import { stores } from "@delebash/core/llm";
import { DEFAULT_AUDIOCPP_SETTINGS } from "@delebash/core/runner/config";
import { buildHas, runtimeOf } from "@delebash/core/runner/runtimes";
import * as devBuild from "./dev_build.js";

const RUNTIME = runtimeOf("audiocpp");

/** The runtime's setting `name` as a positive number — a time limit in seconds, a count — else
 * the kit's default for it (no database yet: a script, a bare test). */
export function runtimeNumber(name) {
  try {
    const v = Number(stores.getRunnerConfigStore().getRuntimeConfig("audiocpp").settings?.[name]);
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    // no kit database: the default
  }
  return DEFAULT_AUDIOCPP_SETTINGS[name];
}

/** The build pinned on this computer (the kit's runner setting), else the one the kit ships. */
export function pinnedBuild() {
  try {
    return stores.getRunnerConfigStore().getRuntimeConfig("audiocpp").pinnedBuild || RUNTIME.defaults.pinnedBuild;
  } catch {
    return RUNTIME.defaults.pinnedBuild; // no kit database: the shipped build
  }
}

/** Whether `npm run dev`'s build runs — every feature the kit knows, then. */
const devFeature = (feature) => (devBuild.current() !== null ? Object.hasOwn(RUNTIME.defaults.features, feature) : null);

/** Whether the build this app ships has `feature` — what the app offers (an older build pinned here
 * refuses it by name, with the update to offer). */
export function shippedHas(feature) {
  return devFeature(feature) ?? buildHas(RUNTIME, RUNTIME.defaults.pinnedBuild, feature);
}

/** Whether the build pinned on this computer — the one that runs — has `feature`. */
export function runtimeHas(feature) {
  return devFeature(feature) ?? buildHas(RUNTIME, pinnedBuild(), feature);
}

/** The runaway limit for a line of `text`, in seconds: `runaway_s_per_char` a character of it, and
 * never less than `runaway_min_s` — the rule the kit prices speech models by (runner/
 * speech_placement.js `runawayLimitS`, read there off its placement), here for a take's check. */
export function runawayLimitS(text) {
  let s = {};
  try {
    s = stores.getRunnerConfigStore().getRuntimeConfig("audiocpp").settings ?? {};
  } catch {
    // no kit database: the defaults
  }
  const at = (name) => (Number.isFinite(Number(s[name])) && Number(s[name]) >= 0 ? Number(s[name]) : DEFAULT_AUDIOCPP_SETTINGS[name]);
  return Math.max(at("runaway_min_s"), at("runaway_s_per_char") * String(text ?? "").length);
}
