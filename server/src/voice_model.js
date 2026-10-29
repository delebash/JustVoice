// SPDX-License-Identifier: MIT
// What model speaks a voice — one answer for every screen and every render (the port of
// justvoice/voice_model.py).
//
// A voice is raw (mock `_s6`, "A voice is raw"): a timbre and the model it was made for. A
// built-in belongs to its model; a clone's model is picked when it is cloned (Chatterbox
// Turbo, Nano or Multilingual, Qwen3 Base, VoxCPM2, Pocket); a design's model is the one it
// was designed on; a blend is Kokoro's. Until 2026-10-03 a voice stored only its ENGINE, so a
// Turbo clone and a Multilingual clone were the same voice to the app, and tags, knobs and the
// render all followed whichever model happened to be loaded
// (docs/plans/2026-10-03-persona-redesign.md §5.2, §6.3 P1).
//
// "Model" here is the capability row id — the model FAMILY: `kokoro`, `kitten`, `pocket`,
// `qwen3-cv`, `qwen3-base`, `qwen3-vd`, `chatterbox-multilingual`, `chatterbox-turbo`,
// `chatterbox-nano`, `voxcpm2`. Its size and precision (1.7B / 0.6B, 8-bit / 16-bit) stay
// the engine's choice on AI Settings; the render picks the variant of the family
// (`variantForModel`).
//
// Everything a screen says about a voice's model — its name, how it can be directed, the
// languages it can speak — comes from `voiceModel`, so the Voices table, the persona editor,
// Cast and the render can never disagree.
//
// Async where a voice has to be looked up among the registry engines' voices (a provider's
// list may need the network): voiceModel, voiceLanguage, modelKey, versionsOf, and speak (a line).
// Everything else is synchronous. The kit's audio.cpp runtime loads and runs the version chosen
// here (round E — docs/plans/2026-10-29-round-e-onto-the-kit.md §5 item 4: the voice → model →
// version choice stays ours; the kit gets a concrete model id).

import { getLogger } from "@delebash/core/platform/log";
import { KeyError, pyRound, pySorted, pyStr, RuntimeError, strip, ValueError } from "@delebash/core/platform/py";
import * as kitSpeech from "./engines/audiocpp/kit_speech.js";
import * as capabilityDetails from "./engines/capability_details.js";
import * as modelCatalog from "./engines/model_catalog.js";
import * as renderCore from "./render_core.js";
import * as self from "./voice_model.js";

export const log = getLogger("justvoice.voice_model");

// How a model can be directed (doc §5.5): written direction, tags from its own list, or
// nothing but the sliders — or, for an audio.cpp model JustVoice doesn't yet know how to direct,
// "can't be directed yet" (the adoption plan, E8).
export const WORDS = "words";
export const TAGS = "tags";
export const SLIDERS = "sliders";
export const NOT_YET = "not_yet";

/** Thrown when the voice's model isn't in this speech runtime, or has no model for the asked
 * language (Pocket); the message names the model. A model not yet downloaded is fetched by its
 * first line's load (doc §6.2 call 4 as amended; the kit's load downloads — round E, G4). (was: "a render refuses rather than downloading gigabytes" —
 * call 4 never said so, and its amendment rules it out; the narrowings review K13, 2026-10-13.) */
export class ModelUnavailable extends RuntimeError {
  constructor(message) {
    super(message);
    this.name = "ModelUnavailable";
  }
}

/** The facts every screen shows for a voice on a model (a frozen dataclass in Python).
 * `model` is the capability row id; the engine id for a registry engine (an online provider),
 * which has no families. `speaks`: the languages this voice can be spoken in on this model,
 * as the catalog writes them ("en-US", "ja", …) — one entry = fixed by the voice or model. */
export class VoiceModel {
  constructor(engineId, model, name, directedBy, speaks) {
    this.engineId = engineId;
    this.model = model;
    this.name = name;
    this.directedBy = directedBy;
    this.speaks = Object.freeze([...speaks]);
    Object.freeze(this);
  }
}

