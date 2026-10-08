// SPDX-License-Identifier: MIT
//
// Adapted from voicebox (MIT) — backend/mcp_server/tools.py at the commit pinned in
// voicebox-pin.txt. Tool surface renamed (justvoice.*), speak delegates to JustVoice's
// /v1/generate pipeline and persists a Generation row (headless JustVoice returns a fetchable
// audio URL instead of playing it). transcribe is added alongside the bundled speech-recognition
// engine. Original copyright (c) the voicebox authors.
//
// JustVoice MCP tool implementations (the port of justvoice/mcp/tools.py). Thin wrappers over
// existing routes/services. Tools are registered with dotted names (`justvoice.speak` etc.) so
// they look natural in agent logs.
//
// fastmcp generated each tool's wire description from the Python function — the input schema
// from its signature, `outputSchema` from its `dict[str, Any]` return, `_meta.fastmcp.tags` —
// and validated a call's arguments with pydantic. The TOOLS table below is that wire output,
// copied from the Python server's `tools/list`, and `validateArgs` answers a bad call in
// pydantic's words, so an agent sees the same server either way.

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getState } from "../app_state.js";
import { Generation, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { storeMediaPath } from "../media_paths.js";
import { generationsRoot } from "../paths.js";
import { b64decode, isDict, pyRound, pyTypeName, ValueError } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyRepr } from "@delebash/llm-runner/platform/pyjson";
import { currentClientId, requestIsLoopback } from "./context.js";
import { resolveVoice } from "./resolve.js";

const NULLABLE_STR = { anyOf: [{ type: "string" }, { type: "null" }], default: null };
const OUTPUT_SCHEMA = { additionalProperties: true, type: "object" };
const META = { fastmcp: { tags: [] } };

/** The tools as fastmcp lists them, with each parameter's check (in signature order). */
export const TOOLS = [
  {
    name: "justvoice.speak",
    fn: "justvoice_speak",
    description:
      "Render text to speech in a JustVoice voice. Returns a generation id plus an audio_url you can GET for the WAV. Pass `voice` (a voice id) or `persona` (a character name); with neither, the per-client binding or the global default voice applies.",
    inputSchema: {
      additionalProperties: false,
      properties: { text: { type: "string" }, voice: NULLABLE_STR, persona: NULLABLE_STR, language: NULLABLE_STR },
      required: ["text"],
      type: "object",
    },
    params: [
      ["text", "str", { required: true }],
      ["voice", "str", { nullable: true, dflt: null }],
      ["persona", "str", { nullable: true, dflt: null }],
      ["language", "str", { nullable: true, dflt: null }],
    ],
  },
  {
    name: "justvoice.list_voices",
    fn: "justvoice_list_voices",
    description: "List available voices (presets, cloned, designed). Use the returned `id` with justvoice.speak(voice=...).",
    inputSchema: { additionalProperties: false, properties: { limit: { default: 200, type: "integer" } }, type: "object" },
    params: [["limit", "int", { dflt: 200 }]],
  },
  {
    name: "justvoice.transcribe",
    fn: "justvoice_transcribe",
    description:
      "Transcribe an audio clip to text with the local speech recognition engine. Pass exactly one of `audio_base64` (bytes as base64) or `audio_path` (absolute local file path — loopback callers only).",
    inputSchema: {
      additionalProperties: false,
      properties: { audio_base64: NULLABLE_STR, audio_path: NULLABLE_STR, language: NULLABLE_STR },
      type: "object",
    },
    params: [
      ["audio_base64", "str", { nullable: true, dflt: null }],
      ["audio_path", "str", { nullable: true, dflt: null }],
      ["language", "str", { nullable: true, dflt: null }],
    ],
  },
  {
    name: "justvoice.list_personas",
    fn: "justvoice_list_personas",
    description: "List personas (finished voices) with their bound voice. Use the returned `name` with justvoice.speak(persona=...).",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    params: [],
  },
];

/** `tools/list` — each tool as fastmcp sends it. */
export function listTools() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, outputSchema: OUTPUT_SCHEMA, _meta: META }));
}

// ── argument validation, in pydantic's words ──────────────────────────────────

