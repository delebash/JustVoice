// SPDX-License-Identifier: MIT
// JustVoice's speech, transcription and alignment on the kit's audio.cpp runtime (round E —
// docs/plans/2026-10-29-round-e-onto-the-kit.md §4 steps 2–3). The kit loads a line's model (where
// the user's saved choice for it says, downloaded first when it isn't here), holds its kind's lock
// for the line, books its memory and runs the after-line pass (llm/speech_dispatch.js
// `withSpeechModel`, runner/runtime_service.js `useModel`); what stays ours is how each family's
// request is shaped (slot.js) and which version a voice speaks (voice_model.js). Transcription is a
// feature on its stt preset (`transcribeFeature`, the "Transcription" feature — feature_catalog.js),
// its request shaped by our hook (kit_hooks.js `transcribe`).
//
// Also what the app reads of the runtime: what each kind holds now (the kit's `loaded()`), whether
// it is installed, a model's files in the kit's models cache — and a refusal of the kit's as our
// EngineRequestError, with the same problem the kit's own routes answer (llm/runtimes_api.js).

import { resolveRuntimeFeature } from "@delebash/core/llm/image_dispatch";
import { speechFeatureReadiness, transcribeFeature, withSpeechModel } from "@delebash/core/llm/speech_dispatch";
import { RuntimeError } from "@delebash/core/platform/py";
import { AudioCppError, wavSeconds } from "@delebash/core/runner/audiocpp";
import { getRuntimeService } from "@delebash/core/runner/runtime_service";
import { ApiError, badRequest, conflict, internal, serviceUnavailable } from "../../errors.js";
import { TRANSCRIPTION_FEATURE } from "../../feature_catalog.js";
import * as modelCatalog from "../model_catalog.js";
import { RUNTIME, variantOf } from "./kit_models.js";
import * as slot from "./slot.js";
import * as self from "./kit_speech.js";

/** The kit's audio.cpp runtime, or null (no shared stack: a script, a bare test). */
export const service = () => getRuntimeService(RUNTIME);

// ─── Errors ──────────────────────────────────────────────────────────────────

/** A speech request the runtime refused or failed, with its status: 503 (out of memory, busy,
 * or the runtime stopped answering), 400 (a request it can't take), 409 (a build feature the
 * runtime lacks), 500 otherwise (audit 2026-10-04 §5 D8) — or one of the kit's refusals with its
 * own problem (`problem`: not enough memory, a cancelled load, a computer that can't run it, a full
 * drive, a busy model). */
export class EngineRequestError extends RuntimeError {
  constructor(status, message, problem = null) {
    super(message);
    this.name = "EngineRequestError";
    this.status = status;
    this.problem = problem;
  }

  apiError() {
    if (this.problem !== null) return this.problem;
    if (this.status === 503) return serviceUnavailable(this.message);
    if (this.status === 409) return conflict(this.message);
    if (this.status >= 400 && this.status < 500) {
      return this.status !== 404 ? badRequest(this.message) : new ApiError(404, "not-found", "Not found", this.message);
    }
    return internal(this.message);
  }
}

/** A line's model didn't load — the runtime failed before the line started, for a reason that is
 * none of the kit's refusals (its process didn't start, its warm-up failed). The caller says so in
 * its own words, with the load route to try. */
export class LoadFailed extends RuntimeError {
  constructor(versionId, message) {
    super(message);
    this.name = "LoadFailed";
    this.versionId = versionId;
  }
}

/** A refusal of the kit's as ours — the problem its routes answer for it (llm/runtimes_api.js
 * `asProblem`, which the kit keeps to its routes): a licence not accepted (TermsRequired, naming
 * the engine), not enough memory, a load an Unload cancelled, what this computer lacks, no room on
 * the drive, a busy model; audio.cpp's own answer with its status; the kit's problems as they are.
 * Anything else is returned as it is. */
