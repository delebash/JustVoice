// SPDX-License-Identifier: MIT
// /v1/voices/preview — audition a candidate voice without saving it (the port of
// justvoice/api/voice_preview_api.py).
//
// An LRU cache in memory holds candidate voices keyed by preview_id (cap 20, 10-min TTL). The
// casting-session workflow: audition 5 candidates per character, save 1, the other 4 expire
// automatically. No library pollution.
//
// Calls a test spies on go through the module namespaces (generate_api's
// `_generateViaManager` / `_generateViaInprocess`, the manager, voice_model, the scheduler);
// the caches are `cfg` values a test may replace (Python monkeypatched the module globals).

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { NotImplementedError, pyInt, strip, truthy, ValueError } from "@delebash/llm-runner/platform/py";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { splitTextIntoChunks } from "../audio/chunked.js";
import * as dspClient from "../audio/dsp_client.js";
import { parseWavHeader, writeWavContainer } from "../audio/wav.js";
import { SynthRequest } from "../engines/base.js";
import * as blending from "../engines/blending.js";
import * as manager from "../engines/manager.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { BlendSegment, BlendStrategy, construct, Delivery, GenerateRequest, modelDump, modelFields, utcNow } from "../models.js";
import { b64decode } from "../py_compat.js";
import * as renderCore from "../render_core.js";
import * as synthScheduler from "../synth_scheduler.js";
import * as vmod from "../voice_model.js";
import * as generateApi from "./generate_api.js";
import { sentBody } from "./settings_api.js";
import * as self from "./voice_preview_api.js";
import { blendLanguageFor } from "./voices_api.js";

export const log = getLogger("justvoice.api.voice_preview_api");

const errText = (e) => e?.message ?? String(e);

export const VoicePreviewSource = literal("cloned", "designed", "blended", "imported");

export const VoicePreviewRequest = T.Object({
  engine: T.String(),
  // The model the candidate is heard on and saved for (capability row id, 2026-10-03) — Turbo
  // and Multilingual are one engine and two models. Left out = the engine's default model that
  // can make this kind of voice.
  model: opt(nullable(T.String()), null),
  source: VoicePreviewSource,
  ref_wav_b64: opt(nullable(T.String()), null), // for cloned / imported
  transcript: opt(nullable(T.String()), null), // for cloned / imported
  xvector_only: opt(T.Boolean(), false), // clone from the speaker vector alone
  prompt: opt(nullable(T.String()), null), // for designed
  source_voice_ids: opt(nullable(T.Array(T.String())), null), // for blended
  weights: opt(nullable(T.Array(T.Number())), null), // for blended
  // Which blend strategy the audition is previewing. The audition and the save must agree or
  // you hear one voice and keep another.
  strategy: opt(BlendStrategy, "blend"),
  segments: opt(nullable(T.Array(BlendSegment)), null), // for the recombine strategy
  // 300 was an audition-sized cap. 2000 leaves headroom for a long reference passage without
  // letting a whole chapter through.
  preview_text: opt(T.String({ minLength: 1, maxLength: 2000 }), "The quick brown fox jumps over the lazy dog."),
  language: opt(T.String(), "en-US"),
  delivery: opt(nullable(T.Record(T.String(), T.Any())), null),
  // Per-render RNG seed. Same seed + same inputs = the same voice. null = random.
  seed: opt(nullable(T.Integer()), null),
});

export const VoicePreviewResponse = T.Object({
  wav_b64: T.String(),
  duration_sec: T.Number(),
  preview_id: T.String(),
  expires_at: T.Number(), // unix timestamp
});

export const PromotePreviewRequest = T.Object({
  name: T.String({ minLength: 1, maxLength: 120 }),
  gender: opt(nullable(T.String()), null),
  // A design's take kept on another model (decided 2026-10-04): the take becomes the clip of a
  // voice on this clone model — VoxCPM2, Chatterbox Turbo or Nano, Multilingual, Qwen3 Base,
  // Pocket — and the voice stays a design with its description. Left out = the model it was
  // heard on.
  model: opt(nullable(T.String()), null),
});

/**
 * The fields a client SENT on a VoicePreviewRequest — pydantic's `model_fields_set`, kept on the
 * object (not enumerable, so it never reaches a dump). The routes mark what arrived; a test or
 * caller building one marks the keys it gave (`voicePreviewRequest`).
 */
const FIELDS_SET = Symbol("fieldsSet");

export function markSent(body, sent) {
  if (body && typeof body === "object") {
    Object.defineProperty(body, FIELDS_SET, { value: new Set(Object.keys(sent || {})), enumerable: false, configurable: true });
  }
  return body;
}

/** `VoicePreviewRequest(**value)` — defaults filled, the given keys marked as set. */
export function voicePreviewRequest(value) {
  return markSent(construct(VoicePreviewRequest, value), value);
}

/**
 * Did the caller actually choose a language, or is this the default? `language` carries a
 * default of "en-US", so its VALUE cannot answer this — the fields set can. The Blend tab
 * deliberately sends nothing (a mix inherits its sources' language), while the Dataset builder
 * and services/projects.js pin one on purpose; both must keep working.
 */
