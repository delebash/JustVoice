// SPDX-License-Identifier: MIT
// A line's takes — its own numbers, what its ★ take was made from, whether it is stale, and
// the take's audio (Studio Slice 4, decided 2026-10-04; docs/plans/2026-10-04-slice-4-render.md)
// — the port of justvoice/line_takes.py.
//
// A take is a kept render of one line. Every render makes a new one and nothing is
// overwritten; the ★ (default) take is what the chapter plays and the export ships (D4). A
// take records its audio, the seed it was made with and its inputs key
// (`render_core.lineInputsKey` — the render cache's key). The line is STALE when the key of
// what it is made from now differs from the ★ take's: its words, its direction or its own
// numbers, the persona (voice, delivery, seed, effects), or a lexicon entry that respells its
// words.
//
// "↻ New take" rolls the take its own seed (`Generation.source` "new_take") and the take is
// judged against that seed. Any other take is judged against the persona's seed now, so
// changing the persona's seed marks those lines stale (G1). A take with no recorded key or no
// audio — one made before this slice — reads stale (G10).
//
// The line's own numbers (D3) live in the block's metadata beside the imported
// `pause_after_ms`, so no data reset is needed; for this line they win over the persona's, an
// imported pause included (G7).
//
// Database functions take the handle (`h`, the kit's sql.js) where Python took a session; rows
// are the tables' own columns. The ones that resolve a voice are async (planBlock, planKey,
// takeIsCurrent, sceneLines, projectRenderState); the rest are synchronous.

import { randomInt } from "node:crypto";
import { readFileSync, rmSync, statSync } from "node:fs";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { strip, truthy, ValueError } from "@delebash/llm-runner/platform/py";
import { pyFloat, pyFloatValue } from "@delebash/llm-runner/platform/pyjson";
import { parseWavHeader } from "./audio/wav.js";
import * as session from "./database/session.js";
import { Block, Generation, Project, Scene, Speaker, Take } from "./database/models.js";
import { notFound } from "./errors.js";
import { spokenBlock } from "./extraction/flags.js";
import { leftOutBlocks } from "./extraction/tags.js";
import * as mediaPaths from "./media_paths.js";
import { pyJsonParse } from "./models.js";
import * as personaRender from "./persona_render.js";
import * as renderCore from "./render_core.js";
import { num, pyLen, toFloat, toInt } from "./render_core.js";

export const log = getLogger("justvoice.line_takes");

// Metadata key → delivery key. `pause_after_ms` is the field every import adapter already
// writes.
export const OVERRIDE_FIELDS = { speed: "speed", pitch: "pitch", gain_db: "gain_db", pause_after_ms: "pause_after" };
// The limits the hatch's fields keep to — the persona page's own ranges. (Floats where Python
// wrote floats: they are named in the refusal as Python prints them.)
export const OVERRIDE_LIMITS = {
  speed: [0.5, 2.0],
  pitch: [-12.0, 12.0],
  gain_db: [-12.0, 12.0],
  pause_after_ms: [0, 10_000],
};
// What a line sets that only one MODEL understands — its emotion, a tag model's register, the
// model's own knobs — kept per model under this metadata key, the shape of a persona's
// `PersonaModelSettings` (decided 2026-10-06: Render works like the persona page).
// `emotion: ""` = none on this line.
export const LINE_MODELS = "line_models";
const _WORD_FIELDS = ["emotion", "register_tag"];

export const CHAPTER_RENDER = "chapter_render"; // made with the persona's seed
export const NEW_TAKE = "new_take"; // ↻ New take: a seed of its own
export const TAKE_SOURCES = [CHAPTER_RENDER, NEW_TAKE];

// §8.16's words, the order Render shows them in.
export const STATES = ["needs a speaker", "needs a voice", "ready", "rendered", "stale"];

const isDict = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// ── The line's own numbers (D3) ──────────────────────────────────────

/** The block's metadata as a dict ({} when there is none, or it is not a JSON object). Floats
 * stay PyFloats, so the metadata written back keeps Python's "1.0". */
export function blockMeta(block) {
  let meta;
  try {
    meta = pyJsonParse(block?.metadata_json || "{}");
  } catch {
    return {};
  }
  return isDict(meta) ? meta : {};
}

/** A podcast music/ad direction line — speaker-less by design, never heard. */
export function isMarker(block) {
  return truthy(num(blockMeta(block).marker));
}

/** The book's scene a line came from: the `#scene:<id>` in its `source_ref`, which the
 * JustWrite import writes on every line. null for any other line. */
