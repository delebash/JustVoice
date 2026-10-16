// SPDX-License-Identifier: MIT
// The speech engines built from audio.cpp's own files (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §3–4). Every speech family in `catalog.json` (scripts/audiocpp-catalog.js) becomes an
// engine here — an engine module (ID, NAME, VARIANTS, STATIC_VOICES …) the manager discovers — and
// each of its runnable models a capability row (capability_details.js). What a spec can't say — how
// a line's direction reaches the model, what we found by testing — comes from our own file per
// family in `./curated/`.
//
// Seven engines are described by our own files too (`ownEngine`, the adoption plan's slice 4):
// Kokoro, KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox (with Turbo and Nano), VoxCPM2 and
// Qwen3-ASR. Their families' files (`ENGINE`, `MODELS`) keep the ids, names, genders and measured
// facts the app has always used; their downloads, voices, languages and chunk sizes come from
// audio.cpp's specs and packages as every engine's do, and their requests and settings stay their
// own (slot.js, capability_details.js). (Until slice 4 they were hand-written `engines/<id>/
// manifest.js` files.)
//
// A model is offered when audio.cpp marks it supported, community or experimental, and one of its
// GGUF packages is complete at the pinned model revision. Hidden: wip and unsupported (decided
// 2026-10-11, answer 3). A model is a catalog entry on one of audio.cpp's own web UI tabs
// (`workflow`, its web UI's `workflowForEntry`) — Text to speech and Voice design for a speech
// engine, Speech to text for a recognition one — and its downloads are the ones its web UI offers
// (`install_packages`, `installChoices`) beside the ones offered before (docs/plans/2026-10-13-
// adopt-everything-audiocpp.md slice 1; nothing offered before is removed).
//
// Every family that speaks is offered (the adoption plan's slice 2, E0): a model does what its
// spec says — copies a voice from a clip, speaks its built-in voices (the spec's, listed as
// voices in the app like Kokoro's), makes a voice from words (a `vdes` entry, E5) — and a
// recognition family is a speech-recognition engine (E1).

import { readFileSync } from "node:fs";
import path from "node:path";
import { EMOTION_VALUES } from "../../models.js";
import * as speechCache from "../../speech_cache.js";
import { CURATED } from "./curated/index.js";
import * as release from "./release.js";

export const CATALOG = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

/** The audio.cpp families whose models run in an engine of ours (their file's `ENGINE`: Kokoro's,
 * Qwen3-TTS's, Chatterbox's and Turbo's …) — and the families of those models' companions (Qwen3's
 * aligner), which are no engine of their own. */
export const OWN_FAMILIES = new Set(
  Object.entries(CURATED)
    .filter(([, c]) => c.ENGINE)
    .flatMap(([family, c]) => [family, ...(c.COMPANIONS || []).map((x) => x.family)]),
);

const SHOWN_STATUS = new Set(["supported", "community", "experimental", "testing"]);
// The entries a speech model is: audio.cpp's Text to speech tab (a `tts` or `clon` entry) and its
// Voice design tab (`vdes`) — unless the entry names another tab (DotTTS Edit runs as `tts` with
// its edit template, a speech editor). A recognition model: its Speech to text tab (`asr`);
// audio understanding on its analysis tab is not one.
const speechEntry = (e) => (e.workflow === "tts" && (e.task === "tts" || e.task === "clon")) || (e.workflow === "design" && e.task === "vdes");
const recognitionEntry = (e) => e.workflow === "asr" && e.task === "asr";
// The one voice of a model whose spec names none: "‹Model› (built-in)" (decided 2026-10-15, the
// build's question 12; audio.cpp's web UI calls it "Model default", `arena.voice.modelDefault`).
export const ownVoiceName = (m) => `${modelName(m)} (built-in)`;
// The tail a model id takes per precision, and the words a name says.
const PRECISION_TAIL = { q8_0: "q8", q8: "q8", bf16: "bf16", f16: "f16", fp16: "f16", q4_k: "q4k", q4_0: "q4", f32: "f32", orig: "orig" };
const PRECISION_WORDS = { q8: "8-bit", bf16: "16-bit", f16: "16-bit", q4k: "4-bit", q4: "4-bit", f32: "32-bit", orig: "original precision" };
// Not a language: audio.cpp's family-level scope word for audio that isn't speech, and "auto"
// (it detects the language).
const NOT_LANGUAGES = new Set(["language_agnostic", "auto"]);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
// A package id's precision tail ("index_tts2_5_q8_0" → "index_tts2_5") — audio.cpp's web UI rule.
const PRECISION_STEM = /_(?:q8_0|q8|f16|fp16|bf16|safetensors|orig|f32|q4_k|q4_0)$/i;

/** A model's name as the app shows it: its family's when the family has one model, else the
 * catalog entry's without the web UI's notes in brackets ("IndexTTS2.5 (tts, zh/en/ja/es/ar clone + emotion, GGUF Q8)" → "IndexTTS2.5"). */
export const modelName = (m) =>
  m.single ? m.fam.display_name : String(m.entry.display_name || m.fam.display_name).replace(/\s*\([^)]*\)\s*$/, "").trim();

/** The options a line can't set through a model's settings: the app sets them itself (the
 * line's text, the voice, its clip's words — `prompt_text` is VoxCPM1's name for them — the
 * language, the seed) or a family file's direction does (docs/plans/2026-10-11-audiocpp-engine-
 * catalog.md §5). A family file's `HIDDEN_OPTIONS` hides more of its own. */
export const APP_OWNED_OPTIONS = new Set([
  "text", "reference_text", "prompt_text", "language", "lang", "seed", "voice", "voice_id", "speaker",
  "emotion_text", "use_emotion_text", "emotion_vector", "template_name",
]);
// A family's instruction (`instruct`, `instruction` before v0.9.2) is the app's only where the app
// sets it: the family's direction goes there (its file's `DIRECTION`, the plan's E3), or a
// voice-design model's description does. Elsewhere it is a setting, as the spec makes it (Maya1's
// voice description).
const INSTRUCTION = new Set(["instruct", "instruction"]);
function appInstructs(family, name) {
  const current = currentOptionName(family, name);
  const dir = CURATED[family]?.DIRECTION;
  const directs = [dir?.option, ...Object.keys(dir?.set || {})].filter(Boolean).map((o) => currentOptionName(family, o));
  if (directs.includes(current)) return true;
  const designs = (CATALOG.families[family]?.entries || []).some((e) => e.task === "vdes");
  return designs && designOptionOf(family) === current;
}
// Not offered as settings either: the host splits long lines, and renders don't stream.
const NOT_SETTINGS = (name) => name.startsWith("stream") || name.startsWith("text_chunk");
// A file on the server's disk — the clip, a noise file, an embedding: the app's to give, never a
// setting (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3, E2 "file paths"). The spec's own
// structural types for one (audio.cpp's docs/maintainers/model_specs.md).
const FILE_TYPES = new Set(["path", "audio_path", "path_list", "audio_path_list"]);
/** Whether an option (a spec row) names a file on the server's disk. */
export const isFileOption = (o) => FILE_TYPES.has(o?.type);

/** Whether a line may set `name` on this family's model through its settings. */
export const isSetting = (family, name) =>
  !APP_OWNED_OPTIONS.has(name) &&
  !(INSTRUCTION.has(name) && appInstructs(family, name)) &&
  !NOT_SETTINGS(name) &&
  !isFileOption(requestOptionsOf(family).get(currentOptionName(family, name))) &&
  !(CURATED[family]?.HIDDEN_OPTIONS || []).includes(name);

/** A setting's name as the family's spec has it now: audio.cpp renamed some (v0.9.2 …), and the
 * family's file maps each old name to its new one (`OLD_OPTION_NAMES`; docs/plans/2026-10-13-
 * adopt-everything-audiocpp.md §2, §4). */