export function _clientPinnedLanguage(body) {
  return Boolean(body?.[FIELDS_SET]?.has("language"));
}

// ── TTL + LRU cache ──────────────────────────────────────────────────────

/**
 * cachetools 7's TTLCache: `maxsize` entries, each living `ttl` seconds from its last `set` on
 * the `timer` clock (seconds). `get` promotes a live entry to most-recently-used; `has` doesn't;
 * an insert past `maxsize` first drops the expired, then the least recently used. An expired
 * entry reads as missing. Candidate for platform/.
 */
export class TTLCache {
  constructor(maxsize, ttl, timer = () => performance.now() / 1000) {
    this.maxsize = maxsize;
    this.ttl = ttl;
    this.timer = timer;
    this._data = new Map();
    this._expires = new Map(); // key → expiry, in expiry order (a set re-inserts)
    this._lru = new Map(); // key → true, least recently used first
  }

  _drop(key) {
    this._data.delete(key);
    this._expires.delete(key);
    this._lru.delete(key);
  }

  expire(now = this.timer()) {
    for (const [k, exp] of this._expires) {
      if (now < exp) break;
      this._drop(k);
    }
  }

  get size() {
    this.expire();
    return this._data.size;
  }

  has(key) {
    const exp = this._expires.get(key);
    return exp !== undefined && this.timer() < exp;
  }

  get(key, dflt = undefined) {
    if (!this.has(key)) return dflt;
    this._lru.delete(key);
    this._lru.set(key, true);
    return this._data.get(key);
  }

  set(key, value) {
    const now = this.timer();
    this.expire(now);
    if (!this._data.has(key)) {
      while (this._data.size + 1 > this.maxsize && this._lru.size) this._drop(this._lru.keys().next().value);
    }
    this._data.set(key, value);
    this._lru.delete(key);
    this._lru.set(key, true);
    this._expires.delete(key);
    this._expires.set(key, now + this.ttl);
  }

  delete(key) {
    const had = this._data.has(key);
    this._drop(key);
    return had;
  }

  clear() {
    this._data.clear();
    this._expires.clear();
    this._lru.clear();
  }
}

export const _LRU_CAP = 20;
export const _TTL_S = 10 * 60;

export class _PreviewEntry {
  constructor(source, payload, wavBytes) {
    this.source = source;
    this.payload = payload;
    this.wavBytes = wavBytes;
    this.expiresAt = Date.now() / 1000 + _TTL_S;
    // Set by the save route so a repeated save is idempotent rather than minting a second copy
    // of the same candidate.
    this.savedVoiceId = null;
  }
}

// ── Rendered-audition cache ──────────────────────────────────────────────
// Auditioning is a listen-tweak-listen loop, so the same (voice, line, knobs) triple gets asked
// for repeatedly — and on a slot-coupled engine each miss is a real synth. Keyed on exactly what
// changes the audio; 10-minute TTL because a re-cloned voice keeps its id, so a stale hit has to
// age out on its own.
export const _AUDITION_CAP = 32;
export const _AUDITION_TTL_S = 10 * 60;

// Streaming an UNSAVED candidate: the stream door addresses a voice by id, and a candidate has
// no id until you keep it. A ticket is a short-lived stand-in id: POST the recipe once, then
// stream against the ticket exactly as if it were a voice. 10 minutes matches the preview LRU.
export const cfg = {
  _PREVIEW_LRU: new TTLCache(_LRU_CAP, _TTL_S),
  _AUDITION_CACHE: new TTLCache(_AUDITION_CAP, _AUDITION_TTL_S),
  _STREAM_TICKETS: new TTLCache(64, _TTL_S),
};

// Test hook — counts served-from-cache responses. Nothing in the app reads it.
export let auditionCacheHits = 0;

/** Tests only. */
export function _resetAuditionCache() {
  cfg._AUDITION_CACHE.clear();
  auditionCacheHits = 0;
}

export async function _storePreview(entry) {
  const previewId = randomUUID();
  cfg._PREVIEW_LRU.set(previewId, entry); // evicts past the cap / on TTL
  return previewId;
}

/** The live entry (promoted to most-recently-used), or null when its TTL lapsed (→ 404). */
export async function _getPreview(previewId) {
  return cfg._PREVIEW_LRU.get(previewId) ?? null;
}

/** Python's `list(x)` of a value that may be None — its TypeError when it is. */
function listOf(x) {
  if (x == null) throw new TypeError("'NoneType' object is not iterable");
  return [...x];
}

/**
 * A blend candidate's style vector, and the language it should speak (async) — ONE door for
 * both audition paths (the POST that returns a whole WAV and the stream ticket). They diverged
 * once already (the POST derived a language while the stream hardcoded none) and that
 * divergence is the tracked "blend auditions as English" defect. Returns `[vector, language |
 * null]`; null means the caller pinned a language and it must be left alone.
 */
