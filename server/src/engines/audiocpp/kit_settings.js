// SPDX-License-Identifier: MIT
// The kit's audio.cpp runtime's own settings — its runner settings `<name>:audiocpp`, read through
// the kit's runtime config (llm/stores.js getRuntimeConfig), each at the kit's default where it holds
// none (runner/config.js DEFAULT_AUDIOCPP_SETTINGS). They were JustVoice's `engines.speech_runtime`
// until round E (docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1). The transcription hook
// reads one request's limit here; the DSP program its start and request limits, the values it read
// before.

import { stores } from "@delebash/core/llm";
import { DEFAULT_AUDIOCPP_SETTINGS } from "@delebash/core/runner/config";

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