export const currentOptionName = (family, name) => CURATED[family]?.OLD_OPTION_NAMES?.[name] ?? name;

/** The old names the family's file gives an option now called `name`. */
export const oldNamesOf = (family, name) =>
  Object.entries(CURATED[family]?.OLD_OPTION_NAMES || {})
    .filter(([, current]) => current === name)
    .map(([old]) => old);

/** A family's settings under their current names: a value saved under an old name moves to the
 * new one, unless the new one is set too, which wins. */
export function currentOptionNames(family, settings) {
  const renames = CURATED[family]?.OLD_OPTION_NAMES;
  if (!renames || !settings) return settings;
  const out = {};
  for (const [k, v] of Object.entries(settings)) if (!Object.hasOwn(renames, k)) out[k] = v;
  for (const [k, v] of Object.entries(settings)) {
    if (Object.hasOwn(renames, k) && !Object.hasOwn(out, renames[k])) out[renames[k]] = v;
  }
  return out;
}

let _modelFamilies = null;

/** The audio.cpp family of a model whose settings are its spec's (its model id, or one of its
 * variant ids), or null for anything else — the seven engines described by our own files keep the
 * app's names for their settings, which their own requests read (the adoption plan §4). */
export function generatedFamilyOf(model) {
  if (_modelFamilies === null) {
    _modelFamilies = new Map();
    for (const mod of generatedEngines().values()) {
      for (const v of mod.VARIANTS) {
        if (OWN_FAMILIES.has(v.audiocpp.family)) continue;
        _modelFamilies.set(v.audiocpp.model, v.audiocpp.family);
        _modelFamilies.set(v.id, v.audiocpp.family);
      }
    }
  }
  return _modelFamilies.get(model) ?? null;
}

/** Whether a generated model's spec takes `name` as a setting (a request option the app doesn't
 * set itself). */
export function takesSetting(model, name) {
  const family = generatedFamilyOf(model);
  return family !== null && isSetting(family, name) && requestOptionsOf(family).has(name);
}

/** A model's saved settings ({name: value}) under their current names — a generated model's
 * renamed as its family's file says; any other model's as they are. */
export function currentSettings(model, settings) {
  const family = generatedFamilyOf(model);
  return family ? currentOptionNames(family, settings) : settings;
}

