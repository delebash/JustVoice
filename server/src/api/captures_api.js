// SPDX-License-Identifier: MIT
//
// Route surface adapted from voicebox (MIT) — backend/routes/captures.py +
// routes/transcription.py at the commit pinned in voicebox-pin.txt, rewritten on JustVoice's
// managed-engine architecture (the recogniser runs in the stt slot of the speech runtime;
// refinement routes through the LLM provider dispatch). Original copyright (c) the voicebox
// authors.
//
// /v1/captures + /v1/transcribe — the dictation backend (parity gaps G1/G2), the port of
// justvoice/api/captures_api.py. The desktop hotkey records audio and POSTs it here; headless
// callers upload files. The Capture row stores BOTH the raw recogniser output and the
// post-refinement transcript so the UI can toggle between them.

import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import multipart from "@fastify/multipart";
import { RequestValidationError } from "@delebash/llm-runner/platform/errors";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { Capture, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest, notFound } from "../errors.js";
import { mediaFile, storeMediaPath } from "../media_paths.js";
import { construct, DateTime } from "../models.js";
import { jsonLoads } from "../py_compat.js";
import * as refinement from "../refinement.js";
import * as self from "./captures_api.js";

const log = getLogger("justvoice.api.captures_api");

const _UPLOAD_CHUNK = 1024 * 1024;
export const _MAX_UPLOAD_MB = 200;
/** `_MAX_UPLOAD_MB` as the routes read it — a test lowers it (Python monkeypatched the module
 * global). */
export const cfg = { _MAX_UPLOAD_MB };

export function _capturesDir() {
  const d = path.join(String(getState().dataDir), "captures");
  mkdirSync(d, { recursive: true });
  return d;
}

/** The stt slot's manager (and the settings), with speech recognition auto-loaded on first use.
 * Shared by transcription and word alignment — one loading rule. → `[manager, settings]`. */
export async function ensureSttLoaded() {
  const { getManager } = await import("../engines/manager.js");
  const mgr = getManager();
  const settings = getState().settings.get();
  if (mgr.loadedFor("stt") === null) {
    const status = mgr.status("asr");
    if (status === "installed") {
      log.info(`captures: auto-loading speech recognition (${settings.captures.stt_model}) on first use`);
      await mgr.load("asr", { device: "auto", variant: settings.captures.stt_model });
    } else {
      throw badRequest(`Speech recognition is ${status} — install the speech runtime on the AI page first`);
    }
  }
  return [mgr, settings];
}

/** Transcribe via the stt-slot engine; auto-load speech recognition if installed. What
 * dictation, MCP and the /v1/transcribe door share. */
export async function _sttTranscribe(audioPath, language) {
  const [mgr, settings] = await self.ensureSttLoaded();
  const lang = language || settings.captures.language;
  return mgr.transcribe({ audio_path: audioPath, language: lang === "" || lang === "auto" ? null : lang });
}

/** Refine if a provider is available → `[refined, model]`, or `[null, null]` — refinement
 * failure never loses the raw transcript. */
export async function _maybeRefine(raw, flags) {
  try {
    const settings = getState().settings.get();
    return await refinement.refineTranscript(raw, flags, { settings });
  } catch (e) {
    log.warning(`captures: refinement skipped: ${e?.message ?? e}`);
    return [null, null];
  }
}

export const CaptureRow = T.Object({
  id: T.String(),
  source: T.String(),
  language: nullable(T.String()),
  duration_ms: nullable(T.Integer()),
  transcript: nullable(T.String()),
  raw_transcript: nullable(T.String()),
  refinement_flags: T.Record(T.String(), T.Any()),
  audio_url: T.String(),
  pinned: opt(T.Boolean(), false),
  created_at: DateTime(),
});

export const CaptureList = T.Object({ captures: T.Array(CaptureRow), total: T.Integer() });

export const UpdateCaptureRequest = T.Object({ pinned: opt(nullable(T.Boolean()), null) });

export const RefineBody = T.Object({
  smart_cleanup: opt(nullable(T.Boolean()), null),
  self_correction: opt(nullable(T.Boolean()), null),
  preserve_technical: opt(nullable(T.Boolean()), null),
});

export function _row(c) {
  return construct(CaptureRow, {
    id: c.id,
    source: c.source,
    language: c.language,
    duration_ms: c.duration_ms,
    transcript: c.transcript,
    raw_transcript: c.raw_transcript,
    refinement_flags: c.refinement_flags_json ? jsonLoads(c.refinement_flags_json) : {},
    audio_url: `/v1/captures/${c.id}/audio`,
    pinned: Boolean(c.pinned),
    created_at: c.created_at,
  });
}

// ── The form, as Starlette reads one ────────────────────────────────────────

