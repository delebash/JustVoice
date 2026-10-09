// SPDX-License-Identifier: MIT
// GET/PUT/PATCH /v1/settings — settings read + update (the port of
// justvoice/api/settings_api.py).
//
// The nested legacy LLM-provider model (`LLMProviderConfig`) is camelCase-NATIVE as of
// 2026-06-21 — the field IS the JSON key, with no snake_case aliases — so this surface emits
// `engines.llm[].providerType` etc. natively, and the renderer reads/writes those sections in
// camelCase. Non-LLM settings sections keep their own (snake) field names.

import { Hono, input } from "@delebash/llm-runner/platform";
import { getState } from "../app_state.js";
import { construct, Settings, SettingsPatch, SettingsPatchResponse } from "../models.js";

/** The request body as the client SENT it (before defaults were filled) — what pydantic's
 * `exclude_unset` reads. The kit's body reader keeps it (`c.get("sentBody")`, app.js's float
 * opt-in); a bare server falls back to the validated body. */
export const sentBody = (c) => {
  const sent = c.get("sentBody");
  return sent !== undefined ? sent : c.req.valid("json");
};

export function router() {
  const app = new Hono();
  app.get("/v1/settings", (c) => c.json(getState().settings.get()));

  app.put("/v1/settings", input({ body: Settings }), (c) => {
    const saved = getState().settings.set(c.req.valid("json"));
    return c.json(construct(SettingsPatchResponse, { settings: saved, restart_required: [] }));
  });

  app.patch("/v1/settings", input({ body: SettingsPatch }), (c) => {
    const [saved, restart] = getState().settings.patch(sentBody(c));
    return c.json(construct(SettingsPatchResponse, { settings: saved, restart_required: restart }));
  });
  return app;
}
