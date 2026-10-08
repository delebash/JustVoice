// SPDX-License-Identifier: MIT
// Host-side voice blending — file math, no engine process involved (the port of
// justvoice/engines/blending.py).
//
// A Kokoro voice is a (510, 1, 256) float32 style array sitting in the installed model file's
// embedded voices, and a blend is the elementwise weighted average
//
//     blend[i] = Σ(wⱼ · voiceⱼ[i]) / Σwⱼ
//
// — the canonical Kokoro mix (slerp/lerp retired 2026-08-19). Creating a blend needs only
// files on disk; the engine can be unloaded. Only *hearing* a blend needs the engine, and that
// rides the normal synth path as the request's `voice_vector`.
//
// The math itself runs in `audiocpp_dsp` (audio/dsp_client.js, 2026-10-07): this module
// resolves which voices, as raw float32 bytes, and checks shapes. Exactly one engine blends
// today; adding a second means adding its arm here.

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NotImplementedError, pyRound, ValueError } from "@delebash/llm-runner/platform/py";
import * as dspClient from "../audio/dsp_client.js";
import * as speechCache from "../speech_cache.js";
import { embeddedFiles } from "./audiocpp/gguf_files.js";
import * as kokoroManifest from "./kokoro/manifest.js";
import { VOICES } from "./kokoro/voices.js";
import * as self from "./blending.js";

/** Python's LookupError. */
export class LookupError extends Error {
  constructor(message) {
    super(message);
    this.name = "LookupError";
  }
}

// The one source id that is not a voice. Extrapolate is `mean + k·(v − mean)`, which
// rearranges to `k·v + (1−k)·mean` — an ordinary weighted combination whose weights sum to 1,
// so the existing blend path runs it unchanged once the centroid is resolvable as a source.
export const MEAN_SOURCE = "__pack_mean__";

/** Which engines can blend. Mirrors capability_details' per-engine `supports_voice_blending`
 * — keep the two in step. */
export function supports(engineId) {
  return engineId === "kokoro";
}

/** The catalog language of a preset voice id, if this id is a preset. */
export function presetLanguage(engineId, voiceId) {
  if (engineId !== "kokoro") return null;
  const hit = VOICES.find(([vid]) => vid === voiceId);
  return hit ? hit[2] : null;
}

/**
 * Weighted-combine the source voices' style vectors into one, flat (async).
 *
 * `resolveStored` maps a stored-voice id (an earlier blend) to its saved vector, so blends of
 * blends work. Throws LookupError for a missing voice or an uninstalled engine, ValueError for
 * shape mismatches. `normalize` divides by Σw — right for a MIX, wrong for the vector-analogy
 * strategy (A + B − C), where magnitude is the point (2026-08-21 ruling). MEAN_SOURCE may
 * appear in `sourceIds`.
 */
export async function blend(engineId, sourceIds, weights, { dataDir, resolveStored, normalize = true }) {
  if (engineId !== "kokoro") throw new NotImplementedError(`engine '${engineId}' has no blend support`);
  return kokoroBlend(sourceIds, weights, dataDir, resolveStored, normalize);
}

/**
 * Assemble one voice from CONTIGUOUS SLICES of several voices' vectors (async). Each segment
 * is [voiceId, start, end] with start/end fractions of the style vector's feature axis. Not a
 * mix: each output feature is taken whole from exactly one source. Kokoro is StyleTTS2-based,
 * which uses the two halves of its 256-wide reference vector for different jobs —
 * `ref_s[:, :128]` the DECODER (timbre), `ref_s[:, 128:]` the prosody predictor — so 0.0-0.5
 * from one voice and 0.5-1.0 from another is one voice's timbre with another's prosody. The
 * slice runs along the LAST axis of the pack's (510, 1, 256) array, per row. Uncovered
 * features stay zero; overlapping segments resolve last-wins.
 */
export async function recombine(engineId, segments, { dataDir, resolveStored }) {
  if (engineId !== "kokoro") throw new NotImplementedError(`engine '${engineId}' cannot recombine`);
  return kokoroRecombine(segments, dataDir, resolveStored);
}

/**
 * The language a mix speaks: unanimous across its sources, else the configured default.
 * THE one rule behind both doors (2026-08-21) — the save path and the pre-save audition.
 * MEAN_SOURCE is skipped — the pack centroid is every language at once.
 */
export function blendLanguage(engineId, sourceIds, { storedLanguage, default: def }) {
  const langs = new Set();
  for (const vid of sourceIds) {
    if (vid === MEAN_SOURCE) continue;
    const lang = storedLanguage(vid) || presetLanguage(engineId, vid);
    if (lang) langs.add(lang);
  }
  return langs.size === 1 ? [...langs][0] : def;
}

/** The centroid of every preset voice in the installed pack, flat (async) — the "average
 * voice" the Extrapolate strategy pushes away from. */
export async function packMean(engineId, { dataDir }) {
  if (engineId !== "kokoro") throw new NotImplementedError(`engine '${engineId}' has no voice pack`);
  return dspClient.f32List(await kokoroPackMean(dataDir));
}

// ── Kokoro ───────────────────────────────────────────────────────────────

function rglobGguf(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try {
      names = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".gguf")) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** The installed Kokoro model file — any downloaded variant (their voices are the same preset
 * packs). No fetching — blending never triggers a download; the caller surfaces "download
 * Kokoro first". */
