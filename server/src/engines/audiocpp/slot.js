// SPDX-License-Identifier: MIT
// Where an engine subprocess used to stand — now one model inside the audio.cpp server (the
// port of justvoice/engines/audiocpp/slot.py).
//
// The engine manager spawns, POSTs `/load`, `/synth`, `/transcribe`, `/align`, GETs `/voices`,
// and terminates. Until the switch each of those was an HTTP call into a Python child running
// the model's reference code. `AudioCppSlot` answers the same calls by driving the ONE
// audio.cpp server, so the manager's admission, VRAM bookings, per-kind slots and cancel logic
// keep working untouched (plan §3.3).
//
// Per-family request mapping (plan §3.4) lives here — the single place that knows how each of
// our engines' requests reads in audio.cpp's terms. What audio.cpp cannot do yet refuses by
// name instead of rendering the wrong thing (plan §5).
//
// The slot's answers are `_Resp` objects (`statusCode`, `content`, `headers`, `text`,
// `json()`) — the bit of an HTTP response the manager reads. Every call is async.

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { getLogger } from "@delebash/core/platform/log";
import { cmp, pyFloatParse, pyInt, rstrip, RuntimeError, splitWs, S, strip, truthy, ValueError } from "@delebash/core/platform/py";
import { pyIntOf, pyJson, unwrap } from "@delebash/core/platform/pyjson";
import * as appState from "../../app_state.js";
import * as dspClient from "../../audio/dsp_client.js";
import { parseWavHeader, writeWavContainer } from "../../audio/wav.js";
import * as speechCache from "../../speech_cache.js";
import { splice, vocabOf } from "../kokoro/ipa.js";
import * as manager from "../manager.js";
import { CURATED } from "./curated/index.js";
import * as espeak from "./espeak.js";
import * as generated from "./generated.js";
import * as japanese from "./japanese.js";
import * as release from "./release.js";
import * as runtime from "./runtime.js";
import { AudioCppError, ModelEntry } from "./runtime.js";
import * as runtimeOptions from "./runtime_options.js";
import * as self from "./slot.js";

export { AudioCppError, ModelEntry, release };

const log = getLogger("justvoice.engines.audiocpp.slot");

// Qwen3 takes language NAMES ("en" is rejected by audio.cpp — measured 2026-10-01).
export const QWEN_LANGUAGE = {
  zh: "Chinese", en: "English", ja: "Japanese", ko: "Korean", de: "German",
  fr: "French", ru: "Russian", pt: "Portuguese", es: "Spanish", it: "Italian",
};
// Qwen3-ASR's 30 languages, by the names its prompt takes (the model card,
// huggingface.co/Qwen/Qwen3-ASR-1.7B, read 2026-10-04: `language="English"`, never a code).
// Until 2026-10-04 the twenty outside QWEN_LANGUAGE went as raw codes, and the aligner was told
// "English" for them — so Cantonese was aligned as space-separated words (audit §5 D7).
export const ASR_LANGUAGE = {
  ...QWEN_LANGUAGE, yue: "Cantonese", ar: "Arabic", id: "Indonesian", th: "Thai",
  vi: "Vietnamese", tr: "Turkish", hi: "Hindi", ms: "Malay", nl: "Dutch",
  sv: "Swedish", da: "Danish", fi: "Finnish", pl: "Polish", cs: "Czech",
  fil: "Filipino", fa: "Persian", el: "Greek", ro: "Romanian", hu: "Hungarian",
  mk: "Macedonian",
};
// The lowest temperature / top-p sent (audit §5 D4): Qwen3 refuses 0, Chatterbox divides by it,
// Turbo reads 0 as 1.0, and Qwen3 reads a top-p of 0 as "no filter".
const MIN_SAMPLING = 0.05;
// Kokoro's text frontend codes (audio.cpp `--language`), from our catalog's tags.
export const KOKORO_LANGUAGE = {
  "en-us": "en-us", en: "en-us", "en-gb": "en-gb", ja: "ja", zh: "zh", es: "es",
  fr: "fr-fr", hi: "hi", it: "it", "pt-br": "pt-br", pt: "pt-br",
};

const has = (o, k) => o != null && Object.hasOwn(o, k);
const get = (o, k, d = null) => (has(o, k) ? o[k] : d);

const kokoroLanguageOf = (voice) => generated.kokoroVoices().find(([v]) => v === voice)?.[1] ?? null;
const fwd = (p) => String(p).replaceAll("\\", "/");

/** Python's repr() of a str / None, for a refusal's text. */
function pyRepr(v) {
  if (v === null || v === undefined) return "None";
  const s = String(v);
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return `${q}${s.replaceAll("\\", "\\\\").replaceAll(q, `\\${q}`)}${q}`;
}

/** The bit of an HTTP response the manager reads. */
export class _Resp {
  constructor(status, content = Buffer.alloc(0), headers = null, payload = null) {
    this.statusCode = status;
    this.content = content;
    this.headers = headers || {};
    this._payload = payload;
  }

  get text() {
    if (this._payload !== null) return pyJson(this._payload);
    return Buffer.from(this.content).toString("utf8");
  }

  json() {
    if (this._payload !== null) return this._payload;
    return JSON.parse(this.content && this.content.length ? Buffer.from(this.content).toString("utf8") : "{}");
  }

  raiseForStatus() {
    if (this.statusCode >= 400) throw new RuntimeError(this.text);
  }
}

const err = (status, msg) => new _Resp(status, Buffer.alloc(0), null, { detail: msg });

// ─── What the server is told it may load ────────────────────────────────────

export function _dataDir() {
  return appState.getState().dataDir;
}

// How many blend packs and filled references stay on disk, and what counts as digital silence in a
// Qwen3-TTS Base reference and what fills it (a test assigns them — Python monkeypatched the global).
export const cfg = { VOICE_PACKS_KEPT: 200, REFERENCES_KEPT: 200, SILENCE_RUN_S: 0.01, SILENCE_FILL_LSB: 2 };
let packSeq = 0;

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A blend's style pack as the raw float32 rows × 256 file our audio.cpp's `voice_pack`
 * option reads (gap 2). Named by its content, so each blend is written once and kept. */
export function writeVoicePack(vector) {
  const values = Array.from(vector, (v) => Number(unwrap(v)));
  if (!values.length || values.length % 256) {
    throw new AudioCppError(`a blended voice has ${values.length} values — Kokoro's are rows × 256`);
  }
  const raw = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) raw.writeFloatLE(values[i], i * 4);
  const folder = path.join(String(self._dataDir()), "cache", "kokoro-voice-packs");
  const stem = createHash("sha1").update(raw).digest("hex");
  const out = path.join(folder, `${stem}.bin`);
  if (isFile(out)) {
    const now = new Date();
    utimesSync(out, now, now); // in use: newest
    return out;
  }
  mkdirSync(folder, { recursive: true });
  // A name of its own per writer: two renders of the same blend at once shared one ".tmp".
  packSeq += 1;
  const tmp = path.join(folder, `${stem}.${process.pid}-${packSeq}.tmp`);
  writeFileSync(tmp, raw);
  renameSync(tmp, out);
  // Every blend auditioned left a pack for good (audit §5 F). A pack is rebuilt from its voice
  // whenever it is needed, so only the newest are kept.
  keepNewest(folder, ".bin", cfg.VOICE_PACKS_KEPT);
  return out;
}

/** Delete all but the `kept` newest `ext` files in `folder` — a cache of files rebuilt on need. */
function keepNewest(folder, ext, kept) {
  const files = readdirSync(folder)
    .filter((n) => n.endsWith(ext))
    .map((n) => {
      const p = path.join(folder, n);
      return [p, statSync(p).mtimeMs];
    })
    .sort((a, b) => b[1] - a[1]);
  for (const [old] of files.slice(kept)) rmSync(old, { force: true });
}

// ── Qwen3-TTS Base references: digital silence filled (decided 2026-10-11) ──
// Stretches of exact digital silence inside a reference run Qwen3-TTS Base on without stopping —
// one sentence came back as 655 s of audio, and every other speech request waited — while the same
// stretches filled with ±2 LSB of noise (about −84 dBFS, inaudible) clone normally; the clip's
// length is not the trigger (measured 2026-10-10, RESEARCH §9). The cause in our audio.cpp copy is
// not found. Until it is, a reference with such a stretch reaches the runtime as a filled copy,
// written once to the cache and named by the clip's bytes; the voice's own file is never changed.

