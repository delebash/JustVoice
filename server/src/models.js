// SPDX-License-Identifier: MIT
// The wire models for the entire API surface, in TypeBox (the port of justvoice/models.py,
// the cross-language source of truth). One file because they cross-reference each other
// heavily. JustVoice's wire is snake_case — every field keeps its Python name exactly.
//
// The convention (the kit's platform/models.js header): a field with a default is
// `opt(schema, default)`; `X | None` is `nullable(X)`; `Literal[...]` is `literal(...)`;
// `extra="forbid"` is `strictObject`; a free `dict` is `T.Record(T.String(), T.Any())`.
// Python's `int` is `T.Integer()` and `float` is `T.Number()` — that difference is what
// tells `pyJson` (through `floatify`) which numbers are floats when a model is stored.
// A `datetime` field is `DateTime()` — a string in pydantic's JSON form (see `dtWire`).
//
// Beside the models, the helpers every store needs to write Python's bytes (each a
// candidate for platform/): `floatify` (a model's floats → PyFloat for pyJson),
// `construct` (pydantic's `Model(**x)`, safe for PyFloat values) and the datetime forms
// (`dtWire`, `dtIso`, `utcNow`, `utcNowNaive`, `dtMicros`). Stored text is read with the
// kit's `pyJsonParse` (json.loads that keeps a whole-number float literal a float).

import { LLMProviderConfig } from "@delebash/llm-runner/llm/schema";
import {
  branchOf,
  check,
  laxConvert,
  literal,
  model,
  nullable,
  opt,
  shapeRequest,
  strictObject,
  T,
  unwrapTyped,
} from "@delebash/llm-runner/platform/models";
import { isDict } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyClone, pyFloatValue } from "@delebash/llm-runner/platform/pyjson";

export { LLMProviderConfig };

// ─── Helpers (candidates for platform/) ─────────────────────────────────

/** A `datetime` field: a string in pydantic's JSON form. Marked so `construct` normalises it. */
export const DateTime = () => T.String({ $comment: "datetime" });
const isDateTimeSchema = (s) => s && s.type === "string" && s.$comment === "datetime";

const DT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6})\d*)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

