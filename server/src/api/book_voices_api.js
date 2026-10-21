// SPDX-License-Identifier: MIT
// /v1/projects/{id}/book-voices/* — voices for a book's cast and narrator, one route per step (the
// one-click plan's slice 3; book_voices/index.js holds the steps, which the one-click run calls
// too). In order: describe (the language model), design (the speech models), match (the rest, from
// the library). A step's answer says what it did, what it left alone and what failed, with the
// model, the recipe, the tokens and the seconds — the numbers the plan's comparison tests read.

import { aiRunHttpError, isAbortError, LLMNotConfiguredError } from "@delebash/core/llm";
import { Hono, input } from "@delebash/core/platform";
import { getLogger } from "@delebash/core/platform/log";
import { literal, nullable, opt, T } from "@delebash/core/platform/models";
import { describeVoices, makeVoices, matchRest } from "../book_voices/index.js";
import * as session from "../database/session.js";
import { HttpError } from "../errors.js";
import { construct } from "../models.js";
import { RunUsage } from "./extraction_api.js";
import { clientGone } from "./generate_api.js";

const log = getLogger("justvoice.api.book_voices_api");
const errText = (e) => e?.message ?? String(e);

/** Who a step names: a speaker of the book. */
const SpeakerRef = {
  speaker_id: T.String(),
  name: opt(T.String(), ""),
};

export const DescribeVoicesRequest = T.Object({
  // Force a recipe; left out, Auto's — the Whole cast card's model (Frontier for a cloud model).
  recipe: opt(nullable(literal("local", "frontier")), null),
});

/** One voice's description, as step 1 answers it and step 2 takes it. */
export const VoiceDescription = T.Object({
  ...SpeakerRef,
  narrator: opt(T.Boolean(), false),
  lines: opt(T.Integer(), 0),
  gender: opt(nullable(T.String()), null),
  description: T.String(),
  // The model that wrote it, and the recipe it ran.
  model: opt(nullable(T.String()), null),
  recipe: opt(nullable(T.String()), null),
});

export const DescribeVoicesResponse = T.Object({
  recipe: T.String(),
  descriptions: T.Array(VoiceDescription),
  // Not described: `cast` — the speaker has a persona (left alone); `persona_named` — a persona of
  // exactly its name is in the library (the match step casts it).
  skipped: T.Array(T.Object({ ...SpeakerRef, narrator: opt(T.Boolean(), false), lines: opt(T.Integer(), 0), reason: T.String() })),
  failed: T.Array(T.Object({ ...SpeakerRef, narrator: opt(T.Boolean(), false), lines: opt(T.Integer(), 0), error: T.String() })),
  usage: RunUsage,
  seconds: T.Number(),
});

export const MakeVoicesRequest = T.Object({ descriptions: T.Array(VoiceDescription) });

export const MakeVoicesResponse = T.Object({
  made: T.Array(
    T.Object({
      ...SpeakerRef,
      narrator: opt(T.Boolean(), false),
      voice_id: T.String(),
      persona_id: T.String(),
      // False when the speaker was cast by someone else meanwhile — the persona is still made.
      cast: T.Boolean(),
      // The words the audition spoke — the voice's clip and its transcript.
      audition: T.String(),
      seconds: T.Number(),
    }),
  ),
  cast_by_name: T.Array(T.Object({ ...SpeakerRef, persona_id: T.String() })),
  left_alone: T.Array(T.Object(SpeakerRef)),
  failed: T.Array(T.Object({ ...SpeakerRef, error: T.String() })),
  seconds: T.Number(),
});

export const MatchRestResponse = T.Object({
  cast_by_name: T.Array(T.Object({ ...SpeakerRef, persona_id: T.String() })),
  assigned: T.Array(T.Object({ ...SpeakerRef, persona_id: T.String(), persona_name: opt(nullable(T.String()), null) })),
  unmatched: T.Array(T.Object(SpeakerRef)),
  note: opt(nullable(T.String()), null),
  usage: opt(nullable(RunUsage), null),
  seconds: T.Number(),
});

/** A language-model step's errors as the AI routes answer them: 501 with no model set, 502 when
 * the call fails. */
async function aiStep(name, fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError || isAbortError(e)) throw e;
    if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
    const ai = aiRunHttpError(e); // 503 a local model not ready, 502 a provider not reached (the kit's)
    if (ai) throw ai;
    log.warning(`book_voices ${name} failed: ${errText(e)}`);
    throw new HttpError(502, `${name} failed: ${errText(e)}`);
  }
}

export function router() {
  const app = new Hono();

  /** Step 1: each main speaker's and the narrator's voice description. Writes nothing. */
  app.post("/v1/projects/:project_id/book-voices/describe", input({ body: nullable(DescribeVoicesRequest) }), async (c) => {
    const body = c.req.valid("json") ?? construct(DescribeVoicesRequest, {});
    const signal = c.req.raw.signal; // a client that leaves stops the model's call (2026-10-21)
    try {
      const out = await aiStep("describe", () => describeVoices(session.getDb(), c.req.param("project_id"), { recipe: body.recipe, signal }));
      return c.json(construct(DescribeVoicesResponse, out));
    } catch (e) {
      if (signal.aborted && isAbortError(e)) return c.body(null, 499); // the client is gone
      throw e;
    }
  });

  /** Step 2: design each voice once, keep its audition as its clip, make its persona, cast it. */
  app.post("/v1/projects/:project_id/book-voices/design", input({ body: MakeVoicesRequest }), async (c) => {
    const body = c.req.valid("json");
    const out = await makeVoices(session.getDb(), c.req.param("project_id"), body.descriptions, { signal: clientGone(c) });
    return c.json(construct(MakeVoicesResponse, out));
  });

  /** Step 3: the speakers still without a persona, matched from the library and cast. */
  app.post("/v1/projects/:project_id/book-voices/match", async (c) => {
    const out = await aiStep("match", () => matchRest(session.getDb(), c.req.param("project_id")));
    return c.json(construct(MatchRestResponse, out));
  });
  return app;
}
