// SPDX-License-Identifier: MIT
// The speech runtime's per-model options a user can set — set on each model row of Speech
// engines, saved in `engine_overrides[engine].runtime_options[model]`, and passed as the
// model's session options when it is registered (audit 2026-10-04 §13.5, batch 5h). The port
// of justvoice/engines/audiocpp/runtime_options.py.
//
// Only options whose effect was measured are offered; every value is one audio.cpp accepts
// (checked in our copy's source). A session option is read when the model loads, so a change
// reloads a loaded model.
//
// Measured on Qwen3-TTS CustomVoice 1.7B, a 752-character line in 200-character pieces, on an
// 8 GB card (docs/dev/RESEARCH.md §2.1): `perf_mode=flash_attention` 194 MB less at the peak
// and 9 % faster, a different take for the same seed; `conv_weight_type=f16` 492 MB less, the
// audio 2.04 dB (log-spectral) from the 32-bit take — close. `mem_saver` changed nothing
// there, so it is not offered.
//
// Each option has the app's `default` (what a model loads with when nothing is set) and
// audio.cpp's own `runtime_default` (never sent). They differ for Decoder weights: the user
// could not tell 16-bit from 32-bit by ear (2026-10-04), so 16-bit is the default and is sent
// to every Qwen3 model unless 32-bit is chosen on its row.

import { ValueError } from "@delebash/llm-runner/platform/py";
import * as appState from "../../app_state.js";
import * as self from "./runtime_options.js";

// family → the options offered for its models. `only_8bit`: audio.cpp accepts it only with
// Q8_0 weights (`qwen3_tts.perf_mode=flash_attention is supported only with Q8_0 GGUF
// weights`, ../audio.cpp/src/models/qwen3_tts/session.cpp).
export const OFFERED = {
  qwen3_tts: [
    {
      key: "qwen3_tts.perf_mode",
      label: "Attention",
      choices: [
        ["off", "Exact"],
        ["flash_attention", "Flash attention"],
      ],
      default: "off",
      runtime_default: "off",
      only_8bit: true,
      hint: "Flash attention: about 9 % faster and 0.2 GB less at the peak; the same seed gives a different take.",
    },
    {
      key: "qwen3_tts.conv_weight_type",
      label: "Decoder weights",
      choices: [
        ["f16", "16-bit"],
        ["f32", "32-bit"],
      ],
      default: "f16",
      runtime_default: "f32",
      only_8bit: false,
      hint: "16-bit: about 0.5 GB less at the peak than 32-bit; no difference heard.",
    },
  ],
};

// The catalog's own mark: every 8-bit row's id ends "-q8" (`release.sixteenBit` swaps it for
// the 16-bit sibling's). A file name is not one — Base 1.7B's is "…-q8_0_v2.gguf".
const is8bit = (row) => String(row.id ?? "").endsWith("-q8");

/** The options a manifest row's model takes. */
export function offeredFor(row) {
  const family = (row.audiocpp || {}).family;
  return (OFFERED[family] || []).filter((o) => !o.only_8bit || is8bit(row));
}

/** What the user set for this model (only non-default values are kept). */
export function savedFor(engineId, variantId) {
  let ov;
  try {
    ov = appState.getState().settings.get().engines.engine_overrides[engineId];
  } catch {
    return {}; // no app state (unit tests): nothing set
  }
  return { ...((ov ? ov.runtime_options[variantId] : null) || {}) };
}

/** Every option the row takes, at the value it loads with: what the user saved, else the
 * app's default. A value saved for an option the row no longer offers is dropped. */
export function chosenFor(engineId, row) {
  const saved = self.savedFor(engineId, row.id);
  const out = {};
  for (const o of offeredFor(row)) {
    const value = Object.hasOwn(saved, o.key) ? saved[o.key] : undefined;
    out[o.key] = o.choices.some(([c]) => c === value) ? value : o.default;
  }
  return out;
}

/** What `_entriesFor` passes at registration: each chosen value that isn't audio.cpp's own
 * default (16-bit Decoder weights is sent unless 32-bit is chosen). */
export function sessionOptionsFor(engineId, row) {
  const runtimeDefault = Object.fromEntries(offeredFor(row).map((o) => [o.key, o.runtime_default]));
  return Object.fromEntries(Object.entries(chosenFor(engineId, row)).filter(([k, v]) => v !== runtimeDefault[k]));
}

/** `values` checked against what the row offers; values at the app's default dropped (nothing
 * saved = the default). Throws ValueError naming the first bad key or value. */
export function validate(row, values) {
  const offered = Object.fromEntries(offeredFor(row).map((o) => [o.key, o]));
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const opt = offered[key];
    if (opt === undefined) throw new ValueError(`${row.name ?? row.id} has no runtime option ${key}`);
    const allowed = opt.choices.map(([c]) => c);
    if (!allowed.includes(value)) throw new ValueError(`${opt.label} must be one of ${allowed.join(", ")}`);
    if (value !== opt.default) out[key] = value;
  }
  return out;
}

/** The row's offered options with their current values — the model row reads this (the
 * `RuntimeOption` wire shape). */
export function describe(engineId, row) {
  const chosen = chosenFor(engineId, row);
  return offeredFor(row).map((o) => ({
    key: o.key,
    label: o.label,
    hint: o.hint,
    default: o.default,
    choices: o.choices.map(([c, lbl]) => ({ value: c, label: lbl })),
    value: chosen[o.key],
  }));
}