/** `pcm` (16-bit, interleaved) with every run of at least `minFrames` all-zero frames filled with
 * ±`lsb` of noise from a fixed-seed generator, so the same clip always gets the same copy; null
 * when it has no such run. */
export function fillDigitalSilence(pcm, channels, minFrames, lsb) {
  const frames = Math.floor(pcm.length / (2 * channels));
  const zero = (f) => {
    for (let c = 0; c < channels; c++) if (pcm.readInt16LE((f * channels + c) * 2) !== 0) return false;
    return true;
  };
  let out = null;
  let seed = 0x9e3779b9;
  let start = -1;
  for (let f = 0; f <= frames; f++) {
    if (f < frames && zero(f)) {
      if (start < 0) start = f;
      continue;
    }
    if (start >= 0 && f - start >= minFrames) {
      if (out === null) out = Buffer.from(pcm);
      for (let g = start; g < f; g++) {
        for (let c = 0; c < channels; c++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          out.writeInt16LE((seed % (2 * lsb + 1)) - lsb, (g * channels + c) * 2);
        }
      }
    }
    start = -1;
  }
  return out;
}

/** The file the runtime gets for a Qwen3-TTS Base reference: the clip itself, or — when it has a
 * stretch of digital silence — its filled copy. A file that can't be read as 16-bit PCM WAV goes as
 * it is (the runtime says what is wrong with it). */
export function guardedReference(file) {
  let raw;
  let fmt;
  let offset;
  let size;
  try {
    raw = readFileSync(file);
    [fmt, offset, size] = parseWavHeader(raw);
  } catch {
    return file;
  }
  if (fmt.bitsPerSample !== 16) return file;
  const minFrames = Math.max(1, Math.round(fmt.sampleRate * cfg.SILENCE_RUN_S));
  const filled = fillDigitalSilence(raw.subarray(offset, offset + size), fmt.channels, minFrames, cfg.SILENCE_FILL_LSB);
  if (filled === null) return file;
  const folder = path.join(String(self._dataDir()), "cache", "qwen3-references");
  const stem = createHash("sha1").update(raw).digest("hex");
  const out = path.join(folder, `${stem}.wav`);
  if (isFile(out)) {
    const now = new Date();
    utimesSync(out, now, now); // in use: newest
    return out;
  }
  mkdirSync(folder, { recursive: true });
  packSeq += 1;
  const tmp = path.join(folder, `${stem}.${process.pid}-${packSeq}.tmp`);
  writeFileSync(tmp, writeWavContainer(filled, fmt.sampleRate, fmt.channels));
  renameSync(tmp, out);
  keepNewest(folder, ".wav", cfg.REFERENCES_KEPT);
  log.info(`a Qwen3-TTS Base reference has digital silence — filled for the runtime (${path.basename(file)})`);
  return out;
}

/** The manifest row for `variantId` (or the engine's default), with its `audiocpp` block. */
export function variantSpec(manifest, variantId) {
  const rows = [...(manifest.module?.VARIANTS || [])];
  const want = variantId == null || variantId === "" || variantId === "auto" ? manifest.defaultVariantId : variantId;
  let row = rows.find((r) => r.id === want);
  if (row === undefined && rows.length) row = rows.find((r) => r.id === manifest.defaultVariantId) ?? rows[0];
  return row && row.audiocpp ? row : null;
}

// The families that take eSpeak NG's paths as session options (audio.cpp
// community_models/kitten_tts/session.cpp:74 — `kitten_tts.espeak_library_path` /
// `kitten_tts.espeak_data_path`). Kokoro is not one: it reads the environment.
export const ESPEAK_SESSION_FAMILIES = ["kitten_tts"];

/** The runtime entries a row registers: its model, then its companions (`<id>::<role>`) — each
 * file where its download put it (speech_cache.variantFilePath: a model from two repositories,
 * QwenCleo-ASR and Qwen3's aligner, keeps each in its own folder). */
export function _entriesFor(manifest, row) {
  const spec = row.audiocpp;
  const at = (file) => String(speechCache.variantFilePath(self._dataDir(), manifest.id, row.id, row.sources, file));
  const opts = { ...(spec.session_options || {}) };
  // The options the user set on the model's row (audit §13.5, 5h).
  Object.assign(opts, runtimeOptions.sessionOptionsFor(manifest.id, row));
  // A companion file downloaded with the model (a family file's SESSION_FILES — MioTTS's codec).
  for (const [k, file] of Object.entries(spec.session_files || {})) opts[k] = at(file);
  // The eSpeak NG phonemizer the runtime install fetched. KittenTTS reads it from its own
  // prefixed session options; Kokoro reads only the runtime's environment
  // (`runtime._childEnv`) and would refuse a session option it doesn't know.
  if (ESPEAK_SESSION_FAMILIES.includes(spec.family)) {
    const found = espeak.paths(manager.enginesRuntimeRoot());
    if (found) {
      opts[`${spec.family}.espeak_library_path`] = String(found[0]);
      opts[`${spec.family}.espeak_data_path`] = String(found[1]);
    }
  }
  const pairs = Object.entries(opts).sort(([a], [b]) => cmp(a, b));
  const out = [new ModelEntry(row.id, spec.family, spec.task, at(spec.file), pairs)];
  for (const comp of spec.companions || []) {
    out.push(new ModelEntry(`${row.id}::${comp.role}`, comp.family, comp.task, at(comp.file)));
  }
  return out;
}

/** Every model of `kind` ("tts" | "stt") on disk — the config's list for a build that can't
 * register models at run time (`managedRuntime`). */
export function installedEntries(kind) {
  const out = [];
  for (const m of manager.getManager().manifests().values()) {
    if (m.kind !== kind) continue;
    for (const row of m.module.VARIANTS || []) {
      if (row.audiocpp && speechCache.variantOnDisk(self._dataDir(), m.id, row.id)) out.push(...self._entriesFor(m, row));
    }
  }
  return out;
}

/** Whether the installed build registers models at run time (`model_management`, our fork —
 * audit 2026-10-04 §13.2): its processes start with no models and nothing downloaded or
 * deleted restarts them. */
export function managedRuntime() {
  return runtime.hasFeature("model_management");
}

// What each build feature makes possible, as a refusal names it (release.FEATURES).
const FEATURE_WORDS = {
  voice_pack: "Blended voices",
  inline_ipa: "A lexicon's pronunciations on Kokoro",
  turbo_clone: "Chatterbox Turbo and Nano voices",
  chatterbox_he_ru_zh: "Chatterbox in Hebrew, Russian and Chinese",
  japanese: "Japanese speech",
  voxcpm2_transcript: "A VoxCPM2 clone's transcript",
};

/** The build features a synth of this line needs (`release.FEATURES`). */
export function featuresNeeded(row, body) {
  const family = row.audiocpp.family;
  const lang = String(get(body, "language") || "").split("-")[0].toLowerCase();
  const out = [];
  if (truthy(get(body, "voice_vector"))) out.push("voice_pack");
  if (family === "chatterbox_turbo") out.push("turbo_clone");
  if (family === "kokoro_tts") {
    const voiceLang = kokoroLanguageOf(get(body, "voice_id")) ?? "";
    if ((lang || voiceLang.toLowerCase()).startsWith("ja")) out.push("japanese");
  }
  if (family === "chatterbox") {
    if (["he", "ru", "zh"].includes(lang)) out.push("chatterbox_he_ru_zh");
    else if (lang === "ja") out.push("japanese");
  }
  if (family === "voxcpm2" && truthy(get(body, "audio_prompt_path")) && truthy(get(body, "ref_text"))) out.push("voxcpm2_transcript");
  return out;
}

/** Why a line can't be spoken on the installed build — an update to offer when the pinned
 * build has the feature, else that this version doesn't have it yet (audit §5 E3). */
export function featureRefusal(feature) {
  const words = get(FEATURE_WORDS, feature) ?? feature;
  if (release.pinnedHas(feature)) {
    return `${words} — this needs the speech runtime update. Update it on AI Settings → Speech engines.`;
  }
  return `${words} — this isn't in this version's speech runtime yet.`;
}