function dtParts(x) {
  if (x instanceof Date) {
    const iso = x.toISOString();
    return { date: iso.slice(0, 10), time: iso.slice(11, 19), frac: `${iso.slice(20, 23)}000`, off: "Z" };
  }
  const m = DT_RE.exec(String(x).trim());
  if (!m) return null;
  let off = m[8] ?? null;
  if (off && off !== "Z" && off !== "z") {
    const o = /^([+-])(\d{2}):?(\d{2})?$/.exec(off);
    const hh = o[2];
    const mm = o[3] ?? "00";
    off = hh === "00" && mm === "00" ? "Z" : `${o[1]}${hh}:${mm}`;
  } else if (off) off = "Z";
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}:${m[6] ?? "00"}`,
    frac: (m[7] ?? "").padEnd(6, "0"),
    off,
  };
}

/** A datetime in pydantic's JSON form: `2026-01-02T03:04:05[.ffffff][Z|±HH:MM]` — the fraction
 * only when non-zero, UTC as "Z", a naive time with no suffix. Unparseable input passes through. */
export function dtWire(x) {
  if (x == null) return x;
  const p = dtParts(x);
  if (!p) return x;
  return `${p.date}T${p.time}${p.frac === "000000" ? "" : `.${p.frac}`}${p.off ?? ""}`;
}

/** A datetime in Python's `isoformat()` form — as `dtWire`, but UTC is "+00:00". */
export function dtIso(x) {
  if (x == null) return x;
  const p = dtParts(x);
  if (!p) return x;
  const off = p.off === "Z" ? "+00:00" : (p.off ?? "");
  return `${p.date}T${p.time}${p.frac === "000000" ? "" : `.${p.frac}`}${off}`;
}

/** Microseconds since the epoch, for ordering datetimes (aware ones by their UTC instant). */
export function dtMicros(x) {
  const p = dtParts(x);
  if (!p) return Number.NaN;
  let ms = Date.parse(`${p.date}T${p.time}Z`);
  if (p.off && p.off !== "Z") {
    const sign = p.off[0] === "-" ? -1 : 1;
    ms -= sign * (Number(p.off.slice(1, 3)) * 60 + Number(p.off.slice(4, 6))) * 60000;
  }
  return ms * 1000 + Number(p.frac);
}

// Python's clock has microseconds; JavaScript's wall clock has milliseconds. The sub-
// millisecond part comes from the high-resolution clock, and successive readings never
// repeat or go backwards (rows ordered by a time keep their insertion order, as Python's
// distinct microsecond stamps did).
let lastMicros = 0;
function nowMicros() {
  const frac = performance.now() % 1;
  let us = Date.now() * 1000 + Math.floor(frac * 1000);
  if (us <= lastMicros) us = lastMicros + 1;
  lastMicros = us;
  return us;
}
function fmtMicros(us) {
  const ms = Math.floor(us / 1000);
  const base = new Date(ms).toISOString().slice(0, 19);
  const frac = String(us % 1000000).padStart(6, "0");
  return `${base}${frac === "000000" ? "" : `.${frac}`}`;
}

/** `datetime.now(timezone.utc)`, in pydantic's JSON form (`…Z`). */
export const utcNow = () => `${fmtMicros(nowMicros())}Z`;
/** `datetime.utcnow()` (naive), in pydantic's JSON form. */
export const utcNowNaive = () => fmtMicros(nowMicros());

/**
 * The value with every number its model types as `float` wrapped as a PyFloat, so pyJson
 * writes `1.0` where Python's json.dumps of `model_dump()` does. Numbers in free (`Any`)
 * positions are left as they are (a PyFloat stays one).
 */
export function floatify(schema, v) {
  if (v == null || !schema) return v;
  if (schema.anyOf) {
    const b = branchOf(schema, v);
    return b ? floatify(b, v) : v;
  }
  if (schema.type === "number") return typeof v === "number" ? pyFloatValue(v) : v;
  if (schema.type === "array" && Array.isArray(v)) return v.map((x) => floatify(schema.items, x));
  if (v instanceof PyFloat || typeof v !== "object" || Array.isArray(v)) return v;
  if (schema.type === "object" && schema.properties) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = schema.properties[k] ? floatify(schema.properties[k], x) : x;
    return out;
  }
  if (schema.patternProperties) {
    const s = Object.values(schema.patternProperties)[0];
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, floatify(s, x)]));
  }
  return v;
}

/** Normalise every `DateTime()` field to pydantic's JSON form (pydantic parses and re-emits). */
function normDates(schema, v) {
  if (v == null || !schema) return v;
  if (isDateTimeSchema(schema)) return typeof v === "string" || v instanceof Date ? dtWire(v) : v;
  if (schema.anyOf) {
    const b = branchOf(schema, v instanceof Date ? "" : v) || schema.anyOf.find(isDateTimeSchema);
    return b ? normDates(b, v) : v;
  }
  if (schema.type === "array" && Array.isArray(v)) return v.map((x) => normDates(schema.items, x));
  if (v instanceof PyFloat || typeof v !== "object" || Array.isArray(v)) return v;
  if (schema.type === "object" && schema.properties) {
    for (const [k, s] of Object.entries(schema.properties)) if (k in v) v[k] = normDates(s, v[k]);
    return v;
  }
  if (schema.patternProperties) {
    const s = Object.values(schema.patternProperties)[0];
    for (const k of Object.keys(v)) v[k] = normDates(s, v[k]);
  }
  return v;
}

/**
 * `Model(**value)` / `Model.model_validate(value)`: lax conversion, unknown fields dropped,
 * defaults filled (declaration order), datetimes normalised — and PyFloat values in free
 * positions kept (the kit's `model()` deep-copies through structuredClone, which loses them).
 * Throws the kit's ModelValidationError in pydantic's words when the value can't fit.
 */
export function construct(schema, value, title) {
  const v = normDates(schema, shapeRequest(schema, laxConvert(schema, unwrapTyped(schema, pyClone(value ?? {})))));
  if (!check(schema, v)) return normDates(schema, model(schema, value, title));
  return v;
}

/**
 * `model.model_dump(exclude_none=…)` — the fields in DECLARATION order, recursing into nested
 * models (also inside lists and dicts), unknown keys dropped. Given a constructed value it is
 * the full dump; given the RAW input a client sent it is `model_dump(exclude_unset=True)`
 * (only the keys that were sent, lax-converted) — pydantic's exclude_unset needs to know
 * what was sent, so pass the request body as it arrived.
 */
export function modelDump(schema, v, { excludeNone = false } = {}) {
  if (v == null || !schema) return v;
  if (schema.anyOf) {
    const b = branchOf(schema, v);
    return b ? modelDump(b, v, { excludeNone }) : v;
  }
  if (schema.type === "array" && Array.isArray(v)) return v.map((x) => modelDump(schema.items, x, { excludeNone }));
  if (schema.type === "object" && schema.properties && isDict(v)) {
    const out = {};
    for (const [k, s] of Object.entries(schema.properties)) {
      if (!(k in v) || v[k] === undefined) continue;
      const x = modelDump(s, v[k], { excludeNone });
      if (excludeNone && x === null) continue;
      out[k] = x;
    }
    return out;
  }
  if (schema.patternProperties && isDict(v)) {
    const s = Object.values(schema.patternProperties)[0];
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, modelDump(s, x, { excludeNone })]));
  }
  return isDateTimeSchema(schema) ? dtWire(v) : laxConvert(schema, v);
}

/** `field: Model = Model()` — the nested model's own defaults, built once, as the default. */
const optModel = (schema) => opt(schema, construct(schema, {}));

// ─── Common / system ────────────────────────────────────────────────────

export const EngineHealth = T.Object({
  id: T.String(),
  name: T.String(),
  ready: T.Boolean(),
  backend: T.String(),
});

export const HealthResponse = T.Object({
  // Family health baseline (F1 Phase 2): `product` + camel `apiVersion` are what the
  // family's checkers read; the snake extras below stay for JV's own consumers.
  product: opt(T.String(), ""),
  apiVersion: opt(T.String(), ""), // camelCase on purpose — the family wire name
  status: opt(literal("ok", "degraded", "down"), "ok"),
  version: T.String(),
  api_version: T.String(),
  current_engine: opt(nullable(T.String()), null),
  // The loaded model by its own name (*Kokoro 82M*) — what the top bar and Home show; the
  // engine id above is for code (2026-10-06, one wording per fact).
  current_model: opt(nullable(T.String()), null),
  engines: opt(T.Array(EngineHealth), []),
});

export const GpuInfo = T.Object({
  vendor: T.String(),
  name: T.String(),
  vram_mb: opt(nullable(T.Integer()), null),
  driver: opt(nullable(T.String()), null),
});

export const SystemInfo = T.Object({
  os: T.String(),
  cpu_name: T.String(),
  cpu_cores: T.Integer(),
  ram_total_mb: T.Integer(),
  gpus: opt(T.Array(GpuInfo), []),
  // Detected runtime availability: cuda / vulkan / rocm / metal / cpu
  runtimes: opt(T.Record(T.String(), T.Boolean()), {}),
  ffmpeg: opt(nullable(T.Record(T.String(), T.Any())), null),
  // Server's data directory — lets the desktop shell open on-disk artifacts (the rotating
  // log file) at their real location.
  data_dir: opt(nullable(T.String()), null),
});

// ─── Settings ───────────────────────────────────────────────────────────

export const ServerSettings = T.Object({
  host: opt(T.String(), "127.0.0.1"),
  port: opt(T.Integer(), 17494),
  docs_enabled: opt(T.Boolean(), true),
});

export const LoggingSettings = T.Object({
  level: opt(T.String(), "info"),
  format: opt(T.String(), "pretty"),
});

export const CacheSettings = T.Object({
  max_memory_entries: opt(T.Integer(), 64),
  max_disk_bytes_per_scope: opt(T.Integer(), 5 * 1024 * 1024 * 1024),
  enabled: opt(T.Boolean(), true),
});

export const LimitsSettings = T.Object({
  text_max_chars: opt(T.Integer(), 50_000),
  chapter_max_lines: opt(T.Integer(), 5_000),
  reference_clip_max_bytes: opt(T.Integer(), 50 * 1024 * 1024),
  request_body_max_bytes: opt(T.Integer(), 100 * 1024 * 1024),
});

/**
 * Knobs for the chunked TTS pipeline. Long text is split at sentence boundaries into
 * chunks, generated per-chunk via the active engine, then concatenated with a short
 * crossfade to eliminate clicks. Short text (≤ max_chunk_chars) skips chunking.
 */
export const GenerationSettings = T.Object({
  max_chunk_chars: opt(T.Integer(), 800), // 100-5000 in UI slider
  crossfade_ms: opt(T.Integer(), 50), // 0-200 in UI slider; 0 = hard cut
  // Audition streaming: GET /preview/stream splits the line into pieces of at most this
  // many characters and sends each as it renders, so playback starts after the first
  // piece. Sentence-sized on purpose — max_chunk_chars is a truncation guard.
  stream_piece_chars: opt(T.Integer(), 200), // 80-800 in UI slider
  // The silence between two lines of a chapter (decided 2026-09-29): ONE value for
  // Studio's Render, the export and ACX QC. A line's own pause still overrides it.
  pause_between_lines_ms: opt(T.Integer(), 600), // 0-3000 in the UI
  // The silence after a line that ends one of the book's scenes, inside a chapter
  // (decided 2026-10-06). Joins lines only: never in a line's delivery, so changing it
  // renders nothing again. A line's own pause still wins.
  pause_at_scene_break_ms: opt(T.Integer(), 2000), // 0-6000 in the UI
  // The silence between two lines cut from one paragraph (decided 2026-10-07). Joins lines
  // only, like the scene break; a line's own pause still wins.
  pause_within_paragraph_ms: opt(T.Integer(), 250), // 0-3000 in the UI
  // The language a voice speaks when nothing else decides it — today, a Kokoro blend of
  // voices in different languages (engines/blending.blend_language). BCP-47.
  default_voice_language: opt(T.String(), "en-US"),
  normalize_audio: opt(T.Boolean(), true),
});

export const CorsSettings = T.Object({
  // The bundled UI runs from a different origin than the loopback server; browsers enforce
  // CORS on fetch(), so these must be allowed. Operator-tunable via PATCH /v1/settings.
  origins: opt(T.Array(T.String()), [
    "http://localhost:1430",
    "http://127.0.0.1:1430",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
  ]),
  // Regex fallback so arbitrary loopback dev ports (and the tauri scheme) work without
  // re-listing each one. Empty string disables it.
  origin_regex: opt(
    T.String(),
    "^(https?://(localhost|127\\.0\\.0\\.1)(:\\d+)?|tauri://localhost|https?://tauri\\.localhost)$",
  ),
});

export const AuthSettings = T.Object({
  tokens: opt(T.Array(T.String()), []),
  require_for_loopback: opt(T.Boolean(), false),
});

export const MasterPreset = T.Object({
  loudness_target_lufs: T.Number(),
  true_peak_dbfs: T.Number(),
  loudness_range_lu: T.Number(),
  sample_rate: T.Integer(),
  channels: T.Integer(),
  format: T.String(),
  bitrate_kbps: T.Integer(),
  head_silence_secs: T.Number(),
  tail_silence_secs: T.Number(),
});

// ACX spec: -23 to -18 LUFS, true peak <= -3 dB, noise floor <= -60 dB RMS, 44.1 kHz /
// 16-bit / mono / MP3 192 kbps CBR for retail audio. We center LUFS at -20 (safely inside
// -23/-18) and add 0.5 dB peak headroom (-3.5) so production variance doesn't push peaks
// over the ACX limit.
export const MasterPresetSettings = T.Object({
  acx: opt(MasterPreset, {
    loudness_target_lufs: -20.0,
    true_peak_dbfs: -3.5,
    loudness_range_lu: 7.0,
    sample_rate: 44_100,
    channels: 1,
    format: "mp3",
    bitrate_kbps: 192,
    head_silence_secs: 0.75,
    tail_silence_secs: 3.0,
  }),
  inaudio: opt(MasterPreset, {
    loudness_target_lufs: -19.0,
    true_peak_dbfs: -3.0,
    loudness_range_lu: 7.0,
    sample_rate: 44_100,
    channels: 1,
    format: "mp3",
    bitrate_kbps: 192,
    head_silence_secs: 0.75,
    tail_silence_secs: 3.0,
  }),
  podcast: opt(MasterPreset, {
    loudness_target_lufs: -16.0,
    true_peak_dbfs: -1.0,
    loudness_range_lu: 10.0,
    sample_rate: 44_100,
    channels: 2,
    format: "mp3",
    bitrate_kbps: 128,
    head_silence_secs: 0.5,
    tail_silence_secs: 1.0,
  }),
  youtube: opt(MasterPreset, {
    loudness_target_lufs: -14.0,
    true_peak_dbfs: -1.0,
    loudness_range_lu: 11.0,
    sample_rate: 48_000,
    channels: 2,
    format: "mp3",
    bitrate_kbps: 192,
    head_silence_secs: 0.5,
    tail_silence_secs: 1.0,
  }),
});

/**
 * Operator-provided source for one engine model variant. Engine model HF repos live in each
 * engine's manifest VARIANTS as defaults; the operator can point a variant at another repo
 * (a mirror, a fork) here. The variant's pinned file names are kept.
 */
export const EngineModelSourceOverride = T.Object({
  hf_repo: opt(nullable(T.String()), null),
  hf_revision: opt(nullable(T.String()), null), // pin a commit / tag
});

/** Per-engine operator overrides (download sources by variant, the default model, …). */
export const EngineOverrides = T.Object({
  sources: opt(T.Record(T.String(), EngineModelSourceOverride), {}),
  // The operator's own default MODEL for this engine (a USER layer over the manifest's
  // DEFAULT_VARIANT_ID). None = manifest default.
  default_variant: opt(nullable(T.String()), null),
  // Where each of this engine's models runs — variant id → "auto" | "gpu" | "cpu" (CPU
  // placement, 2026-10-02). A variant not listed is "auto".
  placements: opt(T.Record(T.String(), literal("auto", "gpu", "cpu")), {}),
  // The longest piece a line reaches each model in — variant id → characters. A variant not
  // listed uses its catalog default; none at all = `generation.max_chunk_chars`.
  split_chars: opt(T.Record(T.String(), T.Integer()), {}),
  // The speech runtime's per-model options the user set — variant id → {option: value},
  // only values other than the default. Passed as session options when the model loads.
  runtime_options: opt(T.Record(T.String(), T.Record(T.String(), T.String())), {}),
  // When the user accepted the engine's own terms (Pocket TTS: Kyutai's prohibited-use
  // terms, which gate cloning). ISO-8601; None = not accepted.
  terms_accepted_at: opt(nullable(T.String()), null),
});

/**
 * The ONE audio.cpp runtime every speech engine shares (the 2026-10-01 switch). Set on the
 * AI page's runtime row through PUT /v1/speech-runtime.
 */
export const SpeechRuntimeSettings = T.Object({
  // "auto" = this machine's choice; "cuda" | "vulkan" | "cpu" | "metal" pins that build.
  backend: opt(T.String(), "auto"),
  // Which GPU the server runs on (audio.cpp's `device` — 0 = the first).
  gpu: opt(T.Integer(), 0),
  // The second, CPU-only process: how many threads it computes with. 0 = this machine's
  // physical core count.
  cpu_threads: opt(T.Integer(), 0),
  // "Fast enough on the CPU" for Auto: seconds of audio per second of work (decided 2×).
  cpu_min_realtime: opt(T.Number(), 2.0),
  // The graphics-card process's CPU threads — its work off the card (text, sampling).
  gpu_threads: opt(T.Integer(), 4),
  // How long a process may take to come up before its start counts as failed.
  start_timeout_s: opt(T.Number(), 60.0),
  // How long one request may run — a line, a model load.
  request_timeout_s: opt(T.Number(), 900.0),
});

export const ExternalEngineConfig = T.Object({
  id: T.String(),
  name: T.String(),
  base_url: opt(T.String(), ""),
  api_key: opt(nullable(T.String()), null),
  model: opt(T.String(), ""),
  voices: opt(T.Array(T.String()), []),
  response_format: opt(T.String(), "wav"),
  // The user runs this server themselves (localhost/LAN) — free, private, no install.
  self_hosted: opt(T.Boolean(), false),
  // TTS provider type discriminator; "openai-compat" matches the prior single pattern.
  provider_type: opt(T.String(), "openai-compat"),
});

export const EnginesSettings = T.Object({
  // Per-engine operator overrides — engine_id -> overrides.
  engine_overrides: opt(T.Record(T.String(), EngineOverrides), {}),
  // Preferred TTS engine for create flows + first-render auto-setup. Engine id.
  default_tts_engine: opt(T.String(), "kokoro"),
  // The audio.cpp runtime's backend and GPU — one for every speech engine.
  speech_runtime: optModel(SpeechRuntimeSettings),
  external: opt(T.Array(ExternalEngineConfig), []),
  // LEGACY LLM provider list — dormant since 2026-08-01 (providers live in the shared DB
  // store); the field STAYS because migrate_providers reads it to upgrade old installs.
  llm: opt(T.Array(LLMProviderConfig), []),
});

export const ModelsSettings = T.Object({
  url_overrides: opt(T.Record(T.String(), T.String()), {}),
});

export const UseCase = literal("audiobook", "game", "podcast", "dictation", "accessibility", "multiple", "unset");

/**
 * Dictation capture + refinement defaults. Hotkey/chord fields are consumed by the desktop
 * shell; the server stores them so every window + CLI client reads the same preferences.
 */
export const CapturesSettings = T.Object({
  stt_model: opt(T.String(), "qwen3-asr-1.7b-q8"), // variant id on the asr engine
  language: opt(T.String(), "auto"),
  auto_refine: opt(T.Boolean(), true),
  llm_model: opt(T.String(), "qwen3-llm-0.6b"), // variant id on the qwen3-llm engine
  smart_cleanup: opt(T.Boolean(), true),
  self_correction: opt(T.Boolean(), true),
  preserve_technical: opt(T.Boolean(), true),
  hotkey_enabled: opt(T.Boolean(), false),
  chord_push_to_talk_keys: opt(T.Array(T.String()), ["ControlRight", "ShiftRight"]),
  chord_toggle_to_talk_keys: opt(T.Array(T.String()), ["ControlRight", "ShiftRight", "Space"]),
});

/** MCP server (/mcp) behaviour. The default voice applies when an agent calls
 * justvoice.speak with no voice/persona and no per-client binding. */
export const MCPSettings = T.Object({
  default_voice: opt(nullable(T.String()), null),
});

/**
 * Speaker-attribution routing (the Auto simplification, 2026-08-06). `direct_min_b`: Direct
 * when the model is at least this many billion parameters, otherwise Guided (a MoE counts
 * TOTAL params). The API floor mirrors the pane input's min=0.1 — zero or a negative would
 * route EVERY model to Direct. Chapter splitting (2026-09-28) and the second look
 * (2026-10-05; off by default since 2026-10-06) below.
 */
export const ExtractionSettings = T.Object({
  direct_min_b: opt(T.Number({ minimum: 0.1 }), 14.0),
  split_lead_in_paragraphs: opt(T.Integer({ minimum: 0 }), 6),
  answer_tokens_per_line: opt(T.Integer({ minimum: 1 }), 65),
  second_look: opt(T.Boolean(), false),
  second_look_words: opt(T.Integer({ minimum: 50 }), 1500), // either side of the line
  second_look_before: opt(T.Integer({ minimum: 0 }), 800), // the end of the chapter before
  second_look_after: opt(T.Integer({ minimum: 0 }), 1500), // the start of the chapter after
});

/** First-run onboarding + cross-cutting UI preferences. */
export const AppSettings = T.Object({
  primary_use_case: opt(UseCase, "unset"),
  secondary_use_cases: opt(T.Array(UseCase), []),
  onboarding_shown: opt(T.Boolean(), false),
});

export const Settings = T.Object({
  server: optModel(ServerSettings),
  logging: optModel(LoggingSettings),
  cache: optModel(CacheSettings),
  limits: optModel(LimitsSettings),
  cors: optModel(CorsSettings),
  auth: optModel(AuthSettings),
  mastering: optModel(MasterPresetSettings),
  models: optModel(ModelsSettings),
  engines: optModel(EnginesSettings),
  generation: optModel(GenerationSettings),
  captures: optModel(CapturesSettings),
  mcp: optModel(MCPSettings),
  extraction: optModel(ExtractionSettings),
  app: optModel(AppSettings),
});

/** Partial-update shape; every field optional. Mirrors Settings. */
export const SettingsPatch = T.Object({
  server: opt(nullable(ServerSettings), null),
  logging: opt(nullable(LoggingSettings), null),
  cache: opt(nullable(CacheSettings), null),
  limits: opt(nullable(LimitsSettings), null),
  cors: opt(nullable(CorsSettings), null),
  auth: opt(nullable(AuthSettings), null),
  mastering: opt(nullable(MasterPresetSettings), null),
  models: opt(nullable(ModelsSettings), null),
  engines: opt(nullable(EnginesSettings), null),
  generation: opt(nullable(GenerationSettings), null),
  captures: opt(nullable(CapturesSettings), null),
  mcp: opt(nullable(MCPSettings), null),
  extraction: opt(nullable(ExtractionSettings), null),
  app: opt(nullable(AppSettings), null),
});

export const SettingsPatchResponse = T.Object({
  settings: Settings,
  restart_required: opt(T.Array(T.String()), []),
});

// ─── Voices ─────────────────────────────────────────────────────────────

// ("lora" — a trained voice — left with training on 2026-10-02, no alias.)
export const VoiceSource = literal("preset", "cloned", "designed", "imported", "blended");
export const StoredVoiceSource = literal("cloned", "designed", "imported", "blended");

// How a blended voice was made:
//   blend       Σ(wⱼ·vⱼ)/Σw — a mix. Weights are shares, so it normalizes.
//   extrapolate mean + k·(v − mean) — one voice pushed away from the pack's average.
//   vector      A + B − C, the word2vec analogy. Does NOT normalize.
//   recombine   contiguous slices of the feature axis taken from different voices.
export const BlendStrategy = literal("blend", "extrapolate", "vector", "recombine");

/** One slice of the style vector's feature axis, as fractions of it (Kokoro: the first half
 * conditions timbre, the second half prosody). */
export const BlendSegment = T.Object({
  voice_id: T.String(),
  start: opt(T.Number(), 0.0),
  end: opt(T.Number(), 1.0),
});

export const BlendRecipe = T.Object({
  // `strategy` is stored, not derived: two strategies can produce the same numbers from the
  // same sources and the recipe is how a voice explains itself later.
  strategy: opt(BlendStrategy, "blend"),
  sources: opt(T.Array(T.String()), []),
  weights: opt(T.Array(T.Number()), []),
  // recombine only; None for every weighted strategy.
  segments: opt(nullable(T.Array(BlendSegment)), null),
});

export const VoiceRecord = T.Object({
  id: T.String(),
  engine: T.String(),
  // The model this voice was made for — the capability row id (2026-10-03). A voice saved
  // before models were stored has none; `voice_model.model_for_stored` answers for it.
  model: opt(nullable(T.String()), null),
  source: StoredVoiceSource,
  name: T.String(),
  language: T.String(),
  gender: opt(nullable(T.String()), null),
  design_prompt: opt(nullable(T.String()), null),
  transcript: opt(nullable(T.String()), null),
  // Qwen3 Base: clone from the speaker vector alone ("Skip the words").
  xvector_only: opt(T.Boolean(), false),
  sample_count: opt(T.Integer(), 0),
  blend_recipe: opt(nullable(BlendRecipe), null),
  embedding: opt(nullable(T.Array(T.Number())), null),
  created_at: DateTime(),
  updated_at: DateTime(),
});

export const Voice = T.Object({
  id: T.String(),
  engine: T.String(),
  source: VoiceSource,
  name: T.String(),
  language: T.String(),
  gender: opt(T.String(), ""),
  sample_url: opt(nullable(T.String()), null),
  // What speaks it, from `voice_model` — one server answer for every screen (2026-10-03).
  model: opt(T.String(), ""),
  model_name: opt(T.String(), ""),
  directed_by: opt(T.String(), ""),
  speaks: opt(T.Array(T.String()), []),
  // A designed voice's description — what it speaks from (no clip) or was designed from.
  design_prompt: opt(nullable(T.String()), null),
});

/** POST /v1/voices/clip-check — a clip about to be cloned, decoded to WAV by the page. */
export const ClipCheckRequest = T.Object({ wav_b64: T.String() });

/** How long the clip is, and how far its speech stands above its noise in dB. */
export const ClipCheckResponse = T.Object({
  seconds: T.Number(),
  noise_margin_db: opt(nullable(T.Number()), null),
});

export const VoiceList = T.Object({ voices: T.Array(Voice) });

/** PATCH /v1/voices/{id} — metadata only. None means "leave unchanged". */
export const UpdateVoiceRequest = T.Object({
  name: opt(nullable(T.String()), null),
  language: opt(nullable(T.String()), null),
  gender: opt(nullable(T.String()), null),
});

export const CloneVoiceRequest = T.Object({
  engine: T.String(),
  // The model the clone is made for; left out = the engine's default model that can clone.
  model: opt(nullable(T.String()), null),
  name: T.String(),
  ref_wav_b64: T.String(),
  language: opt(T.String(), "en-US"),
  gender: opt(nullable(T.String()), null),
  transcript: opt(nullable(T.String()), null),
  xvector_only: opt(T.Boolean(), false), // Qwen3 Base's "Skip the words"
});

export const DesignVoiceRequest = T.Object({
  engine: T.String(),
  model: opt(nullable(T.String()), null),
  name: T.String(),
  prompt: T.String(),
  language: opt(T.String(), "en-US"),
  gender: opt(nullable(T.String()), null),
});

/** POST /v1/voices/{id}/copy — the same clip as a new voice on another model. */
export const CopyVoiceRequest = T.Object({
  model: T.String(),
  name: opt(nullable(T.String()), null),
  transcript: opt(nullable(T.String()), null),
  xvector_only: opt(nullable(T.Boolean()), null),
});

// ─── Personas ───────────────────────────────────────────────────────────

/**
 * What a persona sets that only one MODEL understands (2026-10-03) — kept per model, so
 * switching a persona to another model and back restores them. `emotion` is in the model's
 * own vocabulary; `register_tag` is a tag model's register.
 */
export const PersonaModelSettings = strictObject({
  // The model's own sampling knobs, keyed as its capability row names them.
  knobs: opt(T.Record(T.String(), T.Number()), {}),
  seed: opt(nullable(T.Integer()), null),
  emotion: opt(nullable(T.String()), null),
  register_tag: opt(nullable(T.String()), null),
});

/**
 * How a persona speaks, on top of its voice (2026-10-03). Pace, pitch, gain and the pauses
 * are done on the server, so every model takes them. Everything a model understands only for
 * itself lives under `models[<model id>]`. Extra keys from before this shape are ignored.
 */
export const PersonaDelivery = T.Object({
  speed: opt(nullable(T.Number({ minimum: 0.5, maximum: 2.0 })), null),
  pitch: opt(nullable(T.Number({ minimum: -12.0, maximum: 12.0 })), null),
  gain_db: opt(nullable(T.Number({ minimum: -12.0, maximum: 12.0 })), null),
  pause_before: opt(nullable(T.Integer({ minimum: 0, maximum: 10000 })), null),
  pause_after: opt(nullable(T.Integer({ minimum: 0, maximum: 10000 })), null),
  models: opt(T.Record(T.String(), PersonaModelSettings), {}),
});

const PERSONA_PROPS = {
  id: T.String(),
  name: T.String(),
  // Optional — a persona can be saved before its voice is picked.
  voice_id: opt(nullable(T.String()), null),
  language: opt(T.String(), "en"),
  avatar_path: opt(nullable(T.String()), null),
  // Spoken-delivery instruction — the ONE field that changes the audio. **Never an LLM
  // rewrite of the manuscript.**
  voice_instruct: opt(nullable(T.String()), null),
  // A short note on how it sounds. Read by Compose / Rewrite and Smart-assign; never by an
  // engine.
  note: opt(nullable(T.String()), null),
  // How it speaks (`PersonaDelivery`). A request's own delivery sits on top.
  default_delivery: optModel(PersonaDelivery),
  // Effects chain — applied after TTS produces WAV. List of {type, params}; runs on every
  // line this persona speaks. (Numbers here come from stored text through pyJsonParse —
  // a whole-number float is a PyFloat, so the render-cache key keeps Python's "1.0".)
  effects_chain: opt(T.Array(T.Record(T.String(), T.Any())), []),
  lexicon_id: opt(nullable(T.String()), null),
  // Legacy rewrite-toggle fields, accepted but not persisted.
  llm_rewrite_enabled: opt(T.Boolean(), false),
  llm_model: opt(nullable(T.String()), null),
  imported_from: opt(nullable(T.String()), null),
  imported_id: opt(nullable(T.String()), null),
  created_at: DateTime(),
  updated_at: DateTime(),
};

/** A finished spoken voice — the library's unit (2026-09-29 split). It plays speakers. */
export const Persona = T.Object(PERSONA_PROPS);

/** A persona as the API shows it: the stored persona plus what its voice makes of it. */
export const PersonaView = T.Object({
  ...PERSONA_PROPS,
  model: opt(nullable(T.String()), null),
  model_name: opt(nullable(T.String()), null),
  directed_by: opt(nullable(T.String()), null),
  speaks: opt(nullable(T.String()), null),
});

export const PersonaList = T.Object({ personas: T.Array(PersonaView) });

export const CreatePersonaRequest = T.Object({
  name: T.String(),
  voice_id: opt(nullable(T.String()), null),
  // Left out = the voice's own language (or "en" with no voice yet).
  language: opt(nullable(T.String()), null),
  avatar_path: opt(nullable(T.String()), null),
  voice_instruct: opt(nullable(T.String()), null),
  note: opt(nullable(T.String()), null),
  default_delivery: optModel(PersonaDelivery),
  effects_chain: opt(T.Array(T.Record(T.String(), T.Any())), []),
  lexicon_id: opt(nullable(T.String()), null),
  // Legacy — see Persona model
  llm_rewrite_enabled: opt(T.Boolean(), false),
  llm_model: opt(nullable(T.String()), null),
});

/** PATCH /v1/personas/{id} — a field left out is unchanged; a field sent as null is CLEARED. */
export const UpdatePersonaRequest = strictObject({
  name: opt(nullable(T.String()), null),
  voice_id: opt(nullable(T.String()), null),
  language: opt(nullable(T.String()), null),
  avatar_path: opt(nullable(T.String()), null),
  voice_instruct: opt(nullable(T.String()), null),
  note: opt(nullable(T.String()), null),
  default_delivery: opt(nullable(PersonaDelivery), null),
  effects_chain: opt(nullable(T.Array(T.Record(T.String(), T.Any()))), null),
  lexicon_id: opt(nullable(T.String()), null),
});

/** A persona as the editor holds it, saved or not — what a Listen renders. */
export const PersonaDraft = T.Object({
  name: opt(T.String(), ""),
  voice_id: opt(nullable(T.String()), null),
  language: opt(nullable(T.String()), null),
  voice_instruct: opt(nullable(T.String()), null),
  default_delivery: optModel(PersonaDelivery),
  effects_chain: opt(T.Array(T.Record(T.String(), T.Any())), []),
  lexicon_id: opt(nullable(T.String()), null),
});

/** POST /v1/personas/preview — hear a persona speak a line, through the chapter resolver. */
export const PersonaPreviewRequest = T.Object({
  persona_id: opt(nullable(T.String()), null),
  persona: opt(nullable(PersonaDraft), null),
  text: opt(T.String({ maxLength: 2000 }), ""),
  // A line's own direction, as a chapter line would carry it (Compare).
  direction: opt(nullable(T.String()), null),
  // One-off delivery on top of the persona's (Compare settings).
  delivery: opt(nullable(T.Record(T.String(), T.Any())), null),
  // False: refuse with `engine_not_loaded:<engine>` instead of loading the voice's model.
  auto_load: opt(T.Boolean(), true),
  // Keep the take 10 minutes and answer with its id (effect_presets_api.HeldTakeResponse), so
  // POST /v1/effects/apply can put a chain on the same audio — the chain editor's A / B.
  hold: opt(T.Boolean(), false),
});

/** POST /v1/personas/{id}/merge — every speaker this persona plays moves to `into`. */
export const MergePersonaRequest = T.Object({ into: T.String() });

// ─── Speakers — the people in one book ──────────────────────────────────

// A speaker's pronouns — read by Script's Analyze and Smart-assign, never heard.
export const Pronouns = literal("he/him", "she/her", "they/them", "it/its");

/** A person in one book (2026-09-29). `lines` counts the lines they read. */
export const Speaker = T.Object({
  id: T.String(),
  project_id: T.String(),
  name: T.String(),
  // "Also called" — the other names the text uses.
  aliases: opt(T.Array(T.String()), []),
  // "Who they are" — read by the AI, never heard.
  description: opt(nullable(T.String()), null),
  // The persona that plays them; null = not cast yet.
  persona_id: opt(nullable(T.String()), null),
  persona_name: opt(nullable(T.String()), null),
  // "narrator" for the book's narrator.
  role_label: opt(nullable(T.String()), null),
  pronouns: opt(nullable(Pronouns), null),
  lines: opt(T.Integer(), 0),
  // Where the speaker came from ("justwrite"); null = added here.
  imported_from: opt(nullable(T.String()), null),
});

export const SpeakerList = T.Object({ speakers: T.Array(Speaker) });

export const CreateSpeakerRequest = T.Object({
  name: T.String({ minLength: 1, maxLength: 200 }),
  aliases: opt(T.Array(T.String()), []),
  description: opt(nullable(T.String()), null),
  // Left out = cast by an exact persona name when one exists.
  persona_id: opt(nullable(T.String()), null),
  pronouns: opt(nullable(Pronouns), null),
});

/** Left out = unchanged. `persona_id` sent as null = un-cast; `pronouns` null = not set. */
export const UpdateSpeakerRequest = T.Object({
  name: opt(nullable(T.String({ minLength: 1, maxLength: 200 })), null),
  aliases: opt(nullable(T.Array(T.String())), null),
  description: opt(nullable(T.String()), null),
  persona_id: opt(nullable(T.String()), null),
  pronouns: opt(nullable(Pronouns), null),
});

// ─── Lexicons ───────────────────────────────────────────────────────────

export const LexiconEntry = T.Object({
  grapheme: T.String(),
  phoneme_ipa: opt(nullable(T.String()), null),
  alias: opt(nullable(T.String()), null),
});

export const Lexicon = T.Object({
  id: T.String(),
  name: T.String(),
  entries: opt(T.Array(LexiconEntry), []),
  // Scope discriminator: "global" | "project" (set project_id) | "persona" (set persona_id).
  scope: opt(T.String(), "global"),
  description: opt(nullable(T.String()), null),
  project_id: opt(nullable(T.String()), null),
  persona_id: opt(nullable(T.String()), null),
  created_at: DateTime(),
  updated_at: DateTime(),
});

export const LexiconList = T.Object({ lexicons: T.Array(Lexicon) });

// What a lexicon reaches (Lexicons' "Affects" and "Try a word", 2026-10-09): the books that read
// it as their lexicon, the personas that read it as theirs or speak in those books, and how many
// lines contain one of its words.
const NamedRef = T.Object({ id: T.String(), name: T.String() });
export const LexiconReach = T.Object({
  lines: T.Integer(),
  projects: T.Array(NamedRef),
  personas: T.Array(NamedRef),
});

export const CreateLexiconRequest = T.Object({
  name: T.String(),
  entries: opt(T.Array(LexiconEntry), []),
  scope: opt(T.String(), "global"),
  description: opt(nullable(T.String()), null),
  project_id: opt(nullable(T.String()), null),
  persona_id: opt(nullable(T.String()), null),
});

// ─── Engines / catalog ─────────────────────────────────────────────────

export const EngineStatus = literal("not_installed", "installing", "installed", "loading", "loaded");

export const Feature = literal(
  "preset_voices",
  "voice_cloning",
  "voice_design",
  "instruct_field",
  "paralinguistic_tags",
  "phoneme_override",
  "gpu_accel",
  "single_speaker_dialogue",
  "voice_blending",
);

export const Prerequisites = T.Object({
  rust_feature: opt(nullable(T.String()), null),
  rust_native: opt(T.Boolean(), false),
  sidecar: opt(T.Boolean(), false),
  model_files_needed: opt(T.Array(T.String()), []),
  gpu_runtimes: opt(T.Array(T.String()), []),
});

export const EngineInfo = T.Object({
  id: T.String(),
  name: T.String(),
  description: T.String(),
  backend: T.String(),
  // Runtime-registered providers the user hosts themselves — LOCAL-tab placement.
  self_hosted: opt(T.Boolean(), false),
  capabilities: opt(T.Array(Feature), []),
  prerequisites: optModel(Prerequisites),
  status: opt(EngineStatus, "not_installed"),
  current: opt(T.Boolean(), false),
  is_stubbed: opt(T.Boolean(), false),
  // The variant `POST /v1/engines/<id>/load` (no `model_variant`) actually loads.
  default_variant_id: opt(nullable(T.String()), null),
  // Engine discriminator (tts / llm / embedding).
  kind: opt(T.String(), "tts"),
  // Full capability list (manifest KINDS, falling back to [KIND]). `kind` = kinds[0].
  kinds: opt(T.Array(T.String()), []),
  // The variant currently loaded for this engine (server-truth); null when not loaded.
  current_variant_id: opt(nullable(T.String()), null),
  // "audiocpp" since 2026-10-01; external (in-process) providers carry "".
  isolation: opt(T.String(), ""),
  // OSes this engine works on, straight from the manifest ("windows" | "linux" | "macos").
  supported_oses: opt(T.Array(T.String()), []),
  // The verdict, computed server-side: is THIS host's OS in that list?
  supported_on_this_os: opt(T.Boolean(), true),
  // Non-empty = marked for removal; the string is the reason, shown to the user.
  deprecated: opt(T.String(), ""),
  // Model-weights license — distinct from framework code license.
  weights_license: opt(T.String(), ""),
  // Where the last confirmed load actually runs ("cuda", "vulkan", "cpu", "metal").
  resolved_device: opt(nullable(T.String()), null),
  // Why the loaded model runs there, in the user's words. "" = not loaded.
  placement_reason: opt(T.String(), ""),
  // The engine's own terms, when it has some — {title, text, url, gates}; None = no terms.
  terms: opt(nullable(T.Record(T.String(), T.String())), null),
  terms_accepted: opt(T.Boolean(), false),
});

export const EnginesListResponse = T.Object({
  engines: T.Array(EngineInfo),
  current: opt(nullable(T.String()), null),
});

// ─── The memory budget strip (the 2026-08-13 VRAM wiring, Q3/Q4) ─────────

/** One resident booking in the shared ledger. `source`: measured | computed | declared. */
export const VramReservation = T.Object({
  key: T.String(),
  vram_mb: T.Integer(),
  pinned: opt(T.Boolean(), false),
  kind: opt(T.String(), "llm"),
  source: opt(T.String(), "computed"),
  // ASLEEP: the AI runner idle-unloaded this model, so the booking names memory the card is
  // not currently holding. Excluded from `committed_mb`.
  asleep: opt(T.Boolean(), false),
  // Engine display name, joined server-side.
  label: opt(T.String(), ""),
});

/** One LOADED speech engine, pre-joined for the strip's cells. */
export const VramLoadedRow = T.Object({
  key: T.String(), // "tts:chatterbox"
  kind: T.String(),
  label: T.String(),
  model: opt(T.String(), ""),
  device: opt(T.String(), ""),
});

/** The on-demand LLM's predicted footprint. `ram_mb` is display-only. */
export const VramClaim = T.Object({
  model: T.String(),
  vram_mb: T.Integer(),
  ram_mb: opt(T.Integer(), 0),
  source: opt(T.String(), "computed"),
  matches: opt(T.Integer(), 0),
});

/** One eviction from the arbiter's event ring. */
export const VramEvent = T.Object({
  seq: T.Integer(),
  at: T.Integer(),
  victim_key: T.String(),
  victim_kind: T.String(),
  reason: opt(T.String(), ""),
});

/** One engine process tree whose server is gone (2026-09-29). */
export const LeftoverEngine = T.Object({
  pid: T.Integer(),
  engine_id: T.String(),
  engine_name: T.String(),
  started: T.Number(), // epoch seconds
  server_pid: opt(nullable(T.Integer()), null), // the server that started it, when known
  gpu_mb: opt(nullable(T.Integer()), null), // None = unmeasurable on this box
});

/** `GET /v1/engines/leftovers` and `POST /v1/engines/leftovers/stop`. */
export const LeftoverEnginesResponse = T.Object({
  leftovers: T.Array(LeftoverEngine),
  gpu_mb: opt(nullable(T.Integer()), null), // summed; None when nothing could be measured
});

/** `GET /v1/engines/vram` — the one budget view. `mem_arch` drives the strip's label. */
export const EngineVramResponse = T.Object({
  mem_arch: T.String(),
  total_mb: T.Integer(),
  committed_mb: T.Integer(),
  // Booked INCLUDING models the AI runner has put to sleep.
  booked_mb: opt(T.Integer(), 0),
  remaining_mb: T.Integer(),
  // The MEASURED pool state — `used_mb` is what nvidia-smi would print (None =
  // unmeasurable), `other_mb` the slice the ledger can't attribute.
  used_mb: opt(nullable(T.Integer()), null),
  other_mb: opt(T.Integer(), 0),
  reservations: opt(T.Array(VramReservation), []),
  loaded: opt(T.Array(VramLoadedRow), []),
  busy_kinds: opt(T.Array(T.String()), []),
  claim: opt(nullable(VramClaim), null),
  // Why there is no claim when claim is null: "cloud-routed" | "not-configured" | "unavailable".
  claim_reason: opt(nullable(T.String()), null),
  events: opt(T.Array(VramEvent), []),
});

export const CurrentEngineResponse = T.Object({
  engine: opt(nullable(EngineInfo), null),
});

// ─── Engine capability detail (drives Generate UI gating) ───────────────

/** A continuous-value control (slider + number input). */
export const KnobSpec = T.Object({
  key: T.String(), // e.g. "temperature" / "exaggeration" / "cfg_weight" / "speed"
  label: T.String(),
  min: T.Number(),
  max: T.Number(),
  step: T.Number(),
  default: T.Number(),
  unit: opt(T.String(), ""), // display suffix, e.g. "×" / "st" / "dB"
  hint: opt(T.String(), ""),
  advanced: opt(T.Boolean(), false), // hide behind a Show-advanced toggle
});

/**
 * A category of inline tags this engine's tokenizer recognizes. `value_map` maps
 * JustVoice's own `Delivery.emotion` values onto THIS engine's tag values (only
 * `category="emotion"` sets carry it); an enum value missing from the map is NOT
 * expressible here.
 */
export const InlineTagSet = T.Object({
  category: T.String(),
  label: T.String(),
  tags: T.Array(T.String()),
  syntax: T.String(), // f-string with {value}, e.g. "<|emotion:{value}|>"
  placement: opt(literal("start_of_turn", "inline_anywhere"), "inline_anywhere"),
  hint: opt(T.String(), ""),
  value_map: opt(nullable(T.Record(T.String(), T.String())), null),
});

/** Per-engine (or per-variant) capability surface for UI gating. */
export const EngineCapabilityDetail = T.Object({
  engine_id: T.String(),
  display_name: T.String(),
  supports_voice_cloning: opt(T.Boolean(), false),
  supports_clone_prompt_text: opt(T.Boolean(), false), // ref-audio transcript field
  supports_voice_design: opt(T.Boolean(), false), // qwen3-style description
  supports_instruct_freeform: opt(T.Boolean(), false), // qwen3-style prose textarea
  supports_phoneme_input: opt(T.Boolean(), false), // kokoro raw-IPA bypass
  // Clone from the speaker vector alone, skipping the reference transcript.
  supports_xvector_only: opt(T.Boolean(), false),
  supports_multi_speaker: opt(T.Boolean(), false), // MOSS speaker_prompts map
  supports_voice_blending: opt(T.Boolean(), false), // style-vector averaging (kokoro)
  knobs: opt(T.Array(KnobSpec), []),
  inline_tags: opt(T.Array(InlineTagSet), []),
  // [min, max] semitones of the engine's own pitch range; post-process pitch otherwise.
  pitch_native_st_range: opt(nullable(T.Array(T.Integer())), null),
  pitch_post_process: opt(T.Boolean(), false),
  // True when the model paces itself (Kokoro, KittenTTS take a speed).
  speed_native: opt(T.Boolean(), false),
  notes: opt(T.Array(T.String()), []),
});

/** `GET /v1/engines/capabilities` payload. */
export const EngineCapabilitiesResponse = T.Object({
  engines: T.Record(T.String(), EngineCapabilityDetail),
  // The canonical `Delivery.emotion` vocabulary, served so the picker can never drift.
  emotion_values: opt(T.Array(T.String()), []),
});

export const ModelFile = T.Object({
  url: T.String(),
  sha256: T.String(),
  target_path: T.String(),
  size_bytes: T.Integer(),
});

export const RuntimeOptionChoice = T.Object({ value: T.String(), label: T.String() });

/** One of a model's speech-runtime options, as its row on Speech engines shows it. */
export const RuntimeOption = T.Object({
  key: T.String(), // the runtime's session-option name, e.g. "qwen3_tts.perf_mode"
  label: T.String(),
  hint: opt(T.String(), ""),
  default: T.String(),
  value: T.String(), // what this model loads with
  choices: opt(T.Array(RuntimeOptionChoice), []),
});

export const ModelVariant = T.Object({
  // No vram_mb here: a variant's memory footprint is MEASURED at load time. size_mb is the
  // DOWNLOAD size — the sum of the manifest's pinned real file sizes.
  id: T.String(),
  name: T.String(),
  description: T.String(),
  size_mb: T.Integer(),
  quality: T.Integer(),
  languages: T.Array(T.String()),
  voice_cloning: opt(nullable(T.Boolean()), null),
  voice_design: opt(nullable(T.Boolean()), null),
  preset_voices: opt(nullable(T.Integer()), null),
  weights_license: opt(T.String(), ""),
  hf_repo: opt(nullable(T.String()), null),
  url: opt(nullable(T.String()), null),
  files: opt(T.Array(ModelFile), []),
  // Weights present locally (speech cache first, then a legacy HF-cache install).
  on_disk: opt(nullable(T.Boolean()), null),
  // Where those weights live when on_disk — for the desktop "Open folder" verb.
  local_dir: opt(nullable(T.String()), null),
  // Where it runs (CPU placement): the user's choice, where it runs now, and why.
  placement: opt(T.String(), "auto"),
  runs_on: opt(nullable(T.String()), null),
  runs_on_reason: opt(T.String(), ""),
  // Its speed on the CPU, seconds of audio per second of work.
  cpu_realtime: opt(nullable(T.Number()), null),
  cpu_realtime_here: opt(T.Boolean(), false),
  runtime_options: opt(T.Array(RuntimeOption), []),
  // "words" | "tags" | "sliders" — how a speech model is directed (voice_model.directedBy);
  // null for speech recognition.
  directed_by: opt(nullable(T.String()), null),
});

export const ModelsListResponse = T.Object({
  engine_id: T.String(),
  variants: T.Array(ModelVariant),
});

export const InstallRequest = T.Object({
  model_variant: opt(nullable(T.String()), null),
  // Download the speech runtime (and eSpeak NG) again over the installed one.
  repair: opt(T.Boolean(), false),
});

export const InstallResponse = T.Object({
  engine_id: T.String(),
  model_variant: T.String(),
  job_id: T.String(),
});

export const LoadRequest = T.Object({
  model_variant: opt(nullable(T.String()), null),
  device: opt(T.String(), "auto"),
});

export const LoadResponse = T.Object({
  engine_id: T.String(),
  device: T.String(),
  model_variant: opt(nullable(T.String()), null),
});

export const UnloadResponse = T.Object({
  previous_engine: opt(nullable(T.String()), null),
});

export const UninstallResponse = T.Object({
  engine_id: T.String(),
  model_files_removed: T.Boolean(),
});

// ─── Jobs (install progress) ────────────────────────────────────────────

// Free-form to keep room for engine-specific phases emitted by the manager.
export const JobPhase = T.String();

export const JobStatus = T.Object({
  job_id: T.String(),
  engine_id: T.String(),
  model_variant: T.String(),
  phase: JobPhase,
  bytes_downloaded: opt(T.Integer(), 0),
  bytes_total: opt(T.Integer(), 0),
  current_file: opt(nullable(T.String()), null),
  error: opt(nullable(T.String()), null),
  // Rolling tail of download output lines — capped at 400 entries.
  log_tail: opt(T.Array(T.String()), []),
});

// ─── External engine probe ─────────────────────────────────────────────

export const ProbeRequest = T.Object({
  base_url: T.String(),
  api_key: opt(nullable(T.String()), null),
});

export const ProbeResponse = T.Object({
  reachable: T.Boolean(),
  models: opt(T.Array(T.String()), []),
  voices: opt(T.Array(T.String()), []),
  server_hint: opt(literal("kokoro-fastapi", "openai-edge-tts", "openai", "unknown"), "unknown"),
  recommended_model: opt(nullable(T.String()), null),
  error: opt(nullable(T.String()), null),
});

// ─── Delivery + generation ─────────────────────────────────────────────

export const EMOTION_VALUES = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "fearful",
  "whispered",
  "shouted",
  "sarcastic",
  "contemptuous",
];
export const Emotion = literal(...EMOTION_VALUES);

export const Delivery = T.Object({
  speed: opt(nullable(T.Number()), null),
  emotion: opt(nullable(Emotion), null),
  pitch: opt(nullable(T.Number()), null),
  pause_before: opt(nullable(T.Integer()), null),
  pause_after: opt(nullable(T.Integer()), null),
  gain_db: opt(nullable(T.Number()), null),
  instruct: opt(nullable(T.String()), null),
  // (`style_prompt` was deleted 2026-08-17: Qwen has ONE upstream instruct slot; the
  // standing-vs-this-line axis is persona.voice_instruct vs Block.direction.)
  // Sampling temperature — engines that support it read `delivery.temperature` directly.
  temperature: opt(nullable(T.Number()), null),
  // A tag model's own tags for the whole line (Chatterbox Turbo / Nano).
  tags: opt(nullable(T.Array(T.String())), null),
  // Per-render RNG seed; delivery.seed wins over req.seed (a deliberate override).
  seed: opt(nullable(T.Integer()), null),
  engine: opt(nullable(T.Record(T.String(), T.Any())), null),
});

export const GenerateRequest = T.Object({
  voice: T.String(),
  text: T.String(),
  language: opt(nullable(T.String()), null),
  delivery: opt(nullable(Delivery), null),
  seed: opt(nullable(T.Integer()), null),
  lexicons: opt(T.Array(T.String()), []),
  cache_scope: opt(T.String(), "default"),
  cache: opt(T.Boolean(), true),
  // The persona's delivery, effects and lexicon ride under the request's.
  persona_id: opt(nullable(T.String()), null),
});

export const ChapterLine = T.Object({
  voice: T.String(),
  text: T.String(),
  language: opt(nullable(T.String()), null),
  delivery: opt(nullable(Delivery), null),
  seed: opt(nullable(T.Integer()), null),
  // The effects chain for this line (its persona's). Part of the render cache key.
  effects: opt(nullable(T.Array(T.Record(T.String(), T.Any()))), null),
  // The lexicons this line is read with, in order (the book's, then its persona's).
  lexicons: opt(nullable(T.Array(T.String())), null),
  // Scene mode only: the line's block, so the chapter plays its ★ take when it has one.
  block_id: opt(nullable(T.String()), null),
  // Scene mode: the line ends one of the book's scenes, and has no pause of its own.
  scene_break_after: opt(T.Boolean(), false),
  // Scene mode: the next line is from the same paragraph, and this line has no pause.
  paragraph_next: opt(T.Boolean(), false),
});

export const BetweenLines = T.Object({
  // None = Settings → generation.pause_between_lines_ms (2026-09-29).
  silence_ms: opt(nullable(T.Integer()), null),
});

export const RenderChapterRequest = T.Object({
  // Direct mode: pass `lines[]` literally. Scene mode: pass `scene_id`; the server resolves
  // blocks → personas → lines internally.
  lines: opt(T.Array(ChapterLine), []),
  scene_id: opt(nullable(T.String()), null),
  between_lines: optModel(BetweenLines),
  master: opt(nullable(literal("acx", "inaudio", "podcast", "youtube", "none")), null),
  title: opt(nullable(T.String()), null),
  author: opt(nullable(T.String()), null),
  book: opt(nullable(T.String()), null),
  cache_scope: opt(T.String(), "default"),
  lexicons: opt(T.Array(T.String()), []),
});

// ─── Phase 5 — blend ─────────────────────────────────────────────────

export const BlendVoiceRequest = T.Object({
  engine: T.String(),
  model: opt(nullable(T.String()), null),
  name: T.String(),
  // Weighted strategies (blend / extrapolate / vector). One id may be blending.MEAN_SOURCE.
  source_voice_ids: opt(T.Array(T.String()), []),
  weights: opt(nullable(T.Array(T.Number())), null),
  strategy: opt(BlendStrategy, "blend"),
  // recombine only.
  segments: opt(nullable(T.Array(BlendSegment)), null),
});

// ─── Cache ──────────────────────────────────────────────────────────────

export const ScopeStats = T.Object({
  entries_on_disk: T.Integer(),
  bytes_on_disk: T.Integer(),
});

export const CacheStats = T.Object({
  total_entries_on_disk: T.Integer(),
  total_bytes_on_disk: T.Integer(),
  memory_entries: T.Integer(),
  memory_bytes: T.Integer(),
  scopes: opt(T.Record(T.String(), ScopeStats), {}),
});

// ─── Errors (RFC 7807) ─────────────────────────────────────────────────

export const ProblemDetails = T.Object({
  type: T.String(),
  title: T.String(),
  status: T.Integer(),
  detail: T.String(),
  instance: opt(T.String(), ""),
});

// ─── Audio analyzer ─────────────────────────────────────────────────────

export const WavFormat = T.Object({
  sample_rate: T.Integer(),
  channels: T.Integer(),
  bits_per_sample: T.Integer(),
  sample_count: T.Integer(),
  duration_sec: T.Number(),
});

export const LoudnessStats = T.Object({
  peak_dbfs: T.Number(),
  rms_dbfs: T.Number(),
  crest_factor_db: T.Number(),
  silence_ratio: T.Number(),
  clipping_ratio: T.Number(),
});

export const AudioAnalysis = T.Object({
  sha256: T.String(),
  file_size_bytes: T.Integer(),
  format: WavFormat,
  loudness: LoudnessStats,
});

// ─── Script — who says each line (Studio Slice 3, §8.24) ─────────────────

export const ScriptSpeaker = T.Object({
  speaker_id: T.String(),
  name: T.String(),
  // Lines this speaker reads in the chapter.
  lines: opt(T.Integer(), 0),
});

/** One row of Script's chapter grid. Counts are lines. */
export const ScriptChapter = T.Object({
  scene_id: T.String(),
  position: T.Integer(),
  title: opt(nullable(T.String()), null),
  // Every line with text, narration included; 0 = no text yet.
  lines: opt(T.Integer(), 0),
  spoken: opt(T.Integer(), 0),
  // When Analyze last ran. Older data has none: `analyzed` is then read off the lines.
  analyzed_at: opt(nullable(T.String()), null),
  analyzed: opt(T.Boolean(), false),
  // Never analyzed, and every line already has its speaker (podcast scripts, game sheets).
  from_import: opt(T.Boolean(), false),
  anchored: opt(T.Integer(), 0), // "Book says" — the book's own words named the speaker
  guessed: opt(T.Integer(), 0), // "AI decided"
  by_you: opt(T.Integer(), 0),
  // Spoken lines no speaker was found for (narration waiting for a narrator is not here).
  no_speaker: opt(T.Integer(), 0),
  flagged: opt(T.Integer(), 0), // lines inside a flag group
  flag_groups: opt(T.Integer(), 0),
  // Flagged lines + lines with no speaker, once Analyze (or the import) decided the chapter.
  to_check: opt(T.Integer(), 0),
  // Narration with no speaker while the book has no narrator: one fix — ＋ Add Narrator.
  narration_waiting: opt(T.Integer(), 0),
  changed: opt(T.Integer(), 0), // lines the last Analyze gave a different speaker
  no_dialogue_found: opt(T.Boolean(), false),
  // Speakers added after this chapter was analyzed whose name appears in its text.
  added_since: opt(T.Array(T.String()), []),
  // Lines added or changed by hand since the last Analyze — Script offers Re-analyze.
  edited_since: opt(T.Integer(), 0),
});

export const ProjectScript = T.Object({
  project_id: T.String(),
  chapters: T.Array(ScriptChapter),
});

export const ScriptLine = T.Object({
  id: T.String(),
  position: T.Integer(),
  text: T.String(),
  speaker_id: opt(nullable(T.String()), null),
  source: opt(nullable(T.String()), null),
  confidence: opt(nullable(T.Number()), null),
  // The paragraph of the analyzed text; null for an imported or pasted line.
  paragraph: opt(nullable(T.Integer()), null),
  spoken: opt(T.Boolean(), false),
  marker: opt(T.Boolean(), false),
  speakable: opt(T.Boolean(), true),
  // The book's own words that named the speaker ("said Marius").
  anchor_words: opt(nullable(T.String()), null),
  // The model's pick, where the book's words won and it had said another.
  llm_speaker: opt(nullable(T.String()), null),
  // The model's pick the confidence floor dropped.
  floored_from: opt(nullable(T.String()), null),
  // The last Analyze changed this line's speaker; `prev_speaker_id` is who it was.
  changed: opt(T.Boolean(), false),
  prev_speaker_id: opt(nullable(T.String()), null),
  // Indexes into SceneScript.flag_groups.
  flags: opt(T.Array(T.Integer()), []),
  // The block's whole metadata — Undo puts it back exactly.
  metadata: opt(T.Record(T.String(), T.Any()), {}),
  // Only a dialogue tag, and the project leaves those out of the audio: shown "Left out".
  left_out: opt(T.Boolean(), false),
  // Rendered takes on the line — Merge says how many it would delete.
  takes: opt(T.Integer(), 0),
  // Narration with no speaker, in a book with no narrator yet: it waits for the narrator.
  waits_for_narrator: opt(T.Boolean(), false),
});

export const ScriptFlag = T.Object({
  check: literal("run", "only", "disagree", "nearby"),
  speaker: opt(nullable(T.String()), null),
  lines: T.Array(T.String()),
  turns: opt(T.Integer(), 0),
  other: opt(nullable(T.String()), null),
});

/** Script's chapter page: the lines, their marks and the speakers. */
export const SceneScript = T.Object({
  chapter: ScriptChapter,
  project_id: T.String(),
  narrator_id: opt(nullable(T.String()), null),
  lines: T.Array(ScriptLine),
  flag_groups: T.Array(ScriptFlag),
  // The book's speakers, most lines first.
  speakers: T.Array(ScriptSpeaker),
});

/** `Model.model_fields` — a model's field names in declaration order. */
export const modelFields = (schema) => Object.keys(schema.properties || {});
