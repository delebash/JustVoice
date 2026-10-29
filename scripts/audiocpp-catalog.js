#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Builds the speech engine list from audio.cpp's own files (docs/plans/2026-10-11-audiocpp-
// engine-catalog.md §2; docs/plans/2026-10-13-adopt-everything-audiocpp.md §2, slice 1): every
// model family audio.cpp has, read at a ref of our fork's checkout beside this repo
// (../audio.cpp), plus each package file's size and hash at the pinned model revision on
// Hugging Face. Writes server/src/engines/audiocpp/seed_audiocpp_catalog.json, which is committed
// (seed data: the kit's family guard allows a quoted SHA-256 only in a seed file — named
// catalog.json until 2026-10-29) — run this whenever our fork moves (the kit's pinned build,
// runner/config.js DEFAULT_AUDIOCPP_BUILD), and the diff shows exactly what the update brings.
//
//   node scripts/audiocpp-catalog.js                 the pinned tag (the kit's DEFAULT_AUDIOCPP_BUILD)
//   node scripts/audiocpp-catalog.js --ref <ref>     another tag, branch or commit of the checkout
//
// Sources, each read with `git show <ref>:<path>` so the checkout's working tree doesn't matter:
//   model_specs/*.json                 family, name, description, status, tasks, languages,
//                                      capabilities, typed request / session / load options,
//                                      dependencies, packages, built-in voices (audio.cpp's
//                                      docs/maintainers/model_specs.md)
//   docs/maintainers/model_specs.md    the enum presets an option names instead of its values
//   webui/configs/models_catalog.json  each runnable entry: task, workflow, packages offered,
//                                      min_vram_gb, hint, default options
//   webui/configs/model_params.json    control labels, ranges and help text, by entry or family
//   docs/model_licenses.md             licence, commercial use, notes, the date checked
//
// Which packages an entry offers is audio.cpp's own web UI rule, ported whole from
// webui/native/src/lib/catalog.ts (`installChoices` and what it calls); which tab an entry sits
// under is its `workflowForEntry` (webui/native/src/routes/+page.svelte).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_AUDIOCPP_BUILD } from "@delebash/core/runner/config";
import { _entryOid, _entrySize, _revisionSha, _tree } from "@delebash/core/runner/models";
import { marked } from "marked";

// The model files: audio.cpp's own GGUF packages. Commit pinned 2026-10-29: 661a224e (2026-10-18,
// "Update microWakeWord embedded spec"), the last before the repo's "Refresh embedded GGUF specs
// for v0.9.2 (#19)" (6f45df32, 2026-10-19), which gave 145 files other bytes — 28 of them
// downloaded on the user's PC — for embedded specs a release build doesn't read (decided
// 2026-10-29). From f861648c it adds Plapre 3, openWakeWord and Whistle, and changes no file but
// MicroWakeWord's GGUF and .gitattributes. Waiting on a later revision: Kitten TTS 2's 20261021
// package, Irodori v4.1 Small MeanFlow, VoxCPM2 VocalRender Pro. (was: f861648c, 2026-10-11 —
// from 7bf52723 no file changed but README.md and .gitattributes, 81 added — until 2026-10-29;
// kept in engines/audiocpp/release.js until round E.)
export const MODEL_REPO = "audio-cpp/audio.cpp-gguf";
export const MODEL_REVISION = "661a224e9d9adbd49c01626f85e426f5f425d771";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CHECKOUT = resolve(ROOT, "..", "audio.cpp");
export const OUT = join(ROOT, "server", "src", "engines", "audiocpp", "seed_audiocpp_catalog.json");