/**
 * A multipart/form-data request read whole before the handler runs, as Starlette does: each
 * file part spooled to a temp folder (`{path, filename, size}`), each other part a string.
 * The folder goes when the answer has been sent (`_useForms`). A request that isn't multipart
 * has no form (every field missing). Candidate for platform/ (FastAPI's `File()` / `Form()`).
 */
export async function _readForm(req) {
  const form = { files: {}, fields: {} };
  if (!req.isMultipart?.()) return form;
  const dir = mkdtempSync(path.join(tmpdir(), "jv-upload-"));
  req.formDir = dir;
  let n = 0;
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const p = path.join(dir, `part-${n++}`);
      await pipeline(part.file, createWriteStream(p));
      form.files[part.fieldname] = { path: p, filename: part.filename, size: statSync(p).size };
    } else {
      form.fields[part.fieldname] = String(part.value);
    }
  }
  return form;
}

/** `name: UploadFile = File(...)` — the 422 FastAPI gives when it is missing. */
export function _requireFile(form, name) {
  const f = form.files[name];
  if (f === undefined) throw new RequestValidationError([{ loc: ["body", name], msg: "Field required", type: "missing" }]);
  return f;
}

/** `name: str = Form(default)` — FastAPI reads an empty form value as "not sent". */
export function _formField(form, name, dflt) {
  const v = form.fields[name];
  return v === undefined || v === "" ? dflt : v;
}

/** Copy an upload chunk by chunk into `dest`, refusing past `cfg._MAX_UPLOAD_MB` (the partial
 * file is the caller's to remove). */
