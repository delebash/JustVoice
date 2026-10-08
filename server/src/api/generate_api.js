// SPDX-License-Identifier: MIT
// POST /v1/generate — single-line synthesis (the port of justvoice/api/generate_api.py).
//
// Dispatches voice lookup + synth through either the manager (managed engines) or the
// in-process registry (external engines). Both paths return audio/wav bytes.
//
// Long text (> settings.generation.max_chunk_chars) is auto-chunked at sentence boundaries via
// `audio/chunked.js`. Below the threshold, a single-shot synth call is used.
// Without this wrapping some engines truncate or hallucinate trailing noise on long inputs.
//
// `generate(req, {signal})` is the route's body as a function — the WAV as a Buffer — which the
// MCP server's `justvoice.speak` calls too. Calls a test spies on go through the module
// namespaces (render_core, voice_model, the manager, the scheduler, this module's own `self.`).

import { cpLen, pyInt, strRepr } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { DEFAULT_MAX_CHUNK_CHARS, splitTextIntoChunks } from "../audio/chunked.js";
import * as dspClient from "../audio/dsp_client.js";
import { parseWavHeader, stripWavHeader, writeWavContainer } from "../audio/wav.js";
import { composeInstruct, mergeDelivery } from "../delivery_merge.js";
import { SynthRequest } from "../engines/base.js";
import * as manager from "../engines/manager.js";
import { badRequest, internal, notFound } from "../errors.js";
import { Delivery, floatify, GenerateRequest, modelDump } from "../models.js";
import * as personaRender from "../persona_render.js";
import * as renderCore from "../render_core.js";
import * as synthScheduler from "../synth_scheduler.js";
import * as voiceModel from "../voice_model.js";
import * as self from "./generate_api.js";

const errText = (e) => e?.message ?? String(e);

/**
 * An AbortSignal that fires when the client goes away before the answer is sent — what
 * asyncio's cancellation of a disconnected request's handler gave Python. Rendering routes pass
 * it to `waitAsync` / `warmLines`, which withdraw the request's pending lines. Candidate for
 * platform/server.js.
 */
export function clientGone(req, reply) {
  const ctl = new AbortController();
  const raw = reply?.raw;
  if (raw && typeof raw.once === "function") {
    raw.once("close", () => {
      if (!raw.writableFinished) ctl.abort();
    });
  }
  return ctl.signal;
}

/** One chunk's bytes (PCM or WAV) → its 16-bit PCM. */
function _pcmOfChunk(audioBytes, isWav) {
  return isWav ? stripWavHeader(audioBytes) : audioBytes;
}

/**
 * A finished line's PCM → the WAV Generate returns: Speed, Gain and Pitch through the chapter
 * render's own function, then the effects chain (async). Until 2026-10-02 this path applied only
 * the chain, so Generate's Speed (on every engine but Kokoro and KittenTTS), Pitch and Gain did
 * nothing. One request to the DSP program (render_core.shapeLinePcm).
 */
async function _finishLine(pcm, sampleRate, channels, delivery, engineId, effects, model = null) {
  const out = await renderCore.shapeLinePcm(pcm, sampleRate, channels, delivery, {
    speedNative: renderCore.speedNative(getState(), engineId, model),
    effects,
  });
  return writeWavContainer(out, sampleRate, channels);
}

/**
 * `[req with its text as this engine will say it, the IPA map for its words]` (async).
 *
 * The chapter render's own steps, in its order (render_core.renderLine): drop the [tags] this
 * engine can't perform, then apply the lexicons the request names — Generate sends the selected
 * persona's. The IPA map rides in the delivery. Until 2026-09-30 this path read no lexicon at
 * all, so a line on Generate was said one way and the same line in a chapter another. The
 * book's lexicon is not added: Generate is not a line of a book.
 */
async function _readThroughLexicons(st, engineId, req) {
  const model = await renderCore._lineModel(st, req.voice, engineId);
  const [text, ipaMap] = renderCore._applyLexicons(renderCore.performableText(st, engineId, model, req.text), req.lexicons, st, {
    ipaCapable: renderCore._supportsPhonemeInput(model),
  });
  return [{ ...req, text }, ipaMap];
}

