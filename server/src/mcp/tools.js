// SPDX-License-Identifier: MIT
// The four MCP tools — thin wrappers over the routes and services the app itself uses, so an
// agent sees what the UI sees:
//
//   justvoice.speak          text → speech in a voice; a `generations` row and an `audio_url`
//                            (a headless server plays nothing — the agent fetches the WAV)
//   justvoice.list_voices    the voice library
//   justvoice.list_personas  the personas (finished voices)
//   justvoice.transcribe     a clip → text, with the local speech recognition
//
// The tool, parameter and result field names are fixed: agents' configs and docs/mcp-server.md
// use them. Arguments are checked by the SDK against each tool's zod schema (an unknown or a
// wrongly typed parameter is refused); a refusal or a failure comes back as a tool result with
// `isError` and the reason as text. A success carries its result object both as JSON text (what
// every client reads) and as `structuredContent`.
//
// The captures, voices, generate, wire-model and render modules are loaded when a tool runs:
// they import the app, which imports this package.

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { b64decode, pyRound, strRepr } from "@delebash/llm-runner/platform/py";
import * as z from "zod/v4";
import { getState } from "../app_state.js";
import { parseWavHeader } from "../audio/wav.js";
import { Generation, uuid } from "../database/models.js";
import { getDb } from "../database/session.js";
import { storeMediaPath } from "../media_paths.js";
import { generationsRoot } from "../paths.js";
import { currentClientId, requestIsLoopback } from "./context.js";
import { resolveVoice } from "./resolve.js";

const optionalText = (what) => z.string().nullable().optional().describe(what);

/** A WAV's length in seconds (3 places), from its own header; null when it can't be read. */
function wavSeconds(wav) {
  try {
    return pyRound(parseWavHeader(wav)[0].durationSec, 3);
  } catch {
    return null;
  }
}

/** An absolute local path: a drive letter and separator or a UNC share on Windows, a leading
 * `/` elsewhere. */
function isAbsoluteLocalPath(p) {
  if (process.platform === "win32") return /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(p);
  return p.startsWith("/");
}

const given = (v) => typeof v === "string" && v !== "";

// ─── speak ──────────────────────────────────────────────────────────────────

async function speak({ text, voice = null, persona = null, language = null }) {
  const h = getDb();
  const resolved = resolveVoice(voice, persona, currentClientId(), h);
  if (resolved === null) {
    throw new Error(
      "No voice resolved for this call. Pass `voice` (an id from justvoice.list_voices) or `persona` " +
        "(a name from justvoice.list_personas), bind a persona to this client with POST /v1/mcp/bindings, " +
        "or set settings.mcp.default_voice.",
    );
  }
  const st = getState();
  const spokenIn = language || resolved.persona?.language || null;

  const { construct, GenerateRequest } = await import("../models.js");
  const { generate } = await import("../api/generate_api.js");
  const renderCore = await import("../render_core.js");
  const answer = await generate(
    construct(GenerateRequest, { voice: resolved.voice_id, text, language: spokenIn, persona_id: resolved.persona?.id ?? null }),
  );
  const wav = Buffer.isBuffer(answer) ? answer : Buffer.from(answer.body);

  let engine = null;
  try {
    engine = await renderCore._resolveEngineForVoice(st, resolved.voice_id);
  } catch {
    /* no registry to ask — fall back below */
  }
  const model = engine ? await renderCore._lineModel(st, resolved.voice_id, engine) : null;
  const durationSec = wavSeconds(wav);

  const id = uuid();
  const file = path.join(generationsRoot(st.dataDir), `${id}.wav`);
  h.tx(() => {
    h.insert(Generation, {
      id,
      persona_id: resolved.persona?.id ?? null,
      text,
      // What it was spoken in: the caller's language, else the persona's; "en" when neither
      // named one (the column's own default).
      language: spokenIn ?? "en",
      engine: engine ?? st.engines?.current() ?? "managed",
      model,
      status: "completed",
      source: "mcp",
      duration_sec: durationSec,
    });
    writeFileSync(file, wav);
    h.update(Generation, { audio_path: storeMediaPath(file) }, { id });
  });

  return {
    generation_id: id,
    status: "completed",
    voice: resolved.voice_id,
    persona: resolved.persona?.name ?? null,
    duration_sec: durationSec,
    audio_url: `/v1/generations/${id}/audio`,
    source: "mcp",
  };
}

// ─── list_voices ────────────────────────────────────────────────────────────

async function listVoices({ limit = 200 }) {
  const voicesApi = await import("../api/voices_api.js");
  const all = (await voicesApi.listVoices()).voices.map((v) => ({
    id: v.id,
    name: v.name,
    engine: v.engine,
    source: v.source,
    language: v.language,
    gender: v.gender || null,
  }));
  return { voices: all.slice(0, limit), total: all.length };
}

