// SPDX-License-Identifier: MIT
// /v1/personas CRUD + where each persona is used (the port of justvoice/api/personas_api.py).
//
// A persona is a finished spoken voice in the library (2026-09-29): it plays speakers — the
// people in a book — and one persona can play many. So "used" means the speakers it plays, in
// which books.

import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { HttpError } from "@delebash/llm-runner/platform/errors";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pySorted, splitWs, strip } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { parseWavHeader, writeWavContainer } from "../audio/wav.js";
import { Block, Generation, Lexicon, MCPBinding, Project, Speaker } from "../database/models.js";
import * as session from "../database/session.js";
import * as run from "../engines/llm/run.js";
import * as manager from "../engines/manager.js";
import { badRequest, conflict, notFound } from "../errors.js";
import {
  construct,
  CreatePersonaRequest,
  MergePersonaRequest,
  modelDump,
  Persona,
  PersonaDelivery,
  PersonaDraft,
  PersonaList,
  PersonaPreviewRequest,
  PersonaView,
  UpdatePersonaRequest,
} from "../models.js";
import * as personaRender from "../persona_render.js";
import * as renderCore from "../render_core.js";
import * as synthScheduler from "../synth_scheduler.js";
import * as vmod from "../voice_model.js";
import { sameName, speakerLineCounts } from "./_speaker_helpers.js";
import { RunUsage } from "./extraction_api.js";
import { clientGone } from "./generate_api.js";
import { sentBody } from "./settings_api.js";
import * as vp from "./voice_preview_api.js";
import { VoicePreviewRequest, VoicePreviewResponse } from "./voice_preview_api.js";

const errText = (e) => e?.message ?? String(e);
const marks = (n) => Array(n).fill("?").join(", ");

/**
 * The persona plus its voice's facts (`PersonaView`), async. `seen` caches each voice's model
 * across a list — many personas share one voice.
 */
export async function _view(st, persona, seen = null) {
  seen = seen === null ? new Map() : seen;
  const vid = persona.voice_id;
  if (vid && !seen.has(vid)) {
    try {
      seen.set(vid, [await vmod.voiceModel(st, vid), await vmod.voiceLanguage(st, vid)]);
    } catch {
      // a voice nothing owns any more shows no facts
      seen.set(vid, [null, null]);
    }
  }
  const [vm, own] = vid ? (seen.get(vid) ?? [null, null]) : [null, null];
  return construct(PersonaView, {
    ...modelDump(Persona, persona),
    model: vm ? vm.model : null,
    model_name: vm ? vm.name : null,
    directed_by: vm ? vm.directedBy : null,
    speaks: vm ? personaRender.personaLanguage(persona, vm, own) : null,
  });
}

/** One speaker this persona plays. */
export const PersonaSpeakerUsage = T.Object({
  project_id: T.String(),
  project_name: T.String(),
  speaker_id: T.String(),
  speaker_name: T.String(),
  lines: opt(T.Integer(), 0),
});

export const PersonaUsageMap = T.Object({ usage: T.Record(T.String(), T.Array(PersonaSpeakerUsage)) });

/** {persona_id: [the speakers it plays, with their book]} — a Map in first-seen order. */
export function _usage(h, personaId = null) {
  let sql =
    `select ${Speaker}.persona_id as pid, ${Speaker}.id as sid, ${Speaker}.name as sname, ${Project}.id as project_id, ` +
    `${Project}.name as project_name from ${Speaker} join ${Project} on ${Project}.id = ${Speaker}.project_id ` +
    `where ${Speaker}.persona_id is not null`;
  const params = [];
  if (personaId !== null) {
    sql += ` and ${Speaker}.persona_id = ?`;
    params.push(personaId);
  }
  const counts = new Map();
  const usage = new Map();
  for (const r of h.all(sql, params)) {
    if (!counts.has(r.project_id)) counts.set(r.project_id, speakerLineCounts(h, r.project_id));
    if (!usage.has(r.pid)) usage.set(r.pid, []);
    usage.get(r.pid).push({
      project_id: r.project_id,
      project_name: r.project_name,
      speaker_id: r.sid,
      speaker_name: r.sname,
      lines: counts.get(r.project_id).get(r.sid) ?? 0,
    });
  }
  for (const [pid, entries] of usage) {
    usage.set(
      pid,
      pySorted(entries, (u) => [u.project_name.toLowerCase(), u.speaker_name.toLowerCase()]),
    );
  }
  return usage;
}