function _bookScene(block) {
  const ref = blockMeta(block).source_ref;
  if (typeof ref !== "string" || !ref.includes("#scene:")) return null;
  const rest = ref.slice(ref.indexOf("#scene:") + "#scene:".length);
  const cut = rest.indexOf("#");
  return cut < 0 ? rest : rest.slice(0, cut);
}

/**
 * The ids of the lines whose next heard line comes from the same paragraph — both carry the
 * same `source_ref` (the JustWrite import's `…#block:<n>`; Analyze gives every line it cuts
 * from one paragraph that paragraph's). They join with Settings' pause within a paragraph,
 * closer than lines of two paragraphs (decided 2026-10-07: a quote · tag · quote cut into three
 * lines joined at ~1.5 s each). A line with no `source_ref` joins as any other. `blocks` in
 * chapter order — the lines that are heard. A Set.
 */
export function paragraphJoins(blocks) {
  const out = new Set();
  for (let i = 0; i + 1 < blocks.length; i++) {
    const ref = blockMeta(blocks[i]).source_ref;
    if (typeof ref === "string" && ref && ref === blockMeta(blocks[i + 1]).source_ref) out.add(blocks[i].id);
  }
  return out;
}

/**
 * The ids of the lines that end one of the book's scenes inside a chapter (decided
 * 2026-10-06: a pause at a scene break). A JustWrite chapter keeps its scenes as runs of
 * lines; a scene ends where the next line names another scene. Found by the label CHANGING,
 * never by a flag on the last line: Analyze gives every line it cuts from one paragraph that
 * paragraph's label, and a line split off, typed in or written by ✎ Edit text has none — it
 * runs on in the scene before it. The chapter's last line ends no scene here: the chapter ends
 * there. `blocks` in chapter order — the lines that are heard. A Set.
 */
export function sceneEnds(blocks) {
  const ends = new Set();
  let current = null;
  let prev = null;
  for (const block of blocks) {
    const scene = _bookScene(block);
    if (scene !== null) {
      if (current !== null && scene !== current && prev !== null) ends.add(prev.id);
      current = scene;
    }
    prev = block;
  }
  return ends;
}

/** What this line sets for itself: {speed, pitch, gain_db, pause_after_ms}, set ones only, and
 * `models` — its per-model settings — when it has any. (speed / pitch / gain_db are floats —
 * PyFloats; pause_after_ms a whole number.) */
export function lineOverride(block) {
  const meta = blockMeta(block);
  const out = {};
  for (const key of Object.keys(OVERRIDE_FIELDS)) {
    const raw = meta[key];
    if (raw == null) continue;
    try {
      out[key] = key === "pause_after_ms" ? Math.max(0, toInt(raw)) : pyFloatValue(toFloat(raw));
    } catch (e) {
      if (e instanceof TypeError || e instanceof ValueError) continue;
      throw e;
    }
  }
  const models = lineModels(block);
  if (Object.keys(models).length) out.models = models;
  return out;
}

/** The line's settings per model: {model: {knobs?, emotion?, register_tag?}}, set ones only
 * (knob values are floats — PyFloats). */
export function lineModels(block) {
  const raw = blockMeta(block)[LINE_MODELS];
  if (!isDict(raw)) return {};
  const out = {};
  for (const [model, s] of Object.entries(raw)) {
    if (!isDict(s)) continue;
    const entry = {};
    const knobs = {};
    for (const [k, v] of Object.entries(truthy(s.knobs) && isDict(s.knobs) ? s.knobs : {})) {
      try {
        knobs[String(k)] = pyFloatValue(toFloat(v));
      } catch (e) {
        if (e instanceof TypeError || e instanceof ValueError) continue;
        throw e;
      }
    }
    if (Object.keys(knobs).length) entry.knobs = knobs;
    for (const key of _WORD_FIELDS) if (typeof s[key] === "string") entry[key] = s[key];
    if (Object.keys(entry).length) out[String(model)] = entry;
  }
  return out;
}

/** The line's numbers, delivery-shaped — `planLine`'s request, which wins over the persona.
 * (Its per-model settings go to `planLine` on their own — `lineModels`.) */
export function overrideDelivery(block) {
  const out = {};
  for (const [k, v] of Object.entries(lineOverride(block))) if (Object.hasOwn(OVERRIDE_FIELDS, k)) out[OVERRIDE_FIELDS[k]] = v;
  return out;
}

