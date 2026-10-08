// SPDX-License-Identifier: MIT
// /v1/takes — per-block take versioning for the audiobook re-roll workflow (the port of
// justvoice/api/takes_api.py).
//
// Voicebox versions WHOLE generations; we version per-block so re-rendering paragraph 47
// doesn't invalidate paragraph 48. Since Studio Slice 4 (2026-10-04) a take keeps its audio,
// and the ★ (default) take is what the chapter plays — Render's line panel lists, plays, stars
// and deletes them here (line_takes.js holds the rules).

import { createReadStream, statSync, unlinkSync } from "node:fs";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { cpSlice } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { Block, Generation, Scene, Take } from "../database/models.js";
import * as session from "../database/session.js";
import { badRequest, notFound } from "../errors.js";
import * as exportVoicelines from "../export_voicelines.js";
import * as lineTakes from "../line_takes.js";
import { mediaFile } from "../media_paths.js";
import { construct, DateTime } from "../models.js";
import * as renderJobs from "../render_jobs.js";
import * as synthScheduler from "../synth_scheduler.js";
import * as voiceModel from "../voice_model.js";
import { personaForBlock } from "./_speaker_helpers.js";
import { clientGone } from "./generate_api.js";

export const TakeResponse = T.Object({
  id: T.String(),
  block_id: T.String(),
  generation_id: T.String(),
  source_take_id: nullable(T.String()),
  is_default: T.Boolean(),
  label: nullable(T.String()),
  created_at: DateTime(),
  // From its generation (Slice 4): how long it is, where its audio plays from (null when it
  // has none on disk), whether ↻ New take rolled its seed, and the words it says.
  seconds: opt(nullable(T.Number()), null),
  audio_url: opt(nullable(T.String()), null),
  new_seed: opt(T.Boolean(), false),
  text: opt(nullable(T.String()), null),
});

const genById = (h, id) => h.one(`select * from ${Generation} where id = ? limit 1`, [id], Generation);
const takeById = (h, id) => h.one(`select * from ${Take} where id = ? limit 1`, [id], Take);

/** A take as the API shows it, with what its generation says. */
export function _takeOut(h, take) {
  const gen = genById(h, take.generation_id);
  const out = {
    id: take.id,
    block_id: take.block_id,
    generation_id: take.generation_id,
    source_take_id: take.source_take_id,
    is_default: take.is_default,
    label: take.label,
    created_at: take.created_at,
  };
  if (gen !== null) {
    out.seconds = gen.duration_sec;
    out.audio_url = lineTakes.hasAudio(gen) ? `/v1/generations/${gen.id}/audio` : null;
    out.new_seed = gen.source === lineTakes.NEW_TAKE;
    out.text = gen.text;
  }
  return construct(TakeResponse, out);
}

export const TakeList = T.Object({
  takes: T.Array(TakeResponse),
  default_take_id: nullable(T.String()),
});

export const UpdateTakeRequest = T.Object({ label: opt(nullable(T.String()), null) });

/** A flat row for the History / Recent generations table (when / voice / text preview / take /
 * effects / actions) — the global history, unlike the block-scoped `TakeResponse`. */
export const RecentTakeRow = T.Object({
  id: T.String(),
  when: DateTime(),
  voice: opt(nullable(T.String()), null),
  text: T.String(),
  take: opt(nullable(T.String()), null),
  effects: opt(nullable(T.String()), null),
  status: T.String(),
  audio_url: opt(nullable(T.String()), null),
});

export const RecentTakesResponse = T.Object({ takes: T.Array(RecentTakeRow) });

/** One link in a take's source chain, walked back through `source_take_id` to the original. */
export const LineageNode = T.Object({
  take_id: T.String(),
  generation_id: T.String(),
  label: opt(nullable(T.String()), null),
  is_default: opt(T.Boolean(), false),
  created_at: DateTime(),
  audio_url: opt(nullable(T.String()), null),
  text_preview: opt(nullable(T.String()), null),
});

export const LineageResponse = T.Object({
  chain: T.Array(LineageNode),
  block_id: opt(nullable(T.String()), null),
});

// ↻ New take: render with a seed of its own, so the line is read afresh (the same seed gives
// the same audio, from the cache — G1, 2026-10-04). The body is optional.
export const RenderBlockRequest = T.Object({ new_take: opt(T.Boolean(), false) });