export const PersonaUsageDetailResponse = T.Object({
  persona_id: T.String(),
  speakers: T.Array(PersonaSpeakerUsage),
  total_lines: T.Integer(),
  // Of those lines, how many carry a written direction of their own — what the editor warns
  // about when a new voice's model can't perform it.
  directed_lines: opt(T.Integer(), 0),
});

export const StockLineResponse = T.Object({ language: nullable(T.String()), text: T.String() });

/**
 * The name a persona may have, or a refusal (decided 2026-09-29): a persona must have a name,
 * and names are unique across the library — case and extra spaces don't count. The exact-name
 * auto-cast (`_speaker_helpers.personaNamed`) depends on it.
 */
export function _personaName(name, { besides = null } = {}) {
  const clean = splitWs(name || "").join(" ");
  if (!clean) throw badRequest("A persona needs a name.");
  const want = sameName(clean);
  for (const p of getState().personas.list()) {
    if (p.id !== besides && sameName(p.name) === want) {
      throw conflict(`A persona called "${p.name}" already exists. Persona names are unique — rename one of them first.`);
    }
  }
  return clean;
}

/**
 * The language a persona on `voiceId` is saved with (2026-10-03), async. Asked for → it must be
 * one the voice's model speaks. Not asked for → the language it had (`keepIfSpoken`) if the
 * voice still speaks it, else the voice's own. Where the voice or model allows one language (a
 * Kokoro voice, Kitten, Turbo) that is the only answer.
 */
export async function _checkedLanguage(voiceId, language, { keepIfSpoken = null } = {}) {
  const st = getState();
  const vm = voiceId ? await vmod.voiceModel(st, voiceId) : null;
  if (vm === null) return strip(language || keepIfSpoken || "en") || "en";
  if (language) {
    if (vm.speaks.length && !vmod.speaksLanguage(vm, language)) {
      throw badRequest(`${vm.name} can't speak ${language} with this voice — it speaks ${vm.speaks.join(", ")}.`);
    }
    return language;
  }
  if (vm.speaks.length === 1) return vm.speaks[0];
  if (keepIfSpoken && vmod.speaksLanguage(vm, keepIfSpoken)) return keepIfSpoken;
  const own = await vmod.voiceLanguage(st, voiceId);
  if (own && (!vm.speaks.length || vmod.speaksLanguage(vm, own))) return own;
  return vm.speaks.length ? vm.speaks[0] : own || "en";
}

async function _checkedVoice(voiceId) {
  if (!voiceId) return null;
  if ((await vmod.voiceModel(getState(), voiceId)) === null) throw badRequest("That voice doesn't exist any more — pick another one.");
  return voiceId;
}

function _checkedDelivery(delivery) {
  const problems = personaRender.checkDelivery(delivery);
  if (problems.length) throw badRequest(problems.join("; "));
  return delivery;
}

/** POST /v1/personas/preview-candidate — hear a voice not kept yet (a clip, a description or a
 * blend, as the persona page's makers hold it) spoken as this persona (decided 2026-10-04:
 * "design the voice you want and test it all in one page"). */
export const PersonaCandidatePreviewRequest = T.Object({
  persona: PersonaDraft,
  candidate: VoicePreviewRequest,
  text: opt(T.String({ maxLength: 2000 }), ""),
});

export const ComposeResponse = T.Object({
  text: T.String(),
  persona_id: T.String(),
  note: opt(nullable(T.String()), null), // diagnostic note if compose was stubbed
  // §16: every AI response carries the run's usage.
  usage: opt(nullable(RunUsage), null),
});

export const RewriteRequest = T.Object({ text: T.String() });

export const RewriteResponse = T.Object({
  original: T.String(),
  rewritten: T.String(),
  persona_id: T.String(),
  note: opt(nullable(T.String()), null),
  usage: opt(nullable(RunUsage), null), // §16, same as ComposeResponse
});

/** Shared guard for /compose + /rewrite — both need a persona with a note on how it sounds
 * (Generate has no book, so no speaker's "Who they are" to read). 404 / 400 as appropriate. */
function _requirePersonaWithNote(personaId) {
  const persona = getState().personas.get(personaId);
  if (!persona) throw notFound(`persona ${personaId}`);
  if (!(persona.note && strip(persona.note))) {
    throw new HttpError(400, `${persona.name} has no note on how it sounds — write one on the Personas page to use Compose / Rewrite.`);
  }
  return persona;
}

/** A run's usage, as RunUsage. */
const usageOf = (resp) => ({ prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model });

