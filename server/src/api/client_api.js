// SPDX-License-Identifier: MIT
// The client API — what another app calls JustVoice for, live (docs/dev/client-api.md; JustDirect
// first, 2026-11-08): a character's voice in one call (the one-click run's recipe for one person),
// a line in OpenAI's speech shape, and a batch of lines that lets go of the card when it ends.
//
//   POST /v1/character-voices                         → 202, a job (kind "character-voice")
//   POST /v1/audio/speech                             → audio/wav
//   POST /v1/audio/speech/batch                       → 202, a job (kind "speech-batch")
//   GET  /v1/audio/speech/batch/:job_id/lines/:id.wav → one line's WAV
//   GET  /v1/audio/speech/batch/:job_id.zip           → every line's WAV and manifest.json
//
// The jobs run on the app's one job registry (export_jobs_api.js `jobs`), so /v1/jobs/:id, its
// events and DELETE are the kit's (makeJobsRouter). A caller names itself in `X-Client`; a voice it
// makes keeps that as its `made_by` (voices_api.js `clientOf`).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isAbortError, LLMNotConfiguredError } from "@delebash/core/llm";
import { Hono, input } from "@delebash/core/platform";
import { HttpError } from "@delebash/core/platform/errors";
import { getLogger } from "@delebash/core/platform/log";
import { cpLen, errText, strip } from "@delebash/core/platform/py";
import { ZipWriter } from "@delebash/core/platform/zip";
import { getState } from "../app_state.js";
import { parseObject } from "../book_voices/index.js";
import { ACTIONS } from "../book_voices/prompts.js";
import * as kitSpeech from "../engines/audiocpp/kit_speech.js";
import * as run from "../engines/llm/run.js";
import { badRequest, notFound } from "../errors.js";
import { CharacterVoiceRequest, construct, GenerateRequest, SpeechBatchRequest, SpeechRequest } from "../models.js";
import { stockLine } from "../persona_render.js";
import * as vmod from "../voice_model.js";
import * as self from "./client_api.js";
import { jobs, onForget } from "./export_jobs_api.js";
import * as generateApi from "./generate_api.js";
import { _formatCharacters } from "./smart_assign_api.js";
import * as vp from "./voice_preview_api.js";
import { clientOf, modelLicence } from "./voices_api.js";

const log = getLogger("justvoice.api.client");

/** Licence words a caller asking for commercial use is refused (curated/<family>.js LICENCE). */
const NOT_COMMERCIAL = new Set(["No", "Separate licence", "Unclear"]);

/** A model as a client reads it: id, name and licence words. */
export function modelFacts(model) {
  const lic = modelLicence(model);
  return {
    model,
    name: vmod.modelName(model),
    commercial: lic?.commercial ?? "Unclear",
    summary: lic?.summary ?? "",
    url: lic?.url ?? "",
  };
}

/** 409 when the caller asked for commercial use and `model`'s licence doesn't allow it. */
function checkCommercial(model, what) {
  const f = self.modelFacts(model);
  if (NOT_COMMERCIAL.has(f.commercial)) {
    throw new HttpError(
      409,
      `The ${what} model, ${f.name}, isn't licensed for commercial use (${f.commercial}): ${f.summary} Set book_voices.${what === "design" ? "design_model" : "clone_model"} to a model you can sell with.`,
    );
  }
  return f;
}

/** The line a voice is designed speaking: the caller's line nearest `words` words without an
 * exclamation (a calm one, as the one-click run's `auditionLine`), else the stock line. */
export function auditionOf(lines, words, language) {
  const count = (t) => t.split(/\s+/).filter(Boolean).length;
  const pool = lines.map((l) => strip(l)).filter((l) => l && cpLen(l) <= 2000 && count(l) * 2 >= words);
  const near = (xs) => xs.reduce((best, t) => (best === null || Math.abs(count(t) - words) < Math.abs(count(best) - words) ? t : best), null);
  return near(pool.filter((t) => !t.includes("!"))) ?? near(pool) ?? stockLine(language);
}

/** One character's voice description, written by the one-click run's Local prompt over the
 * caller's card and lines → `{gender, description, described_by}`; with no language model set,
 * the card's own description as written. */
async function describe(body, signal) {
  const speaker = _formatCharacters([{ id: "c1", name: body.name, description: body.description, gender: body.gender ?? "" }]);
  const passages = body.lines.length ? body.lines.map((l) => `⟦${strip(l)}⟧`).join("\n\n") : "(none given)";
  try {
    const resp = await run.runFeature(ACTIONS.speaker, { book: strip(body.context) || "a story", speaker, passages }, {}, { signal });
    const v = parseObject(resp.text);
    const description = strip(String(v?.description ?? ""));
    if (description) {
      const g = strip(String(v?.gender ?? "")).toLowerCase();
      return { gender: body.gender ?? (g === "male" || g === "female" ? g : null), description, described_by: resp.model || null };
    }
    log.warning(`client: no description for ${body.name} from the language model; the card's own goes to the designer`);
  } catch (e) {
    if (isAbortError(e)) throw e;
    if (!(e instanceof LLMNotConfiguredError)) log.warning(`client: describing ${body.name} failed (${errText(e)}); the card's own goes to the designer`);
  }
  return { gender: body.gender ?? null, description: strip(body.description), described_by: null };
}