/** Where a model asked for `placement` actually runs: a machine whose runtime IS the CPU
 * build has only the CPU process. */
export function effectivePlacement(placement) {
  const exe = runtime.installedExe();
  if (exe !== null && runtime.backendOf(exe) === "cpu") return "cpu";
  return placement;
}

/** The running server for `placement` ("gpu" | "cpu") and `kind` ("tts" | "stt"). The CPU
 * process runs the installed build with `backend: cpu` — measured at 0 MB of graphics memory —
 * at the CPU-threads setting (docs/plans/2026-10-02-cpu-placement.md §8). */
export async function ensureServer(placement = "gpu", kind = "tts") {
  const exe = runtime.installedExe();
  if (exe === null) throw new RuntimeError("the speech runtime (audio.cpp) is not installed — install it on the AI page");
  placement = self.effectivePlacement(placement);
  const srv = runtime.getServer(placement, kind);
  const managed = self.managedRuntime();
  const models = managed ? [] : self.installedEntries(kind);
  if (placement === "cpu") {
    await srv.ensure(exe, models, {
      dataDir: self._dataDir(),
      device: runtime.configuredGpu(),
      threads: runtime.cpuThreads(),
      backend: "cpu",
      managed,
    });
  } else {
    await srv.ensure(exe, models, { dataDir: self._dataDir(), device: runtime.configuredGpu(), managed });
  }
  return srv;
}

/** Has the user accepted this engine's own terms (manifest TERMS)? Best-effort: no app state
 * (bare tests) reads as not accepted. */
export function termsAccepted(engineId) {
  try {
    const ov = appState.getState().settings.get().engines.engine_overrides[engineId];
    return Boolean(ov && ov.terms_accepted_at);
  } catch {
    return false;
  }
}

// The refusal's machine-readable code — the manager turns it into TermsRequired, which the
// API answers with 403 + `code: terms_required` so the app can show the terms.
export const TERMS_REQUIRED = "terms_required";

/** A RIFF WAV's [rate, channels] (Python's `wave` reads them). */
function wavRateChannels(wav) {
  const b = Buffer.from(wav);
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") {
    throw new ValueError("file does not start with RIFF id");
  }
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.toString("latin1", i, i + 4);
    const n = b.readUInt32LE(i + 4);
    if (id === "fmt " && i + 16 <= b.length) return [b.readUInt32LE(i + 12), b.readUInt16LE(i + 10)];
    i += 8 + n + (n & 1);
  }
  throw new ValueError("fmt chunk and/or data chunk missing");
}

// ─── The slot ───────────────────────────────────────────────────────────────

/** One engine's model resident in one of the runtime's servers. `placement` ("gpu" | "cpu")
 * is which server — the manager decides it. */
export class AudioCppSlot {
  constructor(manifest, placement = "gpu") {
    this.manifest = manifest;
    this.placement = self.effectivePlacement(placement);
    // Speech and speech recognition each have their own process (audit §13.2).
    this.kind = manifest.kind === "stt" ? "stt" : "tts";
    this.proc = null; // the server's ChildProcess — its pid is what VRAM probes read
    this.port = null;
    this._row = null;
    this._loaded = false;
    this._generation = null;
    // The first line / clip after a CPU load records its real-time factor (manager).
    this.speedRecorded = false;
  }

  _srv() {
    return runtime.getServer(this.placement, this.kind);
  }

  // -- lifecycle --

  async spawn() {
    const srv = await self.ensureServer(this.placement, this.kind);
    this.proc = srv._run.proc;
    this.port = srv._run.port;
    this._generation = srv._run.proc.pid;
  }

  isAlive() {
    const srv = this._srv();
    return Boolean(this._loaded && srv.isRunning() && srv.pid === this._generation);
  }

  /** It had loaded, and the process holding its model is gone or replaced — the model went
   * with it. A slot still loading is not dead. */
  isDead() {
    return Boolean(this._loaded && !this.isAlive());
  }

  async terminate() {
    const srv = this._srv();
    const ours = this._row !== null && srv.isRunning() && srv.pid === this._generation;
    if (ours && CURATED[this._row.audiocpp?.family]?.UNLOAD_STOPS_PROCESS) {
      // A family whose memory only its process's end frees (its curated file says so): this
      // kind's process holds no other model, so stopping it is the unload.
      await srv.stop();
    } else if (ours) {
      let ids = self._entriesFor(this.manifest, this._row).map((e) => e.id);
      if (srv.managed) ids = ids.filter((i) => srv.hasModel(i));
      try {
        await srv.unload(ids);
      } catch (e) {
        if (!(e instanceof AudioCppError)) throw e;
        log.warning(`audio.cpp unload of ${this._row.id} failed: ${e.message}`);
      }
    }
    this._loaded = false;
  }

  async get(p) {
    if (p === "/voices") return new _Resp(200, Buffer.alloc(0), null, { voices: [...this.manifest.staticVoices] });
    if (p === "/health") return new _Resp(this._srv().isRunning() ? 200 : 503, Buffer.alloc(0), null, {});
    return err(404, `${p} has no audio.cpp equivalent`);
  }

  async post(p, json = null, _timeout = null) {
    const body = json || {};
    try {
      if (p === "/load") return await this._load(body);
      if (p === "/synth") return await this._synth(body);
      if (p === "/transcribe") return await this._transcribe(body);
      if (p === "/align") return await this._align(body);
      if (p === "/shutdown") return new _Resp(200, Buffer.alloc(0), null, {});
      return err(501, `${this.manifest.name} has no ${p} in audio.cpp`);
    } catch (e) {
      if (!(e instanceof AudioCppError)) throw e;
      // audio.cpp's own status survives — out of memory and busy are 503, a bad request 400
      // (audit §5 D8).
      return err(e.status >= 400 && e.status < 600 ? e.status : 500, e.message);
    }
  }

  // -- /load --

  async _load(body) {
    const row = self.variantSpec(this.manifest, get(body, "variant"));
    if (row === null) return err(400, `${this.manifest.name} has no audio.cpp model for ${pyRepr(get(body, "variant"))}`);
    if (!speechCache.variantOnDisk(self._dataDir(), this.manifest.id, row.id)) {
      return err(400, `${has(row, "name") ? row.name : row.id} is not downloaded — download it on the AI page`);
    }
    const srv = await self.ensureServer(this.placement, this.kind);
    if (srv.managed) {
      // Registered and loaded now — a Load means loaded. Companions (the aligner) register on
      // their first use, as they loaded lazily before.
      await srv.register(self._entriesFor(this.manifest, row)[0]);
    }
    this._row = row;
    this.proc = srv._run.proc;
    this.port = srv._run.port;
    this._generation = srv._run.proc.pid;
    this._loaded = true;
    const calibrated = await this._warm(pyIntOf(get(body, "calibrate_chars") || 0));
    return new _Resp(200, Buffer.alloc(0), null, {
      ok: true,
      variant: row.id,
      calibrated,
      voices: [...this.manifest.staticVoices],
    });
  }

  /** The warm-up after a Load (`warmModel`) on this slot's server. */
  async _warm(calibrateChars = 0) {
    return self.warmModel(this._srv(), this._row, this.kind, calibrateChars);
  }

  // -- /synth --