export async function _resolveBlend(body, state) {
  if (!blending.supports(body.engine)) throw badRequest(`engine '${body.engine}' cannot blend — Kokoro is the blending engine.`);

  const resolve = (vid) => {
    const r = state.voices.get(vid);
    return r && r.embedding && r.embedding.length ? [...r.embedding] : null;
  };

  let sources;
  let vector;
  try {
    if (body.strategy === "recombine") {
      const segments = listOf(body.segments);
      sources = segments.map((s) => s.voice_id);
      vector = await blending.recombine(
        body.engine,
        segments.map((s) => [s.voice_id, pyFloatValue(s.start), pyFloatValue(s.end)]),
        { dataDir: state.dataDir, resolveStored: resolve },
      );
    } else {
      sources = listOf(body.source_voice_ids);
      // Same rule as the save endpoint: a mix divides by Σw, an analogy keeps its magnitude.
      let weights = listOf(body.weights);
      if (body.strategy !== "vector") {
        const total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) throw badRequest("weights must sum to a positive value");
        weights = weights.map((w) => w / total);
      } else if (!weights.some((w) => w !== 0)) {
        throw badRequest("every weight is zero — there is nothing to combine");
      }
      vector = await blending.blend(body.engine, sources, weights, {
        dataDir: state.dataDir,
        resolveStored: resolve,
        normalize: false, // applied above, per strategy
      });
    }
  } catch (e) {
    if (e instanceof blending.LookupError || e instanceof ValueError) throw badRequest(e.message);
    throw e;
  }

  // THE fix for "a blend of non-English voices auditions as English" (code-verified
  // 2026-08-20). The client used to send language "en-US" unconditionally, which won over the
  // engine's own per-voice fallback. A pinned language still wins.
  if (_clientPinnedLanguage(body)) return [vector, null];
  return [vector, blendLanguageFor(state, body.engine, sources)];
}

// ── Endpoints ────────────────────────────────────────────────────────────

/** Refuse a candidate missing what its source needs: a clip, a description, or the voices of a
 * blend. */
export function validateCandidate(body) {
  if (body.source === "cloned" || body.source === "imported") {
    if (!body.ref_wav_b64) throw badRequest("ref_wav_b64 required for cloned/imported preview");
    // The transcript is optional, as on a direct clone: without one the engine clones from the
    // clip alone, and Qwen3 Base asks for it or for x-vector only by name (decided 2026-10-03).
  } else if (body.source === "designed") {
    if (!body.prompt) throw badRequest("prompt required for designed preview");
  } else if (body.source === "blended") {
    if (body.strategy === "recombine") {
      if (!body.segments || body.segments.length < 2) throw badRequest("recombine needs at least 2 segments");
    } else {
      const floor = body.strategy === "extrapolate" ? 1 : 2;
      if (!body.source_voice_ids || body.source_voice_ids.length < floor) {
        throw badRequest(`source_voice_ids must contain >=${floor} voice ID${floor === 1 ? "" : "s"} for a ${body.strategy} preview`);
      }
      if (!body.weights || !body.weights.length || body.weights.length !== body.source_voice_ids.length) {
        throw badRequest("weights must match length of source_voice_ids");
      }
    }
  }
}

/** The registry engine a candidate renders on (null for a managed engine, whose model this
 * checks and fixes in `body.model`). Async. */
export async function candidateEngine(body, state) {
  // Registry backends (external providers) keep the direct path; managed plugin engines route
  // via the manager through the scheduler (§7d of the 2026-08-08 plan).
  const engine = state.engines.get(body.engine) ?? null;
  if (engine === null) {
    if (manager.getManager().getManifest(body.engine) == null) throw notFound(`engine ${body.engine}`);
    // The model this candidate is heard on — and saved for (savePreview).
    const action =
      body.source === "cloned" || body.source === "imported" ? "clone" : body.source === "designed" ? "design" : "blend";
    try {
      body.model = vmod.checkModelFor(body.engine, body.model, action);
    } catch (e) {
      if (e instanceof ValueError) throw badRequest(e.message);
      throw e;
    }
  }
  // Lazy-load a registry engine if needed (managed engines load inside the scheduled call).
  if (engine !== null && !engine.ready()) {
    try {
      await engine.load("auto", null);
    } catch (e) {
      throw badRequest(`engine '${body.engine}' failed to load for preview: ${errText(e)}`);
    }
  }
  return engine;
}

const _CANDIDATE_CLIP_HOURS = 1.0;

/**
 * An unsaved voice's clip as a file the runtime can read — in a folder of its own, where clips
 * older than an hour are cleared on the next write. Every clone preview left its clip in the
 * temp folder for good (audit 2026-10-04 §5 F); deleting it right after the render would break a
 * streamed preview, whose later pieces read the same file.
 */
export function _candidateClip(raw) {
  const folder = path.join(tmpdir(), "justvoice-candidate-clips");
  mkdirSync(folder, { recursive: true });
  const cutoff = Date.now() / 1000 - _CANDIDATE_CLIP_HOURS * 3600;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".wav")) continue;
    const old = path.join(folder, name);
    try {
      if (statSync(old).mtimeMs / 1000 < cutoff) unlinkSync(old);
    } catch {
      /* OSError: pass */
    }
  }
  const out = path.join(folder, `${createHash("sha1").update(raw).digest("hex")}.wav`);
  if (!existsSync(out)) writeFileSync(out, raw);
  else {
    const now = new Date();
    utimesSync(out, now, now);
  }
  return out;
}

