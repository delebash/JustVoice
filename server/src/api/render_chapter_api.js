// SPDX-License-Identifier: MIT
// POST /v1/render_chapter — multi-line script in, mastered chapter out (the port of
// justvoice/api/render_chapter_api.py).
//
// Two modes:
//   * Direct mode — `lines[]` passed literally (legacy adapter use).
//   * Scene mode — `scene_id` passed; the server resolves blocks → speakers → personas →
//     lines internally (the speaker is who says the line, the persona plays them —
//     2026-09-29). The persona contributes voice_id, default_delivery, voice_instruct (→
//     delivery.instruct for engines that consume it), its effects and lexicon_id. A speaker's
//     "Who they are" never reaches this path. Each line is read with the book's lexicon, then
//     its own persona's (render_core.lineLexicons, 2026-09-30).
//
// PARTIAL — the render wave (wave C) ported the scene path's helpers, which export_audiobook,
// the captions and the render jobs share: `_resolveSceneToLines`, `_join`, `_lineKwargs`,
// `renderSceneLines(Async)`, `playedTexts`, `_lexiconsFor`, `_sceneMasterTarget`,
// `_masterScenePcm`, `renderSceneToWav`, `_sceneOwner`. The API wave adds the routes
// (GET /v1/render/cache-stats, POST /v1/render_chapter, GET /v1/render/master-target) to this
// file.
//
// A chapter line is a `ChapterLine` wire object (snake_case). Calls a test spies on go through
// the module namespaces (render_core.renderLine / concatLines, synth_scheduler.warmLines,
// mastering.*, this module's own `self.`).

import { getLogger } from "@delebash/llm-runner/platform/log";
import { pySorted, strip, truthy } from "@delebash/llm-runner/platform/py";
import * as appState from "../app_state.js";
import { writeWavContainer } from "../audio/wav.js";
import * as session from "../database/session.js";
import { Block, Project, Scene, Speaker } from "../database/models.js";
import { badRequest, internal, notFound } from "../errors.js";
import { leftOutBlocks } from "../extraction/tags.js";
import * as lineTakes from "../line_takes.js";
import * as mastering from "../mastering.js";
import { ChapterLine, construct, Delivery, floatify, modelDump, modelFields } from "../models.js";
import * as renderCore from "../render_core.js";
import { RenderedLine } from "../render_core.js";
import * as synthScheduler from "../synth_scheduler.js";
import * as self from "./render_chapter_api.js";

export const log = getLogger("justvoice.api.render_chapter_api");

/** The app's database; Python's `_open_db` (internal error before boot). */
export function _openDb() {
  if (session.cfg.handle === null) throw internal("database not initialized");
  return session.cfg.handle;
}

// A podcast music/ad direction line — speaker-less by design, so every attribution check skips
// it (line_takes.isMarker).
const _isMarker = (b) => lineTakes.isMarker(b);

const DELIVERY_FIELDS = new Set(modelFields(Delivery));

/** Python's `sorted(set_of_names)`. */
const sortedNames = (set) => pySorted([...set]);

/**
 * Resolve a scene's blocks → ChapterLines: block → speaker → persona (async).
 *
 * Each block becomes one ChapterLine, planned by the one resolver every render path shares
 * (`line_takes.planBlock` over `persona_render.planLine`): the persona's voice, its delivery
 * with that voice's model's own settings, the direction, its language and seed, its effects and
 * lexicon. Each line carries its OWN lexicons (`ChapterLine.lexicons`): the book's, then the
 * persona's that speaks it.
 *
 * `strict` decides what a block with no usable voice means. Real renders pass strict and the
 * chapter REFUSES, naming the offending lines, the speakers no persona plays and the personas
 * with no voice (a line the attribution pipeline couldn't place used to be dropped here in
 * silence). The read-only cache-stats probe passes strict false: "how much is cached" is a
 * question about the renderable lines and it runs on every Home/Studio visit.
 *
 * A line that is only a dialogue tag ("said Marius,") is skipped when the project has
 * Overview's "Leave out dialogue tags" on — here, so chapter audio, the M4B export and the
 * captions all leave out the same lines. Each line carries its `block_id`, so the chapter
 * plays the line's ★ take when it has one (Studio Slice 4, D4). Throws if the scene has no
 * blocks.
 */