const HAN = /[㐀-鿿]/u;
/** The first of the texts in English (no Han characters), or "". */
export const english = (...xs) => xs.find((x) => typeof x === "string" && x.trim() && !HAN.test(x)) ?? "";
/** An option's name as words, where audio.cpp gives it no label ("top_k" → "Top k"). */
export const humanize = (name) => {
  const s = String(name).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** audio.cpp's own control list for a model (`webui/configs/model_params.json`): its family's
 * controls and its catalog entry's own, by name. */
function controlsOf(fam, entry) {
  return new Map([...(fam?.params || []), ...(entry?.params || [])].map((p) => [p.name, p]));
}

/** Whether audio.cpp's own screen shows `name` (a request option, under its spec name or an old
 * one) for a family's speech model — its family's controls, or its Text to speech entries'. A
 * setting it doesn't show folds under Advanced (decided 2026-10-15). */
export function inControlList(family, name) {
  const fam = catalogFamily(family);
  if (!fam) return false;
  const entries = (fam.entries || []).filter((e) => e.workflow === "tts");
  const names = [name, ...oldNamesOf(family, name)];
  return [fam, ...entries].some((x) => (x.params || []).some((p) => names.includes(p.name)));
}

/** audio.cpp's ends for a request option of a family's speech model, {min, max} (null: it gives
 * none) — its control list's (its family's controls, or its Text to speech entries', under the
 * option's spec name or an old one) where it gives one, else its spec's: the ends `settingsOf`
 * gives a setting (the adoption plan §2, F9). */
export function audiocppEnds(family, name) {
  const fam = catalogFamily(family);
  const names = [name, ...oldNamesOf(family, name)];
  const entries = (fam?.entries || []).filter((e) => e.workflow === "tts");
  const p = [fam ?? {}, ...entries].flatMap((x) => x.params || []).find((c) => names.includes(c.name)) ?? {};
  const o = requestOptionsOf(family).get(name) ?? {};
  return { min: p.minimum ?? o.min ?? null, max: p.maximum ?? o.max ?? null };
}

/**
 * A model's settings, as knob specs (models.js KnobSpec, without the construct): its spec's typed
 * request options — or, for a family whose spec lists none, audio.cpp's own control list
 * (`webui/configs/model_params.json`) — minus what the app sets itself and what the family's
 * file hides. Labels and help in English from audio.cpp's control list where it has them. A
 * number's ends are audio.cpp's — its control list's where it gives one, else the spec's (the
 * adoption plan §2, F9); it is a slider where both are given and the control list doesn't make it
 * a number box, else a number box, open at an end neither gives (E2) — as audio.cpp's own UI
 * shows it. One audio.cpp's own screen doesn't show (not in its control list) is for experts
 * and folds under Advanced (KnobSpec.advanced; decided 2026-10-15, TASKS "Slice 3's six
 * questions" 1). A setting with no default in the spec or the control list has none here (null):
 * audio.cpp's own applies, and nothing is sent until it is set.
 */
export function settingsOf(m) {
  const params = controlsOf(m.fam, m.entry);
  const fromSpec = (m.fam.options || {}).request || [];
  const sources = fromSpec.length
    ? fromSpec.map((o) => ({ name: o.name, type: o.type, min: o.min, max: o.max, default: o.default, values: o.values, description: o.description }))
    : [...params.values()].map((p) => ({
        name: p.name,
        type: { slider: "float", number: p.precision === 0 ? "int" : "float", bool: "bool", choice: "enum", text: "string" }[p.type] || "string",
        min: p.minimum,
        max: p.maximum,
        default: p.default,
        values: p.choices,
        description: "",
      }));
  const out = [];
  for (const o of sources) {
    if (!isSetting(m.family, o.name)) continue;
    // audio.cpp's control list may still name a renamed option the old way (ZipVoice's `t_shift`
    // for `shift`, IndexTTS's `duration_factor` for `duration_scale`): its control is this one.
    const control = params.get(o.name) ?? oldNamesOf(m.family, o.name).map((n) => params.get(n)).find(Boolean) ?? null;
    const p = control ?? {};
    const base = {
      key: o.name,
      label: english(p.label_en, p.label) || humanize(o.name),
      hint: english(p.info_en, p.info, o.description),
      advanced: control === null,
    };
    const given = o.default ?? p.default ?? null;
    if (o.type === "int" || o.type === "float" || o.type === "number") {
      const min = p.minimum ?? o.min ?? null;
      const max = p.maximum ?? o.max ?? null;
      const slider = min !== null && max !== null && max > min && p.type !== "number";
      // A number box steps by its control's step, else by 1 — the HTML number input's own, which
      // audio.cpp's UI leaves as it is.
      const step = p.step ?? (o.type === "int" || !slider ? 1 : Number(((max - min) / 100).toPrecision(1)));
      const def = given === null ? null : Number(given);
      out.push({ ...base, type: "number", min, max, step, box: !slider, default: Number.isFinite(def) ? def : null });
    } else if (o.type === "enum" && Array.isArray(o.values) && o.values.length) {
      const choices = o.values.map(String);
      const def = given === null ? null : String(given);
      out.push({ ...base, type: "choice", choices, default: choices.includes(def) ? def : null });
    } else if (o.type === "bool" || o.type === "boolean") {
      out.push({ ...base, type: "switch", default: given === null ? null : Boolean(given) });
    } else if (o.type === "string") {
      out.push({ ...base, type: "text", default: given === null ? null : String(given) });
    }
  }
  return out;
}

let _settingsByModel = null;

/** A generated model's settings by key (settingsOf), or an empty map — the request keeps a value
 * to the ends its control shows. */
export function settingsByModel(modelId) {
  if (_settingsByModel === null) {
    _settingsByModel = new Map();
    for (const m of generatedModels()) _settingsByModel.set(m.modelId, new Map(settingsOf(m).map((k) => [k.key, k])));
  }
  return _settingsByModel.get(modelId) ?? new Map();
}

/** The family's catalog row, or null. */
export function catalogFamily(family) {
  return CATALOG.families[family] ?? null;
}

/** The options a family's spec marks required that a line may set (Maya1's voice description),
 * each at audio.cpp's own default for it — its spec's, else its control list's — {name: value}:
 * sent when a line leaves one unset, as audio.cpp's own web UI sends its controls' values. One with
 * no default anywhere isn't (audio.cpp then says what is missing). */
export function requiredDefaultsOf(family) {
  const fam = catalogFamily(family);
  const out = {};
  for (const o of (fam?.options || {}).request || []) {
    if (!o.required || !isSetting(family, o.name)) continue;
    const p = [...(fam.params || []), ...fam.entries.flatMap((e) => e.params || [])].find((x) => x.name === o.name);
    const def = o.default ?? (p?.default === "" ? undefined : p?.default);
    const value = def === undefined || def === null ? undefined : coerceOption(o, def);
    if (value !== undefined) out[o.name] = value;
  }
  return out;
}

const _requestOptions = new Map();

/** The family's request options by name (its spec's typed `options.request`). */
export function requestOptionsOf(family) {
  if (!_requestOptions.has(family)) {
    const fam = catalogFamily(family);
    _requestOptions.set(family, new Map(((fam?.options || {}).request || []).map((o) => [o.name, o])));
  }
  return _requestOptions.get(family);
}

/** The family's load options (its spec's typed `options.session`, read when the model loads). */
export function sessionOptionsOf(family) {
  return (catalogFamily(family)?.options || {}).session || [];
}

/** Whether the family's spec lists its request options at all — audio.cpp refuses an option a
 * listing family doesn't list (dots.tts, FireRedTTS3; RESEARCH §10.6), while a family with no
 * listing takes the ones its own code reads. */
export const listsOptions = (family) => requestOptionsOf(family).size > 0;

const clones = (fam) => (fam.capabilities?.clone || []).includes("speaker_reference") || (fam.capabilities?.tts || []).includes("speaker_reference");

/** A package the app can download and register: GGUF, every file at the pinned revision. Returns
 * the package with its model file (the entry's own file where it names one), or null. */
function usablePackage(fam, pkgId, entryPath) {
  const pkg = fam.packages.find((p) => p.id === pkgId);
  if (!pkg || pkg.format !== "gguf") return null;
  const files = pkg.source.files;
  if (!files.length || files.some((f) => f.missing)) return null;
  const ggufs = files.filter((f) => f.path.endsWith(".gguf"));
  if (!ggufs.length) return null;
  const want = entryPath ? path.posix.basename(String(entryPath).replaceAll("\\", "/")) : null;
  const main = ggufs.find((f) => path.posix.basename(f.path) === want) ?? ggufs[0];
  return { pkg, main: main.path };
}

/** The family's licence as the app shows it — audio.cpp's own words; a family missing from its
 * table is "Unclear". */
export function licenceOf(fam) {
  const l = fam.licence;
  return {
    licence: l?.licence || "Not in audio.cpp's licence table",
    commercial_use: l?.commercial_use || "Unclear",
    notes: l?.notes || "",
    url: l?.licence_links?.[0]?.url || l?.weights?.[0]?.url || "",
    checked: l?.checked || "",
  };
}

/** The families an engine of their own may come from: shown by audio.cpp, not run in an engine of
 * ours (`OWN_FAMILIES`), and not kept out by our file (AuK and OuteTTS, which don't speak as
 * listed — decided 2026-10-12). */
function offeredFamilies() {
  return Object.values(CATALOG.families).filter(
    (fam) => !OWN_FAMILIES.has(fam.family) && SHOWN_STATUS.has(fam.status) && !CURATED[fam.family]?.NOT_OFFERED,
  );
}

/** A family's runnable models of one kind, in catalog order: one per runnable catalog entry that
 * `wanted` accepts, two entries on one package being one model (`entries`), registered as the
 * first `tts` entry, else its first. */
function runnableOf(fam, wanted) {
  const runnable = [];
  for (const e of fam.entries) {
    if (!wanted(e)) continue;
    const pkgs = e.packages.map((id) => usablePackage(fam, id, e.path)).filter(Boolean);
    const offered = (e.install_packages || []).map((c) => ({ choice: c, usable: usablePackage(fam, c.id, null) })).filter((c) => c.usable);
    if (!pkgs.length && !offered.length) continue;
    const preferred = pkgs.find((p) => p.pkg.id === e.package) ?? pkgs[0] ?? offered[0].usable;
    // audio.cpp's rule relates packages broadly ("index_tts2" also matches IndexTTS2.5's): a
    // model is its preferred package's precisions only, one package per precision.
    const stem = preferred.pkg.id.replace(PRECISION_STEM, "");
    const seen = new Set();
    const own = [preferred, ...pkgs.filter((p) => p !== preferred)].filter((p) => {
      const tail = PRECISION_TAIL[p.pkg.precision] || p.pkg.precision;
      if (p.pkg.id.replace(PRECISION_STEM, "") !== stem || seen.has(tail)) return false;
      seen.add(tail);
      return true;
    });
    // Then each download audio.cpp's web UI offers for the entry that isn't one already
    // (installChoices: every GGUF in an expose-all family's folder, a stem family's precisions —
    // MOSS-TTSD's 4-bit, CosyVoice3's 32-bit, Irodori's Anime …), with audio.cpp's own label.
    for (const { choice, usable } of offered) {
      if (own.some((p) => p.pkg.id === choice.id)) continue;
      own.push({ ...usable, label: choice.label });
    }
    // Two entries on one package are one model registered two ways (CosyVoice3's clone and
    // instruct entries; Breeze's clone and voice-design entries): one model doing what each
    // entry does, registered as the plain `tts` task, which takes every template.
    const twin = runnable.find((r) => r.packages[0].pkg.id === preferred.pkg.id);
    if (twin) {
      twin.entries.push(e);
      if (twin.entry.task !== "tts" && e.task === "tts") twin.entry = e;
      continue;
    }
    runnable.push({ entry: e, entries: [e], packages: own });
  }
  return runnable;
}

/** A model's id: the one our family file keeps for it (a family's one model was named after the
 * family, so a second entry would rename it), else the engine's own for a single model, else the
 * engine's with its entry's. */
function modelIdOf(fam, engineId, r, runnable) {
  return CURATED[fam.family]?.MODEL_IDS?.[r.entry.id] ?? (runnable.length === 1 ? engineId : `${engineId}-${slug(r.entry.id)}`);
}

/**
 * What a speech model does, from its entries and its spec (the adoption plan's slice 2):
 * - `clone`: the family copies a voice from a clip (`speaker_reference`) — or our family file says
 *   it does where its spec doesn't (`CLONES`: VibeVoice, decided 2026-10-15) — and one of the
 *   model's entries is on the Text to speech tab;
 * - `design`: one of its entries is a voice-design (`vdes`) entry — the entries audio.cpp's own
 *   Voice design tab offers (the plan's E5); `designEntry` is the entry a description goes to;
 * - `voices`: its entries' built-in voices (the spec's `ui.builtin_voices`, else its voice
 *   option's choices), `defaultVoice` the spec's own;
 * - `ownVoice`: a model that does none of these speaks in its one voice,
 *   "‹Model› (built-in)" (Piper's Lessac voice, LFM2.5-Audio JP's).
 */
function speechFactsOf(fam, entries) {
  const cur = CURATED[fam.family];
  const tab = entries.filter((e) => e.task === "tts" || e.task === "clon");
  const vdes = entries.find((e) => e.task === "vdes") ?? null;
  const clone = (cur?.CLONES ?? clones(fam)) && tab.length > 0;
  // A voice from words is a voice-design entry's, as audio.cpp's own Voice design tab lists them
  // (the plan's E5).
  const designEntry = vdes;
  const voices = [];
  for (const e of entries) for (const v of e.builtin_voices || []) if (!voices.includes(v)) voices.push(v);
  const defaultVoice = entries.map((e) => e.default_voice).find((v) => v && voices.includes(v)) ?? voices[0] ?? null;
  const design = designEntry !== null;
  return { clone, design, designEntry, voices, defaultVoice, ownVoice: !clone && !design && !voices.length };
}

/** Every speech model the generated engines offer, in catalog order: one per runnable catalog
 * entry (two on one package being one). */
export function generatedModels() {
  const out = [];
  for (const fam of offeredFamilies()) {
    const runnable = runnableOf(fam, speechEntry);
    for (const r of runnable) {
      const modelId = modelIdOf(fam, fam.family, r, runnable);
      out.push({
        kind: "tts",
        engineId: fam.family,
        modelId,
        family: fam.family,
        fam,
        entry: r.entry,
        entries: r.entries,
        packages: r.packages,
        curated: CURATED[fam.family] ?? null,
        single: runnable.length === 1,
        ...speechFactsOf(fam, r.entries),
      });
    }
  }
  return out;
}

/** Every speech-recognition model the generated engines offer (the adoption plan's slice 2, E1):
 * one per runnable Speech to text entry. Its engine is the family's own — or, where the family
 * also speaks and its speech engine has that id (FireRedAudio, LFM2.5-Audio), `<family>_asr`. */
export function generatedRecognisers() {
  const speaking = new Set(generatedModels().map((m) => m.engineId));
  const out = [];
  for (const fam of offeredFamilies()) {
    const runnable = runnableOf(fam, recognitionEntry);
    const engineId = speaking.has(fam.family) ? `${fam.family}_asr` : fam.family;
    for (const r of runnable) {
      out.push({
        kind: "stt",
        engineId,
        modelId: modelIdOf(fam, engineId, r, runnable),
        family: fam.family,
        fam,
        entry: r.entry,
        entries: r.entries,
        packages: r.packages,
        curated: CURATED[fam.family] ?? null,
        single: runnable.length === 1,
        clone: false,
        design: false,
        designEntry: null,
        voices: [],
        defaultVoice: null,
        ownVoice: false,
      });
    }
  }
  return out;
}

/** Our id for a built-in voice: the engine's id and audio.cpp's name, as Kitten's and Pocket's
 * presets carry their engine (`kitten_bella`) so they never collide with another engine's. */
export const builtinVoiceId = (engineId, name) => `${engineId}_${name}`;

/** A model's built-in voices as the app lists them (an engine's `STATIC_VOICES`, the shape Kokoro's
 * presets have always had): audio.cpp's name, the gender and language our family file gives it (`VOICES`,
 * from audio.cpp's own model docs) — else no gender ("Not known") and the model's one language
 * where it has only one (`languagesOf`) — and the model it belongs to. A model whose spec names no
 * voice has its one, "‹Model› (built-in)". */
export function builtinVoicesOf(m) {
  const own = languagesOf(m).languages;
  const known = m.curated?.VOICES ?? {};
  const one = (id, name, spec) => ({
    id,
    name,
    language: known[spec ?? ""]?.language ?? (own.length === 1 ? own[0] : ""),
    gender: known[spec ?? ""]?.gender ?? "",
    model: m.modelId,
    // audio.cpp's name for it — what the request's `voice` carries; null for a model's one voice.
    audiocpp_voice: spec,
  });
  if (m.ownVoice) return [one(builtinVoiceId(m.modelId, "model_default"), ownVoiceName(m), null)];
  return m.voices.map((v) => one(builtinVoiceId(m.engineId, v), v, v));
}

// audio.cpp's wording where its language list describes rather than names ("100+ languages",
// "multilingual").
const LANGUAGES_WORDING = /^(?:\d+\+?\s+languages|multilingual)$/i;

/** The languages a family speaks: the codes (and names) audio.cpp lists, and its own wording
 * when the list is a description instead — shown as it is, never counted as one language. */
export function speaks(fam) {
  const all = (fam.languages || []).filter((l) => !NOT_LANGUAGES.has(l));
  const note = all.find((l) => LANGUAGES_WORDING.test(l)) ?? "";
  return { languages: all.filter((l) => l !== note), note };
}

/** The languages a model speaks, {languages, note, own}: our family file's (`LANGUAGES`, from
 * audio.cpp's docs — a checkpoint that speaks fewer than its family, decided 2026-10-15, TASKS
 * "Slice 2's acceptance findings" 5) for its package `pkgId`, else for one of its catalog entries;
 * for the whole model (no `pkgId`) whose packages each have their own, those together (sanoTTS's
 * one language per download); else the family's (`speaks`). `own`: the family file gave them. */
export function languagesOf(m, pkgId = null) {
  const own = m.curated?.LANGUAGES ?? {};
  const hit = (pkgId == null ? undefined : own[pkgId]) ?? m.entries.map((e) => own[e.id]).find(Boolean);
  if (hit) return { languages: [...hit], note: "", own: true };
  const per = pkgId == null ? m.packages.map((p) => own[p.pkg.id]).filter(Boolean) : [];
  if (per.length) return { languages: [...new Set(per.flat())], note: "", own: true };
  return { ...speaks(m.fam), own: false };
}

/** The packages a family file names as a model's companions (`SESSION_FILES`: a session option →
 * {family, package}) — MioTTS's codec, which audio.cpp's spec doesn't list as a dependency. */
function companionPackages(m) {
  return Object.entries(m.curated?.SESSION_FILES || {}).map(([option, { family, package: id }]) => {
    const pkg = CATALOG.families[family]?.packages.find((p) => p.id === id);
    if (!pkg) throw new Error(`${m.family}: its companion ${family}/${id} isn't in catalog.json`);
    return { option, pkg };
  });
}

/** The model's download rows with its companions': downloaded, verified and deleted with it — in
 * the model's own row when they share its repository and revision (as Qwen3-ASR's aligner does),
 * else a row of their own. */
function withCompanions(m, main) {
  const rows = [{ ...main, files: [...main.files] }];
  for (const { pkg } of companionPackages(m)) {
    const size = pkg.source.files.reduce((n, f) => n + (f.size_bytes || 0), 0);
    const files = pkg.source.files.map((f) => f.path);
    const same = rows.find((r) => r.hf_repo === pkg.source.repo && r.revision === pkg.source.revision);
    if (same) {
      same.files.push(...files);
      same.size_bytes += size;
    } else rows.push({ hf_repo: pkg.source.repo, revision: pkg.source.revision, size_bytes: size, files });
  }
  return rows;
}

/** `session_files`: each companion's session option → its main file, relative to the model's
 * folder (slot._entriesFor makes it a path). */
function sessionFiles(m) {
  const out = {};
  for (const { option, pkg } of companionPackages(m)) {
    out[option] = (pkg.source.files.find((f) => f.path.endsWith(".gguf")) ?? pkg.source.files[0]).path;
  }
  return Object.keys(out).length ? { session_files: out } : {};
}

/** How many built-in voices a model lists as voices (its one own voice counts). */
const builtinCount = (m) => (m.ownVoice ? 1 : m.voices.length);

/** The option a family's spec takes a voice description in — `instruct` since v0.9.2,
 * `instruction` before — or null where the spec lists neither (the description then goes as the
 * request's `instructions`, as audio.cpp's own Voice design tab sends it). */
export function designOptionOf(family) {
  const opts = requestOptionsOf(family);
  return ["instruct", "instruction"].find((n) => opts.has(n)) ?? null;
}

/** What a speech model's request needs beyond its spec: its built-in voices (our voice id →
 * audio.cpp's name; null = its one voice, sent as no voice), whether it copies a voice from a clip,
 * and, where it makes a voice from words, the voice-design entry's own `template_name` (FireRed's
 * `voice_design` — audio.cpp's catalog pins it per entry, and the app sets that option itself) —
 * an option a model registered for its clone entry must be told. */
function speechRequestFacts(m) {
  const builtin = builtinVoicesOf(m);
  const out = { clone: m.clone, voices: Object.fromEntries(builtin.map((v) => [v.id, v.audiocpp_voice])) };
  // The voice it speaks without one given — the spec's default, or its one voice: its warm-up's.
  const def = builtin.find((v) => v.audiocpp_voice === m.defaultVoice) ?? builtin[0];
  if (def) out.default_voice = def.id;
  if (m.designEntry !== null) {
    const template = (m.designEntry.params || []).find((p) => p.name === "template_name")?.default;
    out.design = template ? { template_name: String(template) } : {};
    // What its warm-up speaks from (slot._warmGenerated): the description audio.cpp itself gives
    // the option — its spec's default (Breeze's "Speak clearly and naturally."), else its control
    // list's.
    const option = designOptionOf(m.family);
    const fromSpec = option ? requestOptionsOf(m.family).get(option)?.default : null;
    const fromParams = [...(m.designEntry.params || []), ...(m.fam.params || [])].find((p) => p.name === option && p.default)?.default;
    if (fromSpec || fromParams) out.design_example = String(fromSpec || fromParams);
  }
  return out;
}

/** A variant row (a model at one precision) in every engine's shape. `label` is
 * audio.cpp's own word for a second package at a precision the model has already (Irodori's
 * "Anime Q8" beside its v4 Q8): its id and name say it instead of the precision. */
function variantRow(m, { pkg, main }, label = null) {
  const tail = PRECISION_TAIL[pkg.precision] || slug(pkg.precision || "gguf");
  const lic = licenceOf(m.fam);
  const name = modelName(m);
  const files = pkg.source.files.map((f) => f.path);
  const langs = languagesOf(m, pkg.id);
  return {
    id: label ? `${m.modelId}-${slug(label)}` : `${m.modelId}-${tail}`,
    name: label ? `${name} (${label})` : tail === "q8" ? name : `${name} (${PRECISION_WORDS[tail] || pkg.precision})`,
    // The family's description is the engine's; a model's own line says only what differs.
    description: PRECISION_WORDS[tail] ? `${PRECISION_WORDS[tail]} weights.` : "",
    languages: langs.languages,
    languages_note: langs.note,
    voice_cloning: m.clone,
    voice_design: m.design,
    preset_voices: builtinCount(m),
    weights_license: lic.licence,
    sources: withCompanions(m, {
      hf_repo: pkg.source.repo,
      revision: pkg.source.revision,
      size_bytes: pkg.source.files.reduce((n, f) => n + (f.size_bytes || 0), 0),
      files,
    }),
    audiocpp: {
      family: m.family,
      task: m.entry.task,
      file: main,
      // audio.cpp's package: one copy on disk for every engine that uses it.
      package: pkg.id,
      generated: true,
      model: m.modelId,
      ...sessionFiles(m),
      ...(m.kind === "tts" ? speechRequestFacts(m) : {}),
      // A speech model's own languages, where its family file gives them: a line in another goes
      // without one (slot.generatedLanguage). A recogniser's request keeps the family's form, so
      // audio.cpp's own refusal stays (decided 2026-10-15, "Slice 2's acceptance findings" 5).
      ...(m.kind === "tts" && langs.own ? { languages: langs.languages } : {}),
    },
    min_vram_gb: m.entry.min_vram_gb,
    status: m.fam.status,
    commercial_use: lic.commercial_use,
  };
}

/**
 * What a generated model needs in memory before a load measures it, {gb, by}: the larger of
 * audio.cpp's estimate and its download, since the weights alone take that much — the estimate is
 * one per model, shared by its precisions, and below the files of some (FireRedAudio's original
 * weights are 23 GB against an estimate of 10), and MOSS-TTSD has none (decided 2026-10-12).
 * `by` says which decided: "estimate" or "files". The seven engines described by our own files too,
 * since the adoption plan's slice 4 (the build's answer 3, decided 2026-10-15: "slice 4 gives those
 * models audio.cpp's memory estimate"; until then each said "memory not measured yet" before its
 * first load). null for a row not built from audio.cpp's files, or with neither number — "memory
 * not measured yet".
 */
export function needOf(row) {
  const files = filesGbOf(row);
  if (files === null) return null;
  const estimate = row.min_vram_gb || 0;
  if (files > estimate) return { gb: Math.round(files * 10) / 10, by: "files" };
  return estimate ? { gb: estimate, by: "estimate" } : null;
}

// ─── The seven engines described by our own files ──────────────────────────────────────────
// (the adoption plan's slice 4: Kokoro, KittenTTS, Pocket TTS, Qwen3-TTS, Chatterbox with Turbo and
// Nano, VoxCPM2, Qwen3-ASR). Each family file's `ENGINE` names the engine its models join and, in
// the family holding its name, the engine's own facts; its `MODELS` are its catalog entries'
// packages as our models, in our ids. What audio.cpp's files give — the downloads (repository,
// revision, files, sizes), precisions, built-in voices and their default, languages, the task a
// model registers as, its memory estimate, its piece budget — is read here from `catalog.json`.

// A precision's rank in a list ordered by precision (`ENGINE.order`): the 8-bit rows first.
const PRECISION_RANK = { q8: 0, bf16: 1, f16: 1, orig: 2 };

/** `text` with each `{name}` filled from `facts`. */
const fill = (text, facts) => String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(facts, k) ? String(facts[k]) : m));