export function _kokoroGguf(dataDir) {
  for (const variant of kokoroManifest.VARIANTS) {
    const vid = variant.id;
    if (speechCache.variantOnDisk(dataDir, "kokoro", vid)) {
      const hits = rglobGguf(String(speechCache.variantDir(dataDir, "kokoro", vid)));
      if (hits.length) return hits[0];
    }
  }
  throw new LookupError("Kokoro is not downloaded — download it on AI Settings → Speech engines first");
}

// One model file version's pack: key "<path>|<mtimeNs>" → [pack Map, names, features].
export const _PACK_CACHE = new Map();

/**
 * The preset voices as name → raw little-endian float32 rows × features (a Map), their names
 * in `voices.json` order — a list, never a set: the mean sums float32 voices in this order —
 * and the feature count (256). Since the 2026-10-01 switch Kokoro is one audio.cpp GGUF, and
 * its voices are files embedded in it (gap 2). Read once per model file version.
 */
export function _kokoroPack(dataDir) {
  const gguf = self._kokoroGguf(dataDir);
  const key = `${gguf}|${statSync(gguf, { bigint: true }).mtimeNs}`;
  if (_PACK_CACHE.has(key)) return _PACK_CACHE.get(key);
  const files = embeddedFiles(gguf);
  if (!files.has("voices.json")) throw new LookupError(`${path.basename(gguf)} carries no voices — re-download Kokoro`);
  const pack = new Map();
  let features = 0;
  for (const [name, entry] of Object.entries(JSON.parse(files.get("voices.json").toString("utf8")))) {
    const raw = files.get(`voices/${entry.path}`);
    if (raw === undefined) continue;
    const rows = Number(entry.rows);
    const cols = Number(entry.cols);
    pack.set(name, Buffer.from(raw.subarray(0, rows * cols * 4)));
    features = features || cols;
  }
  _PACK_CACHE.clear();
  _PACK_CACHE.set(key, [pack, [...pack.keys()], features]);
  return _PACK_CACHE.get(key);
}

/** Centroid over every preset in the pack (float32 bytes, the pack's shape). */
async function kokoroPackMean(dataDir) {
  const [pack, names] = self._kokoroPack(dataDir);
  if (!names.length) throw new LookupError("kokoro voices file holds no voices");
  return dspClient.vectorsMean(names.map((n) => pack.get(n)));
}

/** Resolve ids → float32 bytes, and the pack's feature count. `shaped` (recombine) needs a
 * stored blend to have exactly a preset's size, so its feature axis lines up; otherwise (a
 * weighted average) every source just needs the same size. */
async function kokoroVectors(sourceIds, dataDir, resolveStored, { shaped = false } = {}) {
  const [pack, names, features] = self._kokoroPack(dataDir);
  if (!names.length) throw new LookupError("kokoro voices file holds no voices");
  const packSize = pack.get(names[0]).length / 4;
  let meanCache = null;
  const out = [];
  for (const vid of sourceIds) {
    let arr;
    if (vid === MEAN_SOURCE) {
      if (meanCache === null) meanCache = await kokoroPackMean(dataDir);
      arr = meanCache;
    } else if (pack.has(vid)) {
      arr = pack.get(vid);
    } else {
      const stored = resolveStored(vid);
      if (stored == null) throw new LookupError(`unknown source voice '${vid}' — not a kokoro preset or a stored blend`);
      arr = dspClient.f32Bytes(stored);
    }
    if (shaped && Math.floor(arr.length / 4) !== packSize) {
      throw new ValueError(
        `voice '${vid}' has ${Math.floor(arr.length / 4)} values; this pack's voices are ` +
          `(${Math.floor(packSize / features)}, 1, ${features}) — re-blend against the installed pack.`,
      );
    }
    out.push(arr);
  }
  const sizes = [...new Set(out.map((v) => Math.floor(v.length / 4)))].sort((a, b) => a - b);
  if (sizes.length !== 1) throw new ValueError(`source voices have mismatched vector sizes: [${sizes.join(", ")}]`);
  return [out, features];
}

async function kokoroBlend(sourceIds, weights, dataDir, resolveStored, normalize = true) {
  const [vecs] = await kokoroVectors(sourceIds, dataDir, resolveStored);
  if (normalize && weights.reduce((a, w) => a + Number(w), 0) === 0) throw new ValueError("weights must sum to a non-zero value");
  return dspClient.f32List(await dspClient.vectorsBlend(vecs, weights, normalize));
}

async function kokoroRecombine(segments, dataDir, resolveStored) {
  if (!segments.length) throw new ValueError("recombine needs at least one segment");
  const ids = segments.map((s) => s[0]);
  const [vecs, features] = await kokoroVectors(ids, dataDir, resolveStored, { shaped: true });
  const covered = new Array(features).fill(false);
  for (const [vid, start, end] of segments) {
    const lo = Math.trunc(pyRound(Math.max(0.0, Math.min(1.0, Number(start))) * features));
    const hi = Math.trunc(pyRound(Math.max(0.0, Math.min(1.0, Number(end))) * features));
    if (hi <= lo) throw new ValueError(`segment for '${vid}' is empty: start ${start} is not below end ${end}`);
    for (let i = lo; i < hi; i++) covered[i] = true;
  }
  if (!covered.every(Boolean)) {
    const gap = covered.filter((c) => !c).length;
    throw new ValueError(
      `the segments leave ${gap} of ${features} features unset — a voice with holes in its style vector does not render; cover 0% to 100%.`,
    );
  }
  const spans = segments.map(([, start, end], i) => [i, Number(start), Number(end)]);
  return dspClient.f32List(await dspClient.vectorsRecombine(vecs, spans, features));
}