/** How Python prints a limit: `str(0.5)`, `str(-12.0)`, `str(10000)`. */
const limitText = (key, v) => (key === "pause_after_ms" ? String(v) : pyFloat(v));

/**
 * PATCH semantics for the hatch: a value sets, null clears, a key left out is kept. `models`
 * merges the same way, a level down ({model: {knobs: {k: v}, emotion, register_tag}}; a model
 * or `models` itself sent as null clears it). Throws ValueError naming the field when a value
 * is out of range. The numbers it sets are PyFloats where Python stored floats.
 */
export function mergeOverride(meta, patch) {
  const out = { ...meta };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "models") {
      const merged = _mergeModels(out[LINE_MODELS] || {}, value);
      if (Object.keys(merged).length) out[LINE_MODELS] = merged;
      else delete out[LINE_MODELS];
      continue;
    }
    if (!Object.hasOwn(OVERRIDE_FIELDS, key)) {
      throw new ValueError(`unknown field ${personaRender.pyReprStr(key)} — a line can set ${[...Object.keys(OVERRIDE_FIELDS), "models"].join(", ")}`);
    }
    if (value == null) {
      delete out[key];
      continue;
    }
    const [lo, hi] = OVERRIDE_LIMITS[key];
    let n;
    try {
      n = key === "pause_after_ms" ? toInt(value) : toFloat(value);
    } catch (e) {
      if (e instanceof TypeError || e instanceof ValueError) throw new ValueError(`${key} must be a number`);
      throw e;
    }
    if (!(lo <= n && n <= hi)) throw new ValueError(`${key} must be between ${limitText(key, lo)} and ${limitText(key, hi)}`);
    out[key] = key === "pause_after_ms" ? n : pyFloatValue(n);
  }
  return out;
}

function _mergeModels(current, patch) {
  if (patch == null) return {};
  if (!isDict(patch)) throw new ValueError("models must be an object of {model: settings}");
  const out = {};
  for (const [m, s] of Object.entries(isDict(current) ? current : {})) if (isDict(s)) out[m] = { ...s };
  for (const [model, s] of Object.entries(patch)) {
    if (s == null) {
      delete out[model];
      continue;
    }
    if (!isDict(s)) throw new ValueError(`models.${model} must be an object`);
    const entry = Object.hasOwn(out, model) ? out[model] : {};
    for (const [key, value] of Object.entries(s)) {
      if (key === "knobs") {
        const knobs = { ...(truthy(entry.knobs) ? entry.knobs : {}) };
        for (const [k, v] of Object.entries(truthy(value) ? value : {})) {
          if (v == null) {
            delete knobs[k];
            continue;
          }
          try {
            knobs[String(k)] = pyFloatValue(toFloat(v));
          } catch (e) {
            if (e instanceof TypeError || e instanceof ValueError) throw new ValueError(`${model}'s ${k} must be a number`);
            throw e;
          }
        }
        if (Object.keys(knobs).length) entry.knobs = knobs;
        else delete entry.knobs;
      } else if (_WORD_FIELDS.includes(key)) {
        if (value == null) delete entry[key];
        else if (typeof value === "string" && pyLen(value) <= 60) entry[key] = strip(value);
        else throw new ValueError(`${model}'s ${key} must be a short word`);
      } else {
        throw new ValueError(`unknown setting ${personaRender.pyReprStr(key)} for ${model} — a line can set knobs, emotion, register_tag`);
      }
    }
    if (Object.keys(entry).length) out[model] = entry;
    else delete out[model];
  }
  return out;
}

// ── What a line is made from ─────────────────────────────────────────

/** The one plan for a line, for every door that renders or judges one (async):
 * `persona_render.planLine` with the line's own numbers as the request (they win over the
 * persona's) and, for ↻ New take, its own seed. */
export async function planBlock(state, persona, block, { bookLexicon = null, seed = null } = {}) {
  const request = overrideDelivery(block);
  if (seed != null) request.seed = seed;
  return personaRender.planLine(state, persona, {
    text: block.text,
    direction: block.direction ?? null,
    bookLexicon,
    requestDelivery: request,
    lineModels: lineModels(block),
  });
}

/** The inputs key of a plan — what a take made from it now would record (async). */
export async function planKey(state, plan) {
  if (!plan.voice) return null;
  return renderCore.lineInputsKey(state, plan.voice, plan.text, {
    language: plan.language,
    delivery: plan.delivery,
    seed: plan.seed,
    lexicons: plan.lexicons,
    effects: plan.effects,
  });
}

