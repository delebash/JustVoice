// SPDX-License-Identifier: MIT
// One resolver: a persona and a line → the request every render sends (the port of
// justvoice/persona_render.py).
//
// A persona is a finished spoken voice: a voice (which carries its model) plus everything
// about how it speaks — its language, pace, pitch, gain, pauses, the model's own direction
// (written direction and emotion, or tags), the model's own sampling settings and seed,
// effects and a lexicon (docs/plans/2026-10-03-persona-redesign.md §6.1).
//
// Until 2026-10-03 four render paths built that request four ways (the chapter render, a
// line's re-render, Generate, nothing sending the persona's language or seed). Every path now
// asks `planLine`, so what you hear in the persona editor is what the chapter contains (plan
// §6.2 Q7).
//
// Floats: the persona's shared numbers (pace, pitch, gain) and the model's knobs are floats in
// Python; they leave `modelSettings` as PyFloats, so the render-cache key (which hashes
// Python's json.dumps text) writes them as Python does — "2.0", not "2".

import { strip, truthy } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyFloatValue } from "@delebash/llm-runner/platform/pyjson";
import { chainEntries } from "./audio/effects.js";
import { composeInstruct, mergeDelivery, nestEngineKeys } from "./delivery_merge.js";
import * as capabilityDetails from "./engines/capability_details.js";
import { construct, EMOTION_VALUES, PersonaDelivery } from "./models.js";
import * as renderCore from "./render_core.js";
import * as voiceModel from "./voice_model.js";

// Kept on the persona for every model: done on the server after synthesis.
export const SHARED_KEYS = ["speed", "pitch", "gain_db", "pause_before", "pause_after"];
const FLOAT_KEYS = new Set(["speed", "pitch", "gain_db"]);

// The persona editor's "Stock line" and what an empty Listen speaks: the mock's own line
// (`_s7`), in the persona's language where one is written here, else in English.
export const STOCK_LINES = {
  en: "The fog came in over the pier before either of them said a word.",
  es: "La niebla llegó sobre el muelle antes de que ninguno de los dos dijera una palabra.",
  fr: "Le brouillard est arrivé sur la jetée avant que l'un d'eux ne dise un mot.",
  de: "Der Nebel zog über den Pier, bevor einer von beiden ein Wort sagte.",
  it: "La nebbia arrivò sul molo prima che uno dei due dicesse una parola.",
  pt: "A névoa chegou ao cais antes que qualquer um deles dissesse uma palavra.",
  nl: "De mist trok over de pier voordat een van beiden een woord zei.",
  ru: "Туман накрыл пристань прежде, чем кто-либо из них успел сказать хоть слово.",
  ja: "二人のどちらかが口を開く前に、霧が桟橋に流れ込んできた。",
  zh: "他们俩还没开口，雾就已经漫过了码头。",
  ko: "둘 중 누구도 말을 꺼내기 전에 안개가 부두 위로 밀려왔다.",
};

export function stockLine(language) {
  const base = voiceModel.baseLang(language);
  return Object.hasOwn(STOCK_LINES, base) ? STOCK_LINES[base] : STOCK_LINES.en;
}

/** The request one line renders with. `delivery` is Delivery-shaped: speed, pitch, gain_db,
 * pauses, emotion, instruct, tags, temperature, and the model's own knobs under `engine`. */
export class LinePlan {
  constructor({ voice, model, text, language, delivery = {}, seed = null, effects = [], lexicons = [] }) {
    this.voice = voice;
    this.model = model;
    this.text = text;
    this.language = language;
    this.delivery = delivery;
    this.seed = seed;
    this.effects = effects;
    this.lexicons = lexicons;
  }
}

function _row(model) {
  if (!model) return null;
  const row = capabilityDetails.lookup(model);
  return row !== null && row.engine_id === model ? row : null;
}

/** {category: tagset} of the model's tag sets (a later set of one category wins). */
function _tagsets(model) {
  const row = _row(model);
  const out = {};
  for (const t of row !== null ? row.inline_tags : []) out[t.category] = t;
  return out;
}

/** The emotions a persona on `model` can pick from: the model's own emotion tags (Turbo's
 * seven), or the app's nine where the model takes written direction, or none. */