  async _synth(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    if (truthy(get(body, "voice_vector")) && this._row.audiocpp.family !== "kokoro_tts") {
      return err(422, `${this.manifest.name} has no blended voices — blends are Kokoro's`);
    }
    // What this line needs from the INSTALLED build (the CPU process runs the same one), each
    // refused by name before audio.cpp fails inside or ignores it (audit §5 E1).
    for (const feature of self.featuresNeeded(this._row, body)) {
      if (!runtime.hasFeature(feature)) return err(409, self.featureRefusal(feature));
    }
    if (truthy(get(body, "voice_vector"))) body = { ...body, voice_pack_path: String(self.writeVoicePack(body.voice_vector)) };
    const terms = this.manifest.module?.TERMS;
    if (terms && terms.gates === "cloning" && truthy(get(body, "audio_prompt_path")) && !self.termsAccepted(this.manifest.id)) {
      return new _Resp(403, Buffer.alloc(0), null, {
        detail:
          `${this.manifest.name} clones a voice only after you accept ${terms.owner ?? "its makers"}'s terms — ` +
          `open Voices → Clone with ${this.manifest.name}, or AI Settings → Speech engines, to read and accept them.`,
        code: TERMS_REQUIRED,
        engine: this.manifest.id,
      });
    }
    // A line the model can't take — a voice it doesn't have, a language it doesn't speak — is a
    // request it can't take (400, EngineRequestError's contract), never an internal error (seen
    // through the app 2026-10-16: Pocket TTS French's preset refusal answered 500).
    let req;
    try {
      req = self.toSpeechRequest(this._row, body);
    } catch (e) {
      if (e instanceof AudioCppError && e.status === 500) throw new AudioCppError(e.message, 400);
      throw e;
    }
    const [wav] = await this._srv().speech(req);
    const [sr, ch] = wavRateChannels(wav);
    return new _Resp(200, Buffer.from(wav), {
      "content-type": "audio/wav",
      "X-JustVoice-Sample-Rate": String(sr),
      "X-JustVoice-Channels": String(ch),
      "X-JustVoice-WAV-Container": "1",
    });
  }

  // -- /transcribe, /align --

  _audioPath(body) {
    if (truthy(get(body, "audio_path"))) return [fwd(body.audio_path), false];
    const raw = Buffer.from(String(get(body, "wav_b64") || ""), "base64"); // before the file: a bad upload leaves none
    const name = path.join(os.tmpdir(), `tmp${Math.random().toString(36).slice(2, 10)}.wav`);
    writeFileSync(name, raw);
    return [fwd(name), true];
  }

  async _transcribe(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    let [p, temp] = this._audioPath(body);
    let out;
    try {
      if (this._row.audiocpp.family !== "qwen3_asr") {
        // Every other recogniser audio.cpp has (generated.js): the audio at 16 kHz mono, as
        // audio.cpp's own page sends a recogniser's (webui +page.svelte, stagedPath) — several
        // (OWSM, CrisperWhisper, MOSS-Transcribe-Diarize, Hviske v6) refuse any other rate
        // without libsoxr, which the release doesn't carry.
        const wav = readFileSync(p);
        const at16k = await self.asAudio16kMono(wav);
        if (at16k !== wav) {
          const name = path.join(os.tmpdir(), `tmp${Math.random().toString(36).slice(2, 10)}.wav`);
          writeFileSync(name, at16k);
          if (temp) rmSync(p, { force: true });
          [p, temp] = [fwd(name), true];
        }
      }
      out = await this._srv().transcribe(self.transcribeRequest(this._row, body, p), self._transcribeTimeout(p));
    } finally {
      if (temp) rmSync(p, { force: true });
    }
    // audio.cpp's recognisers report no confidence — null means UNKNOWN, never zero.
    return new _Resp(200, Buffer.alloc(0), null, { text: self.plainTranscript(this._row, out), confidence: null });
  }

  async _align(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    const aligner = (this._row.audiocpp.companions || []).find((c) => c.role === "aligner");
    if (aligner === undefined) return err(501, "this speech-recognition model has no word aligner");
    const wav = truthy(get(body, "audio_path"))
      ? readFileSync(body.audio_path)
      : Buffer.from(String(get(body, "wav_b64") || ""), "base64");
    const lang = String(get(body, "language") || "en").split("-")[0].toLowerCase();
    const srv = this._srv();
    const alignerId = `${this._row.id}::aligner`;
    if (srv.managed && !srv.hasModel(alignerId)) {
      await srv.register(self._entriesFor(this.manifest, this._row).find((e) => e.id === alignerId));
    }
    const out = await srv.align(alignerId, await self.asAudio16kMono(wav), get(body, "text") || "", get(ASR_LANGUAGE, lang) ?? "English");
    const words = (out.words || []).map((w) => ({
      word: get(w, "word", ""),
      start: Number(get(w, "start", 0.0)),
      end: Number(get(w, "end", 0.0)),
    }));
    return new _Resp(200, Buffer.alloc(0), null, { words });
  }
}

/** A recogniser's transcript: its response's `text` — or, where its family's file names the
 * response field holding the words without the model's own markup (`WORDS_FROM`:
 * MOSS-Transcribe-Diarize's timed speaker tags, VibeVoice-ASR Streaming's "Speaker 0:"), that
 * field's texts joined by a space, as audio.cpp joins VibeVoice-ASR's segments
 * (src/models/vibevoice_asr/postprocess.cpp:149-153); its `text` where that field is empty
 * (decided 2026-10-15, TASKS "Slice 2's acceptance findings" 3). */
export function plainTranscript(row, out) {
  const field = CURATED[row?.audiocpp?.family]?.WORDS_FROM;
  const parts = field ? (out?.[field] || []).map((t) => strip(String(t?.text || ""))).filter(Boolean) : [];
  return parts.length ? parts.join(" ") : strip(out?.text || "");
}

/** A transcription request for a recogniser's row (`/v1/audio/transcriptions/details` JSON):
 * `audio` the recording's path on this computer, and the language as the model takes it —
 * Qwen3-ASR's name for one of its 30 (anything else: detected), every other recogniser's in its
 * spec's form (`generatedTranscribeRequest`). */
export function transcribeRequest(row, body, audio) {
  if (row.audiocpp.family !== "qwen3_asr") return self.generatedTranscribeRequest(row, body, audio);
  const req = { model: row.id, audio };
  const lang = String(get(body, "language") || "").split("-")[0].toLowerCase();
  if (has(ASR_LANGUAGE, lang)) req.language = ASR_LANGUAGE[lang]; // anything else: detected
  return req;
}

/** How long a transcription may take (seconds): the request timeout setting (`floor`), or three
 * times the recording — speech recognition runs at about 2x real time on the CPU, so a fixed 600 s
 * timed out recordings longer than ~20 minutes (audit §5 D9). */
export function _transcribeTimeout(p, floor = runtime.requestTimeout()) {
  let seconds;
  try {
    // Python's `wave`: PCM (or extensible) only; frames = data bytes / block size.
    const b = readFileSync(p);
    if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return floor;
    let i = 12;
    let rate = 0;
    let block = 0;
    let fmtOk = false;
    while (i + 8 <= b.length) {
      const id = b.toString("latin1", i, i + 4);
      const n = b.readUInt32LE(i + 4);
      if (id === "fmt ") {
        const tag = b.readUInt16LE(i + 8);
        fmtOk = tag === 1 || tag === 0xfffe;
        rate = b.readUInt32LE(i + 12);
        block = b.readUInt16LE(i + 20);
      } else if (id === "data") {
        if (!fmtOk || !block) return floor;
        const frames = Math.floor(Math.min(n, b.length - i - 8) / block);
        seconds = frames / (rate || 1);
        break;
      }
      i += 8 + n + (n & 1);
    }
  } catch {
    return floor; // not a WAV the stdlib reads: the floor
  }
  if (seconds === undefined) return floor;
  return Math.max(floor, 3.0 * seconds);
}

export const ALIGN_RATE = 16_000; // the rate audio.cpp's Qwen3 aligner works at

// Names for the languages a refusal may need to say (Pocket TTS's five, plus the codes a line
// may carry); anything else is said as its code.
const LANG_WORDS = {
  en: "English", de: "German", it: "Italian", pt: "Portuguese", es: "Spanish",
  fr: "French", ja: "Japanese", zh: "Chinese", ru: "Russian", ko: "Korean",
};
const langWord = (code) => get(LANG_WORDS, code) ?? code;

/**
 * The aligner's input, at the aligner's own rate. audio.cpp v0.9.0's /v1/audio/alignments
 * turns sample positions into seconds with the INPUT rate: a 24 kHz render came back at 2/3
 * of its real word times (measured 2026-10-01). Sent at 16 kHz mono the seconds are right.
 * A WAV this parser can't read (not 16-bit PCM) goes as it is. Our builds fixed it (jv.1); an
 * install still on v0.9.0 needs this. The conversion runs in audiocpp_dsp (2026-10-07).
 */
export async function asAudio16kMono(wav) {
  let fmt;
  try {
    [fmt] = parseWavHeader(wav);
  } catch (e) {
    if (!(e instanceof ValueError)) throw e;
    log.warning(`aligner input left as it is (${e.message}) — word times may be scaled`);
    return wav;
  }
  if (fmt.sampleRate === ALIGN_RATE && fmt.channels === 1) return wav;
  return dspClient.alignerInput(wav, ALIGN_RATE);
}

