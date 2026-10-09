// SPDX-License-Identifier: MIT
// /v1/channels — audio output channel configs (the port of justvoice/api/channels_api.py).
//
// Maps a persona to specific OS audio output devices. Use cases: multi-monitor setups, route
// certain voices to OBS virtual mic, per-character podcast monitoring across multiple outputs.

import { Hono, input } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { jsonLoads, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Channel, PersonaChannel, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, DateTime } from "../models.js";

export const ChannelResponse = T.Object({
  id: T.String(),
  name: T.String(),
  is_default: T.Boolean(),
  device_ids: T.Array(T.String()),
  created_at: DateTime(),
});

export const ChannelList = T.Object({ channels: T.Array(ChannelResponse) });

export const CreateChannelRequest = T.Object({
  name: T.String({ minLength: 1, maxLength: 80 }),
  is_default: opt(T.Boolean(), false),
  device_ids: opt(T.Array(T.String()), []),
});

export const UpdateChannelRequest = T.Object({
  name: opt(nullable(T.String({ minLength: 1, maxLength: 80 })), null),
  is_default: opt(nullable(T.Boolean()), null),
  device_ids: opt(nullable(T.Array(T.String())), null),
});

export const PersonaChannels = T.Object({ channel_ids: T.Array(T.String()) });

/** `ChannelResponse.from_orm(row)`. */
export function fromOrm(row) {
  return construct(ChannelResponse, {
    id: row.id,
    name: row.name,
    is_default: row.is_default,
    device_ids: jsonLoads(row.device_ids_json || "[]"),
    created_at: row.created_at,
  });
}

const byId = (h, id) => h.one(`select * from ${Channel} where id = ? limit 1`, [id], Channel);

export function router() {
  const app = new Hono();
  app.get("/v1/channels", (c) => {
    const rows = session.getDb().all(`select * from ${Channel} order by created_at`, undefined, Channel);
    return c.json({ channels: rows.map(fromOrm) });
  });

  app.post("/v1/channels", input({ body: CreateChannelRequest }), (c) => {
    const h = session.getDb();
    const body = c.req.valid("json");
    const id = uuid();
    h.tx(() => {
      // Only one default at a time.
      if (body.is_default) h.update(Channel, { is_default: false }, { is_default: true });
      h.insert(Channel, { id, name: body.name, is_default: body.is_default, device_ids_json: pyJson(body.device_ids) });
    });
    return c.json(fromOrm(byId(h, id)), 201);
  });

  app.patch("/v1/channels/:channel_id", input({ body: UpdateChannelRequest }), (c) => {
    const h = session.getDb();
    const channelId = c.req.param("channel_id");
    const body = c.req.valid("json");
    if (byId(h, channelId) === null) throw notFound(`channel ${channelId}`);
    h.tx(() => {
      const set = {};
      if (body.name !== null) set.name = body.name;
      if (body.is_default !== null) {
        if (body.is_default) h.update(Channel, { is_default: false }, { is_default: true });
        set.is_default = body.is_default;
      }
      if (body.device_ids !== null) set.device_ids_json = pyJson(body.device_ids);
      h.update(Channel, set, { id: channelId });
    });
    return c.json(fromOrm(byId(h, channelId)));
  });

  app.delete("/v1/channels/:channel_id", (c) => {
    const h = session.getDb();
    const channelId = c.req.param("channel_id");
    if (byId(h, channelId) === null) throw notFound(`channel ${channelId}`);
    h.delete(Channel, { id: channelId });
    return c.json({ deleted: true });
  });

  app.get("/v1/personas/:persona_id/channels", (c) => {
    // No ORDER BY, as Python.
    const rows = session.getDb().all(`select * from ${PersonaChannel} where persona_id = ?`, [c.req.param("persona_id")], PersonaChannel);
    return c.json({ channel_ids: rows.map((r) => r.channel_id) });
  });

  app.put("/v1/personas/:persona_id/channels", input({ body: PersonaChannels }), (c) => {
    const h = session.getDb();
    const personaId = c.req.param("persona_id");
    const body = c.req.valid("json");
    h.tx(() => {
      h.delete(PersonaChannel, { persona_id: personaId });
      for (const cid of body.channel_ids) h.insert(PersonaChannel, { persona_id: personaId, channel_id: cid });
    });
    return c.json({ channel_ids: body.channel_ids });
  });
  return app;
}
