// SPDX-License-Identifier: MIT
// The speech engines built from audio.cpp's own files (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §3–4). Every speech family in `catalog.json` (scripts/audiocpp-catalog.js) that no
// hand-wired engine covers becomes an engine here — a manifest module of the same shape as
// `engines/<id>/manifest.js` — and each of its runnable models a capability row
// (capability_details.js). What a spec can't say — how a line's direction reaches the model, what
// we found by testing — comes from our own file per family in `./curated/`.
//
// The hand-wired engines (kokoro, kitten, pocket, qwen3, chatterbox, voxcpm2, asr) keep their
// manifests: they hold measured fixes a spec doesn't carry. Their families are left out here.
//
// A model is offered when audio.cpp marks it supported, community or experimental, and one of its
// GGUF packages is complete at the pinned model revision. Hidden: wip and unsupported (decided
// 2026-10-11, answer 3). Also left out — mine, not decided: families that don't copy a voice from
// a clip, voice-design entries, built-in voices and recognition families (TASKS FINDING "the
// generated engines offer only models that clone a voice"; into the adoption plan).

import { readFileSync } from "node:fs";
import path from "node:path";
import * as asr from "../asr/manifest.js";
import * as chatterbox from "../chatterbox/manifest.js";
import * as kitten from "../kitten/manifest.js";
import * as kokoro from "../kokoro/manifest.js";
import * as pocket from "../pocket/manifest.js";
import * as qwen3 from "../qwen3/manifest.js";
import * as voxcpm2 from "../voxcpm2/manifest.js";
import { CURATED } from "./curated/index.js";

export const CATALOG = JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url), "utf8"));

/** The audio.cpp families a hand-wired manifest already runs. */
export const HAND_WIRED_FAMILIES = new Set(
  [asr, chatterbox, kitten, kokoro, pocket, qwen3, voxcpm2].flatMap((m) =>
    (m.VARIANTS || []).flatMap((v) => [v.audiocpp?.family, ...(v.audiocpp?.companions || []).map((c) => c.family)]).filter(Boolean),
  ),
);

const SHOWN_STATUS = new Set(["supported", "community", "experimental", "testing"]);
const SPEECH_ENTRY_TASKS = new Set(["tts", "clon"]);
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
  "text", "reference_text", "prompt_text", "language", "lang", "seed", "voice", "voice_id", "speaker", "instruct",
  "instruction", "emotion_text", "use_emotion_text", "emotion_vector", "template_name",
]);
// Not offered as settings either: the host splits long lines, and renders don't stream.
const NOT_SETTINGS = (name) => name.startsWith("stream") || name.startsWith("text_chunk");

/** Whether a line may set `name` on this family's model through its settings. */
export const isSetting = (family, name) =>
  !APP_OWNED_OPTIONS.has(name) && !NOT_SETTINGS(name) && !(CURATED[family]?.HIDDEN_OPTIONS || []).includes(name);

