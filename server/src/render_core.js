// SPDX-License-Identifier: MIT
// Render orchestration — voice + text + delivery → PCM bytes (the port of
// justvoice/render_core.py).
//
// Single source of truth for the per-line render pipeline used by both `/v1/generate` (one
// line) and `/v1/render_chapter` (many). Handles: cache lookup, lexicon substitution, engine
// auto-load, synthesize, speed / gain / pitch on the finished line (`applyLineDelivery`),
// cache store. Long-text inputs (> settings.generation.max_chunk_chars, or the model's own
// split size) go through the chunked path (audio/chunked.js) so chapter-scale renders split
// at sentence boundaries and join without clicks.
//
// No sample math happens here: speed, gain, pitch, the effects chain, the joins and a line's
// fit into a chapter are requests to `audiocpp_dsp` (audio/dsp_client.js; 2026-10-07).
//
// Sync vs async: what only reads (the text preparation, the key, the split size) is
// synchronous; what finds a voice among the registry engines' voices (a provider's list may
// need the network) is async — `_resolveEngineForVoice`, `_lineModel`, `probeLineCached`,
// `lineInputsKey` — and so is everything that synthesizes or reaches the DSP program.
//
// THE CACHE KEY hashes Python's json.dumps text (`delivery.canonicalJson`,
// `effects.effectsChainHash`): a number Python holds as a float must reach it as a PyFloat
// (the persona's and the line's numbers arrive that way from persona_render / line_takes),
// or the key changes (RESEARCH §6).

import { realpathSync, statSync } from "node:fs";
import zlib from "node:zlib";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { B, pyFloatParse, pyInt, pySorted, strip, truthy, ValueError, cpLen, reEscape } from "@delebash/llm-runner/platform/py";
import { unwrap } from "@delebash/llm-runner/platform/pyjson";
import { DEFAULT_MAX_CHUNK_CHARS, splitTextIntoChunks } from "./audio/chunked.js";
import * as dspClient from "./audio/dsp_client.js";
import { effectsChainHash } from "./audio/effects.js";
import { parseWavHeader, stripWavHeader, writeWavContainer } from "./audio/wav.js";
import { CacheKeyBuilder, packPcmWithFormat, unpackPcmWithFormat } from "./cache.js";
import { canonicalJson } from "./delivery.js";
import { SynthRequest } from "./engines/base.js";
import * as capabilityDetails from "./engines/capability_details.js";
import * as runtime from "./engines/audiocpp/runtime.js";
import * as manager from "./engines/manager.js";
import { badRequest, internal, notFound } from "./errors.js";
import { ATOMIC, SPANS, strip as stripTags } from "./inline_tags.js";
import * as self from "./render_core.js";
import { VERSION } from "./version.js";
import * as voiceModel from "./voice_model.js";

export const log = getLogger("justvoice.render_core");

// ── Python's number conversions (candidates for platform/py.js) ─────────────────

/** Python's `float(v)` for the values a delivery holds: a number, a bool, a numeric string;
 * anything else is a TypeError, a non-numeric string a ValueError. */
export function toFloat(v) {
  const x = unwrap(v);
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") return pyFloatParse(x);
  throw new TypeError(`float() argument must be a string or a real number, not '${x === null ? "NoneType" : typeof x}'`);
}

/** Python's `int(v)`: a float is truncated, a bool is 0/1, a string must be a whole number. */
export function toInt(v) {
  const x = unwrap(v);
  if (typeof x === "number") return pyInt(x);
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string") return pyInt(x);
  throw new TypeError(`int() argument must be a string, a bytes-like object or a real number, not '${x === null ? "NoneType" : typeof x}'`);
}

/** A manager's `manifests()` values — a Map from the real manager, an object from a test's. */
const valuesOf = (x) => (x instanceof Map ? [...x.values()] : Object.values(x || {}));

/** `str.format(value=…)` for a tag syntax ("[{value}]"). */
function formatSyntax(syntax, value) {
  return syntax.replace(/\{\{|\}\}|\{value\}/g, (m) => (m === "{{" ? "{" : m === "}}" ? "}" : String(value)));
}

// ── The rendered line ───────────────────────────────────────────────────────────

/**
 * One rendered line. `inputsKey` is what the audio was made from (the render cache's key) and
 * `seed` the seed it was made with — a take records both, so Render can tell a line whose
 * inputs changed since (stale) from one that still matches (Studio Slice 4, 2026-10-04); empty
 * for audio that was not rendered here. `engine` / `model` are what spoke it — a take's
 * generation records both (2026-10-06: every render was saved as "managed").
 */
export class RenderedLine {
  constructor({ pcm, sampleRate, channels, effectiveDelivery, inputsKey = "", seed = null, engine = "", model = "" }) {
    this.pcm = pcm;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.effectiveDelivery = effectiveDelivery;
    this.inputsKey = inputsKey;
    this.seed = seed;
    this.engine = engine;
    this.model = model;
  }
}

/**
 * Find the engine id that owns a voice id (preset or stored), async. Checks three sources:
 * in-process engine voice lists, stored voices, and managed-engine manifest static voices. The
 * manifest pass matters for preset voices of NOT-YET-LOADED engines (e.g. kokoro's af_heart
 * before first load) — without it any render/preview against them 404s before auto-load can
 * even run.
 */
