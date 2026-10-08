// SPDX-License-Identifier: MIT
// /v1/voices — list + CRUD, plus the acquisition paths: clone, design, import, blend (the port of
// justvoice/api/voices_api.py).
//
// The voice DTO builders and `listVoices` came first (wave D — the MCP server's
// `justvoice.list_voices` reads them); the API wave added the routes.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { HttpError } from "@delebash/llm-runner/platform/errors";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { b64decode, isDict, NotImplementedError, pyRound, pySorted, strip, ValueError } from "@delebash/llm-runner/platform/py";
import { jsonLoads, pyFixed, pyFloat, pyFloatValue, pyStrOf } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { noiseMarginDb } from "../audio/analyzer.js";
import { parseWavHeader } from "../audio/wav.js";
import * as blending from "../engines/blending.js";
import * as run from "../engines/llm/run.js";
import { getManager } from "../engines/manager.js";
import { badRequest, notFound, notImplemented } from "../errors.js";
import {
  BlendVoiceRequest,
  ClipCheckRequest,
  ClipCheckResponse,
  CloneVoiceRequest,
  CopyVoiceRequest,
  construct,
  DesignVoiceRequest,
  modelDump,
  UpdateVoiceRequest,
  utcNow,
  Voice,
  VoiceList,
} from "../models.js";
import { fmtG } from "../persona_render.js";
import * as vmod from "../voice_model.js";
import { RunUsage } from "./extraction_api.js";
import { sentBody } from "./settings_api.js";

/** What speaks a voice, as every screen reads it (voice_model.js). */
export function _facts(vm) {
  return { model: vm.model, model_name: vm.name, directed_by: vm.directedBy, speaks: [...vm.speaks] };
}

export function _storedToDto(rec) {
  const st = getState();
  const vm = vmod.describe(st, rec.engine, vmod.modelForStored(st, rec), rec.language);
  return construct(Voice, {
    id: rec.id,
    engine: rec.engine,
    source: rec.source,
    name: rec.name,
    language: rec.language,
    gender: rec.gender || "",
    design_prompt: rec.source === "designed" ? rec.design_prompt : null,
    ..._facts(vm),
  });
}

export function _presetDto(st, engineId, v) {
  const language = Object.hasOwn(v, "language") ? v.language : "en";
  const vm = vmod.describe(st, engineId, vmod.modelForPreset(engineId), language);
  return construct(Voice, {
    id: v.id ?? null,
    engine: engineId,
    source: "preset",
    name: Object.hasOwn(v, "name") ? v.name : (v.id ?? ""),
    language,
    gender: v.gender || "",
    ..._facts(vm),
  });
}

export function _registryDto(st, engine, p) {
  const engineId = engine.meta.engineId;
  const vm = vmod.describe(st, engineId, engineId, p.language);
  return construct(Voice, {
    id: p.id,
    engine: engineId,
    source: "preset",
    name: p.name,
    language: p.language,
    gender: p.gender || "",
    sample_url: p.sample_url ?? p.sampleUrl ?? null,
    ..._facts(vm),
  });
}

/** GET /v1/voices — all voices (presets + stored), as a VoiceList. */
export async function listVoices() {
  const st = getState();
  const out = [];

  // 1. Static presets from managed engine manifests (always available, no subprocess needed).
  //    Kokoro ships 54 here; clone-only engines empty.
  const mgr = getManager();
  for (const manifest of mgr.manifests().values()) {
    for (const v of manifest.staticVoices) out.push(_presetDto(st, manifest.id, v));
  }

  // 2. Presets from in-process engines (currently only external-openai-tts).
  for (const engine of st.engines?.all() ?? []) {
    for (const p of await engine.voices()) out.push(_registryDto(st, engine, p));
  }

  // 3. Stored (clones / designs / imports).
  for (const rec of st.voices.list()) out.push(_storedToDto(rec));
  return construct(VoiceList, { voices: out });
}

export const ModelVersion = T.Object({
  id: T.String(),
  name: T.String(),
  size_mb: opt(nullable(T.Integer()), null),
  on_disk: opt(T.Boolean(), false),
});

/** Which version (size, precision) of its model speaks a voice — the one a render picks — and
 * the family's others (decided 2026-10-05). */