/** A fresh seed for ↻ New take. */
export function rollSeed() {
  return randomInt(0, 2 ** 31 - 2) + 1;
}

// ── A take's audio ───────────────────────────────────────────────────

/** `[pcm, sampleRate, channels]` of a take's stored WAV, or null when there is none on disk. */
export function readTakeWav(audioPath) {
  if (!audioPath) return null;
  let raw;
  try {
    raw = readFileSync(mediaPaths.mediaFile(audioPath));
  } catch {
    return null;
  }
  try {
    const [fmt, offset, size] = parseWavHeader(raw);
    return [raw.subarray(offset, offset + size), fmt.sampleRate, fmt.channels];
  } catch {
    log.warning(`take audio unreadable: ${audioPath}`);
    return null;
  }
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export function hasAudio(gen) {
  return Boolean(gen != null && gen.audio_path && isFile(mediaPaths.mediaFile(gen.audio_path)));
}

const marks = (n) => Array(n).fill("?").join(", ");

/** {block_id → [★ take, its generation]} for the blocks that have one (a Map). */
export function liveTakes(h, blockIds) {
  const ids = [...blockIds];
  if (!ids.length) return new Map();
  const takes = h.all(`select * from ${Take} where block_id in (${marks(ids.length)}) and is_default = 1 order by created_at`, ids, Take);
  const genIds = takes.map((t) => t.generation_id);
  const gens = new Map();
  if (takes.length) {
    for (const g of h.all(`select * from ${Generation} where id in (${marks(genIds.length)})`, genIds, Generation)) gens.set(g.id, g);
  }
  const out = new Map();
  for (const t of takes) {
    // newest last, so a block left with two defaults reads its newest
    const g = gens.get(t.generation_id);
    if (g !== undefined) out.set(t.block_id, [t, g]);
  }
  return out;
}

/** {block_id → generation} for the lines whose ★ take the chapter plays — those with audio (a
 * Map). */
export function playedTakes(h, blockIds) {
  const out = new Map();
  for (const [bid, [, g]] of liveTakes(h, blockIds)) if (hasAudio(g)) out.set(bid, g);
  return out;
}

// ── States ───────────────────────────────────────────────────────────

/** Was the ★ take made from what the line is made from now? (async) */
export async function takeIsCurrent(state, persona, block, gen, { bookLexicon = null } = {}) {
  if (gen == null || !gen.cache_key || !hasAudio(gen)) return false;
  const seed = gen.source === NEW_TAKE ? gen.seed : null;
  let key;
  try {
    key = await planKey(state, await planBlock(state, persona, block, { bookLexicon, seed }));
  } catch (e) {
    // an unresolvable voice, a lexicon gone — not current
    log.debug(`block ${block.id}: inputs key failed: ${e?.message ?? e}`);
    return false;
  }
  return Boolean(key) && key === gen.cache_key;
}

/** `[line number, block]` for a chapter's lines that are heard — text, not a podcast marker,
 * not a dialogue tag the book leaves out. The number is the block's place in the chapter, the
 * one the render's refusal names. */
export function heardBlocks(h, scene, project) {
  const blocks = h.all(`select * from ${Block} where scene_id = ? order by position`, [scene.id], Block);
  let leaveOut;
  try {
    leaveOut = truthy(JSON.parse(project?.metadata_json || "{}").leave_out_tags);
  } catch {
    leaveOut = false;
  }
  const leftOut = leaveOut ? leftOutBlocks(blocks) : new Set();
  const out = [];
  blocks.forEach((b, i) => {
    if (strip(b.text || "") && !leftOut.has(b.id) && !isMarker(b)) out.push([i + 1, b]);
  });
  return out;
}

/** Render's line page for one chapter: each heard line with its state, its ★ take and its
 * number of takes, and the chapter's counts (async; a wire dict). */
export async function sceneLines(h, state, sceneId) {
  const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [sceneId], Scene);
  if (scene === null) throw notFound(`scene ${sceneId}`);
  const project = h.one(`select * from ${Project} where id = ? limit 1`, [scene.project_id], Project);
  const speakers = new Map(h.all(`select * from ${Speaker} where project_id = ?`, [scene.project_id], Speaker).map((s) => [s.id, s]));
  const bookLexicon = project?.default_lexicon_id ?? null;
  const heard = heardBlocks(h, scene, project);
  const ids = heard.map(([, b]) => b.id);
  const live = liveTakes(h, ids);
  const countsByBlock = new Map();
  if (ids.length) {
    for (const r of h.all(`select block_id from ${Take} where block_id in (${marks(ids.length)})`, ids)) {
      countsByBlock.set(r.block_id, (countsByBlock.get(r.block_id) ?? 0) + 1);
    }
  }
  const ends = sceneEnds(heard.map(([, b]) => b));
  const joins = paragraphJoins(heard.map(([, b]) => b));
  const rows = [];
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const [n, block] of heard) {
    const speaker = block.speaker_id ? (speakers.get(block.speaker_id) ?? null) : null;
    const persona = speaker !== null && speaker.persona_id ? state.personas.get(speaker.persona_id) : null;
    const [take, gen] = live.get(block.id) ?? [null, null];
    let st;
    if (speaker === null) st = "needs a speaker";
    else if (persona == null || !persona.voice_id) st = "needs a voice";
    else if (take === null) st = "ready";
    else if (await takeIsCurrent(state, persona, block, gen, { bookLexicon })) st = "rendered";
    else st = "stale";
    counts[st] += 1;
    rows.push({
      block_id: block.id,
      n,
      text: block.text,
      speaker_id: block.speaker_id,
      spoken: spokenBlock(block.source, block.text),
      direction: block.direction || "",
      override: lineOverride(block),
      scene_end: ends.has(block.id),
      paragraph_next: joins.has(block.id) && !ends.has(block.id),
      state: st,
      takes: countsByBlock.get(block.id) ?? 0,
      live: take !== null ? _takeSummary(take, gen) : null,
    });
  }
  return { scene_id: scene.id, title: scene.title || "", position: scene.position, lines: rows, counts: _countsOut(counts) };
}