/** "en-US" → "en"; the comparison every language check uses. */
export function baseLang(code) {
  return strip((code || "").split("-")[0]).toLowerCase();
}

export function speaksLanguage(vm, code) {
  const want = baseLang(code);
  return Boolean(want) && vm.speaks.some((s) => baseLang(s) === want);
}

// ── The catalog ───────────────────────────────────────────────────────────

/** The capability row of a model or variant id (voices_api reads it too). */
export const _capability = (modelOrVariant) => capabilityDetails.lookup(modelOrVariant);

/** The family a catalog variant belongs to: "chatterbox-turbo-f16" → "chatterbox-turbo",
 * "qwen3-base-0.6b-q8" → "qwen3-base". */
export function modelOfVariant(variantId) {
  if (!variantId) return null;
  const row = _capability(variantId);
  return row !== null ? row.engine_id : null;
}

/** The engine's catalog rows, or [] where there is no catalog (an online provider). */
export function _variantRows(engineId) {
  try {
    return [...modelCatalog._variantRows(engineId)];
  } catch {
    // no manifest module
    return [];
  }
}

/** The model families an engine's catalog offers, in catalog order. */
export function modelsOfEngine(engineId) {
  const out = [];
  for (const row of _variantRows(engineId)) {
    const fam = modelOfVariant(row.id);
    if (fam && !out.includes(fam)) out.push(fam);
  }
  return out;
}

/** The engine whose catalog offers this family. */
export function engineOfModel(model) {
  for (const engineId of modelCatalog.manifests().keys()) {
    if (self.modelsOfEngine(engineId).includes(model)) return engineId;
  }
  return null;
}

function _familyRows(engineId, model) {
  return _variantRows(engineId).filter((r) => modelOfVariant(r.id) === model);
}

export function modelName(model, engineId = null) {
  const row = _capability(model);
  if (row !== null && (row.engine_id === model || engineId == null)) return row.display_name;
  const m = modelCatalog.getManifest(engineId || model);
  if (m != null && m.name) return m.name;
  return model;
}

/** Written direction, tags, sliders only, or can't be directed yet — the model's own answer. */
export function directedBy(model) {
  const row = _capability(model);
  if (row === null || row.engine_id !== model) return SLIDERS;
  if (row.supports_instruct_freeform) return WORDS;
  if (row.inline_tags?.length) return TAGS;
  if (row.direction_known === false) return NOT_YET;
  return SLIDERS;
}

/** Every language the family's variants list, in first-seen order — of the variants `keep`
 * accepts, where given. */
export function modelSpeaks(engineId, model, keep = null) {
  const out = [];
  for (const row of _familyRows(engineId, model)) {
    if (keep && !keep(row)) continue;
    for (const lang of row.languages || []) if (!out.includes(lang)) out.push(lang);
  }
  return out;
}

/** The languages a built-in voice speaks: those of the family's variants that carry it (a row's
 * `audiocpp.voices`) — Pocket TTS's twenty presets are in its English, German, Italian,
 * Portuguese and Spanish models, not its French one, which clones only (TASKS "Slice 4's gaps"
 * 2). Where no variant lists its voices, every variant's, as for a clone. (was: every variant's —
 * a Pocket preset listed French, so a persona on one could be saved in French and was refused at
 * its first line — until 2026-10-16.) */
export function presetSpeaks(engineId, model, voiceId) {
  const carries = (row) => Boolean(row.audiocpp?.voices) && Object.hasOwn(row.audiocpp.voices, voiceId);
  const listed = modelSpeaks(engineId, model, carries);
  return listed.length ? listed : modelSpeaks(engineId, model);
}

/** The engine's own default family — the one a no-variant load resolves to — or, when that
 * family can't do `need` ("clone" / "design" / "blend"), the first family in the catalog that
 * can. */
export function _defaultModel(engineId, { need = null } = {}) {
  const families = self.modelsOfEngine(engineId);
  if (!families.length) return null;
  let def;
  try {
    def = modelOfVariant(modelCatalog.resolvedDefaultVariant(engineId));
  } catch {
    def = null;
  }
  const ordered = [...(families.includes(def) ? [def] : []), ...families.filter((f) => f !== def)];
  if (need == null) return ordered[0];
  for (const fam of ordered) if (can(fam, need)) return fam;
  return null;
}