/** `[max_chunk_chars, crossfade_ms]` from settings.generation. */
function _chunkingParams(settings) {
  const gen = settings.generation || {};
  return [pyInt(gen.max_chunk_chars ?? DEFAULT_MAX_CHUNK_CHARS), pyInt(gen.crossfade_ms ?? 50)];
}

/** The request's delivery as Python's `model_dump(exclude_none=True)`, its floats PyFloats. */
const requestDeliveryOf = (req) => (req.delivery ? floatify(Delivery, modelDump(Delivery, req.delivery, { excludeNone: true })) : {});

/**
 * If `voiceId` belongs to the currently-loaded managed engine, that engine's id; else null
 * (async). Only the LOADED managed engine is asked — listing voices from an unloaded one would
 * need its process running.
 */
export async function _findManagedVoiceOwner(voiceId) {
  const mgr = manager.getManager();
  const cur = mgr.currentId();
  if (!cur) return null;
  let voices;
  try {
    voices = await mgr.voices(cur);
  } catch {
    return null;
  }
  for (const v of voices) if (v?.id === voiceId) return cur;
  return null;
}

/**
 * If `voiceId` is in any managed engine's manifest static voices, that engine's id. Used to
 * auto-load the right engine when the user picks a preset voice that belongs to a different
 * (currently-unloaded) engine — without it, a user with Chatterbox loaded who picks a Kokoro
 * voice (af_alloy) would get a 404.
 */
export function _findStaticVoiceOwner(voiceId) {
  const mgr = manager.getManager();
  for (const m of mgr.manifests().values()) {
    for (const v of m.staticVoices) if (v.id === voiceId) return m.id;
  }
  return null;
}

/**
 * Synthesize one line → the WAV as a Buffer (async) — POST /v1/generate's body, and what MCP's
 * `justvoice.speak` calls. `req` is a GenerateRequest wire object; `signal` withdraws the
 * line from the scheduler when the client goes away.
 */
export async function generate(req, { signal = null } = {}) {
  const st = getState();
  const settings = st.settings.get();

  if (cpLen(req.text) > settings.limits.text_max_chars) {
    throw badRequest(`text length ${cpLen(req.text)} > limit ${settings.limits.text_max_chars}`);
  }

  const mgr = manager.getManager();

  // ── Voice lookup ────────────────────────────────────────────────
  // Order of precedence:
  // 1. Currently-loaded managed engine's voices.
  // 2. Stored voice → look up its engine id.
  // 3. In-process engines' voice lists.
  const managedOwner = await self._findManagedVoiceOwner(req.voice);
  if (managedOwner !== null) {
    await _ensureVoiceModel(st, managedOwner, req);
    return self._generateViaManager(managedOwner, req, null, { signal });
  }

  // Voice belongs to a managed engine that isn't the currently-loaded one? A clear error
  // rather than silently switching engines — the GUI filters its dropdown to the loaded
  // engine's voices, so reaching this branch usually means an API caller passed an id from a
  // different engine by mistake.
  const staticOwner = self._findStaticVoiceOwner(req.voice);
  if (staticOwner !== null) {
    if (mgr.currentId() !== staticOwner) {
      throw badRequest(
        `voice ${strRepr(req.voice)} belongs to engine ${strRepr(staticOwner)} which is not currently loaded. ` +
          "Load it on the Engines tab first, or pick a voice belonging to the loaded engine.",
      );
    }
    await _ensureVoiceModel(st, staticOwner, req);
    return self._generateViaManager(staticOwner, req, null, { signal });
  }

  const stored = st.voices.get(req.voice);
  let engineId = null;
  if (stored) {
    // Stored voice's engine — may be managed or in-process.
    const voiceFields = _voiceSynthFields(stored);
    if (mgr.getManifest(stored.engine)) {
      // Auto-load the voice's model if it isn't the resident one.
      await _ensureVoiceModel(st, stored.engine, req);
      return self._generateViaManager(stored.engine, req, voiceFields, { signal });
    }
    // In-process engine path falls through below.
    engineId = stored.engine;
  } else {
    // Walk in-process engines looking for a matching preset voice id.
    for (const engine of st.engines.all()) {
      if ((await engine.voices()).some((p) => p.id === req.voice)) {
        engineId = engine.meta.engineId;
        break;
      }
    }
    if (engineId === null) throw notFound(`voice ${req.voice}`);
  }
  return self._generateViaInprocess(engineId, req);
}