const HAN = /[㐀-鿿]/u;
const english = (...xs) => xs.find((x) => typeof x === "string" && x.trim() && !HAN.test(x)) ?? "";
const humanize = (name) => {
  const s = String(name).replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * A model's settings, as knob specs (models.js KnobSpec, without the construct): its spec's typed
 * request options — or, for a family whose spec lists none, audio.cpp's own control list
 * (`webui/configs/model_params.json`) — minus what the app sets itself and what the family's
 * file hides. Labels and help in English from audio.cpp's control list where it has them. A
 * number needs both ends to be a slider; one without is left out. Each is marked advanced
 * (KnobSpec.advanced). A setting with no default in the spec or the control list has none here
 * (null): audio.cpp's own applies, and nothing is sent until it is set.
 */
export function settingsOf(m) {
  const params = new Map([...(m.fam.params || []), ...(m.entry.params || [])].map((p) => [p.name, p]));
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
    const p = params.get(o.name) || {};
    const base = {
      key: o.name,
      label: english(p.label_en, p.label) || humanize(o.name),
      hint: english(p.info_en, p.info, o.description),
      advanced: true,
    };
    const given = o.default ?? p.default ?? null;
    if (o.type === "int" || o.type === "float" || o.type === "number") {
      const min = o.min ?? p.minimum;
      const max = o.max ?? p.maximum;
      if (min == null || max == null || !(max > min)) continue;
      const step = p.step ?? (o.type === "int" ? 1 : Number(((max - min) / 100).toPrecision(1)));
      const def = given === null ? null : Number(given);
      out.push({ ...base, type: "number", min, max, step, default: Number.isFinite(def) ? def : null });
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

/** The family's catalog row, or null. */
export function catalogFamily(family) {
  return CATALOG.families[family] ?? null;
}

/** The family's request options by name (its spec's typed `options.request`). */
export function requestOptionsOf(family) {
  const fam = catalogFamily(family);
  return new Map(((fam?.options || {}).request || []).map((o) => [o.name, o]));
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

/** Every model the generated engines offer, in catalog order: one per runnable catalog entry. */
export function generatedModels() {
  const out = [];
  for (const fam of Object.values(CATALOG.families)) {
    if (HAND_WIRED_FAMILIES.has(fam.family) || !SHOWN_STATUS.has(fam.status) || !clones(fam)) continue;
    // Our file can keep a model out that can't speak from text and a clip yet (VieNeu, hidden
    // 2026-10-11 on the implementer's pick; decided 2026-10-13, the narrowings review K2: list it,
    // marked as not cloning yet — built with docs/plans/2026-10-13-adopt-everything-audiocpp.md).
    if (CURATED[fam.family]?.NOT_OFFERED) continue;
    if (!(fam.tasks || []).some((t) => t === "tts" || t === "clone")) continue;
    const runnable = [];
    for (const e of fam.entries) {
      if (!SPEECH_ENTRY_TASKS.has(e.task)) continue;
      const pkgs = e.packages.map((id) => usablePackage(fam, id, e.path)).filter(Boolean);
      if (!pkgs.length) continue;
      const preferred = pkgs.find((p) => p.pkg.id === e.package) ?? pkgs[0];
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
      // Two entries on one package are one model registered two ways (CosyVoice3's clone and
      // instruct entries): keep one, the plain `tts` task, which takes every template.
      const twin = runnable.find((r) => r.packages[0].pkg.id === preferred.pkg.id);
      if (twin) {
        if (twin.entry.task !== "tts" && e.task === "tts") twin.entry = e;
        continue;
      }
      runnable.push({ entry: e, packages: own });
    }
    for (const r of runnable) {
      const modelId = runnable.length === 1 ? fam.family : `${fam.family}-${slug(r.entry.id)}`;
      out.push({ modelId, family: fam.family, fam, entry: r.entry, packages: r.packages, curated: CURATED[fam.family] ?? null, single: runnable.length === 1 });
    }
  }
  return out;
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

/** A variant row (a model at one precision) in the hand-wired manifests' shape. */
function variantRow(m, { pkg, main }) {
  const tail = PRECISION_TAIL[pkg.precision] || slug(pkg.precision || "gguf");
  const lic = licenceOf(m.fam);
  const name = modelName(m);
  const files = pkg.source.files.map((f) => f.path);
  const langs = speaks(m.fam);
  return {
    id: `${m.modelId}-${tail}`,
    name: tail === "q8" ? name : `${name} (${PRECISION_WORDS[tail] || pkg.precision})`,
    // The family's description is the engine's; a model's own line says only what differs.
    description: PRECISION_WORDS[tail] ? `${PRECISION_WORDS[tail]} weights.` : "",
    languages: langs.languages,
    languages_note: langs.note,
    voice_cloning: true,
    voice_design: false,
    preset_voices: 0,
    weights_license: lic.licence,
    sources: withCompanions(m, {
      hf_repo: pkg.source.repo,
      revision: pkg.source.revision,
      size_bytes: pkg.source.files.reduce((n, f) => n + (f.size_bytes || 0), 0),
      files,
    }),
    audiocpp: { family: m.family, task: m.entry.task, file: main, generated: true, model: m.modelId, ...sessionFiles(m) },
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
 * `by` says which decided: "estimate" or "files". null for a hand-wired row, whose memory is
 * measured at load (the 2026-08-14 ruling).
 */
export function needOf(row) {
  const files = filesGbOf(row);
  if (files === null) return null;
  const estimate = row.min_vram_gb || 0;
  if (files > estimate) return { gb: Math.round(files * 10) / 10, by: "files" };
  return estimate ? { gb: estimate, by: "estimate" } : null;
}

/** A generated model's download, GB (unrounded) — null for a hand-wired row. */
export function filesGbOf(row) {
  if (!row?.audiocpp?.generated) return null;
  return (row.sources || []).reduce((n, s) => n + (s.size_bytes || 0), 0) / 1024 ** 3;
}

let _engines = null;

/** The generated engines: engine id (the audio.cpp family) → a manifest module. */
export function generatedEngines() {
  if (_engines !== null) return _engines;
  const byFamily = new Map();
  for (const m of generatedModels()) {
    if (!byFamily.has(m.family)) byFamily.set(m.family, []);
    byFamily.get(m.family).push(m);
  }
  _engines = new Map();
  for (const [family, models] of byFamily) {
    const fam = models[0].fam;
    const lic = licenceOf(fam);
    const curated = CURATED[family] ?? null;
    const variants = models.flatMap((m) => m.packages.map((p) => variantRow(m, p)));
    // bf16 and f16 are both "16-bit": where one model has both, each name says which.
    for (const v of variants) {
      if (variants.filter((w) => w.name === v.name).length > 1) v._twin = true;
    }
    for (const v of variants) {
      if (v._twin) v.name = v.name.replace(/\)$/, `, ${v.id.slice(v.id.lastIndexOf("-") + 1)})`);
      delete v._twin;
    }
    const mod = {
      ID: family,
      NAME: fam.display_name,
      DESCRIPTION: fam.description,
      LICENSE: lic.licence,
      WEIGHTS_LICENSE: lic.licence,
      KIND: "tts",
      CAPABILITIES: {
        preset_voices: false,
        voice_cloning: true,
        voice_design: false,
        instruct_field: Boolean(curated?.DIRECTION),
        paralinguistic_tags: false,
        phoneme_override: false,
      },
      REQUIREMENTS: { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] },
      SUPPORTED_OSES: ["windows", "linux", "macos"],
      STATIC_VOICES: [],
      DEFAULT_VARIANT_ID: variants[0].id,
      VARIANTS: variants,
      // Where this engine came from, for the Speech engines list (status, licence, tested).
      GENERATED: { status: fam.status, licence: lic, tested: curated?.TESTED ?? null, best_for: curated?.BEST_FOR ?? [] },
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
    _engines.set(family, mod);
  }
  return _engines;
}

/** "Apache-2.0 · JustVoice's reading, checked 2026-10-11 — audio.cpp's licence table says "No"":
 * whose reading the summary is, and audio.cpp's word where ours differs. */
export function readingOf(l) {
  return `${l.name} · JustVoice's reading, checked ${l.checked}${l.table !== l.commercial ? ` — audio.cpp's licence table says "${l.table}"` : ""}`;
}

/** The audio.cpp families an engine's models come from: a generated engine's own, a hand-wired
 * engine's from its variants (Chatterbox runs two). */
export function familiesOf(mod) {
  if (mod.GENERATED) return [mod.ID];
  return [...new Set((mod.VARIANTS || []).map((v) => v.audiocpp?.family).filter(Boolean))];
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
  const ours = cur.LICENCE;
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