/** Can this family clone / design / blend? */
export function can(model, action) {
  const row = _capability(model);
  if (row === null) return false;
  if (action === "clone") return Boolean(row.supports_voice_cloning);
  if (action === "design") return Boolean(row.supports_voice_design);
  if (action === "blend") {
    // Kokoro is the blending engine (engines/blending.js gates the file math);
    // `supports_voice_blending` follows the pinned runtime and says whether a blend can be
    // HEARD yet, not whether one can be made.
    return row.engine_id === "kokoro" || Boolean(row.supports_voice_blending);
  }
  return false;
}

const VERBS = { clone: "clone a voice", design: "design a voice", blend: "blend voices" };

/** The family a new voice is stored with: the one asked for, checked; or the engine's default
 * family that can do `action`. Throws ValueError with a sentence the API can return. */
export function checkModelFor(engineId, model, action) {
  const families = self.modelsOfEngine(engineId);
  if (model) {
    if (families.length && !families.includes(model)) throw new ValueError(`${modelName(model)} is not a ${engineId} model`);
    if (families.length && !can(model, action)) {
      if (!Object.hasOwn(VERBS, action)) throw new KeyError(action);
      throw new ValueError(`${modelName(model)} can't ${VERBS[action]}`);
    }
    return model;
  }
  const chosen = _defaultModel(engineId, { need: action });
  // No catalog to choose from (an online provider): the engine is the model.
  return chosen ?? engineId;
}

// ── A voice's model ───────────────────────────────────────────────────────

function _hasClip(state, stored) {
  try {
    return Boolean(renderCore.resolveAudioPromptForStored(state, stored));
  } catch {
    // a store without files (tests)
    return false;
  }
}

/**
 * The family a stored voice speaks on. Clip wins (2026-08-22): a Qwen3 designed voice saved
 * with its preview renders as a clone on Qwen3 Base, and one without speaks from its
 * description on VoiceDesign — decided by the clip, whatever was stored. A blend is Kokoro's.
 * Everything else is the model it was made for, or — for a voice saved before models were
 * stored — its engine's default family that can speak a voice of its kind.
 */
export function modelForStored(state, stored) {
  const engineId = stored.engine;
  if (stored.source === "blended") return engineId === "kokoro" ? "kokoro" : stored.model || engineId;
  if (stored.source === "designed" && engineId === "qwen3") return _hasClip(state, stored) ? "qwen3-base" : "qwen3-vd";
  const families = self.modelsOfEngine(engineId);
  const model = stored.model ?? null;
  // A model this build's catalog doesn't offer (Turbo before its release) is kept, so the load
  // refuses it by name — never quietly spoken by another model (audit §5 E4). Only a name no
  // capability row knows (a family that no longer exists) falls through.
  if (model && (!families.length || families.includes(model) || _capability(model) !== null)) return model;
  const need = stored.source === "designed" && !_hasClip(state, stored) ? "design" : "clone";
  return _defaultModel(engineId, { need }) || engineId;
}

/** A built-in belongs to one model: Qwen3's nine speakers to CustomVoice, an audio.cpp model's
 * built-in voices to the model whose spec lists them (a preset's `model`: LFM2.5-Audio's four to
 * its English model), every other engine's presets to its own (single) family. */
export function modelForPreset(engineId, voice = null) {
  if (engineId === "qwen3") return "qwen3-cv";
  if (voice?.model) return voice.model;
  return _defaultModel(engineId) || engineId;
}

/** The preset `voiceId` of `engineId` (its STATIC_VOICES row), or null. */
function _preset(engineId, voiceId) {
  return (modelCatalog.getManifest(engineId)?.staticVoices || []).find((v) => v.id === voiceId) ?? null;
}

function _registryEngine(state, engineId) {
  const registry = state?.engines ?? null;
  return registry !== null ? (registry.get(engineId) ?? null) : null;
}