/**
 * What a candidate contributes to the engine call besides the text — the same fields a SAVED
 * voice contributes through `render_core.voiceSynthFields` (snake_case, the synth body's keys)
 * — and, for a blend, the language its sources speak (async). A design's description is not
 * here: it is the instruct, composed by the caller.
 */
export async function candidateVoiceFields(body, state) {
  // For cloned/imported, the ref WAV as a file the engine can read as an audio prompt.
  let audioPromptPath = null;
  if ((body.source === "cloned" || body.source === "imported") && body.ref_wav_b64) {
    audioPromptPath = _candidateClip(b64decode(body.ref_wav_b64));
  }
  // Wired 2026-08-19: before this, a blended or designed audition passed nothing but
  // `__preview__` and the engine rendered its default voice, so every candidate sounded alike.
  const extra = {};
  let language = null;
  if (audioPromptPath) {
    extra.audio_prompt_path = audioPromptPath;
    if (body.xvector_only) extra.xvector_only = true;
    else if (body.transcript) extra.ref_text = body.transcript;
  } else if (body.source === "blended") {
    let vector;
    [vector, language] = await self._resolveBlend(body, state);
    extra.voice_vector = vector;
  }
  return [extra, language];
}

/** The synth body's extra fields as a registry engine's SynthRequest options. */
const synthOptions = (extra) => ({
  ...(extra.audio_prompt_path !== undefined ? { audioPromptPath: extra.audio_prompt_path } : {}),
  ...(extra.ref_text !== undefined ? { refText: extra.ref_text } : {}),
  ...(extra.xvector_only !== undefined ? { xvectorOnly: extra.xvector_only } : {}),
  ...(extra.voice_vector !== undefined ? { voiceVector: extra.voice_vector } : {}),
});

/** Speak `text` with a candidate voice (async) → `[wav, sampleRate, channels]`. */
export async function synthCandidate(body, engine, { text, language, delivery, seed, extra, signal = null }) {
  if (engine !== null) {
    let out;
    try {
      out = await engine.synthesize(new SynthRequest({ voiceId: "__preview__", text, language, delivery, seed, ...synthOptions(extra) }));
    } catch (e) {
      throw badRequest(`preview synthesize failed: ${errText(e)}`);
    }
    // Wrap raw PCM in a WAV container if needed.
    const wav = out.isWavContainer ? out.bytes : writeWavContainer(out.bytes, out.sampleRate, out.channels);
    return [wav, out.sampleRate, out.channels];
  }
  const mgr = manager.getManager();
  const doIt = async () => {
    await vmod.ensureModelLoaded(body.engine, body.model || body.engine, language);
    const [audio, meta] = await mgr.synth(body.engine, { voice_id: "__preview__", text, language, delivery, seed, ...extra });
    const sr = meta.sample_rate || 24000;
    const ch = meta.channels || 1;
    if (meta.is_wav_container) return [audio, sr, ch];
    return [writeWavContainer(audio, sr, ch), sr, ch];
  };
  const handle = synthScheduler.getScheduler().submit([[body.engine, doIt]], {
    interactive: true,
    owner: synthScheduler.workOwner("a voice preview"),
  });
  await handle.waitAsync({ signal });
  if (handle.error != null) {
    if (handle.error instanceof manager.TermsRequired) throw handle.error.apiError();
    throw badRequest(`preview synthesize failed: ${errText(handle.error)}`);
  }
  return handle.items[0].result;
}

/** Hold a heard candidate for 10 minutes so it can be saved → `[its id, when it lapses]`. */
export async function storeCandidate(source, payload, wavBytes) {
  const entry = new _PreviewEntry(source, payload, wavBytes);
  return [await _storePreview(entry), entry.expiresAt];
}

// ── Row preview — audition an EXISTING voice (table ▶) ──────────────────

export const PREVIEW_LINE_DEFAULT = "Hello — here's how this voice sounds.";

// Minimum audition length the endpoint always accepts, whatever `limits.text_max_chars` is set
// to. An operator who clamps generation to a short line still gets a usable audition; the cap
// only ever rises from here.
export const AUDITION_TEXT_FLOOR = 300;

/** The row preview's optional body. Both fields optional, and an ABSENT body is the canned
 * audition — the ▶ button in the voice library posts nothing. */
export const AuditionRequest = T.Object({
  text: opt(nullable(T.String()), null),
  delivery: opt(nullable(T.Record(T.String(), T.Any())), null),
});

/** sha1 over the three things that change the audio. Delivery is canonicalized (sorted keys, no
 * whitespace) so key order can't split one logical request across two cache entries. */
export function auditionCacheKey(voiceId, text, delivery) {
  const canonical = pyJson(delivery || {}, { sortKeys: true, separators: [",", ":"] });
  return createHash("sha1").update(Buffer.from(`${voiceId}\u0000${text}\u0000${canonical}`, "utf8")).digest("hex");
}