/** Load the model the voice speaks on (voice_model.js) — a Qwen3 speaker needs CustomVoice even
 * while Base is resident, a Turbo clone needs Turbo. The size AI Settings chose is kept. */
async function _ensureVoiceModel(st, engineId, req) {
  try {
    await voiceModel.ensureModelLoaded(engineId, await renderCore._lineModel(st, req.voice, engineId), req.language);
  } catch (e) {
    if (e instanceof voiceModel.ModelUnavailable) throw badRequest(e.message);
    throw badRequest(
      `engine '${engineId}' failed to load on first use: ${errText(e)}. ` +
        `Click Load on the Engines tab first, or POST /v1/engines/${engineId}/load.`,
    );
  }
}

/** Thin wrapper over render_core's resolver (the managed render bridge shares it). */
export function _resolveAudioPromptForStored(stored) {
  return renderCore.resolveAudioPromptForStored(getState(), stored);
}

/** Everything the stored voice contributes to the engine call — the reference clip AND its
 * transcript, a blend's style vector. Wrapper over render_core's single resolver. */
export function _voiceSynthFields(stored) {
  return renderCore.voiceSynthFields(getState(), stored);
}

/** A clip-less designed voice's description, for the instruct slot. Prose, not a synth input,
 * so it is deliberately NOT part of `_voiceSynthFields` — it composes at the API layer with the
 * persona's instruction and the line's direction. Clip-wins lives in render_core. */
export function _voiceDesignInstruct(voiceId) {
  return renderCore.voiceDesignInstructForId(getState(), voiceId);
}

/**
 * Synth via the managed engine (async) → the WAV.
 *
 * `voiceFields` carries whatever the stored voice contributes to the call — the reference WAV
 * path (and its transcript) for a clone, the style vector for a blend. The host resolves them
 * so the engine never needs access to the voice store (`render_core.voiceSynthFields`).
 *
 * Long text (> the model's split size) is split at sentence boundaries and the per-chunk
 * results joined — the chunked path wired into the single-line generate path.
 */