/** A note's switch: true / false, or the name of a build feature the pinned build must have. */
const switchOn = (v) => (typeof v === "string" ? release.pinnedHas(v) : Boolean(v));

/** Whether a language (or a voice in it) is offered on the pinned build: its family file's
 * `LANGUAGE_FEATURES` names the build feature it needs (gap 7's languages). */
function languageOffered(cur, lang) {
  const need = (cur.LANGUAGE_FEATURES || {})[String(lang).toLowerCase().split("-")[0]];
  return need === undefined || release.pinnedHas(need);
}

/** A model row's name and description at a package's precision, where our notes word its first one:
 * the rule the 16-bit rows have always been named by (gap 9, switch plan §5) — "(…, 16-bit)", and
 * "16-bit weights — a larger download that needs more memory." in place of "8-bit weights." — for
 * every precision past its first. */
function siblingWords(name, description, tail) {
  const words = PRECISION_WORDS[tail] || tail;
  const named = name.endsWith(")") ? `${name.slice(0, -1)}, ${words})` : `${name} (${words})`;
  const said = description.replaceAll(" 8-bit weights.", "").replace(/\s+$/u, "");
  return [named, `${said} ${words.charAt(0).toUpperCase()}${words.slice(1)} weights — a larger download that needs more memory.`];
}