export function emotionChoices(model) {
  const sets = _tagsets(model);
  if (Object.hasOwn(sets, "emotion")) return [...sets.emotion.tags];
  const row = _row(model);
  if (row !== null && row.supports_instruct_freeform) return [...EMOTION_VALUES];
  return [];
}

export function registerChoices(model) {
  const sets = _tagsets(model);
  return Object.hasOwn(sets, "register") ? [...sets.register.tags] : [];
}

/** The model's own knobs, minus Speed (the persona's shared Pace) and Seed (its own field):
 * {key: KnobSpec}. */
export function knobSpecs(model) {
  const row = _row(model);
  if (row === null) return {};
  const out = {};
  for (const k of row.knobs) if (k.key !== "speed" && k.key !== "seed") out[k.key] = k;
  return out;
}

/** Python's `format(x, "g")`: 6 significant digits, trailing zeros dropped, exponent form
 * below 1e-4 and from 1e6. Candidate for platform/py.js. */
export function fmtG(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [mant, e] = x.toExponential(5).split("e");
  const exp = Number(e);
  const trim = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp < -4 || exp >= 6) return `${trim(mant)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  return trim(x.toFixed(5 - exp));
}

/** Python's `repr(str)`: single quotes unless the text holds one and no double quote.
 * Candidate for platform/py.js. */
export function pyReprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += `\\${q}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += `\\x${c.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + q;
}

/** Every value a model would not understand, as sentences — empty when the delivery is valid.
 * A model's settings are checked against THAT model, whichever voice the persona has now
 * (values are kept per model). */
export function checkDelivery(delivery) {
  const problems = [];
  for (const [model, ms] of Object.entries(delivery.models || {})) {
    const row = _row(model);
    if (row === null) {
      problems.push(`${model} is not a speech model`);
      continue;
    }
    const name = row.display_name;
    const specs = knobSpecs(model);
    for (const [key, raw] of Object.entries(ms.knobs || {})) {
      const value = Number(raw);
      const spec = Object.hasOwn(specs, key) ? specs[key] : null;
      if (spec === null) problems.push(`${name} has no ${key} setting`);
      else if (!(spec.min <= value && value <= spec.max)) {
        problems.push(`${name}'s ${spec.label} runs ${fmtG(spec.min)}–${fmtG(spec.max)}; ${fmtG(value)} is outside it`);
      }
    }
    if (ms.emotion != null && !emotionChoices(model).includes(ms.emotion)) {
      problems.push(`${name} has no emotion called ${pyReprStr(ms.emotion)}`);
    }
    if (ms.register_tag != null && !registerChoices(model).includes(ms.register_tag)) {
      problems.push(`${name} has no register called ${pyReprStr(ms.register_tag)}`);
    }
  }
  return problems;
}

/** The persona's delivery as a PersonaDelivery (a stored persona carries one; a draft or a
 * test's stand-in may carry a plain dict). */
function _personaDelivery(persona) {
  return construct(PersonaDelivery, persona?.default_delivery || {});
}

const asFloat = (v) => (v instanceof PyFloat ? v : pyFloatValue(v));

/**
 * `[delivery, tags, seed]` the persona sets for `model`.
 *
 * The shared values first (pace, pitch, gain, pauses), then that model's own: its knobs
 * (nested as the engines read them), its emotion — words for a written-direction model, a tag
 * for a tag model — its register tag, and its seed. A model the persona has no settings for
 * gets the shared values and nothing else. `line` is a line's own settings for this model
 * (`line_takes.lineModels`, 2026-10-06): its knobs, emotion and register win over the
 * persona's; an emotion or register of "" is none on that line.
 */
export function modelSettings(persona, model, line = null) {
  const pd = _personaDelivery(persona);
  const out = {};
  for (const k of SHARED_KEYS) {
    if (pd[k] != null) out[k] = FLOAT_KEYS.has(k) ? asFloat(pd[k]) : pd[k];
  }
  const tags = [];
  const ms = model && Object.hasOwn(pd.models, model) ? pd.models[model] : null;
  const knobs = {};
  if (ms !== null) for (const [k, v] of Object.entries(ms.knobs)) knobs[k] = asFloat(v);
  let emotion = ms !== null ? ms.emotion : null;
  let register = ms !== null ? ms.register_tag : null;
  const seed = ms !== null ? ms.seed : null;
  if (truthy(line)) {
    Object.assign(knobs, line.knobs || {});
    if ("emotion" in line) emotion = line.emotion || null;
    if ("register_tag" in line) register = line.register_tag || null;
  }
  Object.assign(out, knobs);
  if (emotion) {
    if (Object.hasOwn(_tagsets(model), "emotion")) tags.push(emotion);
    else out.emotion = emotion;
  }
  if (register) tags.push(register);
  return [nestEngineKeys(out), tags, seed];
}