/** One pydantic error → [type, msg], or null when `v` fits (lax mode, as validate_call). */
function checkValue(kind, nullable, v) {
  if ((v === null || v === undefined) && nullable) return null;
  if (kind === "str") return typeof v === "string" ? null : ["string_type", "Input should be a valid string"];
  // int (lax): a bool, a whole float, a numeric string.
  if (typeof v === "boolean") return null;
  const n = v instanceof PyFloat ? v.v : v;
  if (typeof n === "number") {
    if (!Number.isFinite(n)) return ["finite_number", "Input should be a finite number"];
    return Number.isInteger(n) ? null : ["int_from_float", "Input should be a valid integer, got a number with a fractional part"];
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (/^[-+]?\d+(?:_\d+)*(?:\.0*)?$/.test(t)) return null;
    return ["int_parsing", "Input should be a valid integer, unable to parse string as an integer"];
  }
  return ["int_type", "Input should be a valid integer"];
}

/** The value a lax int check accepted, as Python passes it on. */
function coerce(kind, v) {
  if (kind !== "int" || v === null || v === undefined) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return Math.trunc(Number(v.trim().replace(/_/g, "")));
  return v instanceof PyFloat ? v.v : v;
}

/** The call's keyword arguments → [kwargs, null] or [null, pydantic's message]. */
export function validateArgs(tool, args) {
  const given = isDict(args) ? args : {};
  const errors = [];
  const kwargs = {};
  for (const [name, kind, { required = false, nullable = false, dflt = null }] of tool.params) {
    if (!Object.hasOwn(given, name)) {
      if (required) errors.push([name, "missing_argument", "Missing required argument", given]);
      else kwargs[name] = dflt;
      continue;
    }
    const e = checkValue(kind, nullable, given[name]);
    if (e) errors.push([name, e[0], e[1], given[name]]);
    else kwargs[name] = coerce(kind, given[name]);
  }
  const known = new Set(tool.params.map(([n]) => n));
  for (const [name, v] of Object.entries(given)) {
    if (!known.has(name)) errors.push([name, "unexpected_keyword_argument", "Unexpected keyword argument", v]);
  }
  if (!errors.length) return [kwargs, null];
  const lines = errors.map(
    ([loc, type, msg, v]) =>
      `${loc}\n  ${msg} [type=${type}, input_value=${pyRepr(v)}, input_type=${pyTypeName(v)}]\n    For further information visit https://errors.pydantic.dev/2.13/v/${type}`,
  );
  return [null, `${errors.length} validation error${errors.length === 1 ? "" : "s"} for call[${tool.fn}]\n${lines.join("\n")}`];
}

// ── the tools ────────────────────────────────────────────────────────────────

async function justvoiceSpeak({ text, voice, persona, language }) {
  const h = session.getDb();
  const clientId = currentClientId();
  const resolved = resolveVoice(voice, persona, clientId, h);
  if (resolved === null) {
    throw new ValueError(
      "No voice resolved. Pass `voice=` with a voice id or `persona=` with a character name, bind a persona to this client at POST /v1/mcp/bindings, or set settings.mcp.default_voice.",
    );
  }
  return _speak({ voiceId: resolved.voice_id, persona: resolved.persona, text, language, h });
}

async function justvoiceListVoices({ limit }) {
  if (!(limit >= 1 && limit <= 1000)) throw new ValueError("`limit` must be between 1 and 1000.");
  // Delegate to the real /v1/voices route (upstream pattern: tools are thin wrappers over
  // existing routes) so the tool sees exactly what the UI sees — managed-engine presets
  // included.
  const { listVoices } = await import("../api/voices_api.js");
  const result = await listVoices();
  const voices = result.voices.map((v) => ({
    id: v.id,
    name: v.name,
    engine: v.engine,
    source: v.source,
    language: v.language,
    gender: v.gender || null,
  }));
  return { voices: voices.slice(0, limit), total: voices.length };
}