/** One of our models (a family file's `MODELS` note) as the rows, voices and facts its engine
 * needs. */
function ownModel(engineId, family, note) {
  const fam = CATALOG.families[family];
  const cur = CURATED[family];
  const entry = fam.entries.find((e) => e.id === note.entry);
  if (!entry) throw new Error(`${family}: our notes name the catalog entry ${note.entry}, which catalog.json doesn't have`);
  const kind = entry.task === "asr" ? "stt" : "tts";
  // Its capability row: our notes' (`model`), else the rule a model of an engine's gets.
  const modelId = note.model ?? `${engineId}-${slug(entry.id)}`;
  const own = Boolean(note.name);
  // Its name: our notes', else its catalog entry's without the web UI's notes in brackets — or
  // whole, where our notes say another model of the engine has that name (`audiocpp_name`:
  // audio.cpp's own Turbo package, "Chatterbox Turbo (tts)", beside our Turbo).
  const name = note.name ?? (note.audiocpp_name ? String(entry.display_name) : modelName({ single: false, fam, entry }));
  const clone = kind === "tts" && (note.clone ?? clones(fam));
  const design = kind === "tts" && (note.design ?? entry.task === "vdes");
  const ids = Array.isArray(note.packages) ? Object.fromEntries(note.packages.map((p) => [p, null])) : note.packages;
  const packages = Object.entries(ids)
    .map(([id, ourId]) => ({ ...usablePackage(fam, id, null), ourId }))
    .filter((p) => p.pkg);
  // Its voices: the spec's built-in voices (its entry's), each under our id, name, gender and
  // language (the family file's `VOICES`, by audio.cpp's name), then the ones our file adds that the
  // spec's packages don't name (`file_bytes`: Pocket's nineteen) — those of a language the pinned
  // build reads; else, for a model that speaks without a clip and without one, its own voice.
  const known = cur.VOICES || {};
  const spec = kind === "tts" && note.voices !== false ? [...(entry.builtin_voices || [])] : [];
  const names = [...spec, ...Object.keys(known).filter((v) => known[v].file_bytes && !spec.includes(v) && note.voices !== false)];
  const voiceIds = cur.ENGINE?.voice_ids === "audio.cpp's";
  let voices = names
    .map((v) => ({ v, k: known[v] ?? {} }))
    .filter(({ k }) => !k.language || languageOffered(cur, k.language))
    .map(({ v, k }) => ({ id: k.id ?? (voiceIds ? v : builtinVoiceId(engineId, v)), name: k.name ?? v, language: k.language ?? "", gender: k.gender ?? "", model: modelId, audiocpp_voice: v, file_bytes: k.file_bytes }));
  // Its languages: our notes' (`languages`, or "voices" — each of its voices speaks its own), else
  // a checkpoint's own (`LANGUAGES`, slice 2's), else its family's — less what our file leaves out
  // and what the pinned build doesn't read.
  const left = new Set(cur.LEFT_OUT_LANGUAGES || []);
  const languages =
    note.languages === "voices"
      ? [...new Set(voices.map((v) => v.language))]
      : [...(note.languages ?? cur.LANGUAGES?.[entry.id] ?? speaks(fam).languages)].filter((l) => !left.has(l) && languageOffered(cur, l));
  const single = languages.length === 1 ? languages[0] : "";
  voices = voices.map((v) => ({ ...v, language: v.language || single }));
  if (kind === "tts" && !voices.length && (note.own_voice || (!clone && !design))) {
    const m = { single: false, fam, entry };
    voices.push({ id: builtinVoiceId(modelId, "model_default"), name: note.own_voice ?? ownVoiceName(m), language: single, gender: "", model: modelId, audiocpp_voice: null });
  }
  const defaultVoice = voices.find((v) => v.audiocpp_voice === entry.default_voice) ?? voices[0] ?? null;
  const facts = { voices: voices.length, languages: languages.length };
  const split = note.split_chars === "spec" ? requestOptionsOf(family).get("text_chunk_size")?.default : note.split_chars;
  const lic = licenceOf(fam);
  const rows = packages.map(({ pkg, main, ourId }, i) => {
    const tail = PRECISION_TAIL[pkg.precision] || slug(pkg.precision || "gguf");
    const id = ourId ?? `${note.id ?? modelId}-${tail}`;
    let [rowName, description] = [fill(name, facts), fill(note.description, facts)];
    if (!own) [rowName, description] = [tail === "q8" ? name : `${name} (${PRECISION_WORDS[tail] || pkg.precision})`, PRECISION_WORDS[tail] ? `${PRECISION_WORDS[tail]} weights.` : ""];
    else if (i > 0) [rowName, description] = siblingWords(rowName, description, tail);
    // Its files: the package's, then the voice files our file adds beside its model file.
    const files = pkg.source.files.map((f) => f.path);
    let size = pkg.source.files.reduce((n, f) => n + (f.size_bytes || 0), 0);
    const folder = path.posix.dirname(main);
    for (const v of voices) {
      const file = `${folder}/embeddings/${v.audiocpp_voice}.safetensors`;
      if (v.file_bytes && !files.includes(file)) {
        files.push(file);
        size += v.file_bytes;
      }
    }
    // Its companions (Qwen3-ASR's aligner): the companion package of its own precision, downloaded
    // with it — in its own row when it shares the repository and revision.
    const sources = [{ hf_repo: pkg.source.repo, revision: pkg.source.revision, size_bytes: size, files }];
    const companions = [];
    for (const c of cur.COMPANIONS || []) {
      const cpkg = CATALOG.families[c.family].packages.find((p) => p.id === c.packages[pkg.precision]);
      if (!cpkg) throw new Error(`${family}: no ${c.role} at ${pkg.precision} in catalog.json`);
      const cfiles = cpkg.source.files.map((f) => f.path);
      const csize = cpkg.source.files.reduce((n, f) => n + (f.size_bytes || 0), 0);
      const same = sources.find((s) => s.hf_repo === cpkg.source.repo && s.revision === cpkg.source.revision);
      if (same) {
        same.files.push(...cfiles);
        same.size_bytes += csize;
      } else sources.push({ hf_repo: cpkg.source.repo, revision: cpkg.source.revision, size_bytes: csize, files: cfiles });
      companions.push({ role: c.role, family: c.family, task: c.task, file: cfiles.find((f) => f.endsWith(".gguf")) });
    }
    const row = {
      id,
      name: rowName,
      description,
      languages: [...languages],
      languages_note: "",
      voice_cloning: clone,
      voice_design: design,
      preset_voices: voices.length,
      ...(note.quality ? { quality: note.quality } : {}),
      weights_license: lic.licence,
      sources,
      audiocpp: {
        family,
        task: entry.task,
        file: main,
        clone,
        ...(companions.length ? { companions } : {}),
        package: pkg.id,
        generated: true,
        model: modelId,
        ...(kind === "tts" ? { voices: Object.fromEntries(voices.map((v) => [v.id, v.audiocpp_voice])) } : {}),
        ...(defaultVoice ? { default_voice: defaultVoice.id } : {}),
      },
      min_vram_gb: entry.min_vram_gb,
      status: fam.status,
      commercial_use: lic.commercial_use,
      // The model whose capability row it takes, where it has none of its own (capability_details.js).
      ...(note.like ? { like: note.like } : {}),
    };
    if (cur.CPU_REALTIME?.[id] != null) row.cpu_realtime = cur.CPU_REALTIME[id];
    if (split) row.split_chars = Number(split);
    return row;
  });
  return {
    kind,
    modelId,
    family,
    rows,
    voices: voices.map(({ audiocpp_voice: _a, file_bytes: _b, ...v }) => v),
    facts,
    pending: Boolean(note.needs) && !release.pinnedHas(note.needs),
    needs: Boolean(note.needs),
  };
}

