// SPDX-License-Identifier: MIT
// Delivery overlay — per-line knobs (speed/pitch/gain/pause/emotion/instruct) (the port of
// justvoice/delivery.py).
//
// The overlay is optional per render — every field defaults to "engine's own default
// behavior". Post-render speed (when the model did not pace itself), gain and pitch are
// applied to the finished line by the DSP program (render_core.line_shape →
// audio/dsp_client); everything else is passed to the engine and the engine chooses how to
// honor it.

import { pyFloatParse, pyInt, pyStr, strip, truthy } from "@delebash/llm-runner/platform/py";
import { pyJson, unwrap } from "@delebash/llm-runner/platform/pyjson";

/**
 * Stable string form for cache-key hashing — the bytes Python's
 * `json.dumps(canonical, sort_keys=True, separators=(",", ":"))` writes.
 *
 * Drops null/empty/default fields so functionally-equivalent overlays collide on the same
 * key. A number Python holds as a float must arrive as one — a PyFloat (e.g.
 * `floatify(Delivery, d)`), or it is written "1" where Python wrote "1.0" and the key
 * changes (RESEARCH §6).
 */
export function canonicalJson(delivery) {
  if (!truthy(delivery)) return "";
  const canonical = {};
  for (const [k, v] of Object.entries(delivery)) {
    if (v === null || v === undefined) continue;
    if (k === "speed" && Math.abs(pyFloatParse(unwrap(v)) - 1.0) < 1e-6) continue;
    if (k === "pitch" && Math.abs(pyFloatParse(unwrap(v))) < 1e-6) continue;
    if (k === "pause_before" && pyInt(unwrap(v)) === 0) continue;
    if (k === "pause_after" && pyInt(unwrap(v)) === 0) continue;
    if (k === "gain_db" && Math.abs(pyFloatParse(unwrap(v))) < 1e-6) continue;
    if (k === "instruct" && !strip(pyStr(v))) continue;
    if (k === "engine" && !truthy(v)) continue;
    canonical[k] = v;
  }
  return pyJson(canonical, { sortKeys: true, separators: [",", ":"] });
}
