// SPDX-License-Identifier: MIT
// /v1/cache/* — stats + clear + recent entries (the port of justvoice/api/cache_api.py).

import { statSync } from "node:fs";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { pyRepr } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { Generation } from "../database/models.js";
import * as session from "../database/session.js";
import * as manager from "../engines/manager.js";
import { badRequest } from "../errors.js";
import { mediaFile } from "../media_paths.js";
import { CacheStats, construct } from "../models.js";
import * as voiceModel from "../voice_model.js";

export const RecentCacheEntry = T.Object({
  id: T.String(),
  engine: T.String(),
  // The engine by its name (*Qwen3-TTS*) for the Cache page; "not recorded" for renders saved
  // before 2026-10-06, which all said "managed".
  engine_name: opt(T.String(), ""),
  // The model by its name (*Qwen3-TTS CustomVoice*); "not recorded" before 2026-10-06.
  model_name: opt(T.String(), ""),
  voice: T.String(),
  text_preview: T.String(),
  size_bytes: T.Integer(),
  created_at: T.String(),
});

export const RecentCacheResponse = T.Object({ entries: T.Array(RecentCacheEntry) });

export const ClearQuery = T.Object({
  scope: opt(nullable(T.String())),
  older_than_days: opt(nullable(T.Number())),
  voice_id: opt(nullable(T.String())),
  engine: opt(nullable(T.String())),
});

export const RecentQuery = T.Object({ limit: opt(T.Integer(), 15) });

export function modelName(model, engineId) {
  return voiceModel.modelName(model, engineId);
}

/** An engine's own name — its catalog's, else the registry's. A render saved before engines
 * were recorded says "managed": that is "not recorded". */
export function engineName(engineId) {
  if (!engineId || engineId === "managed") return "not recorded";
  const m = manager.getManager().getManifest(engineId);
  if (m) return m.name;
  const inst = getState().engines.get(engineId);
  return inst ? inst.meta.displayName : engineId;
}

const head80 = (s) => [...(s || "")].slice(0, 80).join("");

export async function router(app) {
  app.get("/v1/cache/stats", async () => {
    const cache = getState()._renderCache ?? null;
    if (cache === null) {
      return construct(CacheStats, { total_entries_on_disk: 0, total_bytes_on_disk: 0, memory_entries: 0, memory_bytes: 0 });
    }
    return cache.stats();
  });

  /**
   * Clear cached renders, optionally limited by scope and/or age. Cache entries are
   * hash-keyed, so scope + age are the only filters the cache layer can honor. voice_id /
   * engine are DECLARED here purely to reject them loudly: before 2026-06-13 they were silently
   * dropped, which turned every filtered prune into a full wipe. Voice/engine pruning operates
   * on DELETE /v1/generations.
   */
  app.post("/v1/cache/clear", { schema: { querystring: ClearQuery } }, async (req) => {
    const q = req.query;
    const scope = q.scope ?? null;
    const olderThanDays = q.older_than_days ?? null;
    const unsupported = ["voice_id", "engine"].filter((k) => q[k] != null).sort();
    if (unsupported.length) {
      throw badRequest(
        `Unsupported cache filter(s) ${pyRepr(unsupported)}: cache entries ` +
          "are hash-keyed and carry no voice/engine identity. " +
          "Use DELETE /v1/generations with these filters instead.",
      );
    }
    const cache = getState()._renderCache ?? null;
    let removed = 0;
    if (cache !== null) removed = cache.clear(scope, olderThanDays);
    return { cleared: true, scope, older_than_days: olderThanDays, removed };
  });

  /**
   * Latest completed generations — the human-readable face of the cache (raw cache keys are
   * hashes; the generation row carries the engine/voice/text that produced them). Delete rows
   * via DELETE /v1/generations/{id}.
   */
  app.get("/v1/cache/recent", { schema: { querystring: RecentQuery } }, async (req) => {
    const st = getState();
    const limit = Math.max(1, Math.min(req.query.limit, 100));
    const rows = session
      .getDb()
      .all(`select * from ${Generation} where status = 'completed' order by created_at desc limit ?`, [limit], Generation);
    const entries = [];
    for (const g of rows) {
      let size = 0;
      if (g.audio_path) {
        try {
          size = statSync(mediaFile(g.audio_path)).size;
        } catch {
          size = 0;
        }
      }
      const persona = g.persona_id ? st.personas.get(g.persona_id) : null;
      entries.push({
        id: g.id,
        engine: g.engine || "?",
        engine_name: engineName(g.engine),
        model_name: g.model ? modelName(g.model, g.engine) : "not recorded",
        voice: persona ? persona.name : g.profile_id || "—",
        text_preview: head80(g.text),
        size_bytes: size,
        created_at: g.created_at || "",
      });
    }
    return construct(RecentCacheResponse, { entries });
  });
}