export async function _generateViaManager(engineId, req, voiceFields = null, { signal = null } = {}) {
  const mgr = manager.getManager();
  const st = getState();
  const model = await renderCore._lineModel(st, req.voice, engineId);
  // Every [tag] this engine can't perform goes, as in a chapter render (decided 2026-09-29) —
  // Generate used to send the text untouched, so Kokoro read "[warm]" aloud as "warm". Then the
  // lexicons (2026-09-30).
  let ipaMap;
  [req, ipaMap] = await _readThroughLexicons(st, engineId, req);

  const [, crossfadeMs] = _chunkingParams(st.settings.get());
  // Each model's own piece length (audit 2026-10-04 §13.3), as in a chapter render.
  const maxChunkChars = renderCore.lineSplitChars(st, engineId, req.voice);
  const describe = renderCore.isDescriptionVoice(st, req.voice);
  const requestDelivery = requestDeliveryOf(req);
  const persona = req.persona_id ? st.personas.get(req.persona_id) : null;
  let language = req.language;
  let delivery;
  let effects;
  let personaSeed;
  if (persona != null) {
    // The persona's settings through the ONE resolver the chapter render uses
    // (persona_render.planLine, 2026-10-03), on the voice Generate is speaking: that model's own
    // knobs, emotion or tags and seed, the direction composed, its language and effects. The
    // request sits on top. (Its lexicon is the one the request names — Generate sends the
    // persona's.)
    const plan = await personaRender.planLine(st, persona, { text: req.text, requestDelivery, voice: req.voice });
    delivery = plan.delivery;
    effects = plan.effects;
    language = req.language || plan.language;
    personaSeed = plan.seed;
  } else {
    delivery = mergeDelivery(requestDelivery);
    // `emotion` rides on the end through the same composer the chapter path uses. A clip-less
    // DESIGNED voice leads: its description is the identity, not direction, and the VoiceDesign
    // checkpoint has nothing else to go on (2026-08-22 — same seam as the chapter path, so one
    // button cannot sound different from the other).
    const composed = composeInstruct(_voiceDesignInstruct(req.voice), delivery.instruct ?? null, delivery.emotion ?? null);
    if (composed) delivery.instruct = composed;
    effects = [];
    personaSeed = delivery.seed ?? null;
    delete delivery.seed;
  }
  if (Object.keys(ipaMap).length) delivery.ipa_map = ipaMap;
  // A tag model's own tags for the line, then the emotion's tag — the chapter render's own
  // steps (render_core), so Generate's Turbo line says its [fear] too. Generate applied neither
  // until 2026-10-03.
  const textOut = renderCore._applyEmotionTag(renderCore._applyLeadTags(req.text, delivery, model), delivery, renderCore._emotionTagset(model));
  req = { ...req, text: textOut };

  const synthOne = (text, chunkSeed) =>
    mgr.synth(engineId, { voice_id: req.voice, text, language, delivery, seed: chunkSeed, ...(voiceFields || {}) });

  // Seed resolution: the delivery's seed (or the persona's for this model) overrides the
  // top-level req.seed. Either path produces the same per-chunk seed math below.
  let effectiveSeed = personaSeed != null ? personaSeed : req.seed;
  // A description voice is drawn from its description on every request: with no seed set it gets
  // its fixed one, and every piece of a long line keeps it — `seed + i` per piece drew a
  // different voice for each (§13.3).
  if (effectiveSeed == null && describe) effectiveSeed = renderCore.descriptionSeed(req.voice);

  const doIt = async () => {
    try {
      if (cpLen(req.text) <= maxChunkChars) {
        const [audioBytes, meta] = await synthOne(req.text, effectiveSeed);
        const pcm = meta.is_wav_container ? stripWavHeader(audioBytes) : audioBytes;
        return await _finishLine(pcm, meta.sample_rate || 24000, meta.channels || 1, delivery, engineId, effects, model);
      }
      // Long-form path: split → per-chunk synth → join → WAV
      const chunks = splitTextIntoChunks(req.text, maxChunkChars);
      const pieces = [];
      let sampleRate = 24000;
      let channels = 1;
      for (let i = 0; i < chunks.length; i++) {
        // Vary seed per chunk to avoid correlated RNG artefacts while staying deterministic for
        // (text, seed) reproducibility.
        const chunkSeed = effectiveSeed != null && !describe ? effectiveSeed + i : effectiveSeed;
        const [audioBytes, meta] = await synthOne(chunks[i], chunkSeed);
        sampleRate = meta.sample_rate || sampleRate;
        channels = meta.channels || channels;
        pieces.push([_pcmOfChunk(audioBytes, Boolean(meta.is_wav_container)), sampleRate, channels]);
      }
      const pcm = await dspClient.join(pieces, crossfadeMs);
      return await _finishLine(pcm, sampleRate, channels, delivery, engineId, effects, model);
    } catch (e) {
      if (e instanceof manager.TermsRequired || e instanceof manager.EngineRequestError) throw e.apiError();
      throw internal(`engine synthesize: ${errText(e)}`);
    }
  };

  // Managed synthesis rides the scheduler as an interactive single — every managed synth goes
  // through the one synth door (§7b P2-5/P2-6 of the 2026-08-08 plan). The scheduler lets it
  // jump any batch at the next line boundary.
  const handle = synthScheduler.getScheduler().submit([[engineId, doIt]], {
    interactive: true,
    owner: synthScheduler.workOwner("Generate"),
  });
  await handle.waitAsync({ signal });
  handle.raiseIfFailed();
  return handle.items[0].result;
}

/**
 * Synth via an in-process engine (external-openai-tts today), async → the WAV. Also auto-chunks
 * long text — same threshold + crossfade as the managed path; without it, single-line generates
 * of long text via in-process engines silently truncate.
 */
