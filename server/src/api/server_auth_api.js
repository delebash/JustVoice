// SPDX-License-Identifier: MIT
// GET/PUT /v1/server-auth — the bearer-token door, and the lockout escape (the port of
// justvoice/api/server_auth_api.py).
//
// The family shape (docgen built it first, 2026-08-05; the apps work the same — user ruling):
// auth config gets its OWN route instead of riding the generic settings API, so the middleware
// can exempt exactly THIS door (plus /v1/health) for loopback clients. Without the exemption,
// require_for_loopback + a lost token gated even the health probe and every way to fix it. The
// tokens already sit in the locally readable settings store, so the loopback door exposes
// nothing new. Wire shape: {"tokens": [...], "requireForLoopback": bool}.

import { HttpError } from "@delebash/llm-runner/platform/errors";
import { T } from "@delebash/llm-runner/platform/models";
import { strip, truthy } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { AuthSettings, construct } from "../models.js";

const wire = (a) => ({
  tokens: a.tokens.filter((t) => typeof t === "string" && t),
  requireForLoopback: Boolean(a.require_for_loopback),
});

export async function router(app) {
  app.get("/v1/server-auth", async () => wire(getState().settings.get().auth));

  app.put("/v1/server-auth", { schema: { body: T.Record(T.String(), T.Any()) } }, async (req) => {
    const body = req.body;
    const tokens = body.tokens;
    if (!Array.isArray(tokens) || !tokens.every((t) => typeof t === "string")) {
      throw new HttpError(400, "tokens must be a list of strings");
    }
    const state = getState();
    const current = state.settings.get();
    const rfl = Object.hasOwn(body, "requireForLoopback") ? body.requireForLoopback : null;
    current.auth = construct(AuthSettings, {
      tokens: tokens.filter((t) => strip(t)),
      require_for_loopback: truthy(rfl),
    });
    state.settings.set(current);
    return wire(current.auth);
  });
}
