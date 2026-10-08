// SPDX-License-Identifier: MIT
// Effects pipeline (Slice 6 of the Profile-kill plan) — the port of justvoice/audio/effects.py.
//
// The render path runs the persona's chain on every line it speaks:
//
//   TTS WAV  →  Persona.effects_chain  →  the line's audio
//
// `applyEffectsChain()` is the public entrypoint: WAV bytes + a (possibly empty) chain spec →
// new WAV bytes with the chain applied. The effects themselves run in `audiocpp_dsp`, the DSP
// program built from our audio.cpp fork (audio/dsp_client.js; moved there from numpy on
// 2026-10-07, proven output for output against the Python it replaced).
//
// Chain shape: a JSON-serializable list of `{type, params}` objects, `type` one of:
//   reverb (room_size, damping, wet_level, dry_level, width, freeze_mode) · chorus (rate_hz,
//   depth, centre_delay_ms, feedback, mix) · distortion (drive_db) · gain (gain_db) ·
//   compressor (threshold_db, ratio, attack_ms, release_ms) · pitch_shift (semitones) ·
//   delay (delay_seconds, feedback, mix) · highpass / lowpass (cutoff_frequency_hz) ·
//   eq_low / eq_mid / eq_high (cutoff_frequency_hz, gain_db, q).
// Those parameter names are unchanged on purpose: chains are persisted in the database and in
// user presets, and a rename would silently invalidate every one of them.
//
// Unknown types, entries switched off, and parameters an effect doesn't take are skipped —
// never an error; a value that isn't a number fails that effect alone. Nothing in a chain can
// fail a render. The UI's "EQ (3-band)" is sugar for the three eq_* primitives.
//
// `effectsChainHash()` is a deterministic sha256 of the resolved chain. The render cache key
// includes it so a hit fires only when the same chain would produce identical audio — which
// is why `DSP_VERSION` is part of the hash input. It hashes Python's `json.dumps(chain,
// sort_keys=True, separators=(",", ":"))` text: a chain read from storage must come through
// `pyJsonParse` so its whole-number floats stay floats ("1.0") — or every key changes.

import { createHash } from "node:crypto";
import { isJsonObject } from "@delebash/llm-runner/platform/py";
import { pyJsonCompact } from "@delebash/llm-runner/platform/pyjson";
import * as dspClient from "./dsp_client.js";

export const cfg = {
  //: Folded into the render cache key: bump it whenever the effects' output changes. "dsp1"
  //: is the numpy effects, which audiocpp_dsp reproduces sample for sample.
  DSP_VERSION: "dsp1",
  //: A chain with a pitch shift is also keyed by what does the shifting — Signalsmith
  //: Stretch moved from python-stretch to 1.4.0 inside audiocpp_dsp on 2026-10-07 and its
  //: output changed, so only those chains' cached takes render again.
  PITCH_ENGINE: "ss-1.4.0",
};
// Read-only views of the defaults (the cache key reads `cfg`, which a test may change).
export const DSP_VERSION = cfg.DSP_VERSION;
export const PITCH_ENGINE = cfg.PITCH_ENGINE;

/** The usable entries of a stored chain, in order (anything not a `{type, params}` object is
 * skipped). */
export function chainEntries(chain) {
  return (chain || []).filter(isJsonObject);
}

/** Apply `chain` to `wavBytes`, return new WAV bytes (async). An empty chain (or one whose
 * every entry is unusable) returns the input unchanged; the sample rate and channels are
 * preserved, and the audio comes back as 16-bit PCM. */
export async function applyEffectsChain(wavBytes, chain) {
  return dspClient.applyEffects(wavBytes, chain);
}

function hasPitchShift(chain) {
  return chain.some((e) => isJsonObject(e) && String(e.type || "").toLowerCase() === "pitch_shift");
}

/**
 * Deterministic sha256 of the resolved chain (first 16 hex). Empty chain → "noeffects".
 * `DSP_VERSION` is part of the payload: the cache's promise is "same key → same audio", a
 * claim about the CODE as much as the chain.
 */
export function effectsChainHash(chain) {
  if (!chain || !chain.length) return "noeffects";
  const payload = pyJsonCompact(chain);
  const version = hasPitchShift(chain) ? `${cfg.DSP_VERSION}+${cfg.PITCH_ENGINE}` : cfg.DSP_VERSION;
  return createHash("sha256").update(`${version}|${payload}`, "utf8").digest("hex").slice(0, 16);
}
