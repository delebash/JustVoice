// SPDX-License-Identifier: MIT
// GET/PUT/PATCH /v1/settings — settings read + update (the port of
// justvoice/api/settings_api.py).
//
// The nested legacy LLM-provider model (`LLMProviderConfig`) is camelCase-NATIVE as of
// 2026-06-21 — the field IS the JSON key, with no snake_case aliases — so this surface emits
// `engines.llm[].providerType` etc. natively, and the renderer reads/writes those sections in
// camelCase. Non-LLM settings sections keep their own (snake) field names.

import { getState } from "../app_state.js";
import { construct, Settings, SettingsPatch, SettingsPatchResponse } from "../models.js";

/** The request body as the client SENT it (before defaults were filled) — what pydantic's
 * `exclude_unset` reads. app.js's JSON parser keeps it; a bare server falls back to the body. */
export const sentBody = (req) => (req.sentBody !== undefined ? req.sentBody : req.body);

export async function router(app) {
  app.get("/v1/settings", async () => getState().settings.get());

  app.put("/v1/settings", { schema: { body: Settings } }, async (req) => {
    const saved = getState().settings.set(req.body);
    return construct(SettingsPatchResponse, { settings: saved, restart_required: [] });
  });

  app.patch("/v1/settings", { schema: { body: SettingsPatch } }, async (req) => {
    const [saved, restart] = getState().settings.patch(sentBody(req));
    return construct(SettingsPatchResponse, { settings: saved, restart_required: restart });
  });
}