/** The families whose models join engine `engineId` (their file's `ENGINE.id`), the one holding the
 * engine's own facts (its `ENGINE.name`) first. */
function familiesOfOwn(engineId) {
  const fams = Object.keys(CURATED).filter((f) => CURATED[f].ENGINE?.id === engineId);
  return [...fams.filter((f) => CURATED[f].ENGINE.name), ...fams.filter((f) => !CURATED[f].ENGINE.name)];
}

/** Kokoro's voices, as [audio.cpp's name, the language our file gives it], in its spec's order
 * (`ui.builtin_voices`; the language curated/kokoro_tts.js `VOICES`) — every one, whatever the
 * pinned build reads, so its request and a refusal name the right one (slot.js, blending.js). */
export function kokoroVoices() {
  const known = CURATED.kokoro_tts.VOICES;
  return (catalogFamily("kokoro_tts")?.builtin_voices || []).map((v) => [v, known[v]?.language ?? ""]);
}

/** Our engines' ids, in the order the app has always listed them. */
export const OWN_ENGINES = [...new Set(Object.values(CURATED).map((c) => c.ENGINE?.id).filter(Boolean))].sort();

/**
 * One of the seven engines described by our own files, built now from audio.cpp's files and our
 * notes — the same module shape as every engine's. A model that needs a build feature the pinned
 * build lacks waits in `PENDING_VARIANTS` (Turbo and Nano before `turbo_clone`).
 */