/** run_feature with the persona routes' error answers: 501 unconfigured, 502 anything else. */
async function runOrRefuse(action, variables) {
  try {
    return await run.runFeature(action, variables);
  } catch (e) {
    if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
    throw new HttpError(502, `LLM call failed: ${errText(e)}`);
  }
}

export async function router(app) {
  app.get("/v1/personas", async () => {
    const st = getState();
    const seen = new Map();
    const personas = [];
    for (const p of st.personas.list()) personas.push(await _view(st, p, seen));
    return construct(PersonaList, { personas });
  });

  /** {persona_id: [the speakers it plays, with their book]} — the Personas page's "Used by"
   * column and filters. */
  app.get("/v1/personas/usage", async () => {
    const usage = _usage(session.getDb());
    return construct(PersonaUsageMap, { usage: Object.fromEntries(usage) });
  });

  /** The speakers one persona plays, each with its book and lines — the persona editor's "Used
   * by" panel. */
  app.get("/v1/personas/:persona_id/usage-detail", async (req) => {
    const h = session.getDb();
    const personaId = req.params.persona_id;
    if (getState().personas.get(personaId) === null) throw notFound(`persona ${personaId}`);
    const speakers = pySorted(_usage(h, personaId).get(personaId) ?? [], (u) => -u.lines);
    let directed = 0;
    if (speakers.length) {
      const ids = speakers.map((u) => u.speaker_id);
      directed = h.value(
        `select count(*) from ${Block} where speaker_id in (${marks(ids.length)}) and direction is not null and direction != ''`,
        ids,
      );
    }
    return construct(PersonaUsageDetailResponse, {
      persona_id: personaId,
      speakers,
      total_lines: speakers.reduce((a, u) => a + u.lines, 0),
      directed_lines: directed,
    });
  });

  /** The persona editor's "↻ Stock line" — one sentence in the persona's language where one is
   * written, else English (persona_render.STOCK_LINES). */
  app.get("/v1/personas/stock-line", { schema: { querystring: T.Object({ language: opt(nullable(T.String()), null) }) } }, async (req) =>
    construct(StockLineResponse, { language: req.query.language, text: personaRender.stockLine(req.query.language) }),
  );

  app.post("/v1/personas", { schema: { body: CreatePersonaRequest }, config: { pyFloats: true } }, async (req, reply) => {
    const body = req.body;
    const voiceId = await _checkedVoice(body.voice_id);
    const st = getState();
    // Python's argument order: the name, then the delivery, then the language.
    const name = _personaName(body.name);
    const delivery = _checkedDelivery(body.default_delivery);
    const language = await _checkedLanguage(voiceId, body.language);
    const created = st.personas.create(name, {
      voice_id: voiceId,
      default_delivery: delivery,
      voice_instruct: body.voice_instruct,
      lexicon_id: body.lexicon_id,
      llm_rewrite_enabled: body.llm_rewrite_enabled,
      llm_model: body.llm_model,
      language,
      avatar_path: body.avatar_path,
      note: body.note,
      effects_chain: body.effects_chain,
    });
    reply.code(201);
    return _view(st, created);
  });

  app.get("/v1/personas/:id", async (req) => {
    const st = getState();
    const p = st.personas.get(req.params.id);
    if (!p) throw notFound(`persona ${req.params.id}`);
    return _view(st, p);
  });

  /** Change what was sent: a field left out stays, a field sent as null is cleared
   * (2026-10-03 — this replaced a PUT that could not clear). */
  app.patch("/v1/personas/:id", { schema: { body: UpdatePersonaRequest }, config: { pyFloats: true } }, async (req) => {
    const id = req.params.id;
    const body = req.body;
    const current = getState().personas.get(id);
    if (current === null) throw notFound(`persona ${id}`);
    const sent = new Set(Object.keys(sentBody(req) || {}));
    const fields = {};
    if (sent.has("name")) fields.name = _personaName(body.name, { besides: id });
    if (sent.has("voice_id")) fields.voice_id = await _checkedVoice(body.voice_id);
    const voiceId = Object.hasOwn(fields, "voice_id") ? fields.voice_id : current.voice_id;
    if (sent.has("language") || sent.has("voice_id")) {
      fields.language = await _checkedLanguage(voiceId, sent.has("language") ? body.language : null, { keepIfSpoken: current.language });
    }
    if (sent.has("default_delivery")) fields.default_delivery = _checkedDelivery(body.default_delivery || construct(PersonaDelivery, {}));
    for (const key of ["avatar_path", "voice_instruct", "note", "effects_chain", "lexicon_id"]) {
      if (sent.has(key)) {
        const value = body[key];
        fields[key] = typeof value === "string" ? strip(value) || null : value;
      }
    }
    const p = getState().personas.update(id, fields);
    if (!p) throw notFound(`persona ${id}`);
    return _view(getState(), p);
  });

  app.delete("/v1/personas/:id", async (req) => {
    const id = req.params.id;
    const personas = getState().personas;
    if (personas.get(id) === null) throw notFound(`persona ${id}`);
    // Every persona deletes the same way (2026-09-29: no built-in personas). The speakers it
    // played lose their persona (SET NULL) and keep their lines — the render stops on them
    // until Cast gives them another.
    if (!personas.delete(id)) throw notFound(`persona ${id}`);
    return { deleted: true };
  });

  /**
   * "Merge into…" (decided 2026-10-03): every speaker this persona plays is played by `into`
   * from now on, and this persona goes. Its persona-scoped lexicons, its generations and its MCP
   * bindings move too; its own settings do not — the persona merged into keeps its own.
   */
  app.post("/v1/personas/:id/merge", { schema: { body: MergePersonaRequest } }, async (req) => {
    const st = getState();
    const h = session.getDb();
    const id = req.params.id;
    const into = req.body.into;
    const source = st.personas.get(id);
    if (source === null) throw notFound(`persona ${id}`);
    if (into === id) throw badRequest("A persona can't be merged into itself.");
    const target = st.personas.get(into);
    if (target === null) throw notFound(`persona ${into}`);
    const moved = h.tx(() => {
      const n = h.update(Speaker, { persona_id: target.id }, { persona_id: id }).changes;
      h.update(Lexicon, { persona_id: target.id }, { persona_id: id });
      h.update(Generation, { persona_id: target.id }, { persona_id: id });
      h.update(MCPBinding, { persona_id: target.id }, { persona_id: id });
      return n;
    });
    st.personas.delete(id);
    return { merged: true, into: target.id, into_name: target.name, speakers: moved };
  });

  /**
   * Hear a persona speak a line — the editor's unsaved draft or a saved one: the persona
   * editor's Listen and Compare, Cast's ▶ and the index's ▶ (2026-10-03). Renders through
   * `persona_render.planLine` — the resolver the chapter render uses — so what you hear here is
   * what the chapter contains. An empty line speaks the stock line in the persona's language.
   */
  app.post("/v1/personas/preview", { schema: { body: PersonaPreviewRequest }, config: { pyFloats: true } }, async (req, reply) => {
    const st = getState();
    const body = req.body;
    let persona;
    if (body.persona !== null) persona = body.persona;
    else if (body.persona_id) {
      persona = st.personas.get(body.persona_id);
      if (persona === null) throw notFound(`persona ${body.persona_id}`);
    } else throw badRequest("Send the persona to hear: persona or persona_id.");
    if (!persona.voice_id) throw badRequest("Pick a voice first — a persona with no voice has nothing to speak with.");
    const problems = personaRender.checkDelivery(persona.default_delivery);
    if (problems.length) throw badRequest(problems.join("; "));
    const plan = await personaRender.planLine(st, persona, { text: " ", direction: body.direction, requestDelivery: body.delivery });
    if (!body.auto_load) {
      const vm = await vmod.voiceModel(st, plan.voice);
      if (vm !== null && manager.getManager().getManifest(vm.engineId) != null && !vmod.isModelLoaded(vm.engineId, vm.model)) {
        throw conflict(`engine_not_loaded:${vm.engineId}`);
      }
    }
    plan.text = strip(body.text) || personaRender.stockLine(plan.language);

    const doIt = async () => {
      const rl = await renderCore.renderLine(st, {
        voice: plan.voice,
        text: plan.text,
        language: plan.language,
        delivery: plan.delivery,
        seed: plan.seed,
        lexicons: plan.lexicons,
        effects: plan.effects,
        cacheScope: "persona-preview",
        useCache: true,
      });
      return renderCore.pcmToWav(rl);
    };
    const handle = synthScheduler.getScheduler().submit([[await vmod.modelKey(st, plan.voice), doIt]], {
      interactive: true,
      owner: synthScheduler.workOwner("a persona preview"),
    });
    await handle.waitAsync({ signal: clientGone(req, reply) });
    handle.raiseIfFailed();
    return reply.type("audio/wav").send(handle.items[0].result);
  });

  /**
   * Hear a voice not kept yet, spoken as this persona. The candidate is planned by
   * `persona_render.planLine` and its text prepared by `render_core.prepareLineText`, as a
   * chapter line would be; the model speaks it; the take, as spoken, is held for 10 minutes
   * (Keep saves it — `/v1/voices/preview/{id}/save`); what comes back is that take shaped by the
   * persona (`render_core.shapeLinePcm`): pace, pitch, gain and effects.
   */
  app.post(
    "/v1/personas/preview-candidate",
    { schema: { body: PersonaCandidatePreviewRequest }, config: { pyFloats: true } },
    async (req, reply) => {
      const st = getState();
      const body = req.body;
      const cand = vp.markSent(body.candidate, (sentBody(req) || {}).candidate);
      vp.validateCandidate(cand);
      const engine = await vp.candidateEngine(cand, st);
      const problems = personaRender.checkDelivery(body.persona.default_delivery);
      if (problems.length) throw badRequest(problems.join("; "));
      const model = cand.model || cand.engine;
      const vm = vmod.describe(st, cand.engine, model, cand.language);
      const design = cand.source === "designed" ? strip(cand.prompt || "") || null : null;
      const plan = await personaRender.planLine(st, body.persona, {
        text: " ",
        candidate: new personaRender.Candidate(vm, design, cand.language),
      });
      const text = strip(body.text) || personaRender.stockLine(plan.language);
      const [extra, blendLanguage] = await vp.candidateVoiceFields(cand, st);
      const language = blendLanguage || plan.language;
      const [prepared, delivery] = renderCore.prepareLineText(st, cand.engine, model, text, plan.delivery, plan.lexicons);
      const [wav, sampleRate, channels] = await vp.synthCandidate(cand, engine, {
        text: prepared,
        language,
        delivery,
        seed: plan.seed,
        extra,
        signal: clientGone(req, reply),
      });
      // The take as the model spoke it — what Keep saves; a design's take keeps the words it
      // speaks as its transcript.
      const payload = modelDump(VoicePreviewRequest, cand);
      payload.preview_text = text;
      payload.language = language;
      const [previewId, expiresAt] = await vp.storeCandidate(cand.source, payload, wav);
      const [, offset, size] = parseWavHeader(wav);
      const pcm = await renderCore.shapeLinePcm(Buffer.from(wav).subarray(offset, offset + size), sampleRate, channels, delivery, {
        speedNative: renderCore.speedNative(st, cand.engine, model),
        effects: plan.effects,
      });
      return construct(VoicePreviewResponse, {
        wav_b64: writeWavContainer(pcm, sampleRate, channels).toString("base64"),
        duration_sec: pcm.length / (sampleRate * channels * 2),
        preview_id: previewId,
        expires_at: expiresAt,
      });
    },
  );

  /**
   * Generate a fresh in-character line via LLM — 🎲 Compose in the persona page's Hear it. Runs
   * through the shared run path: the `compose` template row + its engine preset. (The template
   * row owns the wording — {{personality}} in the system half, the persona's note since
   * 2026-09-29; the old temperature lives on its preset.)
   */
  app.post("/v1/personas/:id/compose", async (req) => {
    const id = req.params.id;
    const persona = _requirePersonaWithNote(id);
    const resp = await runOrRefuse("compose", { personality: strip(persona.note) });
    return construct(ComposeResponse, { text: strip(resp.text), persona_id: id, note: null, usage: usageOf(resp) });
  });

  /**
   * Rewrite the supplied text in the persona's voice (preview-then-accept). The user accepts
   * (text replaces the textarea) or rejects (original preserved) before sending to TTS. NEVER
   * an automatic render-time hook — always explicit. The `persona_rewrite` template row + its
   * engine preset; no token cap (caps ruling 2026-08-07).
   */
  app.post("/v1/personas/:id/rewrite", { schema: { body: RewriteRequest } }, async (req) => {
    const id = req.params.id;
    const body = req.body;
    const persona = _requirePersonaWithNote(id);
    if (!strip(body.text)) throw new HttpError(400, "rewrite requires non-empty text");
    const resp = await runOrRefuse("persona_rewrite", { personality: strip(persona.note), text: body.text });
    return construct(RewriteResponse, {
      original: body.text,
      rewritten: strip(resp.text),
      persona_id: id,
      note: null,
      usage: usageOf(resp),
    });
  });
}
