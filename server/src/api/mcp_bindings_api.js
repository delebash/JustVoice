// SPDX-License-Identifier: MIT
// /v1/mcp/bindings — per-client MCP voice + defaults binding (the port of
// justvoice/api/mcp_bindings_api.py).
//
// When an Unreal editor / Claude / Cursor calls `justvoice.speak` without specifying a voice,
// the per-client binding's defaults apply. After Slice 4 of the Profile-kill rollout the
// binding points at a Persona rather than a (now-dead) VoiceProfile.

import { Hono, input } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { MCPBinding } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, DateTime } from "../models.js";

export const MCPBindingResponse = T.Object({
  client_id: T.String(),
  label: nullable(T.String()),
  persona_id: nullable(T.String()),
  default_engine: nullable(T.String()),
  last_seen_at: nullable(DateTime()),
  created_at: DateTime(),
});

export const MCPBindingList = T.Object({ bindings: T.Array(MCPBindingResponse) });

export const UpsertMCPBindingRequest = T.Object({
  client_id: T.String({ minLength: 1, maxLength: 80 }),
  label: opt(nullable(T.String()), null),
  persona_id: opt(nullable(T.String()), null),
  default_engine: opt(nullable(T.String()), null),
});

const row = (r) => construct(MCPBindingResponse, r);
const byClient = (h, id) => h.one(`select * from ${MCPBinding} where client_id = ? limit 1`, [id], MCPBinding);

export function router() {
  const app = new Hono();
  app.get("/v1/mcp/bindings", (c) => {
    const rows = session.getDb().all(`select * from ${MCPBinding} order by created_at`, undefined, MCPBinding);
    return c.json({ bindings: rows.map(row) });
  });

  app.post("/v1/mcp/bindings", input({ body: UpsertMCPBindingRequest }), (c) => {
    const h = session.getDb();
    const b = c.req.valid("json");
    const fields = { label: b.label, persona_id: b.persona_id, default_engine: b.default_engine };
    if (byClient(h, b.client_id) !== null) h.update(MCPBinding, fields, { client_id: b.client_id });
    else h.insert(MCPBinding, { client_id: b.client_id, ...fields });
    return c.json(row(byClient(h, b.client_id)));
  });

  app.delete("/v1/mcp/bindings/:client_id", (c) => {
    const h = session.getDb();
    const clientId = c.req.param("client_id");
    if (byClient(h, clientId) === null) throw notFound(`mcp binding ${clientId}`);
    h.delete(MCPBinding, { client_id: clientId });
    return c.json({ deleted: true });
  });
  return app;
}