export async function _resolveSceneToLines(sceneId, st, { strict = false } = {}) {
  const h = self._openDb();
  const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [sceneId], Scene);
  if (scene === null) throw notFound(`scene ${sceneId}`);
  const blocks = h.all(`select * from ${Block} where scene_id = ? order by position`, [sceneId], Block);
  if (!blocks.length) throw badRequest(`scene ${sceneId} has no blocks to render`);
  const speakers = new Map(h.all(`select * from ${Speaker} where project_id = ?`, [scene.project_id], Speaker).map((s) => [s.id, s]));
  const project = h.one(`select * from ${Project} where id = ? limit 1`, [scene.project_id], Project);
  let leaveOutTags;
  try {
    leaveOutTags = truthy(JSON.parse(project.metadata_json || "{}").leave_out_tags);
  } catch {
    leaveOutTags = false;
  }
  const tagsLeftOut = leaveOutTags ? leftOutBlocks(blocks) : new Set();
  const bookLexicon = project?.default_lexicon_id ?? null;

  const lines = [];
  const played = []; // each line's block, in step with `lines`
  let skipped = 0;
  const unplaced = []; // [1-based line no, block text]
  const uncast = new Set(); // speaker names no persona plays
  const voiceless = new Set(); // persona names with no voice

  for (let i = 0; i < blocks.length; i++) {
    const position = i + 1;
    const block = blocks[i];
    if (!block.text || !strip(block.text) || tagsLeftOut.has(block.id)) continue;

    let voiceId = null;
    let persona = null;
    const speaker = block.speaker_id ? (speakers.get(block.speaker_id) ?? null) : null;
    if (speaker !== null && speaker.persona_id) {
      persona = st.personas.get(speaker.persona_id) ?? null;
      if (persona !== null) voiceId = persona.voice_id;
    }

    if (!voiceId) {
      // No persona / no voice. DEBUG, not WARNING: this resolver also serves the read-only
      // cache-stats probe, which Home/Studio hit on every visit. Under strict the collected
      // rows become the refusal below — EXCEPT markers, which are speaker-less on purpose
      // (podcast music/ad direction lines): counting them as unplaced would refuse every marked
      // episode forever.
      skipped += 1;
      if (_isMarker(block)) {
        /* speaker-less on purpose */
      } else if (speaker === null) unplaced.push([position, strip(block.text)]);
      else if (persona === null) uncast.add(speaker.name);
      else voiceless.add(persona.name);
      log.debug(`scene resolve: block ${block.id} has no voice — excluded`);
      continue;
    }

    // The ONE plan every render path shares (line_takes.planBlock over persona_render.planLine,
    // 2026-10-03): the persona's voice and its model, its delivery with that model's own
    // settings (emotion or tags, knobs, seed), the direction composed most specific last, its
    // language, its effects, and the book's lexicon then its own. The line's own numbers
    // (Slice 4's ⚙ hatch) sit on top and win — pace, pitch, gain and the pause after it (the
    // `pause_after_ms` every import adapter writes; concatLines applies it).
    const plan = await lineTakes.planBlock(st, persona, block, { bookLexicon });
    const delivery = Object.fromEntries(Object.entries(plan.delivery).filter(([k]) => DELIVERY_FIELDS.has(k)));

    lines.push(
      construct(ChapterLine, {
        voice: plan.voice,
        text: plan.text,
        language: plan.language,
        delivery: construct(Delivery, delivery),
        seed: plan.seed,
        effects: plan.effects.length ? plan.effects : null,
        lexicons: plan.lexicons.length ? plan.lexicons : null,
        block_id: block.id,
      }),
    );
    played.push(block);
  }

  if (strict && (unplaced.length || uncast.size || voiceless.size)) {
    const parts = [];
    if (unplaced.length) {
      const shown = unplaced
        .slice(0, 5)
        .map(([n, t]) => `line ${n} (“${[...t].slice(0, 60).join("")}${[...t].length > 60 ? "…" : ""}”)`)
        .join(", ");
      const more = unplaced.length > 5 ? ` and ${unplaced.length - 5} more` : "";
      parts.push(
        `${unplaced.length} line(s) have no speaker: ${shown}${more}. ` +
          "Open Studio · Script and set one on each, or send them all to the narrator.",
      );
    }
    if (uncast.size) {
      parts.push(`${sortedNames(uncast).join(", ")} ${uncast.size === 1 ? "has" : "have"} no persona yet — give them one in Studio · Cast.`);
    }
    if (voiceless.size) parts.push(`The persona ${sortedNames(voiceless).join(", ")} has no voice — pick one on the Personas page.`);
    throw badRequest(`This chapter isn't ready to render. ${parts.join(" ")}`);
  }
  if (skipped && lines.length) {
    log.info(`scene ${sceneId}: ${skipped} of ${skipped + lines.length} blocks have no voice and were excluded`);
  }
  if (!lines.length) {
    throw badRequest(
      `scene ${sceneId} has blocks but none could be rendered (no speaker, persona or voice). ` +
        "Give the lines speakers in Script and the speakers personas in Cast.",
    );
  }

  // A line that ends one of the book's scenes is followed by Settings' pause at a scene break
  // (2026-10-06); one whose next line is in the same paragraph, by the pause within a paragraph
  // (2026-10-07) — unless it has a pause of its own, which wins.
  const ends = lineTakes.sceneEnds(played);
  const joins = lineTakes.paragraphJoins(played);
  lines.forEach((line, i) => {
    const block = played[i];
    if ("pause_after_ms" in lineTakes.lineOverride(block)) return;
    if (ends.has(block.id)) line.scene_break_after = true;
    else if (joins.has(block.id)) line.paragraph_next = true;
  });
  return lines;
}

