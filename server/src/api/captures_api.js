// SPDX-License-Identifier: MIT
// Dictation on the server — /v1/transcribe and /v1/captures.
//
// A recording arrives as a multipart upload; the local speech recognizer (the `asr` engine in
// the speech runtime) transcribes it; the cleanup pass (refinement.js) tidies it when
// `settings.captures.auto_refine` is on; and a `captures` row keeps BOTH texts, so the Captures
// page can show either. A cleanup that fails never loses the recording's words: the raw
// transcript stands in for the cleaned one. `POST /v1/transcribe` is the same transcription with
// nothing stored.
//
// This module also owns two things other routers use:
//   - the multipart form reader (`_formSpool`, `_readForm`, `_requireFile`, `_formField`) —
//     FastAPI's `File()` / `Form()` semantics for align, voice bundles and project import;
//   - speech recognition loaded on first use (`ensureSttLoaded`, `_sttTranscribe`) — align and
//     the MCP `justvoice.transcribe` tool call it too.
//
// The routes reach `_sttTranscribe`, `ensureSttLoaded`, `_readForm` and `_maybeRefine` through
// this module's own namespace (`self.`), so a test's spy on an export takes effect.

import { closeSync, createReadStream, createWriteStream, mkdirSync, mkdtempSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "@fastify/busboy";
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { HttpError, RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { nullable, opt, shapeRequest, T } from "@delebash/llm-runner/platform/models";
import { isJsonObject, strRepr } from "@delebash/llm-runner/platform/py";
import { jsonLoads, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { attachment, Hono, input, readJson } from "@delebash/llm-runner/platform/server";
import { getState } from "../app_state.js";
import { parseWavHeader } from "../audio/wav.js";
import { Capture, uuid } from "../database/models.js";
import { getDb } from "../database/session.js";
import { badRequest, notFound } from "../errors.js";
import { mediaFile, storeMediaPath } from "../media_paths.js";
import { construct, DateTime } from "../models.js";
import { RefinementFlags, refineTranscript } from "../refinement.js";
import * as self from "./captures_api.js";

const log = getLogger("justvoice.api.captures_api");

const msg = (e) => e?.message ?? String(e);

/** The largest upload any form route takes, in MB. */
export const _MAX_UPLOAD_MB = 200;
/** The cap the routes read at request time (a test lowers it; align and voice bundles read it). */
export const cfg = { _MAX_UPLOAD_MB };

const SOURCES = ["mic", "system_audio", "upload"];

// ─── Wire shapes ────────────────────────────────────────────────────────────

export const CaptureRow = T.Object({
  id: T.String(),
  source: T.String(),
  language: nullable(T.String()),
  duration_ms: nullable(T.Integer()),
  transcript: nullable(T.String()),
  raw_transcript: nullable(T.String()),
  refinement_flags: T.Record(T.String(), T.Any()),
  audio_url: T.String(),
  pinned: T.Boolean(),
  created_at: DateTime(),
});

export const CaptureList = T.Object({ captures: T.Array(CaptureRow), total: T.Integer() });

export const TranscribeResponse = T.Object({ text: T.String(), language: nullable(T.String()) });

export const UpdateCaptureRequest = T.Object({ pinned: opt(nullable(T.Boolean()), null) });

/** Re-refine: each toggle left out (or null) keeps the capture's own. */
export const RefineBody = T.Object({
  smart_cleanup: opt(nullable(T.Boolean()), null),
  self_correction: opt(nullable(T.Boolean()), null),
  preserve_technical: opt(nullable(T.Boolean()), null),
});

const ListQuery = T.Object({ limit: opt(T.Integer(), 50), offset: opt(T.Integer(), 0) });
const RetranscribeQuery = T.Object({ language: opt(nullable(T.String()), null) });

/** The stored flags as an object; `{}` when nothing (or nothing readable) is stored. */
function storedFlags(row) {
  if (!row.refinement_flags_json) return {};
  try {
    const v = jsonLoads(row.refinement_flags_json);
    return isJsonObject(v) ? v : {};
  } catch {
    return {};
  }
}

/** A captures row → the wire shape. */
export function _row(r) {
  return construct(CaptureRow, {
    id: r.id,
    source: r.source,
    language: r.language,
    duration_ms: r.duration_ms,
    transcript: r.transcript,
    raw_transcript: r.raw_transcript,
    refinement_flags: storedFlags(r),
    audio_url: `/v1/captures/${r.id}/audio`,
    pinned: Boolean(r.pinned),
    created_at: r.created_at,
  });
}

// ─── Multipart forms ────────────────────────────────────────────────────────

const SPOOL = "jv.formSpool";

/**
 * Remove a request's spooled files once its answer is made — a middleware on each route that
 * reads a form (`_readForm`), placed before its handler.
 */
export async function _formSpool(c, next) {
  try {
    await next();
  } finally {
    const dir = c.get(SPOOL);
    if (dir) {
      c.set(SPOOL, null);
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** A refusal the form reader answers with its own status ({"detail": …}), as the multipart
 * plugin it replaces did. */
const formRefusal = (status, message) => Object.assign(new Error(message), { statusCode: status });

/**
 * The request's form: `{files: {field: {path, filename, size}}, fields: {field: string}}`. Each
 * file part is written whole to a spool folder under the OS temp folder (read now, so a test can
 * redirect it) before this returns; the route's `_formSpool` removes it. A request that is not
 * multipart has an empty form. busboy (framework-free) reads the request's own body stream —
 * no limit on a file (each route caps its upload), 1 MiB per text field; an empty body is an
 * empty form.
 */
export async function _readForm(c) {
  const form = { files: {}, fields: {} };
  const type = c.req.header("content-type") || "";
  if (!/^multipart\//i.test(type) || !c.req.raw.body) return form;
  const bb = new Busboy({ headers: { "content-type": type }, limits: { fileSize: Number.POSITIVE_INFINITY, fieldSize: 1024 * 1024 } });
  const writes = [];
  let refused = null;
  let n = 0;
  bb.on("file", (fieldname, file, filename) => {
    if (fieldname in Object.prototype) {
      refused ??= formRefusal(400, "prototype property is not allowed as field name");
      file.resume();
      return;
    }
    if (!c.get(SPOOL)) c.set(SPOOL, mkdtempSync(path.join(tmpdir(), "jv-form-")));
    n += 1;
    const dest = path.join(c.get(SPOOL), `part-${n}`);
    // Named in the order the parts came (the last of a name wins); its size once written.
    const entry = { path: dest, filename, size: 0 };
    form.files[fieldname] = entry;
    writes.push(
      pipeline(file, createWriteStream(dest)).then(() => {
        entry.size = statSync(dest).size;
      }),
    );
  });
  bb.on("field", (fieldname, value) => {
    if (fieldname in Object.prototype) refused ??= formRefusal(400, "prototype property is not allowed as field name");
    else form.fields[fieldname] = String(value ?? "");
  });
  let sawData = false;
  const seen = async function* (source) {
    for await (const chunk of source) {
      if (chunk.length) sawData = true;
      yield chunk;
    }
  };
  try {
    await pipeline(Readable.fromWeb(c.req.raw.body), seen, bb);
  } catch (e) {
    // An empty body is an empty form, not truncated multipart data.
    if (sawData || e?.message !== "Unexpected end of multipart data") {
      await Promise.allSettled(writes);
      throw e;
    }
  }
  await Promise.all(writes);
  if (refused) throw refused;
  return form;
}

/** The form's file `name`, or a 422 naming the missing field. */
export function _requireFile(form, name) {
  const file = form.files[name];
  if (file === undefined) throw new RequestValidationError([{ loc: ["body", name], msg: "Field required", type: "missing" }]);
  return file;
}

/** The form's text field `name`; `dflt` when it is missing or empty. */
export function _formField(form, name, dflt) {
  const v = form.fields[name];
  return v === undefined || v === "" ? dflt : v;
}

/** Copy an uploaded file to `dest`, refusing (400) one over the cap. */
async function copyUpload(file, dest) {
  const cap = cfg._MAX_UPLOAD_MB;
  if (file.size > cap * 1024 * 1024) throw badRequest(`upload exceeds ${cap} MB`);
  try {
    await copyFile(file.path, dest);
  } catch (e) {
    rmSync(dest, { force: true });
    throw e;
  }
}

// ─── Speech recognition ─────────────────────────────────────────────────────

/** `[manager, settings]`, with the speech-recognition model loaded — on first use, when the
 * runtime and the model are installed; otherwise a 400 that says what to do. */
export async function ensureSttLoaded() {
  const { getManager } = await import("../engines/manager.js");
  const mgr = getManager();
  const settings = getState().settings.get();
  if (mgr.loadedFor("stt") === null) {
    const status = mgr.status("asr");
    if (status !== "installed") {
      throw badRequest(`speech recognition is ${status} — install the speech runtime and its model on the AI page`);
    }
    log.info(`loading speech recognition (${settings.captures.stt_model}) for its first use`);
    await mgr.load("asr", { device: "auto", variant: settings.captures.stt_model });
  }
  return [mgr, settings];
}

/** The recognizer's text for the file at `audioPath`. The language is `language`, else
 * `settings.captures.language`; "" or "auto" lets the recognizer detect it. */
export async function _sttTranscribe(audioPath, language) {
  const [mgr, settings] = await self.ensureSttLoaded();
  const lang = language || settings.captures.language;
  return mgr.transcribe({ audio_path: audioPath, language: lang && lang !== "auto" ? lang : null });
}

/** Clean `raw` with these flags; on any failure, log it and keep `raw`. */
export async function _maybeRefine(raw, flags, settings) {
  try {
    const [text] = await refineTranscript(raw, flags, { settings });
    return text;
  } catch (e) {
    log.warning(`cleanup skipped, the raw transcript is kept: ${msg(e)}`);
    return raw;
  }
}

/** A WAV file's length in milliseconds, from its header; null when it is not a WAV this app
 * reads. Only the head of the file is read. */
function wavDurationMs(file) {
  try {
    const size = statSync(file).size;
    const head = Buffer.alloc(Math.min(size, 64 * 1024));
    const fd = openSync(file, "r");
    try {
      readSync(fd, head, 0, head.length, 0);
    } finally {
      closeSync(fd);
    }
    const [fmt, dataOffset] = parseWavHeader(head);
    // The header's own data size, unless the file is shorter than it says (a recording cut off).
    const declared = head.readUInt32LE(dataOffset - 4);
    const bytes = Math.min(declared, size - dataOffset);
    const frames = Math.floor(bytes / (fmt.channels * 2));
    return Math.round((frames * 1000) / fmt.sampleRate);
  } catch {
    return null;
  }
}

/** The folder recordings are kept in (made on first use). */
export function _capturesDir() {
  const dir = path.join(getState().dataDir, "captures");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const flagsFromSettings = (settings) =>
  new RefinementFlags({
    smartCleanup: settings.captures.smart_cleanup,
    selfCorrection: settings.captures.self_correction,
    preserveTechnical: settings.captures.preserve_technical,
  });

function captureOr404(h, id) {
  const row = h.get(Capture, id);
  if (row === null) throw notFound(`capture ${id}`);
  return row;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function router() {
  const app = new Hono();

  /** Transcribe one recording; nothing is stored. */
  app.post("/v1/transcribe", _formSpool, async (c) => {
    const form = await self._readForm(c);
    const file = _requireFile(form, "file");
    const language = _formField(form, "language", null);
    const dir = mkdtempSync(path.join(tmpdir(), "jv-transcribe-"));
    try {
      const wav = path.join(dir, "upload.wav");
      await copyUpload(file, wav);
      const text = await self._sttTranscribe(wav, language);
      return c.json(construct(TranscribeResponse, { text, language }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** A new capture: keep the recording, transcribe it, clean it when auto-refine is on. */
  app.post("/v1/captures", _formSpool, async (c) => {
    const form = await self._readForm(c);
    const file = _requireFile(form, "file");
    const source = _formField(form, "source", "upload");
    const language = _formField(form, "language", null);
    if (!SOURCES.includes(source)) throw badRequest(`source must be one of ${SOURCES.join(", ")} — got ${strRepr(source)}`);

    const settings = getState().settings.get();
    const id = uuid();
    const wav = path.join(_capturesDir(), `${id}.wav`);
    await copyUpload(file, wav);
    let raw;
    try {
      raw = await self._sttTranscribe(wav, language);
    } catch (e) {
      // No row is written, so the recording would be an orphan.
      rmSync(wav, { force: true });
      throw e;
    }
    const flags = flagsFromSettings(settings);
    const transcript = settings.captures.auto_refine ? await self._maybeRefine(raw, flags, settings) : raw;

    const h = getDb();
    h.insert(Capture, {
      id,
      audio_path: storeMediaPath(wav),
      source,
      language,
      duration_ms: wavDurationMs(wav),
      raw_transcript: raw,
      refinement_flags_json: pyJson(flags.toDict()),
      transcript,
    });
    return c.json(_row(h.get(Capture, id)), 201);
  });

  /** Newest first. Pinned captures are not sorted to the top here — the Captures page does that. */
  app.get("/v1/captures", input({ querystring: ListQuery }), (c) => {
    const q = c.req.valid("query");
    const limit = Math.min(Math.max(q.limit, 1), 200);
    const offset = Math.max(q.offset, 0);
    const h = getDb();
    const rows = h.all(`select * from ${Capture} order by created_at desc limit ? offset ?`, [limit, offset], Capture);
    return c.json(construct(CaptureList, { captures: rows.map(_row), total: h.count(Capture) }));
  });

  app.get("/v1/captures/:capture_id", (c) => c.json(_row(captureOr404(getDb(), c.req.param("capture_id")))));

  /** The recording, as a WAV download. */
  app.get("/v1/captures/:capture_id/audio", (c) => {
    const id = c.req.param("capture_id");
    const row = captureOr404(getDb(), id);
    const file = row.audio_path ? mediaFile(row.audio_path) : null;
    const size = file ? statSync(file, { throwIfNoEntry: false }) : null;
    if (!size?.isFile()) throw notFound(`audio for capture ${id}`);
    return c.body(Readable.toWeb(createReadStream(file)), 200, {
      "content-type": "audio/wav",
      "content-length": String(size.size),
      "content-disposition": attachment(`${id}.wav`),
    });
  });

  app.patch("/v1/captures/:capture_id", input({ body: UpdateCaptureRequest }), (c) => {
    const h = getDb();
    const id = c.req.param("capture_id");
    const body = c.req.valid("json");
    captureOr404(h, id);
    if (body.pinned !== null) h.update(Capture, { pinned: body.pinned }, { id });
    return c.json(_row(h.get(Capture, id)));
  });

  app.delete("/v1/captures/:capture_id", (c) => {
    const h = getDb();
    const id = c.req.param("capture_id");
    const row = captureOr404(h, id);
    if (row.audio_path) rmSync(mediaFile(row.audio_path), { force: true });
    h.delete(Capture, { id });
    return c.json({ deleted: true });
  });

  /** Clean the raw transcript again — always, whatever auto-refine says — with the toggles
   * sent, each one not sent keeping the capture's own. The raw transcript is never touched. */
  const refineInput = input({ body: RefineBody });
  app.post(
    "/v1/captures/:capture_id/refine",
    // No body at all means "the capture's own toggles" (validated as `{}`).
    async (c, next) => {
      const sent = await readJson(c);
      if (sent !== undefined && sent !== null) return refineInput(c, next);
      c.req.addValidatedData("json", shapeRequest(RefineBody, {}));
      return next();
    },
    async (c) => {
      const h = getDb();
      const id = c.req.param("capture_id");
      const row = captureOr404(h, id);
      if (!row.raw_transcript) throw badRequest(`capture ${id} has no raw transcript to clean`);
      const own = RefinementFlags.fromDict(storedFlags(row));
      const b = c.req.valid("json");
      const flags = new RefinementFlags({
        smartCleanup: b.smart_cleanup ?? own.smartCleanup,
        selfCorrection: b.self_correction ?? own.selfCorrection,
        preserveTechnical: b.preserve_technical ?? own.preserveTechnical,
      });
      let text;
      try {
        [text] = await refineTranscript(row.raw_transcript, flags, { settings: getState().settings.get() });
      } catch (e) {
        // The same answer the refine Lab gives when no language model is set up.
        if (e instanceof LLMNotConfiguredError) throw new HttpError(501, msg(e));
        throw e;
      }
      h.update(Capture, { transcript: text, refinement_flags_json: pyJson(flags.toDict()) }, { id });
      return c.json(_row(h.get(Capture, id)));
    },
  );

  /** Transcribe the stored recording again (in `?language=`, else the capture's own). */
  app.post("/v1/captures/:capture_id/retranscribe", input({ querystring: RetranscribeQuery }), async (c) => {
    const h = getDb();
    const id = c.req.param("capture_id");
    const row = captureOr404(h, id);
    const file = row.audio_path ? mediaFile(row.audio_path) : null;
    if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) throw badRequest(`the recording for capture ${id} is missing`);
    const settings = getState().settings.get();
    const raw = await self._sttTranscribe(file, c.req.valid("query").language || row.language);
    const transcript = settings.captures.auto_refine ? await self._maybeRefine(raw, RefinementFlags.fromDict(storedFlags(row)), settings) : raw;
    h.update(Capture, { raw_transcript: raw, transcript }, { id });
    return c.json(_row(h.get(Capture, id)));
  });
  return app;
}
