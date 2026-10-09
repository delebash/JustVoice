// SPDX-License-Identifier: MIT
// /v1/prefs — renderer UI preferences (real rows, not the renderer's localStorage) (the port of
// justvoice/api/prefs_api.py).
//
// A small key/value JSON store for the Vue app's content prefs — appearance, hidden-voice
// lists, per-voice gender overrides, speaker-lab presets, autoload. The renderer GETs the whole
// document on boot and PATCHes a section on change. Deliberately separate from `/v1/settings`
// (typed operator/server config): PATCH here is a **wholesale per-key** upsert, NOT a deep
// merge, so a map/list entry can be removed by sending the smaller value.
//
// The router itself is the kit's (this contract was the family donor — target-tree P9); what
// lives here is JustVoice's storage: the `prefs` table, one JSON-encoded value per row
// (Python's `json.dumps` — a whole-number float stays `1.0`, app.js's body parser keeps it).

import { makePrefsRouter } from "@delebash/llm-runner/platform";
import { jsonLoads, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { Pref } from "../database/models.js";
import * as session from "../database/session.js";

export function _readAll() {
  const h = session.getDb();
  const out = {};
  // No ORDER BY, as Python's `db.query(Pref).all()` — rowid order.
  for (const row of h.all(`select * from ${Pref}`, undefined, Pref)) {
    try {
      out[row.key] = jsonLoads(row.value);
    } catch {
      out[row.key] = null; // (ValueError, TypeError)
    }
  }
  return out;
}

export function _writeMany(patch) {
  const h = session.getDb();
  h.tx(() => {
    for (const [key, value] of Object.entries(patch)) {
      const encoded = pyJson(value);
      if (h.get(Pref, key) === null) h.insert(Pref, { key, value: encoded });
      else h.update(Pref, { value: encoded }, { key });
    }
  });
}

export function _clear() {
  session.getDb().run(`delete from ${Pref}`);
}

export const router = () => makePrefsRouter({ readAll: _readAll, writeMany: _writeMany, clear: _clear });