const SILENCE = new Map();

/** `seconds` of 16 kHz silence — the recogniser's warm-up input (a third of a second) or its
 * calibration (its 30 s chunk). One file per length, written once per run. */
export function _silencePath(seconds = 1 / 3) {
  const frames = Math.trunc(seconds * 16000);
  let p = SILENCE.get(frames);
  if (p === undefined || !isFile(p)) {
    const f = path.join(os.tmpdir(), `justvoice-audiocpp-silence-${frames}.wav`);
    writeFileSync(f, writeWavContainer(Buffer.alloc(frames * 2), 16000, 1));
    p = fwd(f);
    SILENCE.set(frames, p);
  }
  return p;
}

// What a calibrating warm-up speaks (audit 2026-10-04 §13.3): ordinary narration, cut at a
// sentence end to the piece length the model is given — what its working memory reaches.
export const CALIBRATION_TEXT =
  "The ferry was late again, and nobody on the quay looked surprised. Marius set the lamp on " +
  "the table and counted the doors until the ninth. The fog came in over the pier before " +
  "either of them said a word, and the harbour went quiet. June leaned against the doorframe " +
  "with her arms crossed, watching the last of the light drain out of the sky, and said " +
  "nothing at all for a long while. When she finally spoke, it was to ask about the boats, " +
  "and whether the tide had turned, and whether anyone had thought to bring the lanterns in " +
  "from the far end of the pier. Nobody had. The boy went, grumbling, and came back with three " +
  "of them swinging from one hand and his collar turned up against the damp, and set them " +
  "down in a row by the door without being told. Outside, the bell on the channel buoy rang " +
  "twice and then fell silent, as if it too were waiting to see what the night would bring.";
/** audio.cpp's own piece budget for a family, in characters — it splits longer input itself, so a
 * calibrating piece is never longer (audit §5 D5): its spec's `text_chunk_size` default
 * (Chatterbox and Turbo 128, Kokoro 240, Kitten 400, Kitten TTS 2's 380, Breeze's 600) — null
 * where it gives none. (was: the first four copied here by hand — until the adoption plan's slice
 * 4, F10.) */
export function familyBudget(family) {
  const def = generated.requestOptionsOf(family).get("text_chunk_size")?.default;
  return Number.isFinite(Number(def)) && Number(def) > 0 ? Number(def) : null;
}

// The description a design model's warm-up speaks from — the words Qwen3 VoiceDesign's warm-up
// uses (it had none until 2026-10-04).
const WARM_DESCRIPTION = "A calm, clear narrator.";
// Speech recognition is calibrated with its own chunk of audio (`audio_chunk_seconds`, 30 s).
export const CALIBRATION_AUDIO_S = 30.0;

/** `CALIBRATION_TEXT` cut at a word to as close to `chars` characters as it goes — the memory
 * follows the length, so a piece cut short at a sentence end would under-measure. */
export function calibrationText(chars) {
  if (chars >= CALIBRATION_TEXT.length) return CALIBRATION_TEXT;
  const n = Math.max(40, chars);
  let head = CALIBRATION_TEXT.slice(0, n);
  if (CALIBRATION_TEXT.slice(n, n + 1) !== " ") {
    const i = head.lastIndexOf(" ");
    if (i >= 0) head = head.slice(0, i); // never half a word
  }
  head = rstrip(head, " ,;.");
  return head.length < n ? `${head}.` : `${head.slice(0, -1)}.`;
}

/**
 * Speak once now on `srv` (the server holding `row`'s model — a variant row; `kind` "tts" |
 * "stt"), so a Load means loaded and its memory is measured — audio.cpp loads lazily on a build
 * without `model_management`, and allocates a model's working buffers on its first line on any
 * build. `calibrateChars` > 0: this model has no price on the card yet, so the warm-up is a
 * FULL-LENGTH piece (`CALIBRATION_TEXT` cut to that length, never longer than audio.cpp's own
 * budget for the family; speech recognition gets its 30 s chunk of silence) and what the process
 * holds after it is this model's peak (audit 2026-10-04 §13.3). Returns whether it calibrated. A
 * model that speaks only from a clip (Chatterbox Multilingual, Qwen3 Base, Pocket TTS French)
 * warms on its first real line instead. The slot's Load and the kit's (kit_hooks.js `warm`) both
 * run it.
 *
 * A failure fails the Load with audio.cpp's own words (audit §5 B4).
 */
export async function warmModel(srv, row, kind, calibrateChars = 0) {
  const spec = row.audiocpp;
  const { family, task } = spec;
  const n = calibrateChars ? Math.min(calibrateChars, self.familyBudget(family) ?? calibrateChars) : 0;
  const text = n ? calibrationText(n) : "Ready.";
  const model = row.id;
  if (family === "kokoro_tts") {
    await srv.speech({ model, input: text, voice: "af_heart", language: "en-us", seed: 1 });
  } else if (family === "kitten_tts") {
    await srv.speech({ model, input: text, voice: "Leo" });
  } else if (family === "pocket_tts") {
    // In its default preset, alba. Pocket TTS French has none — it clones only (TASKS "Slice
    // 4's gaps" 2) — so it can't warm up, and its first line sets its price (§7 answer 5):
    // until 2026-10-16 it spoke alba, which the French download doesn't have, and the load failed.
    const voice = spec.voices?.[spec.default_voice];
    if (!voice) return false;
    await srv.speech({ model, input: text, voice, seed: 1 });
  } else if (family === "qwen3_tts" && task === "vdes") {
    // Designed from words, so it needs no clip (it had no warm-up until 2026-10-04).
    await srv.speech({ model, input: text, language: "English", seed: 1, instructions: "A calm, clear narrator." });
  } else if (family === "qwen3_tts" && task === "tts" && !spec.clone) {
    await srv.speech({ model, input: text, language: "English", seed: 1, options: { speaker: "Ryan" } });
  } else if (family === "qwen3_asr") {
    const seconds = calibrateChars ? CALIBRATION_AUDIO_S : 1 / 3;
    await srv.transcribe({ model, language: "English", audio: _silencePath(seconds) });
    return Boolean(calibrateChars);
  } else if (family === "voxcpm2") {
    // Designed, so it needs no clip. Without a warm-up the load measured nothing (197 ->
    // 197 MB) and the memory ledger booked 0 MB for a multi-GB model.
    await srv.speech({ model, input: `(A calm, clear voice)${text}`, seed: 1 });
  } else if (family === "chatterbox_turbo") {
    // Its built-in voice needs no clip, so a Load books its memory now rather than on the first
    // line.
    await srv.speech({ model, input: text, seed: 1 });
  } else if (spec.generated) {
    return await warmGenerated(srv, row, kind, text, n, calibrateChars);
  } else {
    return false;
  }
  return Boolean(n);
}

/**
 * A generated model's warm-up (the adoption plan's slice 2, M1). A recogniser hears silence, as
 * Qwen3-ASR does. A speech model that can speak without a clip speaks the piece — in its default
 * built-in voice (the spec's own), in its one voice, or from a description — through the same
 * request a line takes, so a first load measures its memory as the seven engines described by
 * our own files have always done theirs (`warmModel`). A
 * model that speaks only from a clip can't: its price is saved after its first line instead
 * (§7 answer 5; manager.load). Returns whether it calibrated.
 */
async function warmGenerated(srv, row, kind, text, n, calibrateChars) {
  const spec = row.audiocpp;
  if (kind === "stt") {
    const seconds = calibrateChars ? CALIBRATION_AUDIO_S : 1 / 3;
    await srv.transcribe({ model: row.id, audio: _silencePath(seconds) });
    return Boolean(calibrateChars);
  }
  let body;
  if (spec.default_voice) {
    body = { voice_id: spec.default_voice, text, seed: 1 };
  } else if (spec.design) {
    body = { text, seed: 1, delivery: { instruct: spec.design_example || WARM_DESCRIPTION } };
  } else {
    return false;
  }
  await srv.speech(self.toSpeechRequest(row, body));
  return Boolean(n);
}

// ─── Our request → audio.cpp's (plan §3.4) ──────────────────────────────────

