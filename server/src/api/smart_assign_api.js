// SPDX-License-Identifier: MIT
// POST /v1/llm/smart-assign — the LLM proposes who plays whom (the port of
// justvoice/api/smart_assign_api.py).
//
// Pairs with Studio Cast's ✨ Smart-assign button: the book's speakers go in as `characters` and
// the library's personas (the finished voices) as `voices` — the names of the template row's
// variables, which predate the 2026-09-29 speakers/personas split and still fit it (a persona IS
// the voice). Ported from JustWrite's llm.js:139-172 prompt. One chat through the dispatch with
// feature='smart_assign'; returns the proposed {speaker_id: persona_id} map.
//
// The matches are cast on the server (the one-click plan's slice 3, 2026-10-16): `smartAssign` is
// the call and `applyAssignments` the cast, which the route runs when asked (`apply` — Cast's
// Smart-assign asks; New persona, which matches speakers to VOICES, doesn't) and the one-click
// run's voices step runs for the speakers left without a voice of their own (book_voices). Until
// then the renderer cast each match with PATCH /v1/speakers/{id}.

import { LLMNotConfiguredError } from "@delebash/core/llm";
import { Hono, input } from "@delebash/core/platform";
import { getLogger } from "@delebash/core/platform/log";
import { nullable, opt, T } from "@delebash/core/platform/models";
import { isDict, strip } from "@delebash/core/platform/py";
import { jsonLoads, pyStrOf } from "@delebash/core/platform/pyjson";
import { Persona, Speaker } from "../database/models.js";
import * as session from "../database/session.js";
import * as run from "../engines/llm/run.js";
import { HttpError } from "../errors.js";
import { construct } from "../models.js";
import { RunUsage } from "./extraction_api.js";
import { clientGone } from "./generate_api.js";

const log = getLogger("justvoice.api.smart_assign_api");
const errText = (e) => e?.message ?? String(e);

/** A speaker — who they are is this prompt's only description source. */
export const SmartAssignCharacter = T.Object({
  id: T.String(),
  name: T.String(),
  description: opt(nullable(T.String()), null),
  gender: opt(nullable(T.String()), null),
  pronouns: opt(nullable(T.String()), null),
  aliases: opt(T.Array(T.String()), []),
  role: opt(nullable(T.String()), null),
});

/** A persona — `tone` carries its note on how it sounds. */
export const SmartAssignVoice = T.Object({
  id: T.String(),
  name: T.String(),
  gender: opt(nullable(T.String()), null),
  age: opt(nullable(T.Integer()), null),
  accent: opt(nullable(T.String()), null),
  tone: opt(nullable(T.String()), null),
  language: opt(nullable(T.String()), null),
});

export const SmartAssignRequest = T.Object({
  characters: T.Array(SmartAssignCharacter),
  voices: T.Array(SmartAssignVoice),
  // Cast each speaker with its match here, on the server (`applyAssignments`) — the voices are
  // then personas. Left out, the matches only come back.
  apply: opt(T.Boolean(), false),
});

export const SmartAssignResponse = T.Object({
  assignments: T.Record(T.String(), T.String()),
  note: opt(nullable(T.String()), null),
  // §16: every AI response carries the run's usage.
  usage: opt(nullable(RunUsage), null),
  // The matches cast ({speaker_id: persona_id}) when the request asked to apply them.
  applied: opt(T.Record(T.String(), T.String()), {}),
});

