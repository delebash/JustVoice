// SPDX-License-Identifier: MIT
// JustVoice's speech models as the kit's `runtime_model` rows (round E — docs/plans/2026-10-29-
// round-e-onto-the-kit.md §4 step 1): every model version our engines offer (generated.js, built from
// audio.cpp's catalog and our family files), seeded through `installLlm({ runtimes: ["audiocpp"],
// runtimeModels })` into the kit's audio.cpp runtime, which downloads, loads and places them.
//
// A row is `{runtime, id, name, kind, license, files, peakVramMb, minRamMb, refSpeed, spec}`
// (the kit's llm/seed.js seedRuntimeModels): its files pinned by repository, revision, path, SHA-256
// and size — each one's hash and size from seed_audiocpp_catalog.json, a small file Git stores itself (the catalog
// has only Git's id for it) its family file's `SMALL_FILES`, a Pocket TTS preset voice's its family
// file's `VOICE_FILES` — each in a slot, the main file's "model"; its memory on
// the card before a load measures it audio.cpp's estimate (`min_vram_gb`); its CPU speed our
// measured reference (`cpu_realtime`); and how the runtime registers it (`spec`, the kit's
// RuntimeService.entriesFor): its family and task, a companion file given as a session option
// (MioTTS's codec), its companions (Qwen3-ASR's aligner, registered on the first alignment), eSpeak
// NG's paths for a family that takes them as session options, and a family whose memory only its
// process's end frees.

import { CURATED } from "./curated/index.js";
import { VOICE_FILES } from "./curated/pocket_tts.js";
import * as generated from "./generated.js";
import { ESPEAK_SESSION_FAMILIES } from "./slot.js";

export const RUNTIME = "audiocpp";

const key = (repo, revision, file) => `${repo}\u0000${revision}\u0000${file}`;

let _catalogFiles = null;

/** Every file audio.cpp's catalog lists, by repository, revision and path → `{sha256, bytes}`. */
function catalogFiles() {
  if (_catalogFiles === null) {
    _catalogFiles = new Map();
    for (const fam of Object.values(generated.CATALOG.families)) {
      for (const pkg of fam.packages || []) {
        for (const f of pkg.source?.files || []) {
          _catalogFiles.set(key(pkg.source.repo, pkg.source.revision, f.path), { sha256: f.sha256, bytes: f.size_bytes });
        }
      }
    }
  }
  return _catalogFiles;
}

let _smallFiles = null;

/** Every small file's SHA-256 our family files give (`SMALL_FILES`), by repository, revision and path. */
function smallFiles() {
  if (_smallFiles === null) {
    _smallFiles = new Map();
    for (const c of Object.values(CURATED)) {
      for (const e of c.SMALL_FILES ?? []) for (const [file, sha256] of Object.entries(e.sha256)) _smallFiles.set(key(e.repo, e.revision, file), sha256);
    }
  }
  return _smallFiles;
}

const SHA256 = /^[0-9a-f]{64}$/;

/** A file's SHA-256 and size: the catalog's — where the catalog has only Git's blob id for a small
 * file Git stores itself, the SHA-256 its family file gives (`SMALL_FILES`) — else a Pocket TTS
 * preset voice's (its family file). */
function pinOf(repo, revision, file) {
  const known = catalogFiles().get(key(repo, revision, file));
  if (known && !SHA256.test(String(known.sha256 ?? ""))) {
    const sha256 = smallFiles().get(key(repo, revision, file));
    if (!sha256) throw new Error(`${file} (${repo}@${revision}) has only Git's id in seed_audiocpp_catalog.json and no SHA-256 in our family files`);
    return { sha256, bytes: known.bytes };
  }
  if (known) return known;
  const voice = revision === VOICE_FILES.revision ? VOICE_FILES.sha256[file] : undefined;
  if (voice) {
    const name = file.split("/").pop().replace(/\.safetensors$/, "");
    return { sha256: voice, bytes: CURATED.pocket_tts.VOICES[name]?.file_bytes };
  }
  throw new Error(`${file} (${repo}@${revision}) has no SHA-256 in seed_audiocpp_catalog.json or our family files`);
}

/** The slot a variant's file goes in: "model" for its main file, a companion's role for its file, a
 *  session option's name for the file it names, else the file's own path. */
function slotsOf(spec) {
  const slots = new Map([[spec.file, "model"]]);
  for (const c of spec.companions || []) slots.set(c.file, c.role);
  for (const [option, file] of Object.entries(spec.session_files || {})) slots.set(file, option);
  return slots;
}

/** One model version (an engine's VARIANTS row) as the kit's runtime_model row. */
export function rowOf(mod, v) {
  const spec = v.audiocpp;
  const slots = slotsOf(spec);
  const files = [];
  for (const s of v.sources) {
    for (const file of s.files) {
      const { sha256, bytes } = pinOf(s.hf_repo, s.revision, file);
      const slot = slots.get(file) ?? file;
      if (files.some((f) => f.slot === slot)) throw new Error(`${v.id}: two files in the slot ${slot}`);
      files.push({ slot, repo: s.hf_repo, revision: s.revision, path: file, sha256, bytes: Number(bytes) });
    }
  }
  return {
    runtime: RUNTIME,
    id: v.id,
    name: v.name,
    kind: mod.KIND === "stt" ? "stt" : "tts",
    license: v.weights_license ?? "",
    files,
    // audio.cpp's estimate, the one number placement and the fit word read before a load measures it
    peakVramMb: Math.round(Number(v.min_vram_gb || 0) * 1024),
    minRamMb: 0,
    refSpeed: v.cpu_realtime != null ? { cpu: Number(v.cpu_realtime) } : {},
    spec: {
      family: spec.family,
      task: spec.task,
      ...(spec.session_options ? { sessionOptions: { ...spec.session_options } } : {}),
      ...(spec.session_files ? { sessionFiles: Object.fromEntries(Object.keys(spec.session_files).map((o) => [o, o])) } : {}),
      ...(spec.companions?.length
        ? { companions: spec.companions.map((c) => ({ role: c.role, family: c.family, task: c.task, slot: c.role, ...(c.role === "aligner" ? { onDemand: true } : {}) })) }
        : {}),
      ...(ESPEAK_SESSION_FAMILIES.includes(spec.family) ? { espeak: true } : {}),
      ...(CURATED[spec.family]?.UNLOAD_STOPS_PROCESS ? { unloadStopsProcess: true } : {}),
    },
  };
}

/** Every model version our engines offer, as the kit's runtime_model rows, in the engines' order. */
export function runtimeModelRows() {
  const out = [];
  for (const mod of generated.generatedEngines().values()) for (const v of mod.VARIANTS) out.push(rowOf(mod, v));
  return out;
}

let _variants = null;

/** The model version a kit row is: `{engineId, mod, row}` — its engine's module and its VARIANTS row —
 *  or null for an id no engine offers. */
export function variantOf(id) {
  if (_variants === null) {
    _variants = new Map();
    for (const [engineId, mod] of generated.generatedEngines()) for (const row of mod.VARIANTS) _variants.set(row.id, { engineId, mod, row });
  }
  return _variants.get(id) ?? null;
}