export const JAPANESE_DICTIONARY_MISSING =
  "Japanese needs the Japanese dictionary — install it on AI Settings → Speech engines.";

/** Kokoro's Japanese voices and Chatterbox in Japanese read MeCab's UniDic dictionary — the
 * optional download on the runtime row (gap 7); without it, refused by name. */
function requireJapaneseDictionary() {
  if (japanese.dictionaryDir(manager.enginesRuntimeRoot()) === null) throw new AudioCppError(JAPANESE_DICTIONARY_MISSING);
}

const PAREN_RE = new RegExp(`${S}*\\(${S}*|${S}*\\)${S}*`, "gu");
const DASH_RUN_RE = new RegExp(`(?:${S}*—${S}*){2,}`, "gu");

/** Kokoro's phoneme symbols, from this row's own model file (`ipa.vocabOf`) — null when it can't
 * be read, and the runtime then names a symbol it lacks, as before. */
export function kokoroVocab(row) {
  try {
    return vocabOf(path.join(String(speechCache.variantDir(self._dataDir(), "kokoro", row.id)), row.audiocpp.file));
  } catch {
    return null;
  }
}

/** A manager synth body (a `SynthRequest` as a snake_case object) → `/v1/audio/speech` JSON. */
export function toSpeechRequest(row, body) {
  const spec = row.audiocpp;
  const family = spec.family;
  const delivery = get(body, "delivery") || {};
  const knobs = get(delivery, "engine") || {};
  const lang = String(get(body, "language") || "").toLowerCase();
  const req = { model: row.id, input: get(body, "text") || "" };
  // No seed — or 0, which the seed control calls random — is a new take each time. audio.cpp's
  // own "no seed" is not random everywhere: Kokoro and Kitten keep the session's seed, Turbo a
  // fixed one, VoxCPM2 1234 (audit §5 D1), so a random one is sent. A description voice never
  // arrives here without one (render_core.description_seed).
  const seed = unwrap(get(body, "seed"));
  const noSeed = seed == null || seed === "" || seed === "0" || seed === 0 || seed === false;
  req.seed = noSeed ? 1 + Math.floor(Math.random() * (2 ** 31 - 1)) : pyInt(seed);

  // The seven engines described by our own files keep their own requests (the adoption plan §2:
  // the code a model truly needs, in its family's branch); every other model's is built from its
  // spec (`generatedSpeechRequest`, at the end).
  if (family === "kokoro_tts") {
    const voice = get(body, "voice_id") || spec.default_voice || "af_heart";
    const own = kokoroLanguageOf(voice);
    // A preset's own language is its id's; a blend's rides `voice_language`, which render and
    // preview pass (decided 2026-10-15, F11) — so a line in a language Kokoro lacks is read in the
    // voice's own, a blend's too.
    const voiceLang = String(own !== null ? own : get(body, "voice_language") || "en-us").toLowerCase();
    req.voice = voice;
    const key = lang || voiceLang;
    // A language Kokoro doesn't speak goes as none: audio.cpp then uses the voice's own (its
    // spec: "defaults to the selected voice prefix"), not US English (the narrowings review, F11).
    const language = get(KOKORO_LANGUAGE, key) ?? get(KOKORO_LANGUAGE, key.split("-")[0]);
    if (language) req.language = language;
    if (voiceLang.startsWith("ja") && !truthy(get(body, "voice_pack_path"))) requireJapaneseDictionary();
    if (truthy(get(delivery, "ipa_map"))) {
      // A lexicon's IPA: the words it covers ride as "[word](/phonemes/)" (gap 3). The host
      // sends an ipa_map only when the installed runtime splices (render_core). A word whose
      // pronunciation uses a symbol Kokoro lacks is read the normal way, not refused with its
      // line (decided 2026-10-15, F12).
      req.input = splice(req.input, delivery.ipa_map, self.kokoroVocab(row));
    }
    const opts = {};
    if (truthy(get(body, "voice_pack_path"))) {
      // A blend: its pack rides `voice_pack`; the voice id only picks the language and the
      // G2P, so it is the first preset that speaks the blend's language — the line's, or the
      // voice's own when Kokoro doesn't speak the line's.
      opts.voice_pack = fwd(body.voice_pack_path);
      const want = language ?? get(KOKORO_LANGUAGE, voiceLang) ?? get(KOKORO_LANGUAGE, voiceLang.split("-")[0]) ?? voiceLang;
      const first = generated.kokoroVoices().find(([, lg]) => (get(KOKORO_LANGUAGE, lg.toLowerCase()) ?? lg.toLowerCase()) === want);
      req.voice = first ? first[0] : "af_heart";
    }
    if (truthy(get(delivery, "speed"))) req.speed = pyFloatParse(delivery.speed);
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "qwen3_tts") {
    // A language Qwen3 doesn't speak goes as "Auto" (it detects, and a CustomVoice speaker
    // keeps its own dialect) — not "English", which forced the English token (audit §5 D6).
    const base = lang.split("-")[0] || "en";
    req.language = get(QWEN_LANGUAGE, base) ?? "Auto";
    const opts = {};
    const temperature = has(delivery, "temperature") ? delivery.temperature : get(knobs, "talker_temperature");
    for (const [ours, theirs, cast] of [
      ["talker_top_k", "top_k", pyIntOf],
      ["talker_top_p", "top_p", pyFloatParse],
      ["repetition_penalty", "repetition_penalty", pyFloatParse],
      ["subtalker_temperature", "subtalker_temperature", pyFloatParse],
      ["subtalker_top_k", "subtalker_top_k", pyIntOf],
      ["subtalker_top_p", "subtalker_top_p", pyFloatParse],
    ]) {
      if (get(knobs, ours) != null) opts[theirs] = cast(knobs[ours]);
    }
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, pyFloatParse(temperature));
    // A top-p of 0 is "no filter" and a sampling temperature of 0 is refused (audit §5 D4, D9).
    for (const key of ["top_p", "subtalker_top_p", "subtalker_temperature"]) {
      if (key in opts) opts[key] = Math.max(MIN_SAMPLING, opts[key]);
    }
    const instruct = strip(get(delivery, "instruct") || get(knobs, "instruct") || "");
    if (spec.task === "vdes") {
      if (!instruct) throw new AudioCppError("VoiceDesign renders from a voice description and this voice has none");
      req.instructions = instruct;
    } else if (truthy(get(body, "audio_prompt_path"))) {
      if (!spec.clone) throw new AudioCppError("the CustomVoice model cannot clone — use a Base model for this voice");
      req.voice_ref = fwd(self.guardedReference(body.audio_prompt_path));
      // audio.cpp clones a Base voice in ICL mode (the clip and what it says) unless
      // `x_vector_only_mode` asks for the speaker vector alone, and ICL without a transcript
      // is refused — so a clip with neither is refused here, by name (decided 2026-10-03).
      if (truthy(get(body, "xvector_only"))) opts.x_vector_only_mode = true;
      else if (truthy(get(body, "ref_text"))) req.reference_text = body.ref_text;
      else throw new AudioCppError("Qwen3 Base needs what the clip says — type the transcript, or tick Skip the words.");
    } else {
      if (spec.clone) throw new AudioCppError("the Base model is clone-only — this voice needs a reference clip");
      opts.speaker = get(body, "voice_id");
      if (instruct) opts.instruct = instruct;
    }
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  // Kitten's and Pocket's voices: our id → audio.cpp's name (the row's `voices`, from the spec and
  // our file); anything else speaks the spec's default voice (Kitten's Leo, Pocket's alba).
  const builtIn = (voiceId) => get(spec.voices || {}, voiceId || "") ?? get(spec.voices || {}, spec.default_voice || "");
  if (family === "kitten_tts") {
    req.voice = builtIn(get(body, "voice_id")) ?? "Leo";
    if (truthy(get(delivery, "speed"))) req.speed = pyFloatParse(delivery.speed);
    return req;
  }

  if (family === "pocket_tts") {
    // One model per language: a line in another language is refused by name, as Qwen3
    // refuses the wrong checkpoint (docs/plans/2026-10-02-cpu-placement.md §8).
    const speaks = (row.languages || []).map((x) => String(x).split("-")[0].toLowerCase());
    const base = lang.split("-")[0];
    if (base && speaks.length && !speaks.includes(base)) {
      throw new AudioCppError(
        `the loaded ${row.name ?? "Pocket TTS"} model speaks ${langWord(speaks[0])}, and ` +
          `this line is ${langWord(base)} — load the ${langWord(base)} Pocket TTS model for it`,
      );
    }
    if (truthy(get(body, "audio_prompt_path"))) req.voice_ref = fwd(body.audio_prompt_path);
    else if (!Object.keys(spec.voices || {}).length) {
      // French has no preset of ours: it clones only (decided 2026-10-16, TASKS "Slice 4's gaps" 2).
      throw new AudioCppError(`${row.name ?? "Pocket TTS"} speaks only cloned voices — this voice has no reference clip`);
    } else req.voice = builtIn(get(body, "voice_id")) ?? "alba";
    return req;
  }

  if (family === "chatterbox") {
    if (!truthy(get(body, "audio_prompt_path"))) {
      throw new AudioCppError("Chatterbox speaks only cloned voices — this voice has no reference clip");
    }
    req.voice_ref = fwd(body.audio_prompt_path);
    req.language = lang.split("-")[0] || "en";
    if (req.language === "ja") requireJapaneseDictionary();
    const opts = {};
    for (const [ours, theirs] of [
      ["exaggeration", "exaggeration"],
      ["cfg_weight", "guidance_scale"],
      ["repetition_penalty", "repetition_penalty"],
      ["top_p", "top_p"],
      ["min_p", "min_p"],
      ["s3gen_cfg_rate", "s3gen_cfg_rate"],
    ]) {
      if (get(knobs, ours) != null) opts[theirs] = pyFloatParse(knobs[ours]);
    }
    const temperature = has(delivery, "temperature") ? delivery.temperature : get(knobs, "temperature");
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, pyFloatParse(temperature));
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "chatterbox_turbo") {
    // Turbo and Nano (gap 1): English; a cloned voice — our audio.cpp needs a clip longer than
    // 5 s and refuses a shorter one by name — or the model's own voice, sent as no voice (the
    // adoption plan's F4; audio.cpp's own Turbo package has only that one). Exaggeration / CFG /
    // min-p do nothing on Turbo, so only its own sampling knobs are sent.
    if (truthy(get(body, "audio_prompt_path"))) {
      if (spec.clone === false) throw new AudioCppError(`${row.name ?? "Chatterbox Turbo"} doesn't copy a voice from a clip`);
      req.voice_ref = fwd(body.audio_prompt_path);
    } else if (!has(spec.voices, get(body, "voice_id"))) {
      // Since F4 a cloned voice or the model's own; audio.cpp's package only its own (decided
      // 2026-10-16, TASKS "Slice 4's gaps" 5).
      const speaks = spec.clone === false ? "only its own built-in voice" : "only a cloned voice or its own built-in one — this voice has no reference clip";
      throw new AudioCppError(`${row.name ?? "Chatterbox Turbo"} speaks ${speaks}`);
    }
    const opts = {};
    for (const key of ["repetition_penalty", "top_p"]) {
      if (get(knobs, key) != null) opts[key] = pyFloatParse(knobs[key]);
    }
    if (get(knobs, "top_k") != null) opts.top_k = pyIntOf(knobs.top_k);
    const temperature = has(delivery, "temperature") ? delivery.temperature : get(knobs, "temperature");
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, pyFloatParse(temperature));
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "voxcpm2") {
    // One model clones (the clip) and designs (a description). VoxCPM2 takes a description, or
    // a line's direction on a clone, as a parenthesised prefix on the text, which audio.cpp
    // splits off and does not speak (manifest header).
    const instruct = splitWs(get(delivery, "instruct") || get(knobs, "instruct") || "").join(" ");
    if (truthy(get(body, "audio_prompt_path"))) {
      req.voice_ref = fwd(body.audio_prompt_path);
      // Reaches the model once our copy of audio.cpp passes the clip as prompt audio. The clip's
      // words make it VoxCPM2's Hi-Fi cloning, which its authors say ignores the instruction
      // ("When Hi-Fi mode is enabled, the control instruction is ignored") — ours read it aloud
      // (RESEARCH §10.6, §10.8). So a line with direction sends the clip alone (decided
      // 2026-10-11); a plain line keeps the closer clone.
      if (truthy(get(body, "ref_text")) && !instruct) req.reference_text = body.ref_text;
    } else if (!instruct) {
      throw new AudioCppError("VoxCPM2 speaks a cloned voice or a designed one — this voice has neither a reference clip nor a description");
    }
    // VoxCPM2 treats ANY parenthesised text as direction and does not speak it — mid-line too
    // ("He left (quietly) and…" came back without "quietly", 2026-10-02). The line's own
    // brackets become dashes so its words are spoken; only our tag uses brackets.
    let text = String(req.input).replace(PAREN_RE, " — ");
    text = strip(text.replace(DASH_RUN_RE, " — "), " —");
    if (instruct) text = `(${instruct.replaceAll("(", "").replaceAll(")", "")})${text}`;
    req.input = text;
    const opts = {};
    if (get(knobs, "cfg_value") != null) opts.guidance_scale = pyFloatParse(knobs.cfg_value);
    if (get(knobs, "inference_timesteps") != null) opts.num_inference_steps = pyIntOf(knobs.inference_timesteps);
    if (get(knobs, "retry_badcase_max_times") != null) opts.retry_badcase_max_times = Math.max(1, pyIntOf(knobs.retry_badcase_max_times));
    if (get(knobs, "retry_badcase_ratio_threshold") != null) {
      opts.retry_badcase_ratio_threshold = pyFloatParse(knobs.retry_badcase_ratio_threshold);
    }
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  // Every other speech model audio.cpp has (engines/audiocpp/generated.js).
  if (spec.generated) return self.generatedSpeechRequest(row, body, req);

  throw new AudioCppError(`no speech mapping for the ${family} family`);
}