export function engineError(e, engineId = null) {
  if (e instanceof EngineRequestError || e instanceof modelCatalog.TermsRequired || e instanceof LoadFailed) return e;
  if (e instanceof AudioCppError) return new EngineRequestError(e.status >= 400 && e.status < 600 ? e.status : 500, e.message);
  if (e instanceof ApiError) return new EngineRequestError(e.statusCode, String(e.detail ?? e.message), e);
  const refused = (status, slug, title, extra = null) => new EngineRequestError(status, e.message, new ApiError(status, slug, title, e.message, extra));
  if (e?.termsRequired) return new modelCatalog.TermsRequired(engineId ?? variantOf(e.termsRequired.modelId)?.engineId ?? null, e.message);
  if (e?.loadCancelled) return refused(409, "load-cancelled", "The load was cancelled", { modelId: e.loadCancelled.modelId });
  if (e?.name === "NotEnoughMemoryError") return refused(409, "not-enough-memory", "Not enough memory", { where: e.where, neededMb: e.neededMb, freeMb: e.freeMb });
  if (e?.need) return refused(409, "engine-cant-run-here", "This computer can't run this engine yet", { need: e.need });
  if (e?.diskFull) return refused(507, "disk-full", "Not enough room on the drive", e.diskFull);
  if (e?.busy) return refused(409, e.busy, e.busy === "model-busy" ? "The model is busy" : "The engine is busy");
  if (e?.notFound) return new EngineRequestError(404, e.message);
  if (e?.notInstalled || e?.notDownloaded) return new EngineRequestError(409, e.message);
  return e;
}

/** Whether `e` is one of the kit's refusals (or a licence to accept) — said as it is, never as a
 * failed load. */
const isRefusal = (e) => e instanceof modelCatalog.TermsRequired || e?.problem != null;

/** `e` as the HTTP problem it answers — a refusal's, or a failed request's with audio.cpp's own
 * words after "engine <what> failed:", as a request's failure always said them — or as it is. */
export function asProblem(e, what) {
  const mapped = self.engineError(e);
  if (mapped instanceof EngineRequestError && e instanceof AudioCppError) {
    return new EngineRequestError(mapped.status, `engine ${what} failed: ${mapped.message}`).apiError();
  }
  return typeof mapped?.apiError === "function" ? mapped.apiError() : mapped;
}

// ─── A line ──────────────────────────────────────────────────────────────────

/**
 * Speak one line on model version `versionId` of `engineId` — `body` a synth body (a SynthRequest
 * as a snake_case object: voice_id, text, language, delivery, seed, and a stored voice's clip,
 * transcript or blend). What it needs from the runtime, its terms and its blend are checked first
 * (slot.js `checkLine`), so a refused line loads nothing; then the kit runs it on the model —
 * loaded where the user's saved choice says (no placement of ours), with the load options they
 * saved (kit_hooks.js `sessionOptions`) — the request shaped for its family (slot.js `speak`).
 * `onStart()` runs when the line starts, its model loaded. → `[wav, {media_type, sample_rate,
 * channels, is_wav_container}]`. A failure is ours (`engineError`), and one before the line started
 * that is no refusal is a LoadFailed.
 */
export async function speak(engineId, versionId, body, { onStart = null } = {}) {
  const found = variantOf(versionId);
  if (found === null) throw new EngineRequestError(404, `no speech model ${versionId} in ${modelCatalog.getManifest(engineId)?.name ?? engineId}`);
  slot.checkLine(found, body);
  let started = false;
  try {
    const line = (out) => ({ text: String(body?.text ?? ""), audioS: wavSeconds(out?.[0]) });
    return await withSpeechModel(RUNTIME, versionId, { line }, async (server) => {
      started = true;
      onStart?.();
      return slot.speak(server, found.row, body);
    });
  } catch (e) {
    const mapped = self.engineError(e, engineId);
    if (!started && !isRefusal(mapped)) throw new LoadFailed(versionId, e?.message ?? String(e));
    if (mapped instanceof EngineRequestError && e instanceof AudioCppError) {
      // audio.cpp's own words, as a synth's failure always said them
      throw new EngineRequestError(mapped.status, `engine synth failed: ${mapped.message}`);
    }
    throw mapped;
  }
}

// ─── Transcription and alignment ─────────────────────────────────────────────

/** The model the Transcription feature's preset names. */
export const transcriptionModel = () => resolveRuntimeFeature(TRANSCRIPTION_FEATURE, "stt").preset.model;

/** What the Transcription feature needs before it can run — the kit's readiness (its preset's
 * `model`, the runtime installed, the model downloaded: `need` "" when it can run). */
export const transcriptionReadiness = () => speechFeatureReadiness(TRANSCRIPTION_FEATURE);

/**
 * The recogniser's text for `body` (`{audio_path, language}` — a language "" or null lets it
 * detect one): the Transcription feature's preset — its model, where it says — through the kit,
 * the request shaped by our hook (kit_hooks.js `transcribe`), then the words without the model's
 * own markup (slot.js `plainTranscript`). A failure is the problem it answers.
 */