/** The design and clone models a character's voice is made on, checked before the job starts →
 * `{cfg, designEngine, design, clone}`; 400 for a model that can't do its part, 409 for one the
 * caller can't sell with when it asked for commercial use. */
export function characterModels(body) {
  const cfg = getState().settings.get().book_voices;
  const designEngine = vmod.engineOfModel(cfg.design_model);
  if (designEngine === null || !vmod.can(cfg.design_model, "design")) {
    throw badRequest(`${vmod.modelName(cfg.design_model)} can't design a voice from words — set book_voices.design_model to one that can.`);
  }
  if (vmod.engineOfModel(cfg.clone_model) === null || !vmod.can(cfg.clone_model, "clone")) {
    throw badRequest(`${vmod.modelName(cfg.clone_model)} can't keep a voice from its clip — set book_voices.clone_model to one that can.`);
  }
  const design = body.commercial_use ? checkCommercial(cfg.design_model, "design") : self.modelFacts(cfg.design_model);
  const clone = body.commercial_use ? checkCommercial(cfg.clone_model, "clone") : self.modelFacts(cfg.clone_model);
  return { cfg, designEngine, design, clone };
}

/** Make one character's voice (the job's work) → the job's result. */
export async function makeCharacterVoice(body, client, { signal = null, progress = () => {} } = {}) {
  const st = getState();
  const { cfg, designEngine, design, clone } = self.characterModels(body);
  progress(0.05, "Describing the voice");
  const d = await describe(body, signal);
  signal?.throwIfAborted();
  progress(0.3, "Designing the voice");
  const audition = self.auditionOf(body.lines, cfg.audition_words, body.language);
  const heard = await vp.previewVoice(
    vp.voicePreviewRequest({ engine: designEngine, model: cfg.design_model, source: "designed", prompt: d.description, preview_text: audition, language: body.language }),
    { signal },
  );
  signal?.throwIfAborted();
  progress(0.9, "Keeping the voice");
  const saved = await vp.savePreview(heard.previewId, { name: body.name, gender: d.gender, model: cfg.clone_model });
  if (client) st.voices.update(saved.voice_id, { made_by: client });
  return {
    voice_id: saved.voice_id,
    name: body.name,
    gender: d.gender,
    description: d.description,
    described_by: d.described_by,
    design,
    clone,
    audition,
    audition_url: `/v1/voices/${saved.voice_id}/clip.wav`,
  };
}

/** OpenAI's speech body → JustVoice's line request (generate_api.js `generate`). */
export function lineRequest(body, voiceLanguage) {
  const delivery = {};
  if (body.emotion) delivery.emotion = body.emotion;
  if (strip(body.instructions ?? "")) delivery.instruct = strip(body.instructions);
  if (body.speed != null && body.speed !== 1) delivery.speed = body.speed;
  return {
    voice: body.voice,
    text: body.input,
    language: voiceLanguage,
    delivery: Object.keys(delivery).length ? delivery : null,
    seed: body.seed ?? null,
    cache: true,
  };
}

/** One line in OpenAI's shape → WAV bytes. */
export async function speak(body, { signal = null } = {}) {
  if ((body.response_format ?? "wav") !== "wav") throw badRequest(`response_format ${body.response_format}: only "wav" is offered`);
  if (!strip(body.input)) throw badRequest("input is empty");
  const rec = getState().voices.get(body.voice);
  const language = rec?.language ?? null;
  return generateApi.generate(construct(GenerateRequest, self.lineRequest(body, language)), { signal });
}

/** Let go of every speech model JustVoice holds (the card is the caller's again) → how many. */
export async function releaseSpeech() {
  let n = 0;
  for (const kind of ["tts", "stt"]) {
    const held = kitSpeech.loadedFor(kind);
    if (held && (await kitSpeech.unload(held.versionId))) n += 1;
  }
  return n;
}

/** Where a batch's WAVs are kept: `<data>/cache/client-batches/<job id>/`. */
const batchDir = (jobId) => path.join(getState().dataDir, "cache", "client-batches", jobId);
const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** A batch's folders older than a day go, and their ended jobs are forgotten — the caller fetched
 * them, or never will (the registry keeps an ended job until it is forgotten). */
function sweepBatches(now = Date.now()) {
  const root = path.join(getState().dataDir, "cache", "client-batches");
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const p = path.join(root, name);
    try {
      if (jobs.get(name)?.state === "running" || now - statSync(p).mtimeMs <= 24 * 3600_000) continue;
      jobs.forget(name);
      rmSync(p, { recursive: true, force: true });
    } catch {
      // another sweep took it
    }
  }
}