/**
 * A generated model's request (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4): the voice —
 * a clip (a cloned voice), one of the model's built-in voices as audio.cpp names it, or a
 * description (a designed voice, in the option the spec's voice design takes it; the adoption
 * plan's slice 2) — the line's direction as the family's file says to give it
 * (`curated/<family>.js`); the clip's words where the spec takes them and the direction allows;
 * the language and the seed where the spec lists them; and the model's settings, checked against
 * the spec's types. A family whose spec lists its options gets only those — audio.cpp refuses
 * others there (RESEARCH §10.6).
 */
export function generatedSpeechRequest(row, body, req) {
  const spec = row.audiocpp;
  const family = spec.family;
  const delivery = get(body, "delivery") || {};
  const knobs = get(delivery, "engine") || {};
  const specOpts = generated.requestOptionsOf(family);
  const listed = specOpts.size > 0;
  const curated = CURATED[family] ?? null;
  const name = row.name || family;
  const words = splitWs(get(delivery, "instruct") || "").join(" ");
  const voices = spec.voices || {};
  const voiceId = get(body, "voice_id");
  const clip = truthy(get(body, "audio_prompt_path"));
  const builtin = !clip && voiceId != null && Object.hasOwn(voices, voiceId);

  // The voice. A clip wins (a cloned voice, or a design kept as a take); then a built-in voice;
  // then a description, on a model that makes a voice from words.
  const options = {};
  let designed = false;
  if (clip) {
    if (spec.clone === false) throw new AudioCppError(`${name} doesn't copy a voice from a clip`);
    req.voice_ref = fwd(body.audio_prompt_path);
  } else if (builtin) {
    // audio.cpp's name for it, as its own web UI sends a built-in voice (`voice`); a model's one
    // voice goes as none — the model's default.
    if (voices[voiceId]) req.voice = voices[voiceId];
  } else if (spec.design) {
    if (!words) {
      throw new AudioCppError(
        spec.clone
          ? `${name} speaks a cloned voice or a designed one — this voice has neither a reference clip nor a description`
          : `${name} renders from a voice description and this voice has none`,
      );
    }
    // The description — with whatever direction the line composed onto it, as Qwen3 VoiceDesign
    // takes it — in the option the spec's voice design takes, with the voice-design entry's own
    // template (FireRed's `voice_design`); a spec that names neither option gets it as the
    // request's `instructions`, as audio.cpp's own Voice design tab sends it.
    designed = true;
    const option = generated.designOptionOf(family);
    Object.assign(options, spec.design);
    if (option) options[option] = words;
    else req.instructions = words;
  } else if (spec.clone === false) {
    throw new AudioCppError(`${name} speaks only its built-in voices — this voice isn't one of them`);
  } else {
    throw new AudioCppError(`${name} speaks only cloned voices — this voice has no reference clip`);
  }

  // The line's direction as the family's file says to give it — on a cloned or built-in voice; a
  // designed voice's description already carries it.
  const dir = generated.applyDirection(designed ? null : (curated?.DIRECTION ?? null), { emotion: get(delivery, "emotion"), words });
  // A setting saved under a name audio.cpp has since renamed goes under its new name.
  const shown = generated.settingsByModel(spec.model);
  for (const [k, v] of Object.entries(generated.currentOptionNames(family, knobs))) {
    // Never one the app sets itself or the family's file hides, even saved before it was hidden.
    if (!generated.isSetting(family, k)) continue;
    const opt = specOpts.get(k);
    if (listed && !opt) continue;
    // A number is kept to the ends its control shows — audio.cpp's control list's, else the
    // spec's (generated.settingsOf) — so what is sent is what was set.
    const knob = shown.get(k);
    const ends = knob?.type === "number" ? { min: knob.min, max: knob.max } : {};
    const value = opt ? generated.coerceOption({ ...opt, ...ends }, v) : v;
    if (value !== undefined) options[k] = value;
  }
  // A required setting the line leaves unset goes at audio.cpp's own default (Maya1's voice
  // description).
  for (const [k, v] of Object.entries(generated.requiredDefaultsOf(family))) if (!Object.hasOwn(options, k)) options[k] = v;
  // The direction's options; the defaults it brings (Breeze's guidance) yield to the model's
  // settings.
  Object.assign(options, dir.options);
  for (const [k, v] of Object.entries(dir.defaults)) if (!Object.hasOwn(options, k)) options[k] = v;
  if (clip) {
    // The clip's words: to a spec that lists them, and to one that lists no options at all, whose
    // own code reads what it reads — OmniVoice needs them, Higgs takes them (decided 2026-10-12).
    const hasWords = truthy(get(body, "ref_text")) && (!listed || specOpts.has("reference_text"));
    if (!dir.directed && curated?.PLAIN) {
      Object.assign(options, hasWords ? curated.PLAIN.with_reference_text : curated.PLAIN.without_reference_text);
    }
    if (hasWords && !dir.dropReferenceText) req.reference_text = body.ref_text;
  }

  // The line's language — none where the model's own languages (its family file's) leave it out.
  // A family whose session reads it only from the request's options gets it there (its file's
  // LANGUAGE_IN_OPTIONS: MOSS's three by name, IndexTTS2 as its code — a top-level language
  // reaches only the request's text, app/server/server_protocol.cpp:72-75; decided 2026-10-15,
  // TASKS "Slice 2's acceptance findings" 7); every other family at the top level.
  const language = generatedLanguage(family, get(body, "language"), spec.languages ?? null);
  const inOptions = curated?.LANGUAGE_IN_OPTIONS;
  if (language !== undefined && inOptions === "name") {
    const named = get(QWEN_LANGUAGE, String(language).toLowerCase().split("-")[0]);
    if (named) options.language = named;
  } else if (language !== undefined && inOptions) options.language = language;
  else if (language !== undefined) req.language = language;
  if (listed && !specOpts.has("seed")) delete req.seed;
  if (dir.prefix) req.input = `${dir.prefix}${req.input}`;
  // A speaker script (its family file's SPEAKER_SCRIPT): each line of the text, and of the clip's
  // words, as the voice's line in it — VibeVoice's "Speaker 1: …", MOSS-TTSD's "[S1] …" (decided
  // 2026-10-15, "Slice 2's acceptance findings" 1).
  if (curated?.SPEAKER_SCRIPT) {
    req.input = self.asSpeakerScript(curated.SPEAKER_SCRIPT, req.input);
    if (req.reference_text) req.reference_text = self.asSpeakerScript(curated.SPEAKER_SCRIPT, req.reference_text);
  }
  if (Object.keys(options).length) req.options = options;
  return req;
}

