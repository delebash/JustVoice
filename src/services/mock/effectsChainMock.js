// SPDX-License-Identifier: MIT
// The Effects chain mock's data (`#/mock/personas/p_june/effects`, dev only — the build's question
// 9, decided 2026-10-15: the chain list drawn compact in the app first, the build after the user
// looks). Production minus the plumbing: the effects and their knobs are the server's own list
// (server/src/audio/effect_catalog.js, what GET /v1/effects/catalog serves); the four built-in
// presets are the server's seed as it stands (server/src/database/seed.js — a server test keeps
// this copy equal to it); only the persona's chain and the presets you save are made up.

import { EFFECT_CATALOG } from "../../../server/src/audio/effect_catalog.js";

export const CATALOG = EFFECT_CATALOG;

const on = (type, params) => ({ type, enabled: true, params });

/** The built-in presets as the server seeds them (`BUILTIN_EFFECT_PRESETS`), the way
 *  GET /v1/effect-presets answers: `is_builtin`, in their sort order. */
export const BUILTIN_PRESETS = [
  {
    id: "fx_robotic",
    name: "Robotic",
    is_builtin: true,
    chain: [
      on("chorus", { rate_hz: 0.35, depth: 0.4, centre_delay_ms: 3.0, feedback: 0.65, mix: 0.55 }),
      on("eq_mid", { cutoff_frequency_hz: 1100.0, gain_db: 5.0, q: 1.6 }),
      on("distortion", { drive_db: 8.0 }),
    ],
  },
  {
    id: "fx_radio",
    name: "Radio",
    is_builtin: true,
    chain: [
      on("highpass", { cutoff_frequency_hz: 450.0 }),
      on("lowpass", { cutoff_frequency_hz: 3200.0 }),
      on("compressor", { threshold_db: -24.0, ratio: 6.0, attack_ms: 2.0, release_ms: 150.0 }),
      on("distortion", { drive_db: 12.0 }),
    ],
  },
  {
    id: "fx_echo",
    name: "Echo Chamber",
    is_builtin: true,
    chain: [
      on("reverb", { room_size: 0.92, damping: 0.18, wet_level: 0.38, dry_level: 0.72, width: 0.9 }),
      on("delay", { delay_seconds: 0.24, feedback: 0.4, mix: 0.3 }),
    ],
  },
  {
    id: "fx_deep",
    name: "Deep Voice",
    is_builtin: true,
    chain: [
      on("pitch_shift", { semitones: -3.0 }),
      on("eq_low", { cutoff_frequency_hz: 220.0, gain_db: 4.0, q: 0.7 }),
      on("compressor", { threshold_db: -20.0, ratio: 2.5, attack_ms: 8.0, release_ms: 200.0 }),
    ],
  },
];
