// SPDX-License-Identifier: MIT
// Voice tuning merge: the persona's delivery, then the request's on top (the port of
// justvoice/delivery_merge.py).
//
// `mergeDelivery()` collapses the two into one effective delivery dict that the engine
// receives. The request wins on key conflict; missing keys fall through. Engine-specific
// subdicts (`delivery.engine.*`) merge at the inner-key level too. (A render preset sat on
// top of both until render presets were removed, 2026-10-03.)
//
// Why a dedicated module: the merge is called from BOTH /v1/generate (single line) AND
// /v1/chapters/render (chapter batch), and the tier ordering must match exactly across both.

import { getLogger } from "@delebash/llm-runner/platform/log";
import { rstrip, truthy } from "@delebash/llm-runner/platform/py";
import { Delivery, modelFields } from "./models.js";

// (Python named this logger "justvoice.delivery-merge"; nothing logs through it today.)
export const logger = getLogger("justvoice.delivery-merge");

/**
 * Join delivery hints into the ONE instruct string engines consume.
 *
 * Qwen — the only family that reads instruct — has a single upstream slot, so everything
 * that shapes delivery has to arrive as one sentence. The ordering rule is **most specific
 * last**: the persona says who they are, the emotion labels the state, the line says how
 * this one goes. A lone hint passes through **verbatim**, unjoined and unstripped: a
 * hand-written instruct must never be reformatted just because it is the only one present.
 * Lives here because `/v1/generate` and `/v1/chapters/render` both compose it — drifting
 * apart would make the same persona sound different depending on which button was pressed.
 */
export function composeInstruct(...hints) {
  const kept = hints.filter((h) => truthy(h));
  if (!kept.length) return null;
  if (kept.length === 1) return kept[0];
  return kept.map((h) => rstrip(h, ". ")).join(". ");
}

const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

export function _decodeJsonDict(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return isDict(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Move engine-private keys out of the top level and into `engine`.
 *
 * Every UI that writes delivery saves the capability schema's keys **flat**
 * (`{"exaggeration": 0.7}`); every engine adapter reads them **nested**
 * (`delivery.engine.exaggeration`). Fixing it here rather than in each UI means one seam, and
 * it also repairs deliveries **already stored flat** in `personas.default_delivery`. An
 * explicit `engine` subdict still wins: a key present in both places keeps the nested value.
 */
export function nestEngineKeys(delivery) {
  if (!truthy(delivery)) return {};
  const canonical = new Set(modelFields(Delivery));
  const nested = { ...(truthy(delivery.engine) ? delivery.engine : {}) };
  const out = {};
  for (const [k, v] of Object.entries(delivery)) {
    if (k === "engine") continue;
    if (canonical.has(k)) out[k] = v;
    else if (!Object.hasOwn(nested, k)) nested[k] = v;
  }
  if (Object.keys(nested).length) out.engine = nested;
  return out;
}

/**
 * Merge `overlay` into `base`, recursing into nested dicts. Overlay wins on conflict;
 * non-dict values are replaced wholesale; lists are NOT merged element-wise.
 */
export function _deepMerge(base, overlay) {
  const out = truthy(base) ? { ...base } : {};
  if (!truthy(overlay)) return out;
  for (const [k, v] of Object.entries(overlay)) {
    if (v === null || v === undefined) continue;
    if (isDict(v) && isDict(out[k])) out[k] = _deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/**
 * The persona's delivery (`tier2Overlay`, caller-resolved), then the request's on top — one
 * effective delivery dict, or {} for neither. Each is normalised FIRST, so a flat
 * `exaggeration` in the persona and a nested one in the request land in the same place and
 * the request still wins.
 */
export function mergeDelivery(requestDelivery, tier2Overlay = null) {
  const merged = _deepMerge({}, nestEngineKeys(tier2Overlay || {}));
  return _deepMerge(merged, nestEngineKeys(requestDelivery || {}));
}