/**
 * The language an audition should render in, or null to let the engine use the voice's own
 * catalog language. A preset resolves correctly inside the engine (its id carries its
 * language). A STORED voice does not: a blend is minted `voice_<hex>`, the engine's lookup
 * misses, and it falls back to en-US — so the language has to come from the record here.
 */
export function _auditionLanguage(voiceId) {
  const ticket = cfg._STREAM_TICKETS.get(voiceId);
  if (ticket) return ticket.language ?? null;
  const rec = getState().voices.get(voiceId);
  return rec && rec.language ? rec.language : null;
}

/**
 * ONE voice→engine routing door for both audition endpoints (POST /preview and GET
 * /preview/stream), so the streaming path can't drift (async):
 *
 *   1. voice of the currently-loaded managed engine,
 *   2. static voice of an installed managed engine (load-on-consent),
 *   3. stored voice (clone / design / import / blend),
 *   4. in-process engine preset.
 *
 * Returns `["managed" | "inprocess", engineId, voiceFields | null]`; throws the same 409
 * engine_not_installed/_not_loaded conflicts the client dialogs key on.
 */
export async function _resolveAuditionTarget(voiceId, autoLoad) {
  const st = getState();
  const mgr = manager.getManager();

  // Tier 0 — a stream ticket standing in for a candidate that has no id yet. Everything
  // downstream treats it as an ordinary voice.
  const ticket = cfg._STREAM_TICKETS.get(voiceId);
  if (ticket) {
    const engineId = ticket.engine_id;
    const m = mgr.getManifest(engineId);
    if (m != null) {
      if (!m.isInstalled) throw conflict(`engine_not_installed:${engineId}`);
      if (mgr.currentId() !== engineId) {
        if (!autoLoad) throw conflict(`engine_not_loaded:${engineId}`);
        await mgr.load(engineId, { device: "auto" });
      }
      return ["managed", engineId, ticket.voice_fields];
    }
    return ["inprocess", engineId, ticket.voice_fields];
  }

  /** The voice's own model resident, or the client's load dialog. */
  const ready = async (engineId) => {
    const vm = await vmod.voiceModel(st, voiceId);
    const model = vm !== null ? vm.model : engineId;
    if (vmod.isModelLoaded(engineId, model)) return;
    if (!autoLoad) throw conflict(`engine_not_loaded:${engineId}`);
    try {
      await vmod.ensureModelLoaded(engineId, model, _auditionLanguage(voiceId));
    } catch (e) {
      if (e instanceof vmod.ModelUnavailable) throw badRequest(e.message);
      throw e;
    }
  };

  const owner = await generateApi._findManagedVoiceOwner(voiceId);
  if (owner !== null) {
    const m = mgr.getManifest(owner);
    if (m != null && !m.isInstalled) throw conflict(`engine_not_installed:${owner}`);
    await ready(owner);
    return ["managed", owner, null];
  }

  const staticOwner = generateApi._findStaticVoiceOwner(voiceId);
  if (staticOwner !== null) {
    const m = mgr.getManifest(staticOwner);
    // The speech runtime isn't installed yet — the UI maps this to an "install it in Engines"
    // dialog.
    if (m != null && !m.isInstalled) throw conflict(`engine_not_installed:${staticOwner}`);
    await ready(staticOwner);
    return ["managed", staticOwner, null];
  }

  const stored = st.voices.get(voiceId);
  if (stored) {
    const voiceFields = generateApi._voiceSynthFields(stored);
    if (mgr.getManifest(stored.engine)) {
      await ready(stored.engine);
      return ["managed", stored.engine, voiceFields];
    }
    const engine = st.engines.get(stored.engine) ?? null;
    if (engine === null) throw notFound(`engine ${stored.engine}`);
    if (!engine.ready() && !autoLoad) throw conflict(`engine_not_loaded:${stored.engine}`);
    return ["inprocess", stored.engine, null];
  }

  for (const engine of st.engines.all()) {
    if ((await engine.voices()).some((p) => p.id === voiceId)) {
      if (!engine.ready() && !autoLoad) throw conflict(`engine_not_loaded:${engine.meta.engineId}`);
      return ["inprocess", engine.meta.engineId, null];
    }
  }

  throw notFound(`voice ${voiceId}`);
}

/** A 44-byte PCM16 WAV header with the streaming convention's sizes (0xFFFFFFFF): the byte count
 * isn't known until the render finishes. Players read it as "PCM until the connection closes". */
export function _streamingWavHeader(sampleRate, channels) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(0xffffffff, 4);
  h.write("WAVE", 8, "latin1");
  h.write("fmt ", 12, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(0xffffffff, 40);
  return h;
}

export const StreamTicketResponse = T.Object({ ticket: T.String(), expires_at: T.Number() });

/** The row audition's text cap: never below the floor, else the operator's limit. */
function auditionText(st, raw) {
  const text = strip(raw || "") || PREVIEW_LINE_DEFAULT;
  const cap = Math.max(AUDITION_TEXT_FLOOR, st.settings.get().limits.text_max_chars);
  const n = renderCore.pyLen(text);
  if (n > cap) {
    throw badRequest(`audition text is ${n} characters, limit ${cap} — previews are for a line or two, not a chapter.`);
  }
  return text;
}