export const VoiceModelVersion = T.Object({
  engine_id: T.String(),
  model: T.String(),
  model_name: T.String(),
  speaks_with: opt(nullable(T.String()), null),
  loaded: opt(nullable(T.String()), null),
  default: opt(nullable(T.String()), null),
  versions: opt(T.Array(ModelVersion), []),
});

/** The model a new voice is stored with — the one asked for, checked against the engine and
 * what it can do, or the engine's default. */
export function _modelFor(engine, model, action) {
  try {
    return vmod.checkModelFor(engine, model, action);
  } catch (e) {
    if (e instanceof ValueError) throw badRequest(e.message);
    throw e;
  }
}

// Chatterbox Turbo and Nano clone only from a clip longer than this (upstream's own rule —
// docs/plans/2026-10-03-gap-1-turbo-cloning.md).
export const _TURBO_MIN_CLIP_S = 5.0;

function _clipSeconds(p) {
  let fmt;
  let size;
  try {
    [fmt, , size] = parseWavHeader(readFileSync(p));
  } catch {
    // not a PCM WAV we can measure
    return null;
  }
  const frame = Math.max(1, fmt.channels) * 2;
  return size / frame / Math.max(1, fmt.sampleRate);
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** A preset of an in-process engine with this id, or null. */
async function registryPreset(st, id) {
  for (const engine of st.engines.all()) {
    for (const p of await engine.voices()) if (p.id === id) return [engine, p];
  }
  return null;
}

// ── LLM gender guess (F1 Phase 3 — the voice_gender feature) ─────────────
// EXPLICIT trigger only (ruling 2, 2026-08-05: a button in Voices, never auto on fetch). The
// renderer sends the voices its dictionary could not label; the `voice_gender` template row +
// its preset (p_classify) do the wording and tunables; this route computes the variable VALUE
// and maps the row's male/female/unknown contract onto JV's F/M/"" vocabulary.

export const GenderGuessVoice = T.Object({ name: T.String(), description: opt(T.String(), "") });

export const GenderGuessRequest = T.Object({ voices: T.Array(GenderGuessVoice) });

export const GenderGuessResponse = T.Object({
  // {input name: "F" | "M" | ""} — "" = the model said unknown (left unset).
  guesses: T.Record(T.String(), T.String()),
  // §16: every AI response carries the run's usage. null on the no-voices early return.
  usage: opt(nullable(RunUsage), null),
});

const _GENDER_MAP = { female: "F", male: "M" };

/** The first `{…}` in a model's answer as a dict ({} when there is none or it isn't JSON). */
export function _firstJsonObject(text) {
  const t = strip(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) return {};
  let v;
  try {
    v = jsonLoads(m[0]);
  } catch (e) {
    if (e instanceof ValueError || e instanceof TypeError) return {};
    throw e;
  }
  return isDict(v) ? v : {};
}

// ── Blend — the fourth acquisition path ──────────────────────────────────
// Host-side file math (engines/blending.js): the style vectors live in the installed variant's
// voices file, so creating a blend needs no engine process at all. Blend belongs beside clone /
// design / import.

/**
 * `blending.blendLanguage` bound to this server's state. Exported (no underscore) because the
 * PRE-SAVE audition in voice_preview_api must reach the same answer this endpoint reaches —
 * that divergence is exactly the bug being closed.
 */
export function blendLanguageFor(st, engine, sourceIds) {
  return blending.blendLanguage(engine, sourceIds, {
    storedLanguage: (vid) => {
      const rec = st.voices.get(vid);
      return rec ? rec.language : null;
    },
    default: st.settings.get().generation.default_voice_language,
  });
}

/**
 * The dedup key for a blended voice. `strategy` and `segments` joined it 2026-08-21: without
 * them, two voices that are genuinely different collide (a `vector` mix does not normalize
 * while a `blend` of the same sources and weights does, and a `recombine` carries no weights at
 * all). Python's `zip(sources, weights)` stops at the shorter list — a recombine (no weights)
 * hashes no sources, only its segments; `str(w)` is a float's repr.
 */
export function _recipeHash(sources, weights, strategy = "blend", segments = null) {
  const h = createHash("sha256");
  h.update(Buffer.from(strategy, "utf8"));
  const n = Math.min(sources.length, weights.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push([sources[i], weights[i]]);
  for (const [s, w] of pySorted(pairs, (p) => p[0])) {
    h.update(Buffer.from(s, "utf8"));
    h.update(Buffer.from(pyFloat(Number(w)), "utf8"));
  }
  // Segment ORDER is meaningful (later segments overwrite earlier ones on any overlap), so this
  // list is not sorted.
  for (const seg of segments || []) {
    h.update(Buffer.from(`${seg.voice_id}:${pyFloat(Number(seg.start))}:${pyFloat(Number(seg.end))}`, "utf8"));
  }
  return h.digest("hex");
}

const errText = (e) => e?.message ?? String(e);

export async function router(app) {
  app.get("/v1/voices", async () => listVoices());

  /** Which version of its model speaks this voice. */
  app.get(
    "/v1/voices/:id/model-version",
    { schema: { querystring: T.Object({ language: opt(nullable(T.String()), null) }) } },
    async (req) => {
      const out = await vmod.versionsOf(getState(), req.params.id, req.query.language);
      if (out === null) throw notFound(`voice ${req.params.id}`);
      return construct(VoiceModelVersion, out);
    },
  );

  app.get("/v1/voices/:id", async (req) => {
    const st = getState();
    const id = req.params.id;
    const hit = await registryPreset(st, id);
    if (hit !== null) return _registryDto(st, hit[0], hit[1]);
    const rec = st.voices.get(id);
    if (rec) return _storedToDto(rec);
    for (const manifest of getManager().manifests().values()) {
      for (const v of manifest.staticVoices) if (v.id === id) return _presetDto(st, manifest.id, v);
    }
    throw notFound(`voice ${id}`);
  });

  /** Update a stored voice's metadata. */
  app.patch("/v1/voices/:id", { schema: { body: UpdateVoiceRequest } }, async (req) => {
    const st = getState();
    const id = req.params.id;
    // Preset voices ship with the engine — nothing stored to update.
    if ((await registryPreset(st, id)) !== null) throw badRequest(`voice ${id} is an engine preset and cannot be updated`);
    const rec = st.voices.update(id, modelDump(UpdateVoiceRequest, sentBody(req)));
    if (!rec) throw notFound(`voice ${id}`);
    return _storedToDto(rec);
  });

  app.delete("/v1/voices/:id", async (req) => {
    if (!getState().voices.delete(req.params.id)) throw notFound(`voice ${req.params.id}`);
    return { deleted: true };
  });

  /** How long a clip is, and how far its speech stands above its noise. The persona page's
   * clone maker checks a clip before it is kept (2026-10-04): the page decodes it to WAV, this
   * measures it. */
  app.post("/v1/voices/clip-check", { schema: { body: ClipCheckRequest } }, async (req) => {
    let raw;
    let fmt;
    let offset;
    let size;
    try {
      raw = b64decode(req.body.wav_b64);
      [fmt, offset, size] = parseWavHeader(raw);
    } catch (e) {
      // anything unreadable is the caller's to fix
      throw badRequest(`not a WAV clip: ${errText(e)}`);
    }
    if (fmt.bitsPerSample !== 16) throw badRequest("send the clip as 16-bit PCM WAV");
    const pcm = raw.subarray(offset, offset + size);
    return construct(ClipCheckResponse, {
      seconds: pyRound(fmt.durationSec, 2),
      noise_margin_db: await noiseMarginDb(pcm, fmt.sampleRate, fmt.channels),
    });
  });

  /** Clone a voice from a reference clip. */
  app.post("/v1/voices/clone", { schema: { body: CloneVoiceRequest } }, async (req, reply) => {
    const st = getState();
    const body = req.body;
    if (!body.engine || !body.name) throw badRequest("engine + name required");
    let wavBytes;
    try {
      wavBytes = b64decode(body.ref_wav_b64);
    } catch (e) {
      throw badRequest(`invalid base64: ${errText(e)}`);
    }
    const model = _modelFor(body.engine, body.model, "clone");
    const now = utcNow();
    const created = st.voices.create({
      id: "",
      engine: body.engine,
      model,
      source: "cloned",
      name: body.name,
      language: body.language,
      gender: body.gender,
      transcript: body.transcript,
      xvector_only: body.xvector_only,
      sample_count: 0,
      created_at: now,
      updated_at: now,
    });
    st.voices.writeRefWav(created.id, wavBytes);
    reply.code(201);
    return _storedToDto(created);
  });

  /** Create a voice from a prose description. */
  app.post("/v1/voices/design", { schema: { body: DesignVoiceRequest } }, async (req, reply) => {
    const st = getState();
    const body = req.body;
    const model = _modelFor(body.engine, body.model, "design");
    const now = utcNow();
    const created = st.voices.create({
      id: "",
      engine: body.engine,
      model,
      source: "designed",
      name: body.name,
      language: body.language,
      gender: body.gender,
      design_prompt: body.prompt,
      sample_count: 0,
      created_at: now,
      updated_at: now,
    });
    reply.code(201);
    return _storedToDto(created);
  });

  /**
   * "Copy to another model…" (decided 2026-10-03): a clone belongs to the model it was made
   * for, so the same clip on another model is a second voice — Marius on Turbo for English with
   * tags, and on Chatterbox Multilingual for Spanish. What the target model needs is checked
   * here, by name, before anything is written.
   */
  app.post("/v1/voices/:id/copy", { schema: { body: CopyVoiceRequest } }, async (req, reply) => {
    const st = getState();
    const id = req.params.id;
    const body = req.body;
    const src = st.voices.get(id);
    if (src === null) throw notFound(`voice ${id}`);
    const clip = String(st.voices.refWavPath(id));
    if (!isFile(clip)) {
      throw badRequest(
        `${src.name} has no clip to copy — only a cloned, imported or saved designed voice can be spoken by another model`,
      );
    }
    const engine = vmod.engineOfModel(body.model);
    if (engine === null) throw badRequest(`${vmod.modelName(body.model)} isn't in this speech runtime`);
    if (!vmod.can(body.model, "clone")) throw badRequest(`${vmod.modelName(body.model)} can't clone a voice`);
    const name = vmod.modelName(body.model);
    if (body.model === "chatterbox-turbo" || body.model === "chatterbox-nano") {
      const secs = _clipSeconds(clip);
      if (secs !== null && secs <= _TURBO_MIN_CLIP_S) {
        throw badRequest(`${name} needs a clip longer than ${fmtG(_TURBO_MIN_CLIP_S)} seconds — this one is ${pyFixed(secs, 1)} s`);
      }
    }
    const transcript = body.transcript !== null ? body.transcript : src.transcript;
    const xvectorOnly = body.xvector_only !== null ? body.xvector_only : src.xvector_only;
    const row = vmod._capability(body.model);
    if (row !== null && row.supports_xvector_only && !strip(transcript || "") && !xvectorOnly) {
      throw badRequest(`${name} needs the words the clip says, or Skip the words — give one with the copy`);
    }
    const now = utcNow();
    const created = st.voices.create({
      id: "",
      engine,
      model: body.model,
      source: ["cloned", "imported", "designed"].includes(src.source) ? src.source : "cloned",
      name: strip(body.name || "") || `${src.name} (${name})`,
      language: src.language,
      gender: src.gender,
      design_prompt: src.design_prompt,
      transcript,
      xvector_only: Boolean(xvectorOnly) && Boolean(row && row.supports_xvector_only),
      sample_count: 0,
      created_at: now,
      updated_at: now,
    });
    st.voices.writeRefWav(created.id, readFileSync(clip));
    reply.code(201);
    return _storedToDto(created);
  });

  /** LLM-label the voices the built-in dictionary doesn't know. */
  app.post("/v1/voices/gender-guess", { schema: { body: GenderGuessRequest } }, async (req) => {
    const voices = req.body.voices;
    if (!voices.length) return construct(GenderGuessResponse, { guesses: {} });
    const lines = voices.map((v) => `- ${v.name}${v.description ? ` — ${v.description}` : ""}`);
    let resp;
    try {
      resp = await run.runFeature("voice_gender", { voices: lines.join("\n") });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      throw e;
    }
    const raw = _firstJsonObject(resp.text);
    const wanted = new Set(voices.map((v) => v.name));
    const guesses = {};
    for (const [name, val] of Object.entries(raw)) {
      if (wanted.has(name)) {
        const key = strip(pyStrOf(val)).toLowerCase();
        guesses[name] = Object.hasOwn(_GENDER_MAP, key) ? _GENDER_MAP[key] : "";
      }
    }
    return construct(GenderGuessResponse, {
      guesses,
      usage: { prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model },
    });
  });

  /** Blend 2–5 voices into a new voice (elementwise weighted average). */
  app.post("/v1/voices/blend", { schema: { body: BlendVoiceRequest } }, async (req, reply) => {
    const st = getState();
    const body = req.body;
    reply.code(201);

    if (!blending.supports(body.engine)) {
      throw notImplemented(`engine '${body.engine}' cannot blend — its voices are not style vectors. Kokoro is the blending engine.`);
    }

    const storedVector = (vid) => {
      const rec = st.voices.get(vid);
      return rec && rec.embedding && rec.embedding.length ? [...rec.embedding] : null;
    };

    // ── Per-strategy validation + the weights that get STORED ───────────
    // Recombine is the odd one: no weights, ordered segments. The three weighted strategies
    // differ only in whether Σw divides the result.
    const segments = [...(body.segments || [])];
    let sourceIds;
    let storedWeights;
    if (body.strategy === "recombine") {
      if (segments.length < 2) throw badRequest("recombine needs at least 2 segments");
      if (segments.length > 5) throw badRequest("recombine takes at most 5 segments");
      sourceIds = segments.map((s) => s.voice_id);
      storedWeights = [];
    } else {
      sourceIds = [...body.source_voice_ids];
      // Extrapolate is one voice plus the pack centroid, so it is the one weighted strategy
      // that legitimately arrives with a single voice.
      const floor = body.strategy === "extrapolate" ? 1 : 2;
      if (sourceIds.length < floor) {
        throw badRequest(`${body.strategy} requires at least ${floor} source voice${floor === 1 ? "" : "s"}`);
      }
      if (sourceIds.length > 5) throw badRequest("blend takes at most 5 source voices");
      if (body.weights && body.weights.length && body.weights.length !== sourceIds.length) {
        throw badRequest("weights length must match source_voice_ids length");
      }
      const weights = body.weights && body.weights.length ? body.weights : sourceIds.map(() => 1.0);
      // A mix divides by Σw so its weights are shares; an analogy keeps its magnitude. Only the
      // dividing kind needs a positive sum.
      if (body.strategy !== "vector") {
        const total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) throw badRequest("weights must sum to a positive value");
        storedWeights = weights.map((w) => w / total);
      } else {
        if (!weights.some((w) => w !== 0)) throw badRequest("every weight is zero — there is nothing to combine");
        storedWeights = [...weights];
      }
    }

    // Dedup — the same recipe returns the existing voice.
    const recipeHash = _recipeHash(sourceIds, storedWeights, body.strategy, segments);
    for (const v of st.voices.list()) {
      if (
        v.engine === body.engine &&
        v.source === "blended" &&
        v.blend_recipe &&
        _recipeHash(v.blend_recipe.sources, v.blend_recipe.weights, v.blend_recipe.strategy, v.blend_recipe.segments) === recipeHash
      ) {
        return _storedToDto(v);
      }
    }

    let blended;
    try {
      if (body.strategy === "recombine") {
        blended = await blending.recombine(
          body.engine,
          // A segment's bounds are floats (its error words print them as Python does).
          segments.map((s) => [s.voice_id, pyFloatValue(s.start), pyFloatValue(s.end)]),
          { dataDir: st.dataDir, resolveStored: storedVector },
        );
      } else {
        blended = await blending.blend(body.engine, sourceIds, storedWeights, {
          dataDir: st.dataDir,
          resolveStored: storedVector,
          normalize: false, // already applied above, per strategy
        });
      }
    } catch (e) {
      if (e instanceof blending.LookupError) throw badRequest(e.message);
      if (e instanceof NotImplementedError) throw notImplemented(e.message);
      throw badRequest(`blend failed: ${errText(e)}`);
    }

    const lang = blendLanguageFor(st, body.engine, sourceIds);

    const now = utcNow();
    const created = st.voices.create({
      id: "",
      engine: body.engine,
      model: _modelFor(body.engine, body.model, "blend"),
      source: "blended",
      name: body.name,
      language: lang,
      sample_count: 0,
      blend_recipe: {
        strategy: body.strategy,
        sources: sourceIds,
        weights: storedWeights,
        segments: segments.length ? segments : null,
      },
      embedding: blended,
      created_at: now,
      updated_at: now,
    });
    return _storedToDto(created);
  });
}
