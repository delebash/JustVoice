// SPDX-License-Identifier: MIT
// POST /v1/llm/smart-assign — the LLM proposes who plays whom (the port of
// justvoice/api/smart_assign_api.py).
//
// Pairs with Studio Cast's ✨ Smart-assign button: the book's speakers go in as `characters` and
// the library's personas (the finished voices) as `voices` — the names of the template row's
// variables, which predate the 2026-09-29 speakers/personas split and still fit it (a persona IS
// the voice). Ported from JustWrite's llm.js:139-172 prompt. One chat through the dispatch with
// feature='smart_assign'; returns the proposed {speaker_id: persona_id} map.

import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { strip } from "@delebash/llm-runner/platform/py";
import * as run from "../engines/llm/run.js";
import { HttpError } from "../errors.js";
import { construct } from "../models.js";
import { cpSlice, isDict, jsonLoads, pyStrOf } from "../py_compat.js";
import { RunUsage } from "./extraction_api.js";

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
});

export const SmartAssignResponse = T.Object({
  assignments: T.Record(T.String(), T.String()),
  note: opt(nullable(T.String()), null),
  // §16: every AI response carries the run's usage.
  usage: opt(nullable(RunUsage), null),
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
    if (c.description) bits.push(`description="${cpSlice(c.description, 0, 200)}"`);
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

export async function router(app) {
  app.post("/v1/llm/smart-assign", { schema: { body: SmartAssignRequest } }, async (req) => {
    const body = req.body;
    if (!body.characters.length || !body.voices.length) throw new HttpError(400, "smart-assign requires non-empty characters AND voices");

    // The template row owns the wording ({{speakers}}/{{personas}} — ruling 9; the book's
    // speakers matched to personas, 2026-09-29); code computes the variable VALUES. No token cap
    // (caps ruling 2026-08-07).
    let resp;
    try {
      resp = await run.runFeature("smart_assign", { speakers: _formatCharacters(body.characters), personas: _formatVoices(body.voices) });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      log.warning(`smart_assign LLM call failed: ${errText(e)}`);
      throw new HttpError(502, `smart-assign failed: ${errText(e)}`);
    }

    const raw = _parseAssignmentObject(resp.text);
    const charIds = new Set(body.characters.map((c) => c.id));
    const voiceIds = new Set(body.voices.map((v) => v.id));
    // Defensive filter: ignore ids the model invented or that no longer appear in the catalog
    // (e.g. the user deleted a voice mid-flight).
    const assignments = Object.fromEntries(Object.entries(raw).filter(([cid, vid]) => charIds.has(cid) && voiceIds.has(vid)));

    let note = null;
    if (!Object.keys(assignments).length && Object.keys(raw).length) note = "Model returned assignments, but none matched the current catalog.";

    return construct(SmartAssignResponse, {
      assignments,
      note,
      usage: { prompt_tokens: resp.prompt_tokens, completion_tokens: resp.completion_tokens, model: resp.model },
    });
  });
}