// ─── list_personas ──────────────────────────────────────────────────────────

async function listPersonas() {
  return {
    personas: getState()
      .personas.list()
      .map((p) => ({ id: p.id, name: p.name, voice_id: p.voice_id ?? null, language: p.language ?? null, has_note: Boolean(p.note) })),
  };
}

// ─── transcribe ─────────────────────────────────────────────────────────────

async function transcribe({ audio_base64 = null, audio_path = null, language = null }) {
  const byPath = given(audio_path);
  if (byPath === given(audio_base64)) throw new Error("Pass exactly one of audio_base64 or audio_path.");
  const captures = await import("../api/captures_api.js");
  const capMb = captures._MAX_UPLOAD_MB;
  const tooBig = () => new Error(`The audio is larger than the ${capMb} MB limit.`);

  if (byPath) {
    // A server bound to the network must not read its own files for a remote caller.
    if (!requestIsLoopback()) throw new Error("audio_path is accepted only from this machine — a remote caller sends audio_base64.");
    if (!isAbsoluteLocalPath(audio_path)) throw new Error(`audio_path must be an absolute path, not ${strRepr(audio_path)}.`);
    const info = statSync(audio_path, { throwIfNoEntry: false });
    if (!info?.isFile()) throw new Error(`There is no file at ${audio_path}.`);
    if (info.size > capMb * 1024 * 1024) throw tooBig();
    return { text: await captures._sttTranscribe(audio_path, language), language: language ?? null };
  }

  let bytes;
  try {
    bytes = b64decode(audio_base64, true);
  } catch (e) {
    throw new Error(`audio_base64 is not valid base64: ${e?.message ?? e}`);
  }
  if (bytes.length > capMb * 1024 * 1024) throw tooBig();
  const dir = mkdtempSync(path.join(tmpdir(), "jv-mcp-audio-"));
  try {
    const file = path.join(dir, "audio.wav");
    writeFileSync(file, bytes);
    return { text: await captures._sttTranscribe(file, language), language: language ?? null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Registration ───────────────────────────────────────────────────────────

/** Every tool: its name, what an agent is told, its arguments (strict — an unknown one is
 * refused) and its handler. */
export const TOOLS = [
  {
    name: "justvoice.speak",
    title: "Speak text",
    description:
      "Render text as speech in a JustVoice voice. Returns a generation_id and an audio_url — GET it from the " +
      "JustVoice server to fetch the WAV (nothing is played). Pass voice (a voice id) or persona (a persona name); " +
      "with neither, the persona bound to this client applies, else the server's default voice.",
    inputSchema: z.strictObject({
      text: z.string().describe("The text to speak."),
      voice: optionalText("A voice id from justvoice.list_voices."),
      persona: optionalText("A persona name (or id) from justvoice.list_personas."),
      language: optionalText("A language code such as en or ja; default: the persona's, else the voice's own."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: speak,
  },
  {
    name: "justvoice.list_voices",
    title: "List voices",
    description:
      "List the voice library — preset, cloned and designed voices. A voice's id is what justvoice.speak takes as voice.",
    inputSchema: z.strictObject({
      limit: z.number().int().min(1).max(1000).optional().describe("How many voices to return, 1–1000 (default 200)."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: listVoices,
  },
  {
    name: "justvoice.transcribe",
    title: "Transcribe audio",
    description:
      "Transcribe a clip with JustVoice's local speech recognition. Pass exactly one of audio_base64 (the file's bytes) " +
      "or audio_path (an absolute path on the server's machine — accepted only from that machine).",
    inputSchema: z.strictObject({
      audio_base64: optionalText("The audio file, base64-encoded."),
      audio_path: optionalText("An absolute path to an audio file on the server's machine."),
      language: optionalText("A language code; default: detect it."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: transcribe,
  },
  {
    name: "justvoice.list_personas",
    title: "List personas",
    description:
      "List the personas — finished voices with a name — and the voice each one speaks with. A persona's name is what " +
      "justvoice.speak takes as persona.",
    // No arguments; an unknown one is refused, and a call may leave `arguments` out.
    inputSchema: z.strictObject({}).optional(),
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: listPersonas,
  },
];

/** The result object as a tool result: JSON text for every client, and the same object as
 * structured content. */
const toResult = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });

/** Register every tool on an SDK `McpServer`. */
export function registerTools(server) {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: z.looseObject({}),
        annotations: tool.annotations,
      },
      async (args) => toResult(await tool.handler(args ?? {})),
    );
  }
}