export function _formatCharacters(chars) {
  const lines = [];
  for (const c0 of chars) {
    const c = construct(SmartAssignCharacter, c0);
    const bits = [`id="${c.id}"`, `name="${c.name}"`];
    if (c.role) bits.push(`role="${c.role}"`);
    if (c.gender) bits.push(`gender="${c.gender}"`);
    if (c.pronouns) bits.push(`pronouns="${c.pronouns}"`);
    if (c.aliases.length) bits.push(`aliases="${c.aliases.join(", ")}"`);
    // Who they are, whole (the narrowings review C12, 2026-10-13: it was cut at 200 characters).
    if (c.description) bits.push(`description="${c.description}"`);
    lines.push(`- ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

export function _formatVoices(voices) {
  const lines = [];
  for (const v0 of voices) {
    const v = construct(SmartAssignVoice, v0);
    const bits = [`id="${v.id}"`, `name="${v.name}"`];
    if (v.gender) bits.push(`gender="${v.gender}"`);
    if (v.age) bits.push(`age=${v.age}`);
    if (v.accent) bits.push(`accent="${v.accent}"`);
    if (v.tone) bits.push(`tone="${v.tone}"`);
    if (v.language) bits.push(`language="${v.language}"`);
    lines.push(`- ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

/** Pull the first JSON object from possibly-noisy model output. */
export function _parseAssignmentObject(text) {
  text = strip(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return {};
  let v;
  try {
    v = jsonLoads(m[0]);
  } catch {
    return {};
  }
  if (!isDict(v)) return {};
  // `isinstance(val, (str, int))` — a bool is an int; a float is not.
  const keep = (val) => typeof val === "string" || typeof val === "boolean" || (typeof val === "number" && Number.isInteger(val));
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, val]) => keep(val))
      .map(([k, val]) => [k, pyStrOf(val)]),
  );
}

/**
 * One Smart-assign call (async) → `{assignments, note, usage}`: the model proposes, for each
 * speaker in `characters`, one of `voices` ({speaker_id: voice_id}). Ids the model invented, or
 * that aren't among those sent, are dropped. Throws the kit's LLMNotConfiguredError, or the call's
 * own error.
 */
export async function smartAssign(characters, voices) {
  // The template row owns the wording ({{speakers}}/{{personas}} — ruling 9; the book's
  // speakers matched to personas, 2026-09-29); code computes the variable VALUES. No token cap
  // (caps ruling 2026-08-07).
  const resp = await run.runFeature("smart_assign", { speakers: _formatCharacters(characters), personas: _formatVoices(voices) });

  const raw = _parseAssignmentObject(resp.text);
  const charIds = new Set(characters.map((ch) => ch.id));
  const voiceIds = new Set(voices.map((v) => v.id));
  // Defensive filter: ignore ids the model invented or that no longer appear in the catalog
  // (e.g. the user deleted a voice mid-flight).
  const assignments = Object.fromEntries(Object.entries(raw).filter(([cid, vid]) => charIds.has(cid) && voiceIds.has(vid)));

  let note = null;
  if (!Object.keys(assignments).length && Object.keys(raw).length) note = "Model returned assignments, but none matched the current catalog.";
  return { assignments, note, usage: { prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model } };
}

/**
 * Cast each speaker with the persona Smart-assign matched it to → the matches cast,
 * {speaker_id: persona_id}. A speaker or persona that no longer exists is passed over; a
 * narrator's persona is never replaced (decided 2026-10-13, the narrowings review C1); with
 * `onlyUncast` no speaker that already has a persona is touched (the one-click run: a speaker
 * already cast is left alone). One transaction.
 */
export function applyAssignments(h, assignments, { onlyUncast = false } = {}) {
  const applied = {};
  h.tx(() => {
    for (const [speakerId, personaId] of Object.entries(assignments)) {
      const speaker = h.get(Speaker, speakerId);
      if (speaker === null || h.get(Persona, personaId) === null) continue;
      if (speaker.persona_id && (onlyUncast || speaker.role_label === "narrator")) continue;
      if (speaker.persona_id !== personaId) h.update(Speaker, { persona_id: personaId }, { id: speakerId });
      applied[speakerId] = personaId;
    }
  });
  return applied;
}

export function router() {
  const app = new Hono();
  app.post("/v1/llm/smart-assign", input({ body: SmartAssignRequest }), async (c) => {
    const body = c.req.valid("json");
    if (!body.characters.length || !body.voices.length) throw new HttpError(400, "smart-assign requires non-empty characters AND voices");
    const gone = clientGone(c);

    let out;
    try {
      out = await smartAssign(body.characters, body.voices);
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      log.warning(`smart_assign LLM call failed: ${errText(e)}`);
      throw new HttpError(502, `smart-assign failed: ${errText(e)}`);
    }
    // A Smart-assign cancelled while the model answered casts nothing, as when the page cast.
    const applied = body.apply && !gone.aborted ? applyAssignments(session.getDb(), out.assignments) : {};
    return c.json(construct(SmartAssignResponse, { ...out, applied }));
  });
  return app;
}