/** `Path.unlink(missing_ok=True)`. */
function unlinkMissingOk(p) {
  try {
    unlinkSync(p);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}

export async function router(app) {
  app.get("/v1/takes/by_block/:block_id", async (req) => {
    const h = session.getDb();
    const rows = h.all(`select * from ${Take} where block_id = ? order by created_at desc`, [req.params.block_id], Take);
    const def = rows.find((r) => r.is_default);
    return { takes: rows.map((r) => _takeOut(h, r)), default_take_id: def ? def.id : null };
  });

  app.post("/v1/takes/:take_id/set_default", async (req) => {
    const h = session.getDb();
    const takeId = req.params.take_id;
    const take = takeById(h, takeId);
    if (!take) throw notFound(`take ${takeId}`);
    // Clear other defaults for the same block, then mark this one.
    h.tx(() => {
      h.update(Take, { is_default: false }, "block_id = ? and is_default = 1", [take.block_id]);
      h.update(Take, { is_default: true }, { id: takeId });
    });
    return _takeOut(h, takeById(h, takeId));
  });

  app.patch("/v1/takes/:take_id", { schema: { body: UpdateTakeRequest } }, async (req) => {
    const h = session.getDb();
    const takeId = req.params.take_id;
    const take = takeById(h, takeId);
    if (!take) throw notFound(`take ${takeId}`);
    if (req.body.label !== null) h.update(Take, { label: req.body.label }, { id: takeId });
    return _takeOut(h, takeById(h, takeId));
  });

  app.delete("/v1/takes/:take_id", async (req) => {
    const h = session.getDb();
    const takeId = req.params.take_id;
    const take = takeById(h, takeId);
    if (!take) throw notFound(`take ${takeId}`);
    // The take in use can go too (decided 2026-10-07): the newest take left — the top of the
    // line's list — goes in use in the same commit. With none left the line has no take, like
    // a line never rendered.
    let defaultTakeId = null;
    h.tx(() => {
      if (take.is_default) {
        const nxt = h.one(`select * from ${Take} where block_id = ? and id != ? order by created_at desc limit 1`, [take.block_id, take.id], Take);
        if (nxt !== null) {
          h.update(Take, { is_default: true }, { id: nxt.id });
          defaultTakeId = nxt.id;
        }
      }
      // Its audio goes with it (Slice 4): the generation row and its file.
      const gen = genById(h, take.generation_id);
      h.delete(Take, { id: take.id });
      if (gen !== null && lineTakes.TAKE_SOURCES.includes(gen.source)) lineTakes.deleteGeneration(h, gen);
    });
    return { deleted: true, default_take_id: defaultTakeId };
  });

  /**
   * Last N generations regardless of block / project, newest first — a flat row shape for
   * Home's Recent generations card. (Generate's History table read it too, until Generate was
   * removed 2026-10-05.)
   */
  app.get("/v1/takes/recent", { schema: { querystring: T.Object({ limit: opt(T.Integer(), 20) }) } }, async (req) => {
    const h = session.getDb();
    const rows = h.all(
      `select * from ${Generation} order by created_at desc limit ?`,
      [Math.max(1, Math.min(100, req.query.limit))],
      Generation,
    );
    const personas = getState().personas;
    const takes = rows.map((r) => {
      const persona = r.persona_id ? personas.get(r.persona_id) : null;
      // Take label — none computed here (Voicebox shows "3 of 7", which needs lineage).
      return {
        id: r.id,
        when: r.created_at,
        // The persona that spoke it (2026-10-06 — this read the legacy profile id, which no
        // render sets, so every row said "?").
        voice: persona ? persona.name : null,
        text: cpSlice(r.text || "", 0, 120),
        take: null,
        effects: null,
        status: r.status,
        audio_url: r.audio_path ? `/v1/generations/${r.id}/audio` : null,
      };
    });
    return construct(RecentTakesResponse, { takes });
  });

  /** Delete one generation (DB row + audio file). The History table's ✕. Bulk deletion with
   * filters stays on DELETE /v1/generations. */
  app.delete("/v1/generations/:generation_id", async (req) => {
    const h = session.getDb();
    const id = req.params.generation_id;
    const gen = genById(h, id);
    if (!gen) throw notFound(`generation ${id}`);
    if (gen.audio_path) unlinkMissingOk(mediaFile(gen.audio_path));
    h.delete(Generation, { id });
    return { deleted: true };
  });

  /**
   * Walk a take's source chain back to its original (task #98) — the chain oldest → newest.
   * Each take points to the take it was re-rolled from; the chain ends at the original
   * (source_take_id null).
   */
  app.get("/v1/takes/:take_id/lineage", async (req) => {
    const h = session.getDb();
    const chain = [];
    const visited = new Set();
    let curId = req.params.take_id;
    let blockId = null;
    // Walk backward up to a sane bound — protects against accidental cycles.
    for (let i = 0; i < 50; i++) {
      if (!curId || visited.has(curId)) break;
      visited.add(curId);
      const take = takeById(h, curId);
      if (!take) break;
      const gen = genById(h, take.generation_id);
      blockId = take.block_id;
      chain.push({
        take_id: take.id,
        generation_id: take.generation_id,
        label: take.label,
        is_default: Boolean(take.is_default),
        created_at: take.created_at,
        audio_url: gen && gen.audio_path ? `/v1/generations/${gen.id}/audio` : null,
        text_preview: gen ? cpSlice(gen.text || "", 0, 120) : null,
      });
      curId = take.source_take_id;
    }
    // Oldest (root) first — a top-to-bottom timeline.
    chain.reverse();
    return construct(LineageResponse, { chain, block_id: blockId });
  });

  /** Stream the WAV for a completed generation — the take-versioning UI plays takes back
   * without re-rendering. Only for generations with an audio_path on disk. */
  app.get("/v1/generations/:generation_id/audio", async (req, reply) => {
    const h = session.getDb();
    const id = req.params.generation_id;
    const gen = genById(h, id);
    if (!gen) throw notFound(`generation ${id}`);
    if (!gen.audio_path) throw badRequest("generation has no audio on disk (status may not be 'completed')");
    const p = mediaFile(gen.audio_path);
    let st;
    try {
      st = statSync(p);
    } catch {
      st = null;
    }
    if (!st?.isFile()) throw notFound(`audio file missing from disk: ${gen.audio_path}`);
    // Starlette's FileResponse: the media type, the length, and an attachment name.
    return reply
      .type("audio/wav")
      .header("content-length", st.size)
      .header("content-disposition", `attachment; filename="${id}.wav"`)
      .send(createReadStream(p));
  });

  /**
   * Render ONE block through the production path (line → speaker → persona: voice + tier-2
   * delivery + the line's own numbers + lexicon) and keep it as the line's new ★ take —
   * Render's ▶ Gen, ↻ and ↻ New take, and the Lines grid's per-row ↻ and 'Re-render N
   * changed'. The take records what it was made from, so the line reads rendered until that
   * changes.
   */
  app.post("/v1/blocks/:block_id/render", { schema: { body: nullable(RenderBlockRequest) } }, async (req, reply) => {
    const h = session.getDb();
    const blockId = req.params.block_id;
    const block = h.one(`select * from ${Block} where id = ? limit 1`, [blockId], Block);
    if (block === null) throw notFound(`block ${blockId}`);
    const persona = personaForBlock(h, block);
    const state = getState();
    // The render rides the scheduler as an interactive single (§7b P2-6 — one synth door) and
    // the endpoint awaits it.
    let voice = null;
    if (persona !== null) {
      const storeP = state.personas.get(persona.id);
      if (storeP !== null) voice = storeP.voice_id || null;
    }
    const engineId = voice ? await voiceModel.modelKey(state, voice) : `?voice:${voice === null ? "None" : voice}`;
    const newTake = Boolean(req.body?.new_take);
    const seed = newTake ? lineTakes.rollSeed() : null;
    const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [block.scene_id], Scene);
    const handle = synthScheduler.getScheduler().submit(
      [[engineId, () => exportVoicelines.renderBlockTake(state, persona, block, { seed })]],
      {
        interactive: true,
        owner: scene !== null ? synthScheduler.chapterOwner(scene) : synthScheduler.workOwner("a line's take"),
      },
    );
    await handle.waitAsync({ signal: clientGone(req, reply) });
    handle.raiseIfFailed();
    const rl = handle.items[0].result;

    const take = renderJobs.persistBlockTake(h, state, block, rl, { newSeed: newTake });
    return _takeOut(h, take);
  });
}
