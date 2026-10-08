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
import { getLogger } from "@delebash/llm-runner/platform/log";
import { cmp, pyFloatParse, pyInt, rstrip, RuntimeError, splitWs, S, strip, truthy, ValueError } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as appState from "../../app_state.js";
import * as dspClient from "../../audio/dsp_client.js";
import { parseWavHeader, writeWavContainer } from "../../audio/wav.js";
import * as speechCache from "../../speech_cache.js";
import { splice } from "../kokoro/ipa.js";
import { VOICES } from "../kokoro/voices.js";
import { AUDIOCPP_VOICE as KITTEN_VOICE } from "../kitten/manifest.js";
import { AUDIOCPP_VOICE as POCKET_VOICE } from "../pocket/manifest.js";
import * as manager from "../manager.js";
import * as espeak from "./espeak.js";
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
// A stored value may be a PyFloat (a float kept for Python's text) — read as its number.
const num = (v) => (v instanceof PyFloat ? v.v : v);
const t = (v) => (v instanceof PyFloat ? v.v !== 0 : truthy(v));
const toInt = (v) => pyInt(num(v));
const toFloat = (v) => pyFloatParse(num(v));
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

// How many blend packs stay on disk (a test assigns it — Python monkeypatched the global).
export const cfg = { VOICE_PACKS_KEPT: 200 };
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
  const values = Array.from(vector, (v) => Number(num(v)));
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
  const packs = readdirSync(folder)
    .filter((n) => n.endsWith(".bin"))
    .map((n) => {
      const p = path.join(folder, n);
      return [p, statSync(p).mtimeMs];
    })
    .sort((a, b) => b[1] - a[1]);
  for (const [old] of packs.slice(cfg.VOICE_PACKS_KEPT)) rmSync(old, { force: true });
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