export async function _resolveEngineForVoice(state, voiceId) {
  for (const engine of state.engines.all()) {
    if ((await engine.voices()).some((p) => p.id === voiceId)) return engine.meta.engineId;
  }
  const stored = state.voices.get(voiceId);
  if (stored) return stored.engine;
  try {
    for (const m of valuesOf(manager.getManager().manifests())) {
      if ((m.staticVoices || []).some((v) => v.id === voiceId)) return m.id;
    }
  } catch {
    /* no manager */
  }
  return null;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The absolute path of a stored voice's reference WAV, so the runtime can read it as
 * `audio_prompt_path`; null when there is none. Cloned and imported voices always have one —
 * it is the whole voice. A DESIGNED voice has one only if its preview was frozen at save
 * (2026-08-22): the Designer's own clip becomes the reference, and from there the voice
 * renders as an ordinary clone with a stable identity instead of re-rolling a speaker per
 * line. Designed voices saved before that, and any whose file is missing, fall through to null
 * and stay dynamic — see `voiceDesignInstruct` for the other half of that rule.
 */
export function resolveAudioPromptForStored(state, stored) {
  if (!["cloned", "imported", "designed"].includes(stored.source)) return null;
  const store = state?.voices ?? null;
  if (store === null) return null;
  const p = String(store.refWavPath(stored.id));
  if (!isFile(p)) return null;
  return realpathSync.native(p);
}

/**
 * The description a DESIGNED voice contributes to the instruct slot. **Clip wins.** A designed
 * voice whose preview was frozen to `ref.wav` renders as a clone — the identity is in the
 * audio — so its description is provenance and display only, and must NOT also be spoken as
 * direction. Without a clip the description IS the voice: it has to reach the engine on every
 * line or the VoiceDesign checkpoint has no identity to render at all.
 *
 * Separate from `voiceSynthFields` on purpose: that one carries synth INPUTS keyed as the
 * engine protocol expects, called inside `renderLine` — after the instruct is composed. This
 * is prose for the instruct slot, so it belongs at the compose sites (persona_render, the
 * Generate door), first in the order: the description says who the voice is, everything after
 * it says how this line goes. Both live here so the clip-wins rule has one home.
 */
export function voiceDesignInstruct(state, stored) {
  if (stored == null || stored.source !== "designed") return null;
  if (resolveAudioPromptForStored(state, stored)) return null;
  return strip(stored.design_prompt || "") || null;
}

/** A voice drawn from its written description on every request — designed, no clip
 * (`voiceDesignInstruct`'s clip-wins rule). */
export function isDescriptionVoice(state, voiceId) {
  return voiceDesignInstructForId(state, voiceId) !== null;
}

/** The seed a description voice speaks with when none is set (audit 2026-10-04 §13.3). Its
 * voice is drawn from the description on every request, so with a random seed each line — and
 * each piece of a long line — came out as a different person. A fixed seed per voice makes it
 * one voice; a persona's own seed still wins. Stable across runs (crc32 of the id). */
export function descriptionSeed(voiceId) {
  return zlib.crc32(Buffer.from(voiceId, "utf8")) & 0x7fffffff;
}

/** The longest piece a line goes to its model in: the model's split size (the user's per
 * model, else the catalog's — `EngineManager.splitCharsFor`) under
 * `generation.max_chunk_chars`, which a model with none gets. A description voice keeps
 * `max_chunk_chars`: split, it drifted into a different person from piece to piece (the
 * user's listening verdict, 2026-10-04 — audit §13.6). The host splits at sentence ends and
 * joins; a piece under audio.cpp's own budget is never re-split with its hard join (audit §5
 * D5). */
export function lineSplitChars(state, engineId, voice) {
  const cap = pyInt(state.settings.get().generation?.max_chunk_chars ?? DEFAULT_MAX_CHUNK_CHARS);
  if (isDescriptionVoice(state, voice)) return cap;
  let split;
  try {
    const mgr = manager.getManager();
    split = mgr.splitCharsFor(engineId, mgr.currentVariantId(engineId));
  } catch {
    // a registry engine / bare tests: no split of its own
    split = null;
  }
  return split ? Math.min(cap, split) : cap;
}

/** `voiceDesignInstruct` by voice id — the form the compose sites want, since they hold an id
 * and a missing/preset voice must be a quiet null. Tolerates a state with no voice store (the
 * chapter resolver's tests hand it a duck-typed state carrying only the stores it uses). */
export function voiceDesignInstructForId(state, voiceId) {
  const store = state?.voices ?? null;
  if (!voiceId || store === null) return null;
  return voiceDesignInstruct(state, store.get(voiceId));
}

/**
 * Everything a stored voice contributes to a synth request, keyed as the engine protocol
 * expects (snake_case — it is the synth body). THE one place that knows how each voice source
 * reaches an engine:
 *
 *     cloned / imported → audio_prompt_path (+ ref_text where the engine takes the clip's
 *                         transcript, + xvector_only for Qwen3 Base's "Skip the words")
 *     blended           → voice_vector (the style vector; kokoro)
 *     designed          → audio_prompt_path + ref_text IF its preview was frozen at save;
 *                         otherwise nothing here, and its description reaches the engine as
 *                         instruct prose through `voiceDesignInstruct` at the compose sites
 *     preset            → nothing
 */
export function voiceSynthFields(state, stored) {
  if (stored == null) return {};
  const out = {};
  const prompt = resolveAudioPromptForStored(state, stored);
  if (prompt) {
    out.audio_prompt_path = prompt;
    if (stored.transcript) out.ref_text = stored.transcript;
    if (stored.xvector_only) out.xvector_only = true; // Qwen3 Base's "Skip the words", as auditioned
  }
  if (stored.source === "blended" && truthy(stored.embedding)) out.voice_vector = [...stored.embedding];
  return out;
}

function _registryEngine(state, engineId) {
  const registry = state?.engines ?? null;
  return registry !== null ? (registry.get(engineId) ?? null) : null;
}

/** The model `voice` speaks on — voice_model.js's one answer — or the engine itself where
 * nothing finer is known (async). */
export async function _lineModel(state, voice, engineId) {
  const vm = await voiceModel.voiceModel(state, voice);
  return vm !== null ? vm.model : engineId;
}

/** The capability row of exactly this model (family), or null. Since 2026-10-03 every tag,
 * emotion tag and knob follows the model the VOICE speaks on — not the loaded variant, which is
 * how a Turbo clone rendered while Multilingual was loaded lost its tags. An exact match only:
 * a family must never fall through to its engine's row, or Multilingual would inherit Turbo's
 * tags. */
function _modelRow(model) {
  if (!model) return null;
  const row = capabilityDetails.lookup(model);
  return row !== null && row.engine_id === model ? row : null;
}

/** The engine-level answer, for an engine with no capability row of its own (an online
 * provider, a test's fake engine). null = the engine exists nowhere (a render would 404). */
export function _engineTakesTags(state, engineId) {
  const engine = _registryEngine(state, engineId);
  if (engine !== null) return Boolean(engine.meta.supportsParalinguisticTags);
  let m;
  try {
    m = manager.getManager().getManifest(engineId);
  } catch {
    return null;
  }
  if (m == null) return null;
  return truthy(m.capabilities.paralinguistic_tags);
}

/**
 * `text` with every `[tag]` this model cannot perform removed (decided 2026-09-29: "drop every
 * [word] tag the chosen engine doesn't list, not only the ones the app recognises"). A model
 * that takes no tags loses them all. One that takes tags keeps exactly the bracket tags its
 * capability row lists — Chatterbox Turbo keeps its vocabulary, Multilingual (one engine, a
 * tokenless model) keeps none. Without a capability row the engine's own flag decides, and a
 * tag engine keeps the parser's own set. Shared by the chapter render, the cache probe and
 * Generate, so all three speak the same words.
 */
export function performableText(state, engineId, model, text) {
  const row = _registryEngine(state, engineId) === null ? _modelRow(model) : null;
  if (row === null) {
    if (!self._engineTakesTags(state, engineId)) return stripTags(text);
    return stripTags(text, new Set([...ATOMIC, ...SPANS]));
  }
  const known = new Set();
  for (const tagset of row.inline_tags) {
    if (!(tagset.syntax || "").startsWith("[")) continue;
    for (const t of tagset.tags) known.add(t.toLowerCase());
  }
  return known.size ? stripTags(text, known) : stripTags(text);
}

/**
 * The emotion tag set of the model that speaks the line, or null. `Delivery.emotion` has two
 * possible expressions and the model decides which: models that take freeform prose get it
 * folded into `instruct` by `delivery_merge.composeInstruct` at the compose sites, and models
 * with an emotion token vocabulary get it compiled into the text here — today Chatterbox Turbo
 * and Nano. Exactly the voice's model (`_modelRow`): Turbo and Multilingual are one engine but
 * two tokenizers — Multilingual has no such tokens and would read `[angry]` aloud as a word.
 */
export function _emotionTagset(model) {
  const row = _modelRow(model);
  if (row === null) return null;
  for (const tagset of row.inline_tags) {
    if (tagset.category === "emotion" && truthy(tagset.value_map)) return tagset;
  }
  return null;
}

/**
 * Prefix this line with the engine's tag for `delivery.emotion`. Line-level, so it goes at the
 * front: the emotion is the state the whole line is spoken in, unlike a non-verbal sound,
 * which is positional and the author types where they want it. Silent no-op in three cases,
 * all deliberate: the engine has no emotion vocabulary, no emotion is set, or the value is not
 * in this engine's map. `neutral` maps to the empty string and so lands in that last case — it
 * is expressible precisely by adding nothing.
 */
export function _applyEmotionTag(text, delivery, tagset) {
  if (tagset == null) return text;
  const value = delivery.emotion;
  if (!value) return text;
  const map = tagset.value_map || {};
  const tag = Object.hasOwn(map, value) ? map[value] : null;
  if (!tag) return text;
  return `${formatSyntax(tagset.syntax, tag)} ${text}`;
}

/** A tag model's own tags for the whole line — `delivery.tags`, a persona's emotion and
 * register on Chatterbox Turbo / Nano (2026-10-03) — at the start of the line, each once, and
 * only the tags the model lists. A tag the line already carries is not added again. */
export function _applyLeadTags(text, delivery, model) {
  const wanted = delivery.tags || [];
  if (!wanted.length) return text;
  const row = _modelRow(model);
  if (row === null) return text;
  const known = new Map();
  for (const tagset of row.inline_tags) {
    if (!(tagset.syntax || "").startsWith("[")) continue;
    for (const t of tagset.tags) known.set(t.toLowerCase(), tagset);
  }
  const lead = [];
  for (const tag of wanted) {
    const tagset = known.get(String(tag).toLowerCase());
    if (tagset === undefined) continue;
    const token = formatSyntax(tagset.syntax, tag);
    if (!lead.includes(token) && !text.includes(token)) lead.push(token);
  }
  return lead.length ? `${lead.join(" ")} ${text}` : text;
}

/** Whether this model can pronounce a word from IPA NOW: its capability row says so (the
 * pinned runtime splices it — Kokoro, gap 3) and the INSTALLED runtime is new enough. On an
 * older installed runtime an entry's respelling is used instead, as on an engine without IPA.
 * (The runtime's readers need `await runtime.ensureHardware()` at boot; before it they throw,
 * which reads as "no IPA" here, as any failure did in Python.) */
export function _supportsPhonemeInput(model) {
  try {
    const cap = capabilityDetails.lookup(model);
    if (!(cap && cap.supports_phoneme_input)) return false;
    return Boolean(runtime.hasFeature("inline_ipa"));
  } catch {
    // capability table or runtime unavailable → no IPA
    return false;
  }
}

/** Whether the model paces itself (Kokoro, KittenTTS, the OpenAI-compatible provider). Every
 * other model renders at its own pace and the server time-stretches the finished line (switch
 * plan §5, gap 8). */
export function speedNative(state, engineId, model = null) {
  const engine = _registryEngine(state, engineId);
  if (engine !== null) return Boolean(engine.meta.supportsSpeed);
  try {
    const cap = capabilityDetails.lookup(model || engineId);
    return Boolean(cap && cap.speed_native);
  } catch {
    // capability table unavailable → the server stretches
    return false;
  }
}

//: The speed range the server stretches over — a persona's pace and a line's own
//: (audiocpp_dsp clamps to the same range).
export const STRETCH_RANGE = [0.5, 2.0];

//: What made a line's pace and pitch, as the render cache keys it. Signalsmith Stretch moved
//: from python-stretch (the library at commit ffa45981) to 1.4.0 inside audiocpp_dsp, with a
//: fixed seed, on 2026-10-07 — its output changed, so a line the server paced or pitched is
//: keyed anew, and only those.
export const STRETCH_ENGINE = "ss-1.4.0";

/** The factor the server stretches a finished line by, or null when the model paced it or the
 * line is at its own pace. */
export function serverSpeed(delivery, native) {
  if (native || delivery.speed == null) return null;
  let factor;
  try {
    factor = toFloat(delivery.speed);
  } catch (e) {
    if (e instanceof TypeError || e instanceof ValueError) return null;
    throw e;
  }
  const [lo, hi] = STRETCH_RANGE;
  factor = Math.max(lo, Math.min(hi, factor));
  return Math.abs(factor - 1.0) < 1e-6 ? null : factor;
}

/** The delivery the cache key hashes. A line the server stretches or pitches carries a marker
 * naming what did it: until gap 8 the same delivery rendered unstretched on these engines, and
 * until 2026-10-07 python-stretch did the stretching — neither's cached entries may be served
 * as the new audio. */
export function _keyDelivery(delivery, native) {
  const key = { ...delivery };
  if (serverSpeed(delivery, native)) key.speed_by = `server ${STRETCH_ENGINE}`;
  if (_pitchSemitones(delivery)) key.pitch_by = STRETCH_ENGINE;
  return key;
}

/** A line's pitch, clamped to ±12 semitones; 0 when it has none. */
function _pitchSemitones(delivery) {
  if (!truthy(unwrap(delivery.pitch))) return 0.0;
  return Math.max(-12.0, Math.min(12.0, toFloat(delivery.pitch)));
}

/** What the server does to a finished line from its delivery, as `dspClient.shape`'s options:
 * Speed (when the model did not pace itself), then Gain, then Pitch. */
export function lineShape(delivery, { speedNative: native }) {
  const gain = truthy(unwrap(delivery.gain_db)) ? Math.max(-24.0, Math.min(12.0, toFloat(delivery.gain_db))) : 0.0;
  return {
    stretchFactor: serverSpeed(delivery, native),
    gainDb: gain,
    pitchSemitones: _pitchSemitones(delivery),
  };
}

/**
 * What the server does to a finished line from its delivery: Speed (when the model did not
 * pace itself), then Gain, then Pitch (async). One function for a chapter render and Generate,
 * so the same settings sound the same from both — Generate applied none of the three until
 * 2026-10-02 (gap 8 plan §4). The effects chain is not here: it sits on top of the finished
 * line and each caller applies it after this. Pitch comes before the effects chain, because
 * pitch is part of how the line was spoken; no engine reads `delivery.pitch`.
 */
export async function applyLineDelivery(pcm, sampleRate, channels, delivery, { speedNative: native }) {
  return dspClient.shape(pcm, sampleRate, channels, lineShape(delivery, { speedNative: native }));
}

/**
 * The lexicons one line is read with, in order: the book's (Overview → Pronunciation lexicon),
 * then the lexicon of the persona that speaks it. The one rule every door that renders a line
 * shares — the chapter resolver, the single-line door and the name scan — so they cannot
 * drift. The book's goes first because `_applyLexicons` lets the first entry for a word win: a
 * name belongs to the book, not to a voice reused across books (decided 2026-09-30).
 */
export function lineLexicons(bookLexiconId, personaLexiconId) {
  const out = [];
  for (const lid of [bookLexiconId, personaLexiconId]) if (lid && !out.includes(lid)) out.push(lid);
  return out;
}

/**
 * Apply lexicon entries. Returns `[text, ipaMap]`.
 *
 * Two kinds of entry, two mechanisms: ``alias`` — a spelling the engine's own text reader gets
 * right ("Worcester" → "Wooster"), plain text replacement, any engine; ``phoneme_ipa`` — the
 * exact pronunciation. Text replacement would make the engine READ the IPA letters, so the
 * entries are collected into `ipaMap` and, on an engine that accepts phonemes, spliced into
 * the phoneme stream engine-side. On an engine that cannot, the alias is the fallback; an
 * IPA-only entry does nothing there — a guess beats reading "wˈʊstər" aloud.
 *
 * Lexicons apply in order, and the first entry that ACTS on a word wins it, whichever kind it
 * is (2026-09-30) — that is what lets the book's lexicon, listed first by `lineLexicons`, beat
 * the persona's. An entry claims only what it can match — an IPA entry the word in any case, a
 * respelling its exact spelling — and one that does nothing here (a blank row, or IPA-only on
 * an engine that can't take it) claims nothing, so a later lexicon can still answer.
 *
 * `ipaMap` holds only the words THIS line contains. It rides in the delivery and so in the
 * cache key; carrying every entry made any IPA edit re-render every line. The match is the
 * engine's own (`_ipaWords`).
 */
export function _applyLexicons(text, lexiconIds, state, { ipaCapable = false } = {}) {
  if (!lexiconIds || !lexiconIds.length) return [text, {}];
  let out = text;
  let ipaMap = {};
  // lower(), not casefold(): both matchers compare lowercased, and casefold folds "Maße" into
  // "Masse", two words to the engine.
  const spokenAsIpa = new Set(); // lowercased — IPA matches any case
  const respelt = new Set(); // exact — a respelling matches its own spelling
  for (const lid of lexiconIds) {
    const lex = state.lexicons.get(lid);
    if (!lex) continue;
    for (const entry of lex.entries) {
      const word = strip(entry.grapheme).toLowerCase();
      if (!word || spokenAsIpa.has(word)) continue;
      if (ipaCapable && entry.phoneme_ipa && strip(entry.phoneme_ipa)) {
        ipaMap[entry.grapheme] = strip(entry.phoneme_ipa);
        spokenAsIpa.add(word);
      } else if (entry.alias && !respelt.has(entry.grapheme)) {
        out = out.split(entry.grapheme).join(entry.alias); // str.replace: every occurrence
        respelt.add(entry.grapheme);
      }
    }
  }
  if (Object.keys(ipaMap).length) {
    const spoken = _ipaWords(out, ipaMap);
    ipaMap = Object.fromEntries(Object.entries(ipaMap).filter(([g]) => spoken.has(strip(g).toLowerCase())));
  }
  return [out, ipaMap];
}

/**
 * The mapped words the engine will speak from IPA in `text`, lowercased (a Set): the entries
 * with a pronunciation, through `wordsIn`.
 */
export function _ipaWords(text, ipaMap) {
  return wordsIn(
    text,
    Object.entries(ipaMap)
      .filter(([g, p]) => strip(g) && strip(p || ""))
      .map(([g]) => g),
  );
}

/**
 * Which of `words` a text contains, lowercased (a Set). Step for step what the engine's IPA
 * splice does: whole words, case aside, the longest first so "Mara Vance" is not also "Mara";
 * split on those, and every piece that IS a word counts — which includes one ending in
 * punctuation ("Dr.") that the regex itself can't match but that stands alone between two
 * matches. Two matchers, one rule; the project-lexicon tests pin them together. Lexicons'
 * "Affects" count uses it too (`lexicons_api.lexiconReach`).
 */
export function wordsIn(text, words) {
  const entries = pySorted(
    words.map((g) => strip(g || "")).filter(Boolean),
    (g) => cpLen(g),
    true,
  );
  if (!entries.length || !strip(text)) return new Set();
  const pattern = new RegExp(`${B}(${entries.map(reEscape).join("|")})${B}`, "iu");
  const parts = text.split(pattern);
  if (parts.length === 1) return new Set();
  const known = new Set(entries.map((g) => g.toLowerCase()));
  return new Set(parts.filter((p) => p && known.has(p.toLowerCase())).map((p) => p.toLowerCase()));
}

/**
 * Would renderLine serve this line from cache? Mirrors renderLine's key derivation
 * byte-for-byte WITHOUT rendering or loading the engine (async). Returns null when the voice
 * can't be resolved (the render would 404).
 */
export async function probeLineCached(
  state,
  voice,
  text,
  { language = null, delivery = null, seed = null, lexicons = null, effects = null, cacheScope = "default" } = {},
) {
  const settings = state.settings.get();
  delivery = delivery || {};
  lexicons = lexicons || [];
  const engineId = await self._resolveEngineForVoice(state, voice);
  if (engineId === null) return null;
  if (self._engineTakesTags(state, engineId) === null) return null;
  const model = await self._lineModel(state, voice, engineId);
  // The same preparation renderLine runs (prepareLineText) — one function, so the probe can't
  // drift from the render. An IPA map rides the delivery so it enters the key: a changed
  // pronunciation is a different render.
  let effectiveText;
  [effectiveText, delivery] = prepareLineText(state, engineId, model, text, delivery, lexicons);
  // A description voice speaks with a fixed seed when none is set — one voice, not a new one
  // per line (§13.3). Before the cache key, so the key holds the seed the audio was made with.
  if (seed == null && voice && isDescriptionVoice(state, voice)) seed = descriptionSeed(voice);
  const key = _inputsKey(engineId, voice, effectiveText, language, seed, delivery, speedNative(state, engineId, model), effects);
  const cache = state._renderCache ?? null;
  if (!settings.cache.enabled || cache === null) return false;
  return Boolean(cache.has(cacheScope, key));
}

/** THE key of what a line's audio is made from — the render cache's key, and the one a take
 * records (Studio Slice 4). One builder, so the render, the cache probe and Render's stale
 * check can never disagree. */
export function _inputsKey(engineId, voice, effectiveText, language, seed, delivery, native, effects) {
  return new CacheKeyBuilder()
    .withEngine(engineId, VERSION)
    .withVoice(voice)
    .withText(effectiveText)
    .withLanguage(language)
    .withSeed(seed)
    .withDeliveryJson(canonicalJson(_keyDelivery(delivery, native)))
    .withEffectsChain(effectsChainHash(effects || []))
    .finish();
}

/** The key `renderLine` would give these inputs, without rendering or loading anything — what
 * Render compares a take's recorded key with to say whether the line is stale (async). null
 * when the voice can't be resolved. */
export async function lineInputsKey(
  state,
  voice,
  text,
  { language = null, delivery = null, seed = null, lexicons = null, effects = null } = {},
) {
  const engineId = await self._resolveEngineForVoice(state, voice);
  if (engineId === null) return null;
  if (self._engineTakesTags(state, engineId) === null) return null;
  const model = await self._lineModel(state, voice, engineId);
  const [effectiveText, prepared] = prepareLineText(state, engineId, model, text, { ...(delivery || {}) }, [...(lexicons || [])]);
  if (seed == null && voice && isDescriptionVoice(state, voice)) seed = descriptionSeed(voice);
  return _inputsKey(engineId, voice, effectiveText, language, seed, prepared, speedNative(state, engineId, model), effects);
}

/**
 * The text a model is sent for one line, and the delivery that goes with it — `[text,
 * delivery]`: tags the model can't perform go, the lexicons respell (as IPA where the model
 * reads it), then the lead and emotion tags. `renderLine` and the persona page's preview of an
 * unsaved voice share it (2026-10-04), so a voice heard before it is kept is prepared exactly
 * as a chapter would be.
 */
export function prepareLineText(state, engineId, model, text, delivery, lexicons) {
  let effectiveText = self.performableText(state, engineId, model, text);
  let ipaMap;
  [effectiveText, ipaMap] = self._applyLexicons(effectiveText, lexicons, state, { ipaCapable: self._supportsPhonemeInput(model) });
  if (Object.keys(ipaMap).length) delivery = { ...delivery, ipa_map: ipaMap };
  // After the lexicon, never before — a lexicon entry must not be able to rewrite the inside
  // of a tag we just generated.
  effectiveText = self._applyLeadTags(effectiveText, delivery, model);
  effectiveText = self._applyEmotionTag(effectiveText, delivery, _emotionTagset(model));
  return [effectiveText, delivery];
}

/** What a persona does to a line once the model has spoken it: speed (when the model did not
 * pace itself), gain, pitch, then the effects chain on top of the finished line (async). Shared
 * by `renderLine` and the persona page's preview of an unsaved voice — one implementation, one
 * sound. One request to the DSP program, which runs the steps in that order. */
export async function shapeLinePcm(pcm, sampleRate, channels, delivery, { speedNative: native, effects }) {
  return dspClient.shape(pcm, sampleRate, channels, { ...lineShape(delivery, { speedNative: native }), effects: effects || [] });
}

const errText = (e) => String(e?.message ?? e);

/**
 * Render one line (async) → RenderedLine. `opts`: `{voice, text, language, delivery, seed,
 * lexicons, effects, cacheScope = "default", useCache = true}` — render_line's keywords.
 *
 * `effects` is the chain of the persona that speaks this line. It is applied to the audio here
 * and it is part of the cache key, so two lines that differ only in their chain never share an
 * entry — and editing a persona's chain invalidates exactly the blocks that persona speaks.
 */
export async function renderLine(
  state,
  { voice, text, language = null, delivery = null, seed = null, lexicons = null, effects = null, cacheScope = "default", useCache = true },
) {
  const settings = state.settings.get();
  delivery = delivery || {};
  lexicons = lexicons || [];
  effects = effects || [];

  if (cpLen(text) > settings.limits.text_max_chars) {
    throw badRequest(`text length ${cpLen(text)} > limit ${settings.limits.text_max_chars}`);
  }

  const engineId = await self._resolveEngineForVoice(state, voice);
  if (engineId === null) throw notFound(`voice ${voice}`);
  // Registry backends (external providers + test fakes) win; managed plugin engines never sit
  // in the registry and route via the manager below (the 2026-08-08 §7d fix — before it, every
  // managed voice 404'd here and the whole multi-line render family was cloud-only).
  const engine = state.engines.get(engineId) ?? null;
  if (engine === null) {
    if (manager.getManager().getManifest(engineId) == null) throw notFound(`engine ${engineId}`);
  }

  // The model the voice speaks on (voice_model.js): its tags, its emotion tags, its pacing and
  // the variant loaded below all follow it.
  const model = await self._lineModel(state, voice, engineId);
  // Every [tag] this model can't perform goes, the lexicons respell, the lead and emotion tags
  // go on (prepareLineText). Kept in lockstep with `probeLineCached` — the two derive the same
  // key and any transform added to one has to land in the other or the probe starts lying.
  let effectiveText;
  [effectiveText, delivery] = prepareLineText(state, engineId, model, text, delivery, lexicons);
  // A description voice speaks with a fixed seed when none is set — one voice, not a new one
  // per line (§13.3). Before the cache key, so the key holds the seed the audio was made with.
  if (seed == null && voice && isDescriptionVoice(state, voice)) seed = descriptionSeed(voice);

  // Cache lookup. The key holds what the lexicons CHANGED in this line — the respelt text, and
  // the IPA for its own words (in the delivery) — never which lexicons were attached.
  const cacheEnabled = useCache && settings.cache.enabled;
  const native = speedNative(state, engineId, model);
  const cacheKey = _inputsKey(engineId, voice, effectiveText, language, seed, delivery, native, effects);

  const cache = state._renderCache ?? null;
  if (cacheEnabled && cache !== null) {
    const cached = cache.get(cacheScope, cacheKey);
    if (cached && cached.length) {
      const [sr, ch, pcm] = unpackPcmWithFormat(cached);
      return new RenderedLine({
        pcm,
        sampleRate: sr,
        channels: ch,
        effectiveDelivery: delivery,
        inputsKey: cacheKey,
        seed,
        engine: engineId,
        model,
      });
    }
  }

  // Auto-load on first synthesize + the per-door synth call. Registry backends keep their
  // object door; managed engines load through the manager and synth via its HTTP proxy.
  let synthPiece;
  if (engine !== null) {
    if (!engine.ready()) {
      try {
        await engine.load("auto", null);
        state.engines.setCurrent(engineId);
      } catch (e) {
        throw badRequest(
          `engine '${engineId}' failed to load on first use: ${errText(e)}. ` +
            `Try POST /v1/engines/${engineId}/load with explicit device + model_variant.`,
        );
      }
    }
    synthPiece = async (piece) => {
      const out = await engine.synthesize(new SynthRequest({ voiceId: voice, text: piece, language, delivery, seed }));
      if (!out.isWavContainer) return [out.bytes, out.sampleRate, out.channels];
      // A provider's WAV header is authoritative — its `sampleRate` is a placeholder
      // (external_openai.js); read from it, a 44.1 kHz WAV would otherwise be labelled 24 kHz
      // and played back slowed and lowered.
      const [fmt, offset, size] = parseWavHeader(out.bytes);
      return [Buffer.from(out.bytes).subarray(offset, offset + size), fmt.sampleRate, fmt.channels];
    };
  } else {
    const mgr = manager.getManager();
    // The voice's own model, in the size AI Settings chose — a Turbo clone loads Turbo even
    // while Multilingual is resident (2026-10-03). Pocket has one model per language, so the
    // line's language picks it.
    try {
      await voiceModel.ensureModelLoaded(engineId, model, language);
    } catch (e) {
      if (e instanceof voiceModel.ModelUnavailable) throw badRequest(e.message);
      throw badRequest(
        `engine '${engineId}' failed to load on first use: ${errText(e)}. ` +
          `Load it on the Engines tab first, or POST /v1/engines/${engineId}/load.`,
      );
    }
    const voiceFields = voiceSynthFields(state, state.voices.get(voice));
    synthPiece = async (piece) => {
      const [audio, meta] = await mgr.synth(engineId, { voice_id: voice, text: piece, language, delivery, seed, ...voiceFields });
      const piecePcm = meta.is_wav_container ? stripWavHeader(audio) : audio;
      return [piecePcm, meta.sample_rate || 24000, meta.channels || 1];
    };
  }

  const engineFailure = (e, what) => {
    if (e instanceof manager.TermsRequired || e instanceof manager.EngineRequestError) return e.apiError();
    return internal(`${what}: ${errText(e)}`);
  };

  // Chunked generation for long-form input. Below the threshold, the single-shot fast path.
  // Above, split at sentence boundaries + join the per-chunk audio. Each model's own piece
  // length (audit 2026-10-04 §13.3) — its working memory grows with the line, and the price
  // its load was checked against was measured at this length.
  const maxChunkChars = lineSplitChars(state, engineId, voice);
  const crossfadeMs = pyInt(settings.generation?.crossfade_ms ?? 50);

  let pcm;
  let outSampleRate;
  let outChannels;
  if (cpLen(effectiveText) > maxChunkChars) {
    const chunks = splitTextIntoChunks(effectiveText, maxChunkChars);
    const pieces = [];
    for (const piece of chunks) {
      let got;
      try {
        got = await synthPiece(piece);
      } catch (e) {
        throw engineFailure(e, "engine synthesize (chunked)");
      }
      const [piecePcm, pieceSr, pieceCh] = got;
      pieces.push([piecePcm, pieceSr || 22050, pieceCh]);
    }
    // Every seam by chunked.PIECE_JOIN_*, in the DSP program — even one piece, which comes back
    // through the same float round trip the numpy join gave it.
    pcm = await dspClient.join(pieces, crossfadeMs);
    outSampleRate = pieces[pieces.length - 1][1];
    outChannels = pieces[pieces.length - 1][2];
  } else {
    try {
      [pcm, outSampleRate, outChannels] = await synthPiece(effectiveText);
    } catch (e) {
      throw engineFailure(e, "engine synthesize");
    }
  }

  // Speed (when the model did not pace itself), gain, pitch — the same function Generate calls
  // — then the effects chain on top of the finished line (shapeLinePcm).
  pcm = await self.shapeLinePcm(pcm, outSampleRate, outChannels, delivery, { speedNative: native, effects });

  // Cache write
  if (cacheEnabled && cache !== null) cache.put(cacheScope, cacheKey, packPcmWithFormat(pcm, outSampleRate, outChannels));

  return new RenderedLine({
    pcm,
    sampleRate: outSampleRate,
    channels: outChannels,
    effectiveDelivery: delivery,
    inputsKey: cacheKey,
    seed,
    engine: engineId,
    model,
  });
}

export function pcmToWav(rl) {
  return writeWavContainer(rl.pcm, rl.sampleRate, rl.channels);
}

//: A take's own silence at either end is cut at the join, down to TRIM_KEEP_MS (decided
//: 2026-10-07): models pad — Kokoro ~265 ms before and ~715 ms after, exact digital zero — so
//: a 600 ms pause played as ~1.6 s, uneven by line. Only what is quieter than TRIM_BELOW_DBFS
//: goes, so a word's quiet tail never does (−45 dBFS cut up to 710 ms of one). The take itself
//: is never changed.
export const TRIM_BELOW_DBFS = -70.0;
export const TRIM_KEEP_MS = 50;

/** `pause_before` / `pause_after` off a rendered line's delivery. */
function _pauseMs(line, key) {
  const raw = (line.effectiveDelivery || {})[key];
  if (raw == null) return null;
  try {
    return Math.max(0, toInt(raw));
  } catch (e) {
    if (e instanceof TypeError || e instanceof ValueError) return null;
    throw e;
  }
}

/**
 * Concatenate rendered lines with silence between them (async) → RenderedLine.
 *
 * `silenceMs` is the project's gap. A line's own `pause_after` and the next line's
 * `pause_before` override it for that join: blank means "as the project", a value means this
 * join is special. Each line's own silence at either end is trimmed first (TRIM_BELOW_DBFS,
 * TRIM_KEEP_MS; 2026-10-07), so the gap is the pause heard.
 *
 * Lines from engines with different sample rates or channel counts are brought to the
 * chapter's highest rate and channel count before joining, so no line loses quality (until
 * 2026-10-02 a mismatched line was appended raw — a 48 kHz VoxCPM2 line beside 24 kHz ones
 * played at half speed, an octave low).
 */
export async function concatLines(lines, silenceMs = 250) {
  if (!lines.length) throw new ValueError("no lines");
  const sr = Math.max(...lines.map((l) => l.sampleRate));
  const ch = Math.max(...lines.map((l) => l.channels));
  const parts = [];
  const silence = (ms) => Buffer.alloc(2 * Math.trunc((ms / 1000) * sr) * ch);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i > 0) {
      const after = _pauseMs(lines[i - 1], "pause_after");
      const before = _pauseMs(line, "pause_before");
      const gap = after === null && before === null ? silenceMs : (after || 0) + (before || 0);
      if (gap > 0) parts.push(silence(gap));
    }
    // Trimmed, then brought to the chapter's rate and channels — one request per line.
    parts.push(
      await dspClient.fit(line.pcm, line.sampleRate, line.channels, sr, ch, {
        trimBelowDbfs: TRIM_BELOW_DBFS,
        trimKeepMs: TRIM_KEEP_MS,
      }),
    );
  }
  return new RenderedLine({ pcm: Buffer.concat(parts), sampleRate: sr, channels: ch, effectiveDelivery: {} });
}