/** `pathlib.Path(p).is_absolute()` — on Windows a drive and a root (or a UNC share). */
function isAbsolutePath(p) {
  if (process.platform === "win32") return /^[a-zA-Z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(p);
  return p.startsWith("/");
}

async function justvoiceTranscribe({ audio_base64: audioBase64, audio_path: audioPath, language }) {
  if (Boolean(audioBase64) === Boolean(audioPath)) throw new ValueError("Pass exactly one of `audio_base64` or `audio_path`.");

  const captures = await import("../api/captures_api.js");
  const maxMb = captures._MAX_UPLOAD_MB;

  // Absolute-path mode is loopback-only so a server bound on 0.0.0.0 doesn't double as an
  // arbitrary-local-file read primitive (upstream contract).
  if (audioPath !== null && audioPath !== undefined) {
    if (!requestIsLoopback()) {
      throw new ValueError("`audio_path` is only available to loopback callers — remote callers must use `audio_base64`.");
    }
    if (!isAbsolutePath(audioPath)) throw new ValueError("`audio_path` must be absolute.");
    let st;
    try {
      st = statSync(audioPath);
    } catch {
      st = null;
    }
    if (st === null || !st.isFile()) throw new ValueError(`File not found: ${audioPath}`);
    if (st.size > maxMb * 1024 * 1024) throw new ValueError(`File exceeds ${maxMb} MB limit.`);
    const text = await captures._sttTranscribe(audioPath, language);
    return { text, language };
  }

  let raw;
  try {
    raw = b64decode(audioBase64, true);
  } catch (exc) {
    throw new ValueError(`Invalid audio_base64: ${exc.message}`);
  }
  if (raw.length > maxMb * 1024 * 1024) throw new ValueError(`Audio exceeds ${maxMb} MB limit.`);
  const dir = mkdtempSync(path.join(tmpdir(), "jv-mcp-"));
  const tmpPath = path.join(dir, "clip.wav");
  writeFileSync(tmpPath, raw);
  try {
    const text = await captures._sttTranscribe(tmpPath, language);
    return { text, language };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function justvoiceListPersonas() {
  const personas = getState().personas.list();
  return {
    personas: personas.map((p) => ({ id: p.id, name: p.name, voice_id: p.voice_id, language: p.language, has_note: Boolean(p.note) })),
  };
}

const HANDLERS = {
  "justvoice.speak": justvoiceSpeak,
  "justvoice.list_voices": justvoiceListVoices,
  "justvoice.transcribe": justvoiceTranscribe,
  "justvoice.list_personas": justvoiceListPersonas,
};

const textResult = (text, isError) => ({ content: [{ type: "text", text }], isError });

/**
 * `tools/call` → the CallToolResult fastmcp sends: the result as compact JSON text plus
 * `structuredContent`, or `isError` with the reason — an unknown tool, pydantic's validation
 * message, or "Error calling tool '<name>': <the error>".
 */
export async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return textResult(`Unknown tool: ${pyRepr(String(name))}`, true);
  const [kwargs, invalid] = validateArgs(tool, args ?? {});
  if (invalid) return textResult(invalid, true);
  let result;
  try {
    result = await HANDLERS[name](kwargs);
  } catch (e) {
    return textResult(`Error calling tool ${pyRepr(name)}: ${e?.detail ?? e?.message ?? e}`, true);
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false };
}

/** The tools' doors, for a test or a host that drives them without the protocol. */
export { justvoiceListPersonas, justvoiceListVoices, justvoiceSpeak, justvoiceTranscribe };

// ─── Speak helper ──────────────────────────────────────────────────────────

/** Delegate to the /v1/generate pipeline, persist a Generation row, and return ids + a
 * fetchable audio URL. The API wave's `api/generate_api.js` exports `generate(req)` (the
 * route's handler, answering the WAV — a Buffer, or an object whose `body` is one). */
export async function _speak({ voiceId, persona, text, language, h }) {
  const generateApi = await import("../api/generate_api.js");
  const { construct, GenerateRequest } = await import("../models.js");
  const rc = await import("../render_core.js");

  const req = construct(GenerateRequest, {
    voice: voiceId,
    text,
    language: language || (persona ? persona.language : null),
    persona_id: persona ? persona.id : null,
  });
  const response = await generateApi.generate(req);
  const wav = Buffer.isBuffer(response) ? response : Buffer.from(response.body);

  const state = getState();
  const engineId = await rc._resolveEngineForVoice(state, voiceId);
  const id = uuid();
  const gen = {
    id,
    persona_id: persona ? persona.id : null,
    text,
    language: language || "en",
    // The engine that spoke it (2026-10-06 — it was always "managed").
    engine: engineId || state.engines?.current?.() || "managed",
    model: engineId ? await rc._lineModel(state, voiceId, engineId) : null,
    status: "completed",
    source: "mcp",
    // A generation's length still assumes 16 kHz, 16-bit mono WAV (as Python's).
    duration_sec: wav.length > 44 ? pyRound((wav.length - 44) / (2 * 16000), 3) : null,
  };
  const outPath = path.join(generationsRoot(state.dataDir), `${id}.wav`);
  h.tx(() => {
    h.insert(Generation, gen);
    writeFileSync(outPath, wav);
    // Relative to the data root — survives a Change-folder move.
    h.update(Generation, { audio_path: storeMediaPath(outPath) }, { id });
  });

  return {
    generation_id: id,
    status: "completed",
    voice: voiceId,
    persona: persona ? persona.name : null,
    duration_sec: gen.duration_sec,
    audio_url: `/v1/generations/${id}/audio`,
    source: "mcp",
  };
}