/** The chapter's lines as one audio, `gapMs` apart (async) — Settings' pause at a scene break
 * after a line that ends one of the book's scenes (2026-10-06), and its pause within a paragraph
 * between two lines of one paragraph (2026-10-07). Those pauses are set on the rendered line
 * here, never in its delivery: the delivery is in the line's audio key (`render_core._inputsKey`),
 * so changing a setting would make those lines stale and render them again. A copy, so a cached
 * line is never changed. */
export async function _join(st, lines, rendered, gapMs) {
  const gen = st.settings.get().generation;
  const own = (line) => {
    if (line.scene_break_after) return gen.pause_at_scene_break_ms;
    if (line.paragraph_next) return gen.pause_within_paragraph_ms;
    return null;
  };
  const joined = lines.map((line, i) => {
    const rl = rendered[i];
    const pause = own(line);
    return pause != null ? new RenderedLine({ ...rl, effectiveDelivery: { ...(rl.effectiveDelivery || {}), pause_after: pause } }) : rl;
  });
  return renderCore.concatLines(joined, gapMs);
}

/** A line's delivery as render_core reads it: `line.delivery.model_dump(exclude_none=True)`,
 * its floats PyFloats again (they are in the cache key). */
export function _deliveryOf(line) {
  return line.delivery ? floatify(Delivery, modelDump(Delivery, line.delivery, { excludeNone: true })) : null;
}

/** renderLine's options for one chapter line. */
export function _lineKwargs(line, cacheScope, requestLexicons = null) {
  return {
    voice: line.voice,
    text: line.text,
    language: line.language,
    delivery: _deliveryOf(line),
    seed: line.seed,
    lexicons: _lexiconsFor(line, requestLexicons),
    effects: line.effects,
    cacheScope,
    useCache: true,
  };
}

/** {block_id → [generation id, audio_path, text]} — the lines that play their ★ take (D4). */
export function _takesFor(lines) {
  const ids = lines.filter((l) => l.block_id).map((l) => l.block_id);
  if (!ids.length) return new Map();
  const gens = lineTakes.playedTakes(self._openDb(), ids);
  return new Map([...gens].map(([bid, g]) => [bid, [g.id, g.audio_path, g.text]]));
}

/** The chapter a render is for, as the queue names it — "2 · Bigger Inside" (2026-10-07);
 * lines sent without a chapter are "a chapter render". */
export function _sceneOwner(sceneId) {
  if (sceneId) {
    const scene = self._openDb().one(`select * from ${Scene} where id = ? limit 1`, [sceneId], Scene);
    if (scene !== null) return synthScheduler.chapterOwner(scene);
  }
  return synthScheduler.workOwner("a chapter render");
}

/** A line's ★ take as a rendered line, its pauses from the line as it is now (they join takes;
 * they are not in them). */
function _takeLine(line, audioPath) {
  const got = lineTakes.readTakeWav(audioPath);
  if (got === null) return null;
  const [pcm, sr, ch] = got;
  return new RenderedLine({ pcm, sampleRate: sr, channels: ch, effectiveDelivery: _deliveryOf(line) || {} });
}

/** The chapter's lines as audio (async): a line's ★ take where it has one, the rest rendered as
 * before — through the cache, warmed model by model first. `owner` names the chapter in the
 * queue (`synthScheduler.ahead`); `signal` aborts the warm (a client disconnect). */
export async function renderSceneLinesAsync(st, lines, kwargs, { owner = null, signal = null } = {}) {
  const takes = _takesFor(lines);
  const played = new Map();
  lines.forEach((line, i) => {
    if (takes.has(line.block_id)) {
      const rl = _takeLine(line, takes.get(line.block_id)[1]);
      if (rl !== null) played.set(i, rl);
    }
  });
  await synthScheduler.warmLines(
    st,
    kwargs.filter((_, i) => !played.has(i)),
    { owner, signal },
  );
  const out = [];
  for (let i = 0; i < kwargs.length; i++) out.push(played.has(i) ? played.get(i) : await renderCore.renderLine(st, kwargs[i]));
  return out;
}