/** `text` as the voice's lines in a family's speaker script: each non-empty line through
 * `template`'s `{text}` — VibeVoice drops a line without "Speaker N:"
 * (../audio.cpp/src/models/vibevoice/tokenizer_text.cpp:48-83), MOSS-TTSD reads `[S1]` as the
 * first speaker (docs/models/moss_ttsd.md:20-21). A line's own `$&` stays as written. */
export function asSpeakerScript(template, text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => template.replace("{text}", () => l))
    .join("\n");
}

/** A line's language (a code: "en", "en-US") in the form a generated model's spec takes it — one
 * of its option's values, the English name where its default is a name ("Chinese", FireRedTTS3),
 * or a code its family's languages list (`listedLanguage`) — or undefined where its spec lists no
 * language option, the line has none, or the family lists it in no form it takes: the model then
 * picks it, as its spec says an omitted language does (OmniVoice takes Arabic only as `arb`, `arz`
 * … and its spec lists no codes; it refused `ar`). `languages`: the model's own, where its family
 * file gives them (generated.languagesOf) — a line in none of them goes without one (LFM2.5-Audio
 * JP given English); the form stays the family's (VoiceTut-TTS's `ar-EG` is the app's tag, not one
 * OmniVoice takes). */
export function generatedLanguage(family, language, languages = null) {
  const langSpec = generated.requestOptionsOf(family).get("language");
  const code = String(language || "").toLowerCase().split("-")[0];
  if (!langSpec || !code) return undefined;
  if (languages && !languages.some((l) => String(l).toLowerCase().split("-")[0] === code)) return undefined;
  const name = get(QWEN_LANGUAGE, code);
  if (Array.isArray(langSpec.values) && langSpec.values.length) {
    return langSpec.values.find((v) => String(v).toLowerCase() === code || (name && String(v).toLowerCase() === name.toLowerCase()));
  }
  if (/^[A-Z][a-z]+$/.test(String(langSpec.default || ""))) return name ?? undefined;
  return self.listedLanguage(family, language);
}

/** The form a family's language list (audio.cpp's spec) names a language in: the exact code, its
 * base (`en` for `en-US`), or the one region it lists (`en-GB` for `en`) — undefined when it lists
 * none, or several regions and none exactly. */
export function listedLanguage(family, language) {
  const want = String(language || "").toLowerCase();
  const code = want.split("-")[0];
  if (!code) return undefined;
  const listed = (generated.catalogFamily(family)?.languages || []).map(String);
  const exact = listed.find((l) => l.toLowerCase() === want);
  const base = listed.find((l) => l.toLowerCase() === code);
  const region = listed.filter((l) => l.toLowerCase().split("-")[0] === code);
  return exact ?? base ?? (region.length === 1 ? region[0] : undefined);
}

/**
 * A generated recogniser's request (the adoption plan's slice 2, E1): the audio, and the language
 * where the spec takes one, in a form the spec lists — one of its option's values; the English
 * name where its default is a name (Confucius4's "Auto"); else a code the family's languages list
 * (`en`, or `en-US` where it lists regions). A language it lists in no form it takes (OWSM's
 * three-letter codes) goes as none: the model detects it, or uses its own default.
 */
export function generatedTranscribeRequest(row, body, audio) {
  const family = row.audiocpp.family;
  const req = { model: row.id, audio };
  const langSpec = generated.requestOptionsOf(family).get("language");
  const want = String(get(body, "language") || "").toLowerCase();
  if (!langSpec || !want) return req;
  const code = want.split("-")[0];
  const name = get(ASR_LANGUAGE, code);
  if (Array.isArray(langSpec.values) && langSpec.values.length) {
    const hit = langSpec.values.find((v) => [want, code, name?.toLowerCase()].includes(String(v).toLowerCase()));
    if (hit !== undefined) req.language = hit;
    return req;
  }
  if (/^[A-Z][a-z]+$/.test(String(langSpec.default || ""))) {
    if (name) req.language = name;
    return req;
  }
  const hit = self.listedLanguage(family, want);
  if (hit !== undefined) req.language = hit;
  return req;
}