const COUNT_KEYS = ["needs_speaker", "needs_voice", "ready", "rendered", "stale"];

/** Every chapter's counts in §8.16's words — Render's grid, Studio's step card, Overview and
 * Home (async; a wire dict). */
export async function projectRenderState(h, state, projectId) {
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
  const chapters = [];
  const total = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const scene of scenes) {
    const c = (await sceneLines(h, state, scene.id)).counts;
    chapters.push({ scene_id: scene.id, title: scene.title || "", ...c });
    STATES.forEach((s, i) => {
      total[s] += c[COUNT_KEYS[i]];
    });
  }
  return { project_id: projectId, chapters, totals: _countsOut(total) };
}

function _countsOut(c) {
  return {
    lines: Object.values(c).reduce((a, b) => a + b, 0),
    needs_speaker: c["needs a speaker"],
    needs_voice: c["needs a voice"],
    ready: c.ready,
    rendered: c.rendered,
    stale: c.stale,
  };
}

function _takeSummary(take, gen) {
  return {
    take_id: take.id,
    generation_id: take.generation_id,
    seconds: gen != null ? gen.duration_sec : null,
    audio_url: hasAudio(gen) ? `/v1/generations/${gen.id}/audio` : null,
    label: take.label,
    new_seed: Boolean(gen != null && gen.source === NEW_TAKE),
    text: gen != null ? gen.text : null,
  };
}

// ── A take's audio goes with it ──────────────────────────────────────

/** A take's generation row and its file. */
export function deleteGeneration(h, gen) {
  if (gen.audio_path) {
    try {
      rmSync(mediaPaths.mediaFile(gen.audio_path), { force: true });
    } catch (e) {
      log.warning(`generation ${gen.id}: could not delete ${gen.audio_path}: ${e?.message ?? e}`);
    }
  }
  h.delete(Generation, { id: gen.id });
}

/** Generations a deleted take left behind — a take goes by FK cascade with its line, chapter
 * or book, and its generation (SET NULL) stayed, file and all. Called after those deletes and
 * at boot. Returns how many went. */
export function sweepOrphanTakes(h) {
  const orphans = h.all(
    `select * from ${Generation} where source in (${marks(TAKE_SOURCES.length)}) and id not in (select generation_id from ${Take})`,
    TAKE_SOURCES,
    Generation,
  );
  if (orphans.length) h.tx(() => orphans.forEach((g) => deleteGeneration(h, g)));
  return orphans.length;
}

/** `sweepOrphanTakes` on the app's database — for callers holding no handle (boot). */
export function sweepOrphanTakesNow() {
  if (session.cfg.handle === null) return 0;
  try {
    return sweepOrphanTakes(session.cfg.handle);
  } catch (e) {
    log.warning(`take sweep failed: ${e?.message ?? e}`);
    return 0;
  }
}