/** One audition piece through the doors Generate uses → its WAV (async). */
function renderPiece(kind, engineId, req, voiceFields, signal) {
  if (kind === "managed") return generateApi._generateViaManager(engineId, req, voiceFields, { signal });
  return generateApi._generateViaInprocess(engineId, req);
}

const DELIVERY_FIELDS = new Set(modelFields(Delivery));

export async function router(app) {
  /**
   * Generate a short audition clip without persisting the voice. Returns a preview_id that can
   * be passed to POST /v1/voices/preview/{id}/save within 10 minutes to promote the candidate to
   * a persistent Voice.
   */
  app.post("/v1/voices/preview", { schema: { body: VoicePreviewRequest } }, async (req, reply) => {
    const body = markSent(req.body, sentBody(req));
    self.validateCandidate(body);
    const state = getState();
    const engine = await self.candidateEngine(body, state);
    const [extra, blendLanguage] = await self.candidateVoiceFields(body, state);
    if (blendLanguage !== null) body.language = blendLanguage;
    const delivery = { ...(body.delivery || {}) };
    if (body.source === "designed") {
      // The description IS the instruct for a design checkpoint; a line's own direction would
      // append to it exactly as it does at render.
      delivery.instruct = [body.prompt, delivery.instruct ?? null].filter((x) => truthy(x)).join(" ");
    }
    const [wav, sampleRate, channels] = await self.synthCandidate(body, engine, {
      text: body.preview_text,
      language: body.language,
      delivery,
      seed: body.seed,
      extra,
      signal: generateApi.clientGone(req, reply),
    });
    const durationSec = wav.length / (sampleRate * channels * 2);
    const [previewId, expiresAt] = await self.storeCandidate(body.source, modelDump(VoicePreviewRequest, body), wav);
    return construct(VoicePreviewResponse, {
      wav_b64: Buffer.from(wav).toString("base64"),
      duration_sec: durationSec,
      preview_id: previewId,
      expires_at: expiresAt,
    });
  });

  /**
   * Promote a previewed voice to the persistent library. Idempotent on preview_id: subsequent
   * saves return the same record. 404 if the preview has expired from the LRU.
   */
  app.post("/v1/voices/preview/:preview_id/save", { schema: { body: PromotePreviewRequest } }, async (req) => {
    const previewId = req.params.preview_id;
    const body = req.body;
    const entry = await _getPreview(previewId);
    if (entry === null) throw notFound(`preview ${previewId} (expired from LRU or never existed)`);

    // Implemented 2026-08-19 (the acquisition build). This route used to return {"promoted":
    // true, …, "note": "route stub"} without writing anything.
    const state = getState();
    const payload = entry.payload || {};

    // Idempotent on preview_id: a second save returns the first record.
    const already = entry.savedVoiceId;
    if (already) {
      const rec = state.voices.get(already);
      if (rec) return { promoted: true, preview_id: previewId, voice_id: rec.id, name: rec.name, source: rec.source };
    }

    const now = utcNow();
    // The recipe stored here must match what POST /v1/voices/blend would store for the same
    // inputs, or the same mix reached through two doors dedups as two voices. Shares are
    // normalized; an analogy is not.
    const strategy = payload.strategy || "blend";
    const segments = (payload.segments || []).map((s) => construct(BlendSegment, s));
    const weights = [...(payload.weights || [])];
    let recipeSources;
    let recipeWeights;
    if (strategy === "recombine") {
      recipeSources = segments.map((s) => s.voice_id);
      recipeWeights = [];
    } else {
      recipeSources = [...(payload.source_voice_ids || [])];
      const total = weights.reduce((a, b) => a + b, 0);
      recipeWeights = strategy !== "vector" && total ? weights.map((w) => w / total) : weights;
    }
    // A designed voice's transcript is the line its own preview speaks: the frozen clip + the
    // words it speaks is what makes an ICL clone source.
    let transcript = payload.transcript ?? null;
    if (entry.source === "designed") transcript = payload.preview_text || transcript;

    // A design's take kept on another clone model (2026-10-04).
    let engineId = Object.hasOwn(payload, "engine") ? payload.engine : "";
    let model = payload.model ?? null;
    if (body.model && body.model !== model) {
      if (entry.source !== "designed") throw badRequest("Only a design's take can be kept on another model.");
      const other = vmod.engineOfModel(body.model);
      if (other === null || !vmod.can(body.model, "clone")) throw badRequest(`${vmod.modelName(body.model)} can't speak a voice from its clip.`);
      [engineId, model] = [other, body.model];
    }

    const recipe =
      entry.source === "blended" && (weights.length || segments.length)
        ? { strategy, sources: recipeSources, weights: recipeWeights, segments: segments.length ? segments : null }
        : null;
    const created = state.voices.create({
      id: "",
      engine: engineId,
      model,
      source: entry.source,
      name: body.name,
      language: payload.language || "en",
      gender: body.gender,
      transcript,
      xvector_only: Boolean(payload.xvector_only) && (entry.source === "cloned" || entry.source === "imported"),
      design_prompt: payload.prompt ?? null,
      sample_count: 0,
      blend_recipe: recipe,
      created_at: now,
      updated_at: now,
    });

    // The reference clip travels with a cloned/imported voice — without it the saved voice has
    // no timbre source and every later render fails.
    const refB64 = payload.ref_wav_b64;
    if (refB64) {
      try {
        state.voices.writeRefWav(created.id, b64decode(refB64));
      } catch (e) {
        state.voices.delete(created.id);
        throw badRequest(`could not store the reference clip: ${errText(e)}`);
      }
    } else if (entry.source === "designed" && entry.wavBytes && entry.wavBytes.length) {
      // THE freeze bridge (2026-08-22). The audition just rendered this voice and we are
      // holding the audio — keeping it turns a designed voice into a stable clone source, the
      // only way a designed identity survives from one line to the next. Failure here is NOT
      // fatal: the voice still works, dynamically, off its description alone.
      try {
        state.voices.writeRefWav(created.id, entry.wavBytes);
      } catch (e) {
        log.warning(`designed voice ${created.id} saved without its frozen clip (${errText(e)}) — it will render dynamically from its description`);
      }
    }

    // A blend's vector is recomputed from its recipe rather than carried in the preview
    // payload — same inputs, same arithmetic, and it stays correct if the voice pack was
    // reinstalled between audition and save.
    if (entry.source === "blended" && recipe !== null) {
      const resolve = (vid) => {
        const r = state.voices.get(vid);
        return r && r.embedding && r.embedding.length ? [...r.embedding] : null;
      };
      try {
        let vector;
        if (recipe.strategy === "recombine") {
          vector = await blending.recombine(
            created.engine,
            (recipe.segments || []).map((s) => [s.voice_id, pyFloatValue(s.start), pyFloatValue(s.end)]),
            { dataDir: state.dataDir, resolveStored: resolve },
          );
        } else {
          // The recipe's weights are already in their final form — normalized for a mix, raw for
          // an analogy — so the combine must not divide again.
          vector = await blending.blend(created.engine, [...recipe.sources], [...recipe.weights], {
            dataDir: state.dataDir,
            resolveStored: resolve,
            normalize: false,
          });
        }
        state.voices.update(created.id, { embedding: vector });
      } catch (e) {
        if (e instanceof blending.LookupError || e instanceof NotImplementedError || e instanceof ValueError) {
          state.voices.delete(created.id);
          throw badRequest(`could not save the blend: ${errText(e)}`);
        }
        throw e;
      }
    }

    entry.savedVoiceId = created.id;
    return { promoted: true, preview_id: previewId, voice_id: created.id, name: created.name, source: created.source };
  });

  /**
   * Mint a short-lived id so an unsaved candidate can be streamed. Two steps, because an <audio
   * src> can only issue a GET: the recipe is POSTed once, its style vector computed here, and
   * the ticket passed to GET /v1/voices/{ticket}/preview/stream like any voice id. Blend-only
   * for now: a clone or a design needs its reference clip on the engine call, which the ticket
   * does not carry.
   */
  app.post("/v1/voices/preview/stream-ticket", { schema: { body: VoicePreviewRequest } }, async (req) => {
    const body = markSent(req.body, sentBody(req));
    if (body.source !== "blended") {
      throw badRequest("stream tickets are for blend candidates; clone and design auditions use POST /v1/voices/preview");
    }
    const [vector, lang] = await self._resolveBlend(body, getState());
    const ticket = `tkt_${randomUUID().replaceAll("-", "")}`;
    cfg._STREAM_TICKETS.set(ticket, {
      engine_id: body.engine,
      voice_fields: { voice_vector: vector },
      language: lang !== null ? lang : body.language,
    });
    return construct(StreamTicketResponse, { ticket, expires_at: Date.now() / 1000 + _TTL_S });
  });

  /**
   * Pipelined audition (streaming phase 1, 2026-08-19): the line splits into sentence-sized
   * pieces (settings.generation.stream_piece_chars), each renders through the same doors as
   * POST /preview, and every piece hits the wire as it finishes — playback starts after the
   * FIRST piece. Pieces join with the chunked path's seam, held back one crossfade window so the
   * seam is blended before it is sent. Same routing, same text cap, same audition cache as POST
   * /preview — a completed stream fills the cache, and a cache hit answers with the finished WAV
   * in one piece. A client disconnect stops the render at the next piece boundary.
   */
  app.get(
    "/v1/voices/:voice_id/preview/stream",
    { schema: { querystring: T.Object({ text: opt(T.String(), ""), auto_load: opt(T.Boolean(), false) }) } },
    async (req, reply) => {
      const st = getState();
      const voiceId = req.params.voice_id;
      const text = auditionText(st, req.query.text);

      // Same key as a body-less POST of this line — the two doors share the cache. A TICKET is
      // skipped: it names one unsaved candidate, so every entry would be a permanent miss.
      const key = cfg._STREAM_TICKETS.has(voiceId) ? null : auditionCacheKey(voiceId, text, {});
      if (key !== null) {
        const hit = cfg._AUDITION_CACHE.get(key);
        if (hit !== undefined) {
          auditionCacheHits += 1;
          return reply.type(hit[1]).send(hit[0]);
        }
      }

      const [kind, engineId, voiceFields] = await self._resolveAuditionTarget(voiceId, req.query.auto_load);
      const auditionLang = _auditionLanguage(voiceId);

      const gen = st.settings.get().generation;
      const pieceChars = Math.max(80, pyInt(gen.stream_piece_chars ?? 200));
      const crossfadeMs = pyInt(gen.crossfade_ms ?? 50);
      const pieces = splitTextIntoChunks(text, pieceChars);
      if (!pieces.length) pieces.push(text);
      const signal = generateApi.clientGone(req, reply);

      async function* wavStream() {
        let sr = 0;
        let channels = 1;
        let tail = null; // held back for the next seam (the DSP program's own float32)
        const emitted = []; // int16 bytes, for the cache
        for (let idx = 0; idx < pieces.length; idx++) {
          // language: a stored voice's own, a ticket's derived one, or null so a preset resolves
          // inside the engine. Omitting it made every stored blend stream as en-US.
          const pieceReq = construct(GenerateRequest, { voice: voiceId, text: pieces[idx], language: auditionLang });
          const wav = Buffer.from(await renderPiece(kind, engineId, pieceReq, voiceFields, signal));
          const [fmt] = parseWavHeader(wav);
          if (sr === 0) {
            sr = fmt.sampleRate;
            channels = fmt.channels;
            yield _streamingWavHeader(sr, channels);
          } else if (fmt.sampleRate !== sr) {
            // One engine, one audition — a rate change mid-stream would be silent chipmunking.
            throw new Error(`audition stream: sample rate changed mid-piece (${sr} → ${fmt.sampleRate})`);
          }
          // The seam a line's pieces get (chunked.PIECE_JOIN_*): joined onto the tail held from
          // the piece before, then this piece's trailing quiet and one crossfade window held
          // back for the NEXT seam, except on the last piece, which flushes whole.
          let chunk;
          [chunk, tail] = await dspClient.streamJoin(wav, tail, { last: idx === pieces.length - 1, crossfadeMs });
          if (chunk && chunk.length) {
            emitted.push(chunk);
            yield chunk;
          }
        }
        // The full render exists now — cache it with a REAL header so the next play of this line
        // is instant and scrubbable. (A ticket's stream caches under a null key, as Python's
        // did — no lookup ever reads it.)
        if (sr && emitted.length) cfg._AUDITION_CACHE.set(key, [writeWavContainer(Buffer.concat(emitted), sr, channels), "audio/wav"]);
      }

      return reply.type("audio/wav").send(Readable.from(wavStream(), { objectMode: false }));
    },
  );

  /**
   * Short audition clip for a stored or preset voice. Mirrors /v1/generate's voice→engine
   * routing. When the owning engine isn't loaded and auto_load is false, answers 409
   * "engine_not_loaded:<engine_id>" so the client can ask the user before paying the 25–55 s
   * load. An optional `{text, delivery}` body hears YOUR line with YOUR knobs instead of the
   * canned sentence (Slice B); no body = the canned audition, unchanged.
   */
  app.post(
    "/v1/voices/:voice_id/preview",
    {
      schema: { body: nullable(AuditionRequest), querystring: T.Object({ auto_load: opt(T.Boolean(), false) }) },
      config: { pyFloats: true },
    },
    async (req, reply) => {
      const st = getState();
      const voiceId = req.params.voice_id;
      const body = req.body ?? null;
      const text = auditionText(st, body ? body.text : null);

      // Only fields the Delivery shape actually carries; an unknown key would 422 the whole
      // audition over a typo in a knob name.
      const deliveryRaw = (body ? body.delivery : null) || {};
      const delivery = Object.fromEntries(Object.entries(deliveryRaw).filter(([k, v]) => DELIVERY_FIELDS.has(k) && v !== null));

      const key = auditionCacheKey(voiceId, text, delivery);
      const hit = cfg._AUDITION_CACHE.get(key);
      if (hit !== undefined) {
        auditionCacheHits += 1;
        return reply.type(hit[1]).send(hit[0]);
      }

      const genReq = construct(GenerateRequest, {
        voice: voiceId,
        text,
        // A value Delivery refuses is pydantic's ValidationError inside the handler — a 500 in
        // Python (not a 422; kept on purpose).
        delivery: Object.keys(delivery).length ? construct(Delivery, delivery, "Delivery") : null,
      });

      // Routing lives in _resolveAuditionTarget — ONE door shared with GET /preview/stream.
      const [kind, engineId, voiceFields] = await self._resolveAuditionTarget(voiceId, req.query.auto_load);
      const wav = await renderPiece(kind, engineId, genReq, voiceFields, generateApi.clientGone(req, reply));
      if (wav && wav.length) cfg._AUDITION_CACHE.set(key, [Buffer.from(wav), "audio/wav"]);
      return reply.type("audio/wav").send(wav);
    },
  );
}