/** Render a batch (the job's work) → `{lines: [{id, file, url, seconds, error}]}`. */
export async function speakBatch(jobId, body, { signal = null, progress = () => {} } = {}) {
  const dir = batchDir(jobId);
  mkdirSync(dir, { recursive: true });
  const out = [];
  try {
    for (const [i, line] of body.lines.entries()) {
      signal?.throwIfAborted();
      progress(i / body.lines.length, `Line ${i + 1} of ${body.lines.length}`);
      const started = performance.now();
      const entry = { id: line.id, file: `${line.id}.wav`, url: `/v1/audio/speech/batch/${jobId}/lines/${line.id}.wav`, voice: line.voice, seconds: 0, error: null };
      try {
        const wav = await self.speak({ ...line, response_format: "wav" }, { signal });
        writeFileSync(path.join(dir, entry.file), wav);
      } catch (e) {
        if (isAbortError(e) || signal?.aborted) throw e;
        entry.error = errText(e);
        entry.file = null;
        entry.url = null;
      }
      entry.seconds = Math.round(performance.now() - started) / 1000;
      out.push(entry);
    }
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ lines: out }, null, 2));
    return { lines: out };
  } finally {
    // The card is the caller's again — done, failed or cancelled.
    if (body.release) await self.releaseSpeech().catch((e) => log.warning(`client: letting go of the speech models failed: ${errText(e)}`));
  }
}

onForget((job) => {
  if (job.kind === "speech-batch") rmSync(batchDir(job.id), { recursive: true, force: true });
});

export function router() {
  const app = new Hono();

  app.post("/v1/character-voices", input({ body: CharacterVoiceRequest }), (c) => {
    const body = c.req.valid("json");
    const client = clientOf(c);
    if (!strip(body.name) || !strip(body.description)) throw badRequest("name and description are required");
    self.characterModels(body); // refused here, before a job starts
    const snap = jobs.start({ kind: "character-voice", key: `${client ?? ""}:${body.name}`, label: body.name, failTitle: "The voice couldn't be made" }, (ctx) =>
      self.makeCharacterVoice(body, client, ctx),
    );
    return c.json(snap, 202);
  });

  app.post("/v1/audio/speech", input({ body: SpeechRequest, pyFloats: true }), async (c) => {
    const wav = await self.speak(c.req.valid("json"));
    return c.body(wav, 200, { "content-type": "audio/wav" });
  });

  app.post("/v1/audio/speech/batch", input({ body: SpeechBatchRequest, pyFloats: true }), (c) => {
    const body = c.req.valid("json");
    if (!body.lines.length) throw badRequest("lines is empty");
    const seen = new Set();
    for (const l of body.lines) {
      if (!SAFE_ID.test(l.id)) throw badRequest(`line id ${JSON.stringify(l.id)}: letters, digits, "_", "-" and "." only, up to 128`);
      if (seen.has(l.id)) throw badRequest(`line id ${l.id} is given twice`);
      seen.add(l.id);
    }
    sweepBatches();
    const client = clientOf(c);
    let jobId = null;
    const snap = jobs.start({ kind: "speech-batch", key: `${client ?? ""}:${Date.now()}:${Math.random()}`, label: `${body.lines.length} lines`, failTitle: "The lines couldn't be spoken" }, (ctx) =>
      self.speakBatch(jobId, body, ctx),
    );
    jobId = snap.id;
    return c.json(snap, 202);
  });

  app.get("/v1/audio/speech/batch/:job_id/lines/:file", (c) => {
    const { job_id: jobId, file } = c.req.param();
    const id = file.replace(/\.wav$/, "");
    if (!SAFE_ID.test(jobId) || !SAFE_ID.test(id) || !file.endsWith(".wav")) throw notFound(file);
    const p = path.join(batchDir(jobId), `${id}.wav`);
    if (!existsSync(p)) throw notFound(`line ${id} of batch ${jobId}`);
    return c.body(readFileSync(p), 200, { "content-type": "audio/wav" });
  });

  // Done with a batch: a running one is stopped, an ended one forgotten with its files.
  app.delete("/v1/audio/speech/batch/:job_id", (c) => {
    const jobId = c.req.param("job_id");
    const job = SAFE_ID.test(jobId) ? jobs.get(jobId) : null;
    if (!job || job.kind !== "speech-batch") throw notFound(`batch ${jobId}`);
    if (job.state === "running") jobs.cancel(jobId);
    else jobs.forget(jobId);
    rmSync(batchDir(jobId), { recursive: true, force: true });
    return c.json({ deleted: true });
  });

  app.get("/v1/audio/speech/batch/:file", (c) => {
    const file = c.req.param("file");
    const jobId = file.replace(/\.zip$/, "");
    if (!file.endsWith(".zip") || !SAFE_ID.test(jobId)) throw notFound(file);
    const dir = batchDir(jobId);
    const manifest = path.join(dir, "manifest.json");
    if (!existsSync(manifest)) throw notFound(`batch ${jobId} (not finished, or forgotten)`);
    const zf = new ZipWriter({ compression: "stored" });
    zf.writestr("manifest.json", readFileSync(manifest));
    for (const l of JSON.parse(readFileSync(manifest, "utf8")).lines) if (l.file) zf.writestr(l.file, readFileSync(path.join(dir, l.file)));
    return c.body(zf.toBuffer(), 200, { "content-type": "application/zip", "content-disposition": `attachment; filename="${jobId}.zip"` });
  });
  return app;
}
