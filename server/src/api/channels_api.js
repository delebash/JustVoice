// SPDX-License-Identifier: MIT
// /v1/channels — audio output channel configs (the port of justvoice/api/channels_api.py).
//
// Maps a persona to specific OS audio output devices. Use cases: multi-monitor setups, route
// certain voices to OBS virtual mic, per-character podcast monitoring across multiple outputs.

import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Channel, PersonaChannel, uuid } from "../database/models.js";
import * as session from "../database/session.js";
import { notFound } from "../errors.js";
import { construct, DateTime } from "../models.js";
import { jsonLoads } from "../py_compat.js";

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

export async function router(app) {
  app.get("/v1/channels", async () => {
    const rows = session.getDb().all(`select * from ${Channel} order by created_at`, undefined, Channel);
    return { channels: rows.map(fromOrm) };
  });

  app.post("/v1/channels", { schema: { body: CreateChannelRequest } }, async (req, reply) => {
    const h = session.getDb();
    const body = req.body;
    const id = uuid();
    h.tx(() => {
      // Only one default at a time.
      if (body.is_default) h.update(Channel, { is_default: false }, { is_default: true });
      h.insert(Channel, { id, name: body.name, is_default: body.is_default, device_ids_json: pyJson(body.device_ids) });
    });
    reply.code(201);
    return fromOrm(byId(h, id));
  });

  app.patch("/v1/channels/:channel_id", { schema: { body: UpdateChannelRequest } }, async (req) => {
    const h = session.getDb();
    const channelId = req.params.channel_id;
    const body = req.body;
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
    return fromOrm(byId(h, channelId));
  });

  app.delete("/v1/channels/:channel_id", async (req) => {
    const h = session.getDb();
    const channelId = req.params.channel_id;
    if (byId(h, channelId) === null) throw notFound(`channel ${channelId}`);
    h.delete(Channel, { id: channelId });
    return { deleted: true };
  });

  app.get("/v1/personas/:persona_id/channels", async (req) => {
    // No ORDER BY, as Python.
    const rows = session.getDb().all(`select * from ${PersonaChannel} where persona_id = ?`, [req.params.persona_id], PersonaChannel);
    return { channel_ids: rows.map((r) => r.channel_id) };
  });

  app.put("/v1/personas/:persona_id/channels", { schema: { body: PersonaChannels } }, async (req) => {
    const h = session.getDb();
    const personaId = req.params.persona_id;
    h.tx(() => {
      h.delete(PersonaChannel, { persona_id: personaId });
      for (const cid of req.body.channel_ids) h.insert(PersonaChannel, { persona_id: personaId, channel_id: cid });
    });
    return { channel_ids: req.body.channel_ids };
  });
}