/** The facts every screen shows for a voice on `model`. `presetId`: the voice is that built-in
 * voice of the model, which speaks only its carrying versions' languages (`presetSpeaks`). */
export function describe(state, engineId, model, voiceLanguage, presetId = null) {
  if (_registryEngine(state, engineId) !== null && model === engineId) {
    // An online provider: no families, no direction the app can send.
    const langs = voiceLanguage ? [voiceLanguage] : [];
    return new VoiceModel(engineId, model, modelName(model, engineId), SLIDERS, langs);
  }
  const listed = presetId ? presetSpeaks(engineId, model, presetId) : modelSpeaks(engineId, model);
  let speaks;
  if (model === "kokoro" && voiceLanguage) {
    // A Kokoro voice is bound to its own language's reader: Alpha (Japanese) speaks Japanese,
    // whatever else the model can read.
    speaks = [voiceLanguage];
  } else if (listed.length) {
    // Kitten and Turbo / Nano list English alone; Pocket its five languages with presets for a
    // preset, all six for a clone; Qwen3, Multilingual and VoxCPM2 their many.
    speaks = listed;
  } else {
    speaks = voiceLanguage ? [voiceLanguage] : [];
  }
  return new VoiceModel(engineId, model, modelName(model, engineId), directedBy(model), speaks);
}

/** Python's `except AttributeError` around the registry lookup: a duck-typed state carrying
 * only the stores its caller touches (the chapter resolver's tests) — nothing to look the
 * voice up in. In JavaScript that is a TypeError (a property of undefined). */