export function ownEngine(engineId) {
  const fams = familiesOfOwn(engineId);
  if (!fams.length) return null;
  const main = fams[0];
  const head = CURATED[main].ENGINE;
  const fam = CATALOG.families[main];
  const models = fams.flatMap((f) => CURATED[f].MODELS.map((note) => ownModel(engineId, f, note)));
  const offered = models.filter((m) => !m.pending);
  let variants = offered.flatMap((m) => m.rows);
  if (head.order === "precision") {
    const rank = (v) => PRECISION_RANK[PRECISION_TAIL[fam.packages.find((p) => p.id === v.audiocpp.package)?.precision] ?? ""] ?? 3;
    variants = variants.map((v, i) => [v, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([v]) => v);
  }
  const first = models[0];
  const until = Object.entries(head.description_until || {}).find(([feature]) => !release.pinnedHas(feature));
  const description = fill(until ? until[1] : head.description, first.facts);
  const lic = licenceOf(fam);
  const kind = first.kind;
  const caps = head.capabilities || {};
  const mod = {
    ID: engineId,
    NAME: head.name,
    DESCRIPTION: description,
    LICENSE: lic.licence,
    WEIGHTS_LICENSE: lic.licence,
    KIND: kind,
    CAPABILITIES:
      kind === "stt"
        ? { stt: true }
        : {
            preset_voices: offered.some((m) => m.voices.length > 0),
            voice_cloning: offered.some((m) => m.rows.some((r) => r.voice_cloning)),
            voice_design: offered.some((m) => m.rows.some((r) => r.voice_design)),
            instruct_field: switchOn(caps.instruct_field),
            paralinguistic_tags: switchOn(caps.paralinguistic_tags),
            phoneme_override: switchOn(caps.phoneme_override),
            voice_blending: switchOn(caps.voice_blending),
          },
    REQUIREMENTS: { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] },
    SUPPORTED_OSES: ["windows", "linux", "macos"],
    // Each voice once: the models of one capability row share it (Pocket's languages, Qwen3's sizes).
    STATIC_VOICES: [...new Map(offered.flatMap((m) => m.voices).map((v) => [v.id, v])).values()],
    // The model a plain Load loads: our notes' (Qwen3's CustomVoice 1.7B), else the spec's
    // recommended package's.
    DEFAULT_VARIANT_ID: head.default ?? (variants.find((v) => v.audiocpp.package === fam.ui?.recommended_package) ?? variants[0]).id,
    VARIANTS: variants,
    ...(models.some((m) => m.needs) ? { PENDING_VARIANTS: models.filter((m) => m.pending).flatMap((m) => m.rows) } : {}),
    GENERATED: { family: main, status: fam.status, licence: lic, tested: CURATED[main].TESTED ?? null, best_for: CURATED[main].BEST_FOR ?? [] },
  };
  // A row's description may read its engine's (VoxCPM2's "{engine} 8-bit weights.").
  for (const v of [...mod.VARIANTS, ...(mod.PENDING_VARIANTS || [])]) v.description = fill(v.description, { engine: description });
  // Its own terms (Kyutai's, gating cloning), else a licence that isn't a plain "Yes" accepted once
  // before the first download, as every engine's.
  if (head.terms) mod.TERMS = { ...head.terms };
  else {
    const f = engineFacts(mod);
    if (f.licence && f.licence.commercial !== "Yes") {
      mod.TERMS = { owner: f.licence.name, title: `${head.name}'s licence`, text: f.licence.summary, reading: readingOf(f.licence), url: f.licence.url, gates: "download" };
    }
  }
  return mod;
}

/** A model's download, GB (unrounded) — null for a row not built from audio.cpp's files. */
export function filesGbOf(row) {
  if (!row?.audiocpp?.generated) return null;
  return (row.sources || []).reduce((n, s) => n + (s.size_bytes || 0), 0) / 1024 ** 3;
}

let _engines = null;

/** Every engine: engine id → an engine module — the seven described by our own files first, in the
 * order the app has always listed them, then one per audio.cpp family (its id). */
export function generatedEngines() {
  if (_engines !== null) return _engines;
  const byEngine = new Map();
  for (const m of [...generatedModels(), ...generatedRecognisers()]) {
    if (!byEngine.has(m.engineId)) byEngine.set(m.engineId, []);
    byEngine.get(m.engineId).push(m);
  }
  _engines = new Map();
  for (const id of OWN_ENGINES) _engines.set(id, ownEngine(id));
  for (const [engineId, unordered] of byEngine) {
    const fam = unordered[0].fam;
    const family = fam.family;
    const kind = unordered[0].kind;
    const lic = licenceOf(fam);
    const curated = CURATED[family] ?? null;
    // The model holding the spec's recommended package first — the engine's default — the rest in
    // the catalog's order (audio.cpp's v0.9.2 catalog lists DotTTS MeanFlow before SOAR, its
    // recommended one).
    const recommended = (m) => m.packages.some((p) => p.pkg.id === fam.ui?.recommended_package);
    const models = [...unordered.filter(recommended), ...unordered.filter((m) => !recommended(m))];
    const variants = models.flatMap((m) => {
      // A precision's first package keeps the id and name it always had.
      const taken = new Set();
      return m.packages.map((p) => {
        const tail = PRECISION_TAIL[p.pkg.precision] || slug(p.pkg.precision || "gguf");
        const first = !taken.has(tail);
        taken.add(tail);
        return variantRow(m, p, first ? null : p.label || p.pkg.id);
      });
    });
    // bf16 and f16 are both "16-bit": where one model has both, each name says which.
    for (const v of variants) {
      if (variants.filter((w) => w.name === v.name).length > 1) v._twin = true;
    }
    for (const v of variants) {
      if (v._twin) v.name = v.name.replace(/\)$/, `, ${v.id.slice(v.id.lastIndexOf("-") + 1)})`);
      delete v._twin;
    }
    const mod = {
      ID: engineId,
      NAME: fam.display_name,
      DESCRIPTION: fam.description,
      LICENSE: lic.licence,
      WEIGHTS_LICENSE: lic.licence,
      KIND: kind,
      CAPABILITIES:
        kind === "stt"
          ? { stt: true }
          : {
              preset_voices: models.some((m) => builtinCount(m) > 0),
              voice_cloning: models.some((m) => m.clone),
              voice_design: models.some((m) => m.design),
              instruct_field: Boolean(curated?.DIRECTION),
              paralinguistic_tags: false,
              phoneme_override: false,
            },
      REQUIREMENTS: { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] },
      SUPPORTED_OSES: ["windows", "linux", "macos"],
      // Its built-in voices, listed and filtered as Kokoro's are (the adoption plan's slice 2).
      STATIC_VOICES: models.flatMap((m) => builtinVoicesOf(m)).map(({ audiocpp_voice: _spec, ...v }) => v),
      DEFAULT_VARIANT_ID: variants[0].id,
      VARIANTS: variants,
      // Where this engine came from, for the Speech engines list (status, licence, tested).
      GENERATED: { family, status: fam.status, licence: lic, tested: curated?.TESTED ?? null, best_for: curated?.BEST_FOR ?? [] },
    };
    // A licence that isn't a plain "Yes" is accepted once before the first download (decided
    // 2026-10-11, answer 2) — Pocket's terms door, gating downloads. "Yes" is our reading of the
    // licence at its source (TASKS "Every speech engine's licence in plain words"), and the
    // prompt says it in plain words.
    const facts = engineFacts(mod);
    if (facts.licence && facts.licence.commercial !== "Yes") {
      mod.TERMS = {
        owner: facts.licence.name,
        title: `${fam.display_name}'s licence`,
        text: facts.licence.summary,
        reading: readingOf(facts.licence),
        url: facts.licence.url,
        gates: "download",
      };
    }
    _engines.set(engineId, mod);
  }
  // A recognition model on a package a speech model of its family uses (FireRedAudio, LFM2.5-Audio)
  // keeps its files in that model's folder: one download, seen by both (speech_cache.variantDir).
  const speaking = new Map();
  for (const [engineId, mod] of _engines) {
    if (mod.KIND !== "tts") continue;
    for (const v of mod.VARIANTS) {
      const key = `${v.audiocpp.family}/${v.audiocpp.package}`;
      if (!speaking.has(key)) speaking.set(key, [engineId, v.id]);
    }
  }
  for (const [engineId, mod] of _engines) {
    if (mod.KIND !== "stt") continue;
    for (const v of mod.VARIANTS) {
      const owner = speaking.get(`${v.audiocpp.family}/${v.audiocpp.package}`);
      if (owner) speechCache.shareVariantFiles(engineId, v.id, ...owner);
    }
  }
  return _engines;
}

