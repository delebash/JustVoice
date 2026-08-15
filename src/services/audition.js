// SPDX-License-Identifier: MIT
//
// Audition helpers — the pure parts of hearing a voice before you commit to
// it (workbench Slice B). Kept out of the component so the wire shape and
// the two honesty lines can be tested without mounting anything.
//
// The honesty lines exist because auditioning is NOT free here: one TTS
// engine is resident at a time, so hearing a voice from a different engine
// is a full model swap. The panel says so before you click, rather than
// looking instant and then hanging for a minute.

// Top-level fields on the server's Delivery shape. These are cross-engine —
// every engine that supports them reads them straight off `delivery`.
export const DELIVERY_KEYS = [
  "speed",
  "pitch",
  "pause_before",
  "pause_after",
  "gain_db",
  "temperature",
  "instruct",
  "style_prompt",
  "emotion",
  "seed",
];

function isEmpty(value) {
  return (
    value === "" ||
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

/**
 * Turn the flat editing dict into the wire shape.
 *
 * The knob schema from /v1/engines/capabilities mixes two kinds of key:
 * cross-engine ones that live on Delivery itself (speed, temperature…) and
 * engine-private ones (exaggeration, cfg_weight, talker_temperature…) that
 * every engine reads from the `delivery.engine` SUBDICT — send those flat
 * and they reach nothing. Routing happens here, once.
 *
 * Keys are sorted and empty cells dropped, mirroring the server's cache-key
 * canonicalization: the same knobs in a different order are the same sound
 * and must not be synthesized twice.
 */
export function canonicalDelivery(delivery) {
  const out = {};
  const engine = {};
  for (const key of Object.keys(delivery || {}).sort()) {
    const value = delivery[key];
    if (isEmpty(value)) continue;
    if (key === "engine") continue; // built below, never passed through raw
    if (DELIVERY_KEYS.includes(key)) out[key] = value;
    else engine[key] = value;
  }
  // Any engine subdict already present merges under the routed keys.
  for (const key of Object.keys(delivery?.engine || {}).sort()) {
    if (!isEmpty(delivery.engine[key])) engine[key] = delivery.engine[key];
  }
  if (Object.keys(engine).length) out.engine = engine;
  return out;
}

/**
 * The POST body for /v1/voices/{id}/preview. An empty line and no knobs
 * means "the canned audition" — send nothing at all, which is the path the
 * ▶ button has always used.
 */
export function buildAuditionBody({ text, delivery } = {}) {
  const line = (text || "").trim();
  const knobs = canonicalDelivery(delivery);
  const body = {};
  if (line) body.text = line;
  if (Object.keys(knobs).length) body.delivery = knobs;
  return Object.keys(body).length ? body : null;
}

/**
 * "Is this going to be quick?" — the load-cost line, always shown.
 *
 * `engines` is the engines-store list; `engineId` the voice's engine.
 * Returns {ready, text}: ready=true when this engine is the loaded one.
 */
export function loadNotice(engineId, engines) {
  const list = engines || [];
  const mine = list.find((e) => e?.id === engineId);
  const name = mine?.name || engineId || "This engine";
  if (!engineId) {
    return { ready: false, text: "No engine known for this voice — the first listen may need to load one." };
  }
  if (mine?.status === "loaded") {
    return { ready: true, text: `● ${name} is loaded — listens are quick.` };
  }
  const loaded = list.find((e) => e?.status === "loaded");
  if (loaded) {
    return {
      ready: false,
      text: `⏳ ${name} isn't loaded — ${loaded.name || loaded.id} is. The first listen swaps them, which can take a minute.`,
    };
  }
  return { ready: false, text: `⏳ ${name} isn't loaded — the first listen loads it and can take a minute.` };
}

const KNOB_LABEL = {
  speed: (v) => `speed ${Number(v).toFixed(2)}×`,
  pitch: (v) => `pitch ${v > 0 ? "+" : ""}${v} st`,
  gain_db: (v) => `gain ${v > 0 ? "+" : ""}${v} dB`,
  pause_before: (v) => `pause before ${v} ms`,
  pause_after: (v) => `pause after ${v} ms`,
  temperature: (v) => `temperature ${v}`,
  instruct: () => "instruct",
  style_prompt: () => "style prompt",
  emotion: (v) => `emotion ${v}`,
};

/**
 * "What am I actually hearing?" — one line naming every layer in play, so
 * the sound is never the result of settings scattered across three screens.
 *
 * Parts that only apply at render time (effects, lexicon) are named and
 * marked, never silently implied — the preview endpoint has no effects path.
 */
export function resolvedStack({ voiceName, engineName, delivery, personaName, effects, lexicon } = {}) {
  const head = personaName
    ? `Hearing ${personaName}: ${voiceName || "no voice"}`
    : `Hearing ${voiceName || "no voice"}`;
  const bits = [engineName ? `${head} (${engineName})` : head];

  const wire = canonicalDelivery(delivery);
  const { engine: engineKnobs, ...crossEngine } = wire;
  const label = (key, value) => (KNOB_LABEL[key] || ((v) => `${key} ${v}`))(value);
  for (const [key, value] of Object.entries(crossEngine)) bits.push(label(key, value));
  for (const [key, value] of Object.entries(engineKnobs || {})) bits.push(label(key, value));

  const deferred = [];
  const chain = (effects || []).filter(Boolean);
  if (chain.length) deferred.push(`${chain.length} effect${chain.length === 1 ? "" : "s"}`);
  if (lexicon) deferred.push(lexicon);
  if (deferred.length) bits.push(`${deferred.join(" · ")} (applies on render)`);

  return bits.join(" · ");
}