/** The runtime entries a row registers: its model, then its companions (`<id>::<role>`). */
export function _entriesFor(manifest, row) {
  const spec = row.audiocpp;
  const vdir = speechCache.variantDir(self._dataDir(), manifest.id, row.id);
  const opts = { ...(spec.session_options || {}) };
  // The options the user set on the model's row (audit §13.5, 5h).
  Object.assign(opts, runtimeOptions.sessionOptionsFor(manifest.id, row));
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
  const out = [new ModelEntry(row.id, spec.family, spec.task, path.join(String(vdir), spec.file), pairs)];
  for (const comp of spec.companions || []) {
    out.push(new ModelEntry(`${row.id}::${comp.role}`, comp.family, comp.task, path.join(String(vdir), comp.file)));
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
  if (t(get(body, "voice_vector"))) out.push("voice_pack");
  if (family === "chatterbox_turbo") out.push("turbo_clone");
  if (family === "kokoro_tts") {
    const hit = VOICES.find(([vid]) => vid === get(body, "voice_id"));
    const voiceLang = hit ? hit[2] : "";
    if ((lang || voiceLang.toLowerCase()).startsWith("ja")) out.push("japanese");
  }
  if (family === "chatterbox") {
    if (["he", "ru", "zh"].includes(lang)) out.push("chatterbox_he_ru_zh");
    else if (lang === "ja") out.push("japanese");
  }
  if (family === "voxcpm2" && t(get(body, "audio_prompt_path")) && t(get(body, "ref_text"))) out.push("voxcpm2_transcript");
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
    if (this._row !== null && srv.isRunning() && srv.pid === this._generation) {
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
    const calibrated = await this._warm(toInt(get(body, "calibrate_chars") || 0));
    return new _Resp(200, Buffer.alloc(0), null, {
      ok: true,
      variant: row.id,
      calibrated,
      voices: [...this.manifest.staticVoices],
    });
  }

  /**
   * Speak once now, so a Load means loaded and its memory is measured — audio.cpp loads lazily
   * on a build without `model_management`, and allocates a model's working buffers on its
   * first line on any build. `calibrateChars` > 0: this model has no price on the card yet,
   * so the warm-up is a FULL-LENGTH piece (`CALIBRATION_TEXT` cut to that length, never longer
   * than audio.cpp's own budget for the family; speech recognition gets its 30 s chunk of
   * silence) and what the process holds after it is this model's peak (audit 2026-10-04
   * §13.3). Returns whether it calibrated. A family that speaks only from a clip (Chatterbox
   * Multilingual, Qwen3 Base) warms on its first real line instead.
   *
   * A failure fails the Load with audio.cpp's own words (audit §5 B4).
   */
  async _warm(calibrateChars = 0) {
    const spec = this._row.audiocpp;
    const { family, task } = spec;
    const n = calibrateChars ? Math.min(calibrateChars, get(FAMILY_BUDGET, family) ?? calibrateChars) : 0;
    const text = n ? calibrationText(n) : "Ready.";
    const model = this._row.id;
    const srv = this._srv();
    if (family === "kokoro_tts") {
      await srv.speech({ model, input: text, voice: "af_heart", language: "en-us", seed: 1 });
    } else if (family === "kitten_tts") {
      await srv.speech({ model, input: text, voice: "Leo" });
    } else if (family === "pocket_tts") {
      await srv.speech({ model, input: text, voice: "alba", seed: 1 });
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
      // The app offers Turbo's cloned voices only, but its built-in voice needs no clip, so a
      // Load books its memory now rather than on the first line.
      await srv.speech({ model, input: text, seed: 1 });
    } else {
      return false;
    }
    return Boolean(n);
  }

  // -- /synth --

  async _synth(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    if (t(get(body, "voice_vector")) && this._row.audiocpp.family !== "kokoro_tts") {
      return err(422, `${this.manifest.name} has no blended voices — blends are Kokoro's`);
    }
    // What this line needs from the INSTALLED build (the CPU process runs the same one), each
    // refused by name before audio.cpp fails inside or ignores it (audit §5 E1).
    for (const feature of self.featuresNeeded(this._row, body)) {
      if (!runtime.hasFeature(feature)) return err(409, self.featureRefusal(feature));
    }
    if (t(get(body, "voice_vector"))) body = { ...body, voice_pack_path: String(self.writeVoicePack(body.voice_vector)) };
    const terms = this.manifest.module?.TERMS;
    if (terms && terms.gates === "cloning" && t(get(body, "audio_prompt_path")) && !self.termsAccepted(this.manifest.id)) {
      return new _Resp(403, Buffer.alloc(0), null, {
        detail:
          `${this.manifest.name} clones a voice only after you accept ${terms.owner ?? "its makers"}'s terms — ` +
          `open Voices → Clone with ${this.manifest.name}, or AI Settings → Speech engines, to read and accept them.`,
        code: TERMS_REQUIRED,
        engine: this.manifest.id,
      });
    }
    const req = self.toSpeechRequest(this._row, body);
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
    if (t(get(body, "audio_path"))) return [fwd(body.audio_path), false];
    const raw = Buffer.from(String(get(body, "wav_b64") || ""), "base64"); // before the file: a bad upload leaves none
    const name = path.join(os.tmpdir(), `tmp${Math.random().toString(36).slice(2, 10)}.wav`);
    writeFileSync(name, raw);
    return [fwd(name), true];
  }

  async _transcribe(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    const [p, temp] = this._audioPath(body);
    let out;
    try {
      const req = { model: this._row.id, audio: p };
      const lang = String(get(body, "language") || "").split("-")[0].toLowerCase();
      if (has(ASR_LANGUAGE, lang)) req.language = ASR_LANGUAGE[lang]; // anything else: detected
      out = await this._srv().transcribe(req, self._transcribeTimeout(p));
    } finally {
      if (temp) rmSync(p, { force: true });
    }
    // audio.cpp's recognisers report no confidence — null means UNKNOWN, never zero.
    return new _Resp(200, Buffer.alloc(0), null, { text: strip(out.text || ""), confidence: null });
  }

  async _align(body) {
    if (!this.isAlive() || this._row === null) return err(409, `${this.manifest.name} is not loaded`);
    const aligner = (this._row.audiocpp.companions || []).find((c) => c.role === "aligner");
    if (aligner === undefined) return err(501, "this speech-recognition model has no word aligner");
    const wav = t(get(body, "audio_path"))
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

/** How long a transcription may take (seconds): the request timeout setting, or three times
 * the recording — speech recognition runs at about 2x real time on the CPU, so a fixed 600 s
 * timed out recordings longer than ~20 minutes (audit §5 D9). */
export function _transcribeTimeout(p) {
  const floor = runtime.requestTimeout();
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
// audio.cpp's own piece budget for a family, in characters — it splits longer input itself,
// so a calibrating piece is never longer (Chatterbox and Turbo session.cpp, Kokoro and Kitten
// frontends; audit §5 D5).
export const FAMILY_BUDGET = { chatterbox: 128, chatterbox_turbo: 128, kokoro_tts: 240, kitten_tts: 400 };
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
  const seed = num(get(body, "seed"));
  const noSeed = seed == null || seed === "" || seed === "0" || seed === 0 || seed === false;
  req.seed = noSeed ? 1 + Math.floor(Math.random() * (2 ** 31 - 1)) : pyInt(seed);

  if (family === "kokoro_tts") {
    const voice = get(body, "voice_id") || "af_heart";
    const hit = VOICES.find(([vid]) => vid === voice);
    const voiceLang = (hit ? hit[2] : "en-us").toLowerCase();
    req.voice = voice;
    const key = lang || voiceLang;
    req.language = get(KOKORO_LANGUAGE, key) ?? get(KOKORO_LANGUAGE, key.split("-")[0]) ?? "en-us";
    if (voiceLang.startsWith("ja") && !t(get(body, "voice_pack_path"))) requireJapaneseDictionary();
    if (t(get(delivery, "ipa_map"))) {
      // A lexicon's IPA: the words it covers ride as "[word](/phonemes/)" (gap 3). The host
      // sends an ipa_map only when the installed runtime splices (render_core).
      req.input = splice(req.input, delivery.ipa_map);
    }
    const opts = {};
    if (t(get(body, "voice_pack_path"))) {
      // A blend: its pack rides `voice_pack`; the voice id only picks the language and the
      // G2P, so it is the first preset that speaks the blend's language.
      opts.voice_pack = fwd(body.voice_pack_path);
      const first = VOICES.find(([, , lg]) => (get(KOKORO_LANGUAGE, lg.toLowerCase()) ?? lg.toLowerCase()) === req.language);
      req.voice = first ? first[0] : "af_heart";
    }
    if (t(get(delivery, "speed"))) req.speed = toFloat(delivery.speed);
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
      ["talker_top_k", "top_k", toInt],
      ["talker_top_p", "top_p", toFloat],
      ["repetition_penalty", "repetition_penalty", toFloat],
      ["subtalker_temperature", "subtalker_temperature", toFloat],
      ["subtalker_top_k", "subtalker_top_k", toInt],
      ["subtalker_top_p", "subtalker_top_p", toFloat],
    ]) {
      if (get(knobs, ours) != null) opts[theirs] = cast(knobs[ours]);
    }
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, toFloat(temperature));
    // A top-p of 0 is "no filter" and a sampling temperature of 0 is refused (audit §5 D4, D9).
    for (const key of ["top_p", "subtalker_top_p", "subtalker_temperature"]) {
      if (key in opts) opts[key] = Math.max(MIN_SAMPLING, opts[key]);
    }
    const instruct = strip(get(delivery, "instruct") || get(knobs, "instruct") || "");
    if (spec.task === "vdes") {
      if (!instruct) throw new AudioCppError("VoiceDesign renders from a voice description and this voice has none");
      req.instructions = instruct;
    } else if (t(get(body, "audio_prompt_path"))) {
      if (!spec.clone) throw new AudioCppError("the CustomVoice model cannot clone — use a Base model for this voice");
      req.voice_ref = fwd(body.audio_prompt_path);
      // audio.cpp clones a Base voice in ICL mode (the clip and what it says) unless
      // `x_vector_only_mode` asks for the speaker vector alone, and ICL without a transcript
      // is refused — so a clip with neither is refused here, by name (decided 2026-10-03).
      if (t(get(body, "xvector_only"))) opts.x_vector_only_mode = true;
      else if (t(get(body, "ref_text"))) req.reference_text = body.ref_text;
      else throw new AudioCppError("Qwen3 Base needs what the clip says — type the transcript, or tick Skip the words.");
    } else {
      if (spec.clone) throw new AudioCppError("the Base model is clone-only — this voice needs a reference clip");
      opts.speaker = get(body, "voice_id");
      if (instruct) opts.instruct = instruct;
    }
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "kitten_tts") {
    req.voice = get(KITTEN_VOICE, get(body, "voice_id") || "") ?? "Leo";
    if (t(get(delivery, "speed"))) req.speed = toFloat(delivery.speed);
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
    if (t(get(body, "audio_prompt_path"))) req.voice_ref = fwd(body.audio_prompt_path);
    else req.voice = get(POCKET_VOICE, get(body, "voice_id") || "") ?? "alba";
    return req;
  }

  if (family === "chatterbox") {
    if (!t(get(body, "audio_prompt_path"))) {
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
      if (get(knobs, ours) != null) opts[theirs] = toFloat(knobs[ours]);
    }
    const temperature = has(delivery, "temperature") ? delivery.temperature : get(knobs, "temperature");
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, toFloat(temperature));
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "chatterbox_turbo") {
    // Turbo and Nano (gap 1): English, cloned voices only — our audio.cpp needs a clip longer
    // than 5 s and refuses a shorter one by name. Exaggeration / CFG / min-p do nothing on
    // Turbo, so only its own sampling knobs are sent.
    if (!t(get(body, "audio_prompt_path"))) {
      throw new AudioCppError(`${row.name ?? "Chatterbox Turbo"} speaks only cloned voices — this voice has no reference clip`);
    }
    req.voice_ref = fwd(body.audio_prompt_path);
    const opts = {};
    for (const key of ["repetition_penalty", "top_p"]) {
      if (get(knobs, key) != null) opts[key] = toFloat(knobs[key]);
    }
    if (get(knobs, "top_k") != null) opts.top_k = toInt(knobs.top_k);
    const temperature = has(delivery, "temperature") ? delivery.temperature : get(knobs, "temperature");
    if (temperature != null) opts.temperature = Math.max(MIN_SAMPLING, toFloat(temperature));
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  if (family === "voxcpm2") {
    // One model clones (the clip) and designs (a description). VoxCPM2 takes a description, or
    // a line's direction on a clone, as a parenthesised prefix on the text, which audio.cpp
    // splits off and does not speak (manifest header).
    const instruct = splitWs(get(delivery, "instruct") || get(knobs, "instruct") || "").join(" ");
    if (t(get(body, "audio_prompt_path"))) {
      req.voice_ref = fwd(body.audio_prompt_path);
      // Reaches the model once our copy of audio.cpp passes the clip as prompt audio.
      if (t(get(body, "ref_text"))) req.reference_text = body.ref_text;
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
    if (get(knobs, "cfg_value") != null) opts.guidance_scale = toFloat(knobs.cfg_value);
    if (get(knobs, "inference_timesteps") != null) opts.num_inference_steps = toInt(knobs.inference_timesteps);
    if (get(knobs, "retry_badcase_max_times") != null) opts.retry_badcase_max_times = Math.max(1, toInt(knobs.retry_badcase_max_times));
    if (get(knobs, "retry_badcase_ratio_threshold") != null) {
      opts.retry_badcase_ratio_threshold = toFloat(knobs.retry_badcase_ratio_threshold);
    }
    if (Object.keys(opts).length) req.options = opts;
    return req;
  }

  throw new AudioCppError(`no speech mapping for the ${family} family`);
}