/** "Apache-2.0 · JustVoice's reading, checked 2026-10-11 — audio.cpp's licence table says "No"":
 * whose reading the summary is, and audio.cpp's word where ours differs — or, for a model whose
 * licence JustVoice hasn't read yet, "… · audio.cpp's licence table, checked 2026-09-21". */
export function readingOf(l) {
  if (l.by === "audio.cpp") return `${l.name} · audio.cpp's licence table, checked ${l.checked}`;
  return `${l.name} · JustVoice's reading, checked ${l.checked}${l.table !== l.commercial ? ` — audio.cpp's licence table says "${l.table}"` : ""}`;
}

/** The audio.cpp families an engine's models come from, the one holding its own facts first
 * (Chatterbox runs two). */
export function familiesOf(mod) {
  const fams = [...new Set((mod.VARIANTS || []).map((v) => v.audiocpp?.family).filter(Boolean))];
  const main = mod.GENERATED?.family;
  return main ? [main, ...fams.filter((f) => f !== main)] : fams.length ? fams : [mod.ID];
}

/** What the Speech engines list says about an engine beyond its models: its licence in plain
 * words beside audio.cpp's word, audio.cpp's status, what we found by testing, what it's best
 * for — from the first of its families with a curated file. */
export function engineFacts(mod) {
  const fams = familiesOf(mod);
  const family = fams.find((f) => CURATED[f]?.LICENCE) ?? fams[0];
  const none = { licence: null, catalog_status: "", tested: null, best_for: [] };
  if (!family) return none;
  const cur = CURATED[family] ?? {};
  const fam = CATALOG.families[family];
  const table = fam ? licenceOf(fam) : null;
  // A family that both speaks and recognises may read differently for each (FireRedAudio).
  const ours = (mod.KIND === "stt" && cur.RECOGNISER_LICENCE) || cur.LICENCE;
  // A model JustVoice offers before reading its licence at its source (every speaking family and
  // every recogniser since the adoption plan's slice 2) shows audio.cpp's own word and notes from
  // its licence table, gated the same way, until our reading replaces it.
  const theirs = !ours && mod.GENERATED && fam?.licence ? fam.licence : null;
  return {
    licence: ours
      ? {
          name: ours.name ?? table?.licence ?? "",
          commercial: ours.commercial,
          table: table?.commercial_use ?? "Unclear",
          summary: ours.summary,
          url: ours.url || table?.url || "",
          checked: ours.checked,
        }
      : theirs
        ? {
            name: table.licence,
            commercial: table.commercial_use,
            table: table.commercial_use,
            // Its notes, else the label's own words, so a gate always says something.
            summary: table.notes || `Commercial use: ${table.commercial_use}`,
            url: table.url,
            checked: table.checked,
            by: "audio.cpp",
          }
        : null,
    catalog_status: fam?.status ?? "",
    tested: cur.TESTED ?? null,
    best_for: cur.BEST_FOR ?? [],
  };
}

/** One option value in the type the spec gives it, or undefined when it doesn't fit. */
export function coerceOption(spec, value) {
  if (value === null || value === undefined || value === "") return undefined;
  const t = spec.type;
  if (t === "int" || t === "float" || t === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    let v = t === "int" ? Math.round(n) : n;
    if (spec.min != null) v = Math.max(spec.min, v);
    if (spec.max != null) v = Math.min(spec.max, v);
    return v;
  }
  if (t === "bool" || t === "boolean") return value === true || value === "true" || value === 1 || value === "1";
  if (t === "enum") return (spec.values || []).includes(value) ? value : undefined;
  return String(value);
}

/**
 * The emotions a family's direction file acts on (the narrowings review E8: "the persona page
 * offers only the emotions a family's direction file maps"), in the app's order — or null where a
 * line's emotion reaches the model whatever it is, in its words (Breeze's instruction, IndexTTS's
 * emotion text, Fish's description) or where there is no direction file. CosyVoice3 acts on its
 * authors' five sentences; Higgs on its seven tags.
 */
export function directionEmotions(direction) {
  if (!direction) return null;
  let mapped;
  if (direction.kind === "phrases") mapped = Object.keys(direction.phrases || {});
  else if (direction.kind === "vector" && !direction.words) mapped = Object.keys(direction.vectors || {});
  else if (direction.kind === "prefix" && !direction.words) mapped = Object.keys(direction.tags || {});
  else return null;
  return EMOTION_VALUES.filter((e) => mapped.includes(e));
}

/**
 * A line's direction for a family, as its file says to give it. `cue` = {emotion, words}: the
 * line's emotion (JustVoice's nine) and its direction in words. Returns the request options to
 * set, the defaults it brings that the model's settings override (a strength, a guidance), a text
 * prefix, and whether the clip's transcript must stay out.
 */
export function applyDirection(direction, cue) {
  const out = { options: {}, defaults: {}, prefix: "", dropReferenceText: false, directed: false };
  if (!direction) return out;
  const emotion = cue.emotion && cue.emotion !== "neutral" ? cue.emotion : null;
  const words = String(cue.words || "").trim();
  if (direction.kind === "words") {
    if (!words) return out;
    Object.assign(out.options, direction.set || {});
    out.options[direction.option] = words;
    Object.assign(out.defaults, direction.when_directed || {});
    out.directed = true;
  } else if (direction.kind === "phrases") {
    const phrase = emotion ? direction.phrases[emotion] : null;
    if (!phrase) return out;
    Object.assign(out.options, direction.set || {});
    out.options[direction.option] = phrase;
    out.dropReferenceText = Boolean(direction.drop_reference_text);
    out.directed = true;
  } else if (direction.kind === "vector") {
    const vec = emotion ? direction.vectors[emotion] : null;
    if (vec) out.options[direction.option] = [...vec];
    else if (words && direction.words) {
      out.options[direction.words.flag] = true;
      out.options[direction.words.option] = words;
    } else return out;
    out.defaults[direction.alpha_option] = direction.alpha;
    out.directed = true;
  } else if (direction.kind === "prefix") {
    const parts = [];
    if (emotion && direction.tags[emotion]) parts.push(direction.tags[emotion]);
    if (words && direction.words) parts.push(direction.words.replace("{text}", words.replace(/[[\]]/g, "")));
    if (!parts.length) return out;
    out.prefix = parts.join("");
    out.directed = true;
  }
  return out;
}