/** The language the persona speaks (decided 2026-10-03: "we need to let user know this
 * persona is speaking japanese or engilish"). Where the voice or its model allows one language
 * (a Kokoro voice, Kitten, Turbo) that is the answer. Otherwise the persona's own choice when
 * the model speaks it, else the voice's own language (`own`), else the model's first. */
export function personaLanguage(persona, vm, own = null) {
  const chosen = strip(persona?.language || "") || null;
  if (vm == null) return chosen;
  if (vm.speaks.length === 1) return vm.speaks[0];
  if (chosen && (!vm.speaks.length || voiceModel.speaksLanguage(vm, chosen))) return chosen;
  if (own && (!vm.speaks.length || voiceModel.speaksLanguage(vm, own))) return own;
  return vm.speaks.length ? vm.speaks[0] : chosen;
}

/** An unsaved voice heard through a persona — the persona page's Clone, Design and Blend
 * makers (2026-10-04): the model it would speak on (`voiceModel.describe`), its description
 * when it is a design, and its own language. */
export class Candidate {
  constructor(vm, designPrompt = null, language = null) {
    this.vm = vm;
    this.designPrompt = designPrompt;
    this.language = language;
    Object.freeze(this);
  }
}

/**
 * The request one line spoken by `persona` renders with (async) → LinePlan.
 *
 * `voice` overrides the persona's (Generate speaking a persona's settings on its own voice
 * pick); `candidate` stands in for a voice not saved yet (the plan's `voice` is then null);
 * `requestDelivery` sits on top of the persona's delivery (a Compare value, a line's override
 * in Slice 4); `direction` is the line's own written direction, added after the persona's;
 * `lineModels` is a line's own settings per model — the one for this model wins over the
 * persona's (2026-10-06).
 *
 * The written direction is composed most specific last, for every model and dropped by the
 * ones that take none (slot.js): a clip-less designed voice's description, the persona's
 * standing delivery (or an explicit instruct in the request), its emotion, the line's
 * direction.
 */
export async function planLine(
  state,
  persona,
  { text, direction = null, bookLexicon = null, requestDelivery = null, voice = null, candidate = null, lineModels = null } = {},
) {
  let voiceId;
  let vm;
  let design;
  let ownLanguage;
  if (candidate != null) {
    voiceId = null;
    vm = candidate.vm;
    design = candidate.designPrompt;
    ownLanguage = candidate.language;
  } else {
    voiceId = voice || persona?.voice_id || null;
    vm = voiceId ? await voiceModel.voiceModel(state, voiceId) : null;
    design = renderCore.voiceDesignInstructForId(state, voiceId);
    ownLanguage = await voiceModel.voiceLanguage(state, voiceId);
  }
  const model = vm != null ? vm.model : null;

  const lm = lineModels || {};
  const [personaDelivery, tags, personaSeed] = modelSettings(persona, model, model && Object.hasOwn(lm, model) ? lm[model] : null);
  let seed = personaSeed;
  const request = { ...(requestDelivery || {}) };
  if (request.seed != null) seed = request.seed;
  delete request.seed;
  const delivery = mergeDelivery(request, personaDelivery);
  if (tags.length && !("tags" in request)) delivery.tags = tags;

  const standing = strip(persona?.voice_instruct || "") || null;
  const composed = composeInstruct(design, delivery.instruct || standing, delivery.emotion, strip(direction || "") || null);
  if (composed) delivery.instruct = composed;

  return new LinePlan({
    voice: voiceId,
    model,
    text,
    language: personaLanguage(persona, vm, ownLanguage),
    delivery,
    seed,
    effects: chainEntries(persona?.effects_chain ?? null),
    lexicons: renderCore.lineLexicons(bookLexicon, persona?.lexicon_id ?? null),
  });
}