async function copyCapped(upload, dest) {
  let total = 0;
  const out = createWriteStream(dest);
  try {
    for await (const chunk of createReadStream(upload.path, { highWaterMark: _UPLOAD_CHUNK })) {
      total += chunk.length;
      if (total > cfg._MAX_UPLOAD_MB * 1024 * 1024) throw badRequest(`upload exceeds ${cfg._MAX_UPLOAD_MB} MB`);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

const byId = (h, id) => h.one(`select * from ${Capture} where id = ? limit 1`, [id], Capture);
const unlinkQuiet = (p) => {
  try {
    unlinkSync(p);
  } catch {
    /* missing_ok */
  }
};

/** Make a router context read forms: the multipart parser (FastAPI has no upload limit of its
 * own; the routes cap at _MAX_UPLOAD_MB themselves) and the spooled files' cleanup once the
 * answer is sent. */
export async function _useForms(app) {
  await app.register(multipart, { limits: { fileSize: Number.POSITIVE_INFINITY, fieldSize: 1024 * 1024 } });
  app.addHook("onResponse", async (req) => {
    if (req.formDir) rmSync(req.formDir, { recursive: true, force: true });
  });
}

export async function router(app) {
  await _useForms(app);

  /** Pin/unpin (parity: the journeys mock pins repeated phrases). */
  app.patch("/v1/captures/:capture_id", { schema: { body: UpdateCaptureRequest } }, async (req) => {
    const h = session.getDb();
    const id = req.params.capture_id;
    if (byId(h, id) === null) throw notFound(`capture ${id}`);
    if (req.body.pinned !== null) h.update(Capture, { pinned: req.body.pinned }, { id });
    return _row(byId(h, id));
  });

  /** Stateless transcription — upload audio, get text. No Capture row. */
  app.post("/v1/transcribe", async (req) => {
    const form = await _readForm(req);
    const file = _requireFile(form, "file");
    const language = _formField(form, "language", null);
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), "jv-transcribe-")), "upload.wav");
    try {
      // The file is deleted however this ends — an oversized upload used to be refused before
      // its path was known, leaving up to 200 MB behind (audit §5 F).
      await copyCapped(file, tmp);
      return { text: await self._sttTranscribe(tmp, language), language };
    } finally {
      rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });

  /** Upload a recording → transcribe → (optionally) refine → persist. */
  app.post("/v1/captures", async (req, reply) => {
    const form = await _readForm(req);
    const file = _requireFile(form, "file");
    const source = _formField(form, "source", "upload");
    const language = _formField(form, "language", null);
    if (!["mic", "system_audio", "upload"].includes(source)) throw badRequest("source must be mic | system_audio | upload");

    const id = uuid();
    const dest = path.join(_capturesDir(), `${id}.wav`);
    try {
      await copyCapped(file, dest);
    } catch (e) {
      unlinkQuiet(dest);
      throw e;
    }
    // Stored RELATIVE to the data root so a Change-folder move doesn't orphan the file.
    const audioPath = storeMediaPath(dest);
    // A failed transcription leaves the file and no row — as Python (its flushed row rolled
    // back; the file stayed).
    const raw = await self._sttTranscribe(dest, language);

    const settings = getState().settings.get();
    const flags = new refinement.RefinementFlags({
      smartCleanup: settings.captures.smart_cleanup,
      selfCorrection: settings.captures.self_correction,
      preserveTechnical: settings.captures.preserve_technical,
    });
    let transcript = raw;
    if (settings.captures.auto_refine) {
      const [refined] = await self._maybeRefine(raw, flags);
      if (refined !== null) transcript = refined;
    }
    const h = session.getDb();
    h.insert(Capture, {
      id,
      audio_path: audioPath,
      source,
      language,
      raw_transcript: raw,
      refinement_flags_json: pyJson(flags.toDict()),
      transcript,
    });
    reply.code(201);
    return _row(byId(h, id));
  });

  app.get(
    "/v1/captures",
    { schema: { querystring: T.Object({ limit: opt(T.Integer(), 50), offset: opt(T.Integer(), 0) }) } },
    async (req) => {
      const h = session.getDb();
      const total = h.count(Capture);
      const rows = h.all(`select * from ${Capture} order by created_at desc limit ? offset ?`, [
        Math.max(1, Math.min(200, req.query.limit)),
        Math.max(0, req.query.offset),
      ], Capture);
      return construct(CaptureList, { captures: rows.map(_row), total });
    },
  );

  app.get("/v1/captures/:capture_id", async (req) => {
    const c = byId(session.getDb(), req.params.capture_id);
    if (c === null) throw notFound(`capture ${req.params.capture_id}`);
    return _row(c);
  });

  app.get("/v1/captures/:capture_id/audio", async (req, reply) => {
    const id = req.params.capture_id;
    const c = byId(session.getDb(), id);
    if (c === null) throw notFound(`capture ${id}`);
    const p = mediaFile(c.audio_path);
    let st;
    try {
      st = statSync(p);
    } catch {
      st = null;
    }
    if (!st?.isFile()) throw notFound(`audio missing from disk: ${c.audio_path}`);
    // Starlette's FileResponse: the media type, the length, and an attachment name.
    return reply
      .type("audio/wav")
      .header("content-length", st.size)
      .header("content-disposition", `attachment; filename="${id}.wav"`)
      .send(createReadStream(p));
  });

  app.delete("/v1/captures/:capture_id", async (req) => {
    const h = session.getDb();
    const id = req.params.capture_id;
    const c = byId(h, id);
    if (c === null) throw notFound(`capture ${id}`);
    if (c.audio_path) unlinkQuiet(mediaFile(c.audio_path));
    h.delete(Capture, { id });
    return { deleted: true };
  });

  /** Re-run refinement on the stored RAW transcript with (possibly new) flags. The raw
   * transcript is never overwritten. */
  app.post("/v1/captures/:capture_id/refine", { schema: { body: RefineBody } }, async (req) => {
    const h = session.getDb();
    const id = req.params.capture_id;
    const c = byId(h, id);
    if (c === null) throw notFound(`capture ${id}`);
    if (!c.raw_transcript) throw badRequest("capture has no raw transcript to refine");
    const settings = getState().settings.get();
    const prev = refinement.RefinementFlags.fromDict(c.refinement_flags_json ? jsonLoads(c.refinement_flags_json) : null);
    const b = req.body;
    const flags = new refinement.RefinementFlags({
      smartCleanup: b.smart_cleanup === null ? prev.smartCleanup : b.smart_cleanup,
      selfCorrection: b.self_correction === null ? prev.selfCorrection : b.self_correction,
      preserveTechnical: b.preserve_technical === null ? prev.preserveTechnical : b.preserve_technical,
    });
    const [refined] = await refinement.refineTranscript(c.raw_transcript, flags, { settings });
    h.update(Capture, { transcript: refined, refinement_flags_json: pyJson(flags.toDict()) }, { id });
    return _row(byId(h, id));
  });

  /** Re-run STT on the stored audio (e.g. after switching recognition models), then re-apply
   * the capture's refinement flags. */
  app.post(
    "/v1/captures/:capture_id/retranscribe",
    { schema: { querystring: T.Object({ language: opt(nullable(T.String()), null) }) } },
    async (req) => {
      const h = session.getDb();
      const id = req.params.capture_id;
      const c = byId(h, id);
      if (c === null) throw notFound(`capture ${id}`);
      let ok = false;
      if (c.audio_path) {
        try {
          ok = statSync(mediaFile(c.audio_path)).isFile();
        } catch {
          ok = false;
        }
      }
      if (!ok) throw badRequest("capture audio missing from disk");
      const raw = await self._sttTranscribe(String(mediaFile(c.audio_path)), req.query.language || c.language);
      const flags = refinement.RefinementFlags.fromDict(c.refinement_flags_json ? jsonLoads(c.refinement_flags_json) : null);
      const settings = getState().settings.get();
      let transcript = raw;
      if (settings.captures.auto_refine) {
        const [refined] = await self._maybeRefine(raw, flags);
        if (refined !== null) transcript = refined;
      }
      h.update(Capture, { raw_transcript: raw, transcript }, { id });
      return _row(byId(h, id));
    },
  );
}