export async function transcribe(body) {
  let out;
  try {
    out = await transcribeFeature(TRANSCRIPTION_FEATURE, body);
  } catch (e) {
    // the recogniser's own words (audio.cpp's refusal — "this LFM2-Audio checkpoint transcribes ja, not en")
    throw self.asProblem(e, "transcribe");
  }
  return slot.plainTranscript(variantOf(self.transcriptionModel())?.row ?? null, out);
}

/** The model that times words: the Transcription preset's when it has a word aligner, else the
 * speech-recognition engine's default (Qwen3-ASR's — captions stay on Qwen3-ASR and its aligner,
 * the adoption plan's §7 answer 2). */
export function alignerModel() {
  let model = "";
  try {
    model = self.transcriptionModel();
  } catch {
    model = ""; // no preset set: the engine's default
  }
  const hasAligner = (id) => (variantOf(id)?.row?.audiocpp?.companions || []).some((c) => c.role === "aligner");
  return hasAligner(model) ? model : modelCatalog.resolvedDefaultVariant("asr");
}

/**
 * Word timings for `wav` (a WAV Buffer) saying `text` → `[{word, start, end}]`: Qwen3-ASR's forced
 * aligner, registered with its model on its first use (the kit's on-demand companion — round E,
 * G11), the audio at the aligner's own rate (slot.js `asAudio16kMono`), the language as Qwen3-ASR
 * names it (English for one it doesn't know). A failure is the problem it answers.
 */
export async function align(wav, text, language = null) {
  const model = self.alignerModel();
  const lang = String(language || "en").split("-")[0].toLowerCase();
  let out;
  try {
    out = await withSpeechModel(RUNTIME, model, { needs: ["aligner"] }, async (server) =>
      server.align(`${model}::aligner`, await slot.asAudio16kMono(wav), text || "", slot.ASR_LANGUAGE[lang] ?? "English"),
    );
  } catch (e) {
    throw self.asProblem(e, "align");
  }
  return (out?.words || []).map((w) => ({ word: w?.word ?? "", start: Number(w?.start ?? 0.0), end: Number(w?.end ?? 0.0) }));
}

// ─── What the runtime holds ──────────────────────────────────────────────────

/** Whether the runtime is installed here (or `npm run dev`'s build stands in). */
export function installed() {
  try {
    return Boolean(self.service()?.installedExe());
  } catch {
    return false; // no kit database / hardware yet
  }
}

/** What `kind` ("tts" | "stt") holds now — `{engineId, versionId, placement, reason}` — or null. */
export function loadedFor(kind) {
  let held = [];
  try {
    held = self.service()?.loaded() ?? [];
  } catch {
    held = [];
  }
  for (const l of held) {
    if (l.kind !== kind) continue;
    const found = variantOf(l.modelId);
    if (found) return { engineId: found.engineId, versionId: l.modelId, placement: l.placement, reason: l.reason ?? "" };
  }
  return null;
}

/** The engine `kind` holds a model of now, or null. */
export const currentFor = (kind) => self.loadedFor(kind)?.engineId ?? null;

/** `engineId`'s loaded version (either kind), or null. */
export function loadedOf(engineId) {
  for (const kind of ["tts", "stt"]) {
    const l = self.loadedFor(kind);
    if (l !== null && l.engineId === engineId) return l;
  }
  return null;
}

/** `engineId`'s loaded version id, or null. */
export const currentVariantId = (engineId) => self.loadedOf(engineId)?.versionId ?? null;

/** One of: not_installed | installed | loaded — an engine's state, from the runtime's. */
export function engineStatus(engineId) {
  if (self.loadedOf(engineId) !== null) return "loaded";
  return self.installed() ? "installed" : "not_installed";
}

/** Let model version `versionId` go (a load of it under way is cancelled — the kit's). */
export async function unload(versionId) {
  return Boolean(await self.service()?.unloadModel(versionId));
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** A downloaded model version's files in the kit's models cache, by slot (its main file "model") —
 * null when they aren't all here, or there is no runtime. */
export function modelFiles(versionId) {
  try {
    return self.service()?.modelFor(versionId).files ?? null;
  } catch {
    return null; // not downloaded, or not a model the runtime has
  }
}

/** Whether every file of model version `versionId` is downloaded. */
export const onDisk = (versionId) => self.modelFiles(versionId) !== null;

/** Whether the runtime's add-on `id` is installed (the Japanese dictionary: "unidic"). */
export function addonInstalled(id) {
  try {
    return Boolean(self.service()?.addons?.().find((a) => a.id === id)?.installed);
  } catch {
    return false;
  }
}