async function _ownerOf(state, voiceId) {
  try {
    return { engineId: await renderCore._resolveEngineForVoice(state, voiceId) };
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}

/** What model speaks `voiceId`, or null when no engine owns it (async). */
export async function voiceModel(state, voiceId) {
  if (!voiceId) return null;
  const store = state?.voices ?? null;
  const stored = store !== null ? store.get(voiceId) : null;
  if (stored != null) {
    const model = modelForStored(state, stored);
    return describe(state, stored.engine, model, stored.language ?? null);
  }
  const owner = await _ownerOf(state, voiceId);
  if (owner === null || owner.engineId == null) return null;
  const { engineId } = owner;
  const engine = _registryEngine(state, engineId);
  if (engine !== null) {
    let lang = null;
    for (const p of await engine.voices()) if (p.id === voiceId) lang = p.language ?? null;
    return describe(state, engineId, engineId, lang);
  }
  return describe(state, engineId, modelForPreset(engineId, _preset(engineId, voiceId)), _presetLanguage(engineId, voiceId), voiceId);
}

/** The language a voice itself is in — a stored voice's own, a preset's catalog language — or
 * null for a voice nothing owns (async). */
export async function voiceLanguage(state, voiceId) {
  if (!voiceId) return null;
  const store = state?.voices ?? null;
  const stored = store !== null ? store.get(voiceId) : null;
  if (stored != null) return stored.language ?? null;
  const owner = await _ownerOf(state, voiceId);
  if (owner === null || owner.engineId == null) return null;
  const { engineId } = owner;
  const engine = _registryEngine(state, engineId);
  if (engine !== null) {
    const hit = (await engine.voices()).find((p) => p.id === voiceId);
    return hit ? (hit.language ?? null) : null;
  }
  return _presetLanguage(engineId, voiceId);
}

function _presetLanguage(engineId, voiceId) {
  for (const v of modelCatalog.getManifest(engineId)?.staticVoices || []) if (v.id === voiceId) return v.language ?? null;
  return null;
}

/** The scheduler's grouping key: lines on one model render together, so a chapter swaps each
 * model in once (doc §6.2 call 5). Async. */
export async function modelKey(state, voiceId) {
  const vm = await self.voiceModel(state, voiceId);
  return vm ? `${vm.engineId}:${vm.model}` : `?voice:${pyStr(voiceId)}`;
}

// ── Speaking on the right variant ─────────────────────────────────────────

const PRECISIONS = new Set(["q8", "f16", "bf16", "f32"]);

/** The size and precision parts of a variant id ("1.7b", "q8", "f16"). */
function _sizeTokens(variantId) {
  const parts = new Set((variantId || "").split("-"));
  const out = new Set();
  for (const p of parts) if (p.endsWith("b") && /^[0-9]+$/.test(p.slice(0, -1).replaceAll(".", ""))) out.add(p);
  for (const p of parts) if (PRECISIONS.has(p)) out.add(p);
  return out;
}

const langKey = (r) => JSON.stringify(r.languages || []);

/**
 * The variant of `model` a line speaks on, or null where there is no catalog. Size and precision
 * stay AI Settings' choice (doc §6.2 call 4): the loaded variant if it is this family; else, among
 * the family's variants on disk, the user's default if it is one of them, else the one sharing
 * most of its size and precision (catalog order breaks ties). So a default that isn't
 * downloaded speaks only once a load fetches it — until then a downloaded sibling speaks, and
 * the persona page offers Load for the default (kept so, the narrowings review C5, 2026-10-13;
 * this comment said "the user's default if it is, else an installed variant", which hid the
 * on-disk condition). Nothing of the family on disk → the same pick among all of the family's
 * variants, and the load fetches its file, as a first load always has (the kit's load downloads a
 * model that isn't here — round E, G4). Pocket has one model per
 * language, so its language picks among them; a language it has no model for →
 * ModelUnavailable, naming the model.
 */
export function variantForModel(engineId, model, language = null) {
  let rows = _familyRows(engineId, model);
  if (!rows.length) return null;
  if (language && new Set(rows.map(langKey)).size > 1) {
    const want = baseLang(language);
    const byLang = rows.filter((r) => (r.languages || []).some((x) => baseLang(x) === want));
    if (!byLang.length) throw new ModelUnavailable(`${modelName(model)} has no model for ${language} — pick a language it speaks`);
    rows = byLang;
  }
  const ids = rows.map((r) => r.id);
  const current = kitSpeech.currentVariantId(engineId);
  if (ids.includes(current) && kitSpeech.currentFor(_kind(engineId)) === engineId) return current;
  const def = modelCatalog.resolvedDefaultVariant(engineId) || null;
  const want = _sizeTokens(def);
  const onDisk = ids.filter((vid) => self._onDisk(engineId, vid));
  const pool = onDisk.length ? onDisk : ids;
  if (pool.includes(def)) return def;
  // Stable sort: catalog order (the 8-bit row first) breaks the ties.
  const shared = (vid) => [..._sizeTokens(vid)].filter((t) => want.has(t)).length;
  return pySorted(pool, (vid) => -shared(vid))[0];
}

function _kind(engineId) {
  return modelCatalog.getManifest(engineId)?.kind || "tts";
}

/** Whether a variant's files are all downloaded (the kit's models cache). */
export function _onDisk(_engineId, variantId) {
  return kitSpeech.onDisk(variantId);
}

// The speech model a line is loading right now (decided 2026-10-07): a render's model loads
// inside its first line, which read "rendering…" for the whole load; Render's strip says
// "loading Qwen3-TTS CustomVoice — 8 s" from this instead. (Python's lock around it guarded
// state no `await` ever splits, so none is needed here.)
export const cfg = { loading: null };

/** Note a load while `fn(done)` runs (Python's `_noting_load` context manager); `done()` ends
 * the note early — the line has started, its model loaded. */
export async function _notingLoad(engineId, model, fn) {
  let name;
  try {
    name = modelName(model, engineId);
  } catch {
    // a name is a nicety
    name = model;
  }
  const note = { model: name, since: performance.now() / 1000 };
  const done = () => {
    if (cfg.loading === note) cfg.loading = null;
  };
  cfg.loading = note;
  try {
    return await fn(done);
  } finally {
    done();
  }
}

/** `{model: "Qwen3-TTS CustomVoice", seconds: 8.2}` while a line's model loads (`speak`); null
 * otherwise. */
export function loadingNow() {
  if (cfg.loading === null) return null;
  return { model: cfg.loading.model, seconds: pyRound(performance.now() / 1000 - cfg.loading.since, 1) };
}

/** The version a line on `model` speaks on (`variantForModel`) — or, where the engine has no
 * catalog of families, its default version. Throws ModelUnavailable for a model the engine's
 * catalog doesn't have (audit §5 E4) or a language it has no model for. */
export function speakingVersion(engineId, model, language = null) {
  if (!_familyRows(engineId, model).length) {
    if (model !== engineId && self.modelsOfEngine(engineId).length) {
      // The engine has a catalog and this model isn't in it (audit §5 E4).
      throw new ModelUnavailable(`${modelName(model)} — this isn't in this version's speech runtime yet, so its voices can't be spoken`);
    }
    return modelCatalog.resolvedDefaultVariant(engineId) || null;
  }
  return self.variantForModel(engineId, model, language);
}

/** One line on version `versionId` of `model` (the kit runs it — kit_speech.js `speak`), its
 * model's load noted while it runs when another version is resident (`loadingNow`). */
export async function speak(engineId, model, versionId, body) {
  if (kitSpeech.currentVariantId(engineId) === versionId) return kitSpeech.speak(engineId, versionId, body);
  return self._notingLoad(engineId, model, (done) => kitSpeech.speak(engineId, versionId, body, { onStart: done }));
}

/** The loaded variant of `engineId`, or null. */
function _residentVariant(engineId) {
  return kitSpeech.currentVariantId(engineId);
}

/** Is a variant of `model` the resident speech model right now? */
export function isModelLoaded(engineId, model) {
  if (kitSpeech.currentFor(_kind(engineId)) !== engineId) return false;
  if (!_familyRows(engineId, model).length) return true;
  return modelOfVariant(_residentVariant(engineId)) === model;
}

/**
 * Which version of its model speaks a voice, and the family's others — the persona page's
 * "Speaks with" (decided 2026-10-05). `speaks_with` is exactly the variant a render picks now
 * (`variantForModel`); `loaded` is the family's resident variant, if any; `default` the
 * engine's default when it is this family. Size and precision stay per model, not per persona
 * (doc §6.2 call 4). null when no engine owns the voice. Async; the answer is a wire dict.
 */
export async function versionsOf(state, voiceId, language = null) {
  const vm = await self.voiceModel(state, voiceId);
  if (vm === null) return null;
  let rows = _familyRows(vm.engineId, vm.model);
  // Pocket has one model per language: only the versions that speak the persona's language are
  // offered (decided 2026-10-15, C5) — the rule `variantForModel` picks by.
  if (language && new Set(rows.map(langKey)).size > 1) {
    const want = baseLang(language);
    rows = rows.filter((r) => (r.languages || []).some((x) => baseLang(x) === want));
  }
  let picked;
  try {
    picked = self.variantForModel(vm.engineId, vm.model, language);
  } catch (e) {
    if (!(e instanceof ModelUnavailable)) throw e;
    picked = null;
  }
  const loaded = self.isModelLoaded(vm.engineId, vm.model) ? _residentVariant(vm.engineId) : null;
  const def = modelCatalog.resolvedDefaultVariant(vm.engineId) || null;
  // The size the Speech engines page shows — the catalog computes it from the files; the raw
  // rows carry none.
  let sizes;
  try {
    sizes = new Map(modelCatalog.modelsFor(vm.engineId).map((m) => [m.id, m.size_mb]));
  } catch {
    sizes = new Map();
  }
  return {
    engine_id: vm.engineId,
    model: vm.model,
    model_name: vm.name,
    speaks_with: picked,
    // Loaded and default only where they are versions offered: another language's Pocket model
    // never speaks this persona and is never its choice.
    loaded: rows.some((r) => r.id === loaded) ? loaded : null,
    default: rows.some((r) => r.id === def) ? def : null,
    versions: rows.map((r) => ({
      id: r.id,
      name: r.name || r.id,
      size_mb: sizes.get(r.id) || null,
      on_disk: self._onDisk(vm.engineId, r.id),
    })),
  };
}