export async function _generateViaInprocess(engineId, req) {
  const st = getState();
  let ipaMap;
  [req, ipaMap] = await _readThroughLexicons(st, engineId, req);
  const engine = st.engines.get(engineId) ?? null;
  if (engine === null) throw notFound(`engine ${engineId}`);
  if (!engine.ready()) {
    try {
      await engine.load("auto", null);
      st.engines.setCurrent(engineId);
    } catch (e) {
      throw badRequest(
        `engine '${engineId}' failed to load on first use: ${errText(e)}. ` +
          `Try POST /v1/engines/${engineId}/load with explicit device + model_variant.`,
      );
    }
  }

  const [maxChunkChars, crossfadeMs] = _chunkingParams(st.settings.get());
  const requestDelivery = requestDeliveryOf(req);
  const persona = req.persona_id ? st.personas.get(req.persona_id) : null;
  let delivery;
  let effects;
  if (persona != null) {
    // Same resolver as the managed path and the chapter render.
    const plan = await personaRender.planLine(st, persona, { text: req.text, requestDelivery, voice: req.voice });
    delivery = plan.delivery;
    effects = plan.effects;
    if (req.language == null) req = { ...req, language: plan.language };
  } else {
    delivery = mergeDelivery(requestDelivery);
    // Same cascade as the managed path: a clip-less designed voice's description first, then
    // whatever was asked for, then the emotion.
    const composed = composeInstruct(_voiceDesignInstruct(req.voice), delivery.instruct ?? null, delivery.emotion ?? null);
    if (composed) delivery.instruct = composed;
    effects = [];
  }
  if (Object.keys(ipaMap).length) delivery.ipa_map = ipaMap;

  const synthOne = (text, chunkSeed) =>
    engine.synthesize(new SynthRequest({ voiceId: req.voice, text, language: req.language, delivery, seed: chunkSeed }));

  try {
    if (cpLen(req.text) <= maxChunkChars) {
      const out = await synthOne(req.text, req.seed);
      let pcm;
      let sr;
      let ch;
      if (!out.isWavContainer) [pcm, sr, ch] = [out.bytes, out.sampleRate, out.channels];
      else {
        // The providers' sample_rate is a placeholder — their WAV header is authoritative.
        let fmt;
        let offset;
        let size;
        try {
          [fmt, offset, size] = parseWavHeader(out.bytes);
        } catch (e) {
          if (e?.name !== "ValueError") throw e;
          // Not 16-bit PCM: the delivery cannot be applied; the chain decodes what it can, as
          // this path always did.
          return await dspClient.applyEffects(out.bytes, effects);
        }
        [pcm, sr, ch] = [Buffer.from(out.bytes).subarray(offset, offset + size), fmt.sampleRate, fmt.channels];
      }
      return await _finishLine(pcm, sr, ch, delivery, engineId, effects);
    }

    const chunks = splitTextIntoChunks(req.text, maxChunkChars);
    const pieces = [];
    let sampleRate = 24000;
    let channels = 1;
    for (let i = 0; i < chunks.length; i++) {
      const chunkSeed = req.seed != null ? req.seed + i : null;
      const out = await synthOne(chunks[i], chunkSeed);
      sampleRate = out.sampleRate || sampleRate;
      channels = out.channels || channels;
      pieces.push([_pcmOfChunk(out.bytes, out.isWavContainer), sampleRate, channels]);
    }
    const pcm = await dspClient.join(pieces, crossfadeMs);
    return await _finishLine(pcm, sampleRate, channels, delivery, engineId, effects);
  } catch (e) {
    throw internal(`engine synthesize: ${errText(e)}`);
  }
}

export async function router(app) {
  /** Synthesize one line → audio/wav bytes. */
  app.post("/v1/generate", { schema: { body: GenerateRequest }, config: { pyFloats: true } }, async (req, reply) => {
    const wav = await self.generate(req.body, { signal: clientGone(req, reply) });
    return reply.type("audio/wav").send(wav);
  });
}