/** `renderSceneLinesAsync` without the warm — what the export, QC and captions call. */
export async function renderSceneLines(st, lines, kwargs) {
  const takes = _takesFor(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const rl = takes.has(line.block_id) ? _takeLine(line, takes.get(line.block_id)[1]) : null;
    out.push(rl !== null ? rl : await renderCore.renderLine(st, kwargs[i]));
  }
  return out;
}

/** What each line says in the chapter's audio — a take's own words where the line plays one (a
 * stale take still says its old words). Captions read it. */
export function playedTexts(lines) {
  const takes = _takesFor(lines);
  return lines.map((line) => (takes.has(line.block_id) ? takes.get(line.block_id)[2] : line.text));
}

/** The lexicons one line renders with: its own (the book's, then its persona's), then the
 * request's — direct-mode callers name theirs on the request. In that order, so the book's
 * still wins. */
export function _lexiconsFor(line, requestLexicons = null) {
  const out = [];
  for (const lid of [...(line.lexicons || []), ...(requestLexicons || [])]) if (!out.includes(lid)) out.push(lid);
  return out;
}

/** The mastering preset a scene render applies, and why → `[preset, source]`. Walks request →
 * the project's `mastering_preset` → the project kind's default. One door, so the Render tab's
 * pill, the render itself and the ACX QC measurement can never disagree. */
export function _sceneMasterTarget(sceneId, requested) {
  const h = self._openDb();
  const scene = h.one(`select * from ${Scene} where id = ? limit 1`, [sceneId], Scene);
  const project = scene !== null ? h.one(`select * from ${Project} where id = ? limit 1`, [scene.project_id], Project) : null;
  return mastering.resolveMasterTarget({
    requested,
    projectMaster: project?.mastering_preset ?? null,
    projectType: project?.project_type ?? null,
  });
}

/**
 * `[wavBytes, appliedPreset, fallbackReason]` for a scene render (async). Scene renders are
 * monitors, not deliverables: the preset's PROCESSING is applied (that is what decides whether
 * a chapter passes ACX) but the bytes come back as WAV. The encoded deliverable comes from the
 * export path, so an .m4b carries exactly one lossy generation. Without ffmpeg the render still
 * happens — raw, and saying so.
 */
export async function _masterScenePcm(combined, target) {
  const st = appState.getState();
  const raw = writeWavContainer(combined.pcm, combined.sampleRate, combined.channels);
  if (!target) return [raw, null, null];
  if (!mastering.haveFfmpeg()) {
    log.warning(`render_chapter: ${target} mastering skipped — ffmpeg is not installed`);
    return [raw, null, "ffmpeg-missing"];
  }
  let wav;
  try {
    wav = await mastering.masterToWav(combined.pcm, combined.sampleRate, combined.channels, {
      presetName: target,
      presets: st.settings.get().mastering,
    });
  } catch (e) {
    throw internal(`mastering: ${e?.message ?? e}`);
  }
  return [wav, target, null];
}

/**
 * Scene → chapter WAV bytes for audiobook assembly and ACX QC (async). Same resolution + render
 * path as scene-mode /v1/render_chapter: each line's ★ take where it has one, the rest rendered
 * through the cache. The project's mastering target is applied here, in the WAV domain, because
 * both callers need it: the .m4b export ships this audio, and ACX QC has to MEASURE what ships.
 * Without ffmpeg the audio comes back raw; the QC reports that.
 *
 * `strict` defaults to true because the caller that matters is the M4B export: shipping a book
 * with lines silently missing is the thing the refusal exists to prevent. ACX QC passes strict
 * false — it MEASURES.
 */
export async function renderSceneToWav(st, sceneId, { strict = true, master = true } = {}) {
  const lines = await self._resolveSceneToLines(sceneId, st, { strict });
  // Each line's ★ take where it has one (Studio Slice 4, D4) — what the chapter plays is what
  // ships and what QC measures.
  const rendered = await renderSceneLines(
    st,
    lines,
    lines.map((line) => _lineKwargs(line, `scene:${sceneId}`)),
  );
  // The same gap Studio's Render uses (was a hardcoded 600 until 2026-09-29).
  const combined = await self._join(st, lines, rendered, st.settings.get().generation.pause_between_lines_ms);
  const target = master ? self._sceneMasterTarget(sceneId, null)[0] : null;
  const [wav] = await self._masterScenePcm(combined, target);
  return wav;
}