const git = (...args) => execFileSync("git", ["-C", CHECKOUT, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const show = (ref, path) => git("show", `${ref}:${path}`);

// The spec fields the app reads; `sources` (tensor mappings) are the runtime's own business.
const SPEC_FIELDS = ["display_name", "description", "category", "status", "tasks", "modes", "languages", "capabilities", "runtime", "options", "dependencies", "ui"];

/** docs/model_licenses.md's "Families" table → family → licence row. */
export function parseLicences(markdown) {
  const link = /\[([^\]]+)\]\(([^)]+)\)/g;
  const plain = (s) => s.replace(link, "$1").replace(/<br\s*\/?>/g, "; ").replace(/`/g, "").trim();
  const links = (s) => [...s.matchAll(link)].map((m) => ({ name: m[1], url: m[2] }));
  const table = marked.lexer(markdown).find((t) => t.type === "table" && t.header[0]?.text === "Family");
  if (!table) throw new Error("docs/model_licenses.md has no Families table");
  const col = Object.fromEntries(table.header.map((h, i) => [h.text, i]));
  const out = {};
  for (const row of table.rows) {
    const cell = (name) => row[col[name]]?.text ?? "";
    const entry = {
      licence: plain(cell("License")),
      licence_links: links(cell("License")),
      commercial_use: plain(cell("Commercial use")),
      notes: plain(cell("Notes")),
      weights: links(cell("Original weights")),
      checked: plain(cell("Checked")),
    };
    for (const family of plain(cell("Family")).split(/[;,]\s*/)) if (family) out[family] = entry;
  }
  return out;
}

/** docs/maintainers/model_specs.md's "Current enum presets" table → preset → its values (an enum
 * option may name a preset instead of listing its values; the runtime's own copy is
 * src/framework/model_spec/options.cpp `option_presets`). */
export function parsePresets(markdown) {
  const table = marked.lexer(markdown).find((t) => t.type === "table" && t.header[0]?.text === "Preset");
  if (!table) throw new Error("docs/maintainers/model_specs.md has no enum preset table");
  const out = {};
  for (const row of table.rows) {
    const name = row[0].text.replace(/`/g, "").trim();
    out[name] = row[1].text.split(",").map((v) => v.replace(/`/g, "").trim()).filter(Boolean);
  }
  return out;
}

/** The spec's options with each preset's values written out, so a reader never needs the table. */
export function withPresetValues(options, presets) {
  if (!options) return options;
  const out = {};
  for (const [scope, rows] of Object.entries(options)) {
    out[scope] = (rows || []).map((o) => {
      if (o.type !== "enum" || (Array.isArray(o.values) && o.values.length) || !o.preset) return o;
      if (!presets[o.preset]) throw new Error(`option ${o.name}: unknown preset ${o.preset}`);
      return { ...o, values: [...presets[o.preset]] };
    });
  }
  return out;
}

/** A family's built-in voices: the spec's `ui.builtin_voices`, else its voice option's choices
 * (docs/plans/2026-10-13-adopt-everything-audiocpp.md §3, "presets"). */
export function builtinVoices(spec) {
  const voiceOption = (spec.options?.request || []).find((o) => o.name === "voice_id");
  const listed = spec.ui?.builtin_voices;
  return {
    builtin_voices: Array.isArray(listed) ? [...listed] : Array.isArray(voiceOption?.values) ? voiceOption.values.map(String) : [],
    default_voice: spec.ui?.default_voice ?? voiceOption?.default ?? null,
  };
}

/** One package's download, pinned: our model repo at MODEL_REVISION, or another repo at the
 * commit its named revision resolves to today. */
async function pinnedSource(pkg, defaults, trees) {
  const dl = { ...(defaults?.download || {}), ...(pkg.download || {}) };
  const repo = dl.repo || MODEL_REPO;
  const revision = repo === MODEL_REPO ? MODEL_REVISION : await _revisionSha(repo, dl.revision || "main");
  const key = `${repo}@${revision}`;
  if (!trees.has(key)) trees.set(key, await _tree(repo, revision));
  const byPath = new Map(trees.get(key).map((e) => [e.path, e]));
  // Package files are repo paths (ours carry their folder, "IndexTTS2-GGUF/…").
  const files = (pkg.files || []).map((path) => {
    const hit = byPath.get(path);
    return hit ? { path, size_bytes: _entrySize(hit), sha256: _entryOid(hit) || null } : { path, missing: true };
  });
  return { repo, revision, kind: dl.kind || "huggingface_snapshot", gated: Boolean(dl.gated), files };
}

// ── audio.cpp's own web UI rule, ported whole (webui/native/src/lib/catalog.ts) ──────────────
// Each function keeps its name and logic; `packages` is every spec's packages, each with its
// `family`, as catalog.ts builds them from model_specs/*.json.

const EXPOSE_ALL_GGUF_PACKAGE_FAMILIES = new Set([
  "ming3_tts",
  "ming3_audio",
  "latentsync",
  "xtts_v2",
  "canary_asr",
  "cohere_asr",
  "moss_transcribe_diarize",
  "confucius4_r2t2",
  "audiosr",
  "controlfoley",
  "breeze_tts",
  "cosyvoice3",
  "firered_audio",
  "fireredtts3",
  "irodori_tts",
  "kitten_tts2",
  "kokoro_tts",
  "meanvc2",
  "midashenglm_gen",
  "sanotts",
  "mossformer2",
  "plapre",
  "voxtral_tts",
]);
// installChoices' first case: families whose packages relate by their id's stem.
const STEM_FAMILIES = [
  "maya1",
  "gigaam_asr",
  "samsone",
  "sam_audio",
  "tone_color_vc",
  "moss_ttsd",
  "moss_voicegen",
  "kugelaudio",
  "crisperwhisper",
  "index_echo",
  "audio_flamingo",
  "owsm",
  "owsm_ctc",
  "reuse",
  "sidon",
  "smart_turn",
];
const STEM_TAIL = /_(?:q8_0|q4_k|bf16|f16|f32|orig)(?:_codec_f16(?:_decode)?)?$/;
const PRECISION_TAIL = /_(?:q8_0|q8|f16|fp16|bf16|safetensors|orig)$/i;
const HAN = /[㐀-䶿一-鿿豈-﫿]/u;

/** The first of the texts that has no Han characters, or "" (catalog.ts `englishUiText`). */
export function englishUiText(preferred, fallback) {
  for (const value of [preferred, fallback]) {
    if (value && !HAN.test(value)) return value;
  }
  return "";
}

const cleanId = (v) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanPath = (v) =>
  String(v || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^models\//i, "").replace(/\/$/, "").toLowerCase();

export const preferredPackage = (pkgs) => pkgs.find((p) => p.default) || pkgs.find((p) => p.precision === "q8_0") || pkgs[0];

/** Which of the family's packages an entry relates to: an exact package id, then a legacy id that
 * prefixes or is prefixed by a package id, then the packages in the entry's folder, then the whole
 * family. */
export function relatedPackages(entry, packages) {
  const family = packages.filter((p) => p.family === entry.family);
  if (!family.length) return [];
  if (entry.family === "ace_step" || entry.family === "minimax_music3") return family;
  if (!entry.download_id) return family;
  const exact = family.find((p) => p.id === entry.download_id);
  if (exact) {
    const stem = exact.id.replace(PRECISION_TAIL, "");
    const matches = family.filter((p) => p.id.replace(PRECISION_TAIL, "") === stem);
    return matches.length ? matches : [exact];
  }
  const legacyId = cleanId(entry.download_id);
  const legacy = family.filter((p) => {
    const id = cleanId(p.id);
    return id.startsWith(legacyId) || legacyId.startsWith(id);
  });
  if (legacy.length) return legacy;
  const target = cleanPath(entry.path);
  const inFolder = family.filter((p) => cleanPath(p.target_directory) === target);
  if (inFolder.length) {
    const stems = new Set(inFolder.map((p) => p.id.replace(PRECISION_TAIL, "")));
    const matches = family.filter((p) => stems.has(p.id.replace(PRECISION_TAIL, "")));
    return matches.length ? matches : inFolder;
  }
  return family;
}

function relatedExposeAllGgufPackages(entry, packages) {
  const family = packages.filter((p) => p.family === entry.family && p.format === "gguf");
  if (!family.length) return [];
  if (entry.family === "sanotts" || entry.family === "xtts_v2") return family;
  if (!entry.download_id) return family;
  const exact = family.find((p) => p.id === entry.download_id);
  if (!exact) return relatedPackages(entry, packages);
  const matches = family.filter((p) => p.target_directory === exact.target_directory);
  return matches.length ? matches : [exact];
}

function exposedPackageRank(p, selectedId) {
  if (selectedId && p.id === selectedId) return 0;
  if (p.default) return 1;
  if (["q4_k", "q4_0", "q8_0", "q8"].includes(p.precision)) return 2;
  if (["f16", "fp16", "bf16"].includes(p.precision)) return 3;
  if (p.precision === "f32") return 4;
  if (p.precision === "orig") return 5;
  return 6;
}

/** The words audio.cpp's model manager labels a package with. */
export function packageLabel(p) {
  if (p.family === "sanotts") {
    if (p.id.includes("_heart_nano_")) return "Heart Nano";
    if (p.id.includes("_heart_")) return "Heart";
    if (p.id.includes("_amy_")) return "Amy";
    if (p.id.includes("_hfc_")) return "HFC";
    if (p.id.includes("_kristin_")) return "Kristin";
    if (p.id.includes("_vi_")) return "Vietnamese";
    if (p.id.includes("_id_")) return "Indonesian";
    if (p.id.includes("_cs_")) return "Czech";
    if (p.id.includes("_de_")) return "German";
    if (p.id.includes("_es_")) return "Spanish";
    if (p.id.includes("_fr_")) return "French";
    if (p.id.includes("_it_")) return "Italian";
    if (p.id.includes("_pt_")) return "Portuguese (Brazil)";
    if (p.id.includes("_ro_")) return "Romanian";
    if (p.id.includes("_ru_")) return "Russian";
    if (p.id.includes("_tr_")) return "Turkish";
    if (p.id.includes("_ne_")) return "Nepali";
    if (p.id.includes("_hi_")) return "Hindi";
  }
  if (p.family === "ace_step") {
    const precision = p.precision === "bf16" ? "BF16" : ["q8_0", "q8"].includes(p.precision) ? "Q8" : p.precision.toUpperCase();
    if (p.id.includes("_xl_turbo_")) return `GGUF Turbo XL ${precision}`;
    if (p.id.includes("_xl_sft_")) return `GGUF Turbo XL SFT ${precision}`;
    if (p.id.includes("_turbo_")) return `GGUF Turbo ${precision}`;
    return `GGUF ${precision}`;
  }
  if (p.family === "irodori_tts" && p.id.includes("_anime_")) return "Anime Q8";
  if (p.family === "yue2") {
    if (p.id === "yue2_main_q8_0") return "Main Q8_0";
    if (p.id === "yue2_main_q4_0") return "Main Q4_0";
    if (p.id === "yue2_main_bf16") return "Main BF16";
    if (p.id === "yue2_vae_f16") return "VAE F16";
    if (p.id === "yue2_vae_f32") return "VAE F32";
    return p.display_name || "Yue2 component";
  }
  if (p.family === "auk") {
    if (p.id === "auk_base_f32") return "Base F32";
    if (p.id === "auk_base_f16") return "Base F16";
    if (p.id === "auk_base_q8_0") return "Base Q8_0";
    if (p.id === "auk_flash_f32") return "AuK-Flash F32";
    if (p.id === "auk_flash_f16") return "AuK-Flash F16";
    if (p.id === "auk_flash_q8_0") return "AuK-Flash Q8_0";
    if (p.id === "auk_qwen_bf16") return "Qwen BF16";
    if (p.id === "auk_qwen_q8_0") return "Qwen Q8_0";
    if (p.id === "auk_vae_f32") return "VAE F32";
    return p.display_name || "AuK component";
  }
  if (p.format === "safetensors") return "Safetensors";
  if (p.id.includes("int8_dit")) return "GGUF Q4 ConvRot";
  if (p.precision === "q4_k" || p.precision === "q4_0") return "GGUF Q4";
  if (p.precision === "q8_0" || p.precision === "q8") return "GGUF Q8";
  if (p.precision === "bf16") return "GGUF BF16";
  if (p.precision === "f16" || p.precision === "fp16") return "GGUF FP16";
  return `GGUF ${p.precision.toUpperCase()}`;
}

// Since upstream's #1127 (2026-10) a package's load target is the server's to resolve ("Static paths
// are display/install placeholders. Managed loads use the server's model-local resolution"): the
// path is the first GGUF file, and no package carries session options of its own any more.
function packageModelPath(p) {
  const modelFile = p.format === "gguf" ? p.files?.find((file) => file.toLowerCase().endsWith(".gguf")) : undefined;
  if (!modelFile) return `models/${p.target_directory}`;
  let relative = modelFile.replace(/\\/g, "/");
  const prefix = (p.strip_prefix || "").replace(/\\/g, "/").replace(/\/$/, "");
  if (prefix && relative.startsWith(`${prefix}/`)) relative = relative.slice(prefix.length + 1);
  return `models/${p.target_directory}/${relative}`.replace(/\/+/g, "/");
}

const choice = (p) => ({ id: p.id, label: packageLabel(p), path: packageModelPath(p), format: p.format, precision: p.precision });

/** The packages audio.cpp's web UI offers to install for a catalog entry, first = its default. */
export function installChoices(entry, packages) {
  if (STEM_FAMILIES.includes(entry.family)) {
    const stem = (entry.download_id || "").replace(STEM_TAIL, "");
    return packages
      .filter((p) => p.family === entry.family && p.format === "gguf" && p.id.replace(STEM_TAIL, "") === stem)
      .sort((left, right) => Number(right.id === entry.download_id) - Number(left.id === entry.download_id))
      .map((p) => choice(p));
  }
  const exposesAllGguf = EXPOSE_ALL_GGUF_PACKAGE_FAMILIES.has(entry.family);
  if (entry.family === "auk" || entry.family === "yue2") {
    const order = new Map(
      entry.family === "auk"
        ? [
            ["auk_base_f32", 0],
            ["auk_base_f16", 1],
            ["auk_base_q8_0", 2],
            ["auk_flash_f32", 3],
            ["auk_flash_f16", 4],
            ["auk_flash_q8_0", 5],
            ["auk_qwen_bf16", 6],
            ["auk_qwen_q8_0", 7],
            ["auk_vae_f32", 8],
          ]
        : [
            ["yue2_main_q8_0", 0],
            ["yue2_main_q4_0", 1],
            ["yue2_main_bf16", 2],
            ["yue2_vae_f16", 3],
            ["yue2_vae_f32", 4],
          ],
    );
    return packages
      .filter((p) => p.family === entry.family && p.format === "gguf")
      .sort((left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99))
      .map((p) => choice(p));
  }
  const related = exposesAllGguf ? relatedExposeAllGgufPackages(entry, packages) : relatedPackages(entry, packages);
  if (entry.family === "ace_step" || entry.family === "minimax_music3" || exposesAllGguf) {
    return related
      .filter((p) => p.format === "gguf")
      .sort((left, right) =>
        exposesAllGguf
          ? exposedPackageRank(left, entry.download_id) - exposedPackageRank(right, entry.download_id)
          : Number(right.default === true) - Number(left.default === true),
      )
      .map((p) => choice(p));
  }
  const q8 = preferredPackage(related.filter((p) => p.format === "gguf" && ["q8_0", "q8"].includes(p.precision)));
  const fp16 =
    preferredPackage(related.filter((p) => p.format === "gguf" && ["f16", "fp16"].includes(p.precision))) ||
    preferredPackage(related.filter((p) => p.format === "gguf" && p.precision === "bf16"));
  const otherGguf = !q8 && !fp16 ? related.filter((p) => p.format === "gguf") : [];
  // The native model manager exposes complete GGUF packages only.
  return [q8, fp16, ...otherGguf].filter((p) => p !== undefined).map((p) => choice(p));
}

// The web UI's tabs (webui/native/src/routes/+page.svelte `workflowTabs`, `workflowForEntry`):
// an entry's own `workflow`, else the enhancement families, else the first tab taking its task.
const WORKFLOW_TABS = [
  ["tts", ["tts", "clon"]],
  ["asr", ["asr"]],
  ["music", ["gen"]],
  ["conversion", ["vc", "svc", "s2s"]],
  ["enhancement", ["s2s"]],
  ["separation", ["sep", "s2s"]],
  ["analysis", ["vad", "diar", "align", "spk", "midi", "asr", "turn", "wake", "cls"]],
  ["design", ["vdes"]],
];

/** The web UI tab a catalog entry sits under — "tts" is its Text to speech tab. */
export function workflowForEntry(entry) {
  if (entry.workflow) return entry.workflow;
  if (["apollo", "universr", "audiosr"].includes(entry.family)) return "enhancement";
  return WORKFLOW_TABS.find(([, tasks]) => tasks.includes(entry.task))?.[0] || "tts";
}

// ── the catalog ─────────────────────────────────────────────────────────────────────────────

export async function buildCatalog(ref) {
  const commit = git("rev-parse", `${ref}^{commit}`).trim();
  const specFiles = git("ls-tree", "--name-only", ref, "model_specs/").trim().split("\n").filter((f) => f.endsWith(".json"));
  const entries = JSON.parse(show(ref, "webui/configs/models_catalog.json")).models;
  const params = JSON.parse(show(ref, "webui/configs/model_params.json"));
  const licences = parseLicences(show(ref, "docs/model_licenses.md"));
  const presets = parsePresets(show(ref, "docs/maintainers/model_specs.md"));
  const specs = specFiles.map((file) => JSON.parse(show(ref, file)));
  // Every spec's packages with their family, as catalog.ts builds them.
  const packages = specs.flatMap((spec) => (spec.packages || []).map((p) => ({ ...p, family: spec.family })));
  const trees = new Map();
  const families = {};
  for (const spec of specs) {
    const family = spec.family;
    const out = { family };
    for (const k of SPEC_FIELDS) if (spec[k] !== undefined) out[k] = spec[k];
    if (out.options) out.options = withPresetValues(out.options, presets);
    const voices = builtinVoices(spec);
    out.builtin_voices = voices.builtin_voices;
    out.default_voice = voices.default_voice;
    out.licence = licences[family] || null;
    out.params = params[family] || null;
    out.packages = [];
    for (const pkg of spec.packages || []) {
      const { download: _d, files: _f, ...rest } = pkg;
      out.packages.push({ ...rest, source: await pinnedSource(pkg, spec.package_defaults, trees) });
    }
    out.entries = entries
      .filter((e) => e.family === family)
      .map((e) => {
        // No download id: the weights are placed by hand (audio.cpp's built-in utilities).
        const related = e.download_id ? relatedPackages(e, packages) : [];
        const row = {
          id: e.id,
          display_name: englishUiText(e.display_name_en, e.display_name) || e.id,
          task: e.task,
          workflow: workflowForEntry(e),
          mode: e.mode,
          path: e.path || null,
          package: related.length ? preferredPackage(related).id : null,
          packages: related.map((p) => p.id),
          install_packages: e.download_id ? installChoices(e, packages) : [],
          // An entry may narrow its family's voices (one checkpoint of a family that speaks one).
          builtin_voices: e.builtin_voices ?? voices.builtin_voices,
          default_voice: e.default_voice ?? voices.default_voice,
          min_vram_gb: e.min_vram_gb ?? null,
          hint: englishUiText(e.input_hint_en, e.input_hint) || null,
          default_text: e.default_text || null,
          params: params[e.id] || null,
        };
        for (const k of ["default_options", "session_options", "load_options"]) if (e[k] !== undefined) row[k] = e[k];
        return row;
      });
    families[family] = out;
  }
  return {
    generated_from: { audiocpp_ref: ref, audiocpp_commit: commit, model_repo: MODEL_REPO, model_revision: MODEL_REVISION },
    families,
  };
}

async function main() {
  const at = process.argv.indexOf("--ref");
  const ref = at > 0 ? process.argv[at + 1] : DEFAULT_AUDIOCPP_BUILD;
  const catalog = await buildCatalog(ref);
  writeFileSync(OUT, `${JSON.stringify(catalog, null, 2)}\n`);
  const fams = Object.values(catalog.families);
  const speech = fams.filter((f) => (f.tasks || []).some((t) => t === "tts" || t === "clone"));
  const missing = fams.flatMap((f) => f.packages.flatMap((p) => p.source.files.filter((x) => x.missing).map((x) => `${f.family}: ${x.path}`)));
  const offered = fams.flatMap((f) => f.entries.flatMap((e) => e.install_packages.map((c) => c.id)));
  console.log(`${fams.length} families (${speech.length} speech) from ${ref} (${catalog.generated_from.audiocpp_commit}) → ${OUT}`);
  console.log(`${fams.reduce((n, f) => n + f.packages.length, 0)} packages; ${new Set(offered).size} offered by audio.cpp's web UI`);
  console.log(`${fams.filter((f) => !f.licence).length} without a licence row: ${fams.filter((f) => !f.licence).map((f) => f.family).join(" ") || "none"}`);
  console.log(`${missing.length} package files not in their pinned repo${missing.length ? `:\n  ${missing.join("\n  ")}` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
