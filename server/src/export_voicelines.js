// SPDX-License-Identifier: MIT
// Game voiceline export — per-line WAVs named by stable line id + manifest (the port of
// justvoice/export_voicelines.py).
//
// The game build consumes audio BY LINE ID (mock #game/6, CONCEPTS §1):
//     EmberfallVO/
//       q01-ashfall/
//         Q01_HALE_001.wav
//         ...
//       manifest.json        ← one diffable entry per line
//
// Rendering reuses the production scene resolution (persona → voice / delivery / lexicon,
// after the book's own lexicon), one line at a time so each WAV is exactly one block. A line
// with a ★ take ships that take, and the manifest says the take's words (Studio Slice 4, D4 —
// the ★ take is what exports); the rest render as before.
//
// `renderBlockTake` is also THE single-line door (a take, Lines ↻, render jobs): every one of
// them plans the line with line_takes.planBlock and renders it through render_core.renderLine.

import { createHash } from "node:crypto";
import { pyRound } from "@delebash/llm-runner/platform/py";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { personaForBlock } from "./api/_speaker_helpers.js";
import { parseWavHeader, writeWavContainer } from "./audio/wav.js";
import * as session from "./database/session.js";
import { Block, Project, Scene, Speaker } from "./database/models.js";
import { badRequest } from "./errors.js";
import * as lineTakes from "./line_takes.js";
import * as renderCore from "./render_core.js";
import * as self from "./export_voicelines.js";
import * as voiceModel from "./voice_model.js";

export function _slug(text, fallback = "scene") {
  const s = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

export function _lineId(block, sceneIdx, pos) {
  if (block.metadata_json) {
    try {
      const ref = JSON.parse(block.metadata_json)?.source_ref;
      if (ref) return String(ref);
    } catch {
      /* not JSON */
    }
  }
  return `s${String(sceneIdx + 1).padStart(2, "0")}_l${String(pos + 1).padStart(3, "0")}`;
}

/** A WAV's length in seconds (Python's `wave`: frames / rate). */
export function _wavDurationS(wav) {
  const [fmt] = parseWavHeader(wav);
  return fmt.sampleCount / (fmt.sampleRate || 1);
}

/**
 * Render every block to its own WAV; return the zip bytes (async).
 *
 * `renderBlockFn(state, persona, block) → WAV bytes` is the test seam; production renders
 * through render_core.renderLine + the persona's delivery and the line's lexicons, matching the
 * Studio render path.
 */
export async function exportVoicelines(state, projectId, { renderBlockFn = null } = {}) {
  const render = renderBlockFn ?? self._renderBlockProduction;
  const h = session.getDb();
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
  const manifest = [];
  const files = [];
  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const group = _slug(scene.title || `scene-${si + 1}`);
    const blocks = h.all(`select * from ${Block} where scene_id = ? order by position`, [scene.id], Block);
    const takes = lineTakes.playedTakes(
      h,
      blocks.map((b) => b.id),
    );
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const speaker = block.speaker_id ? h.get(Speaker, block.speaker_id) : null;
      const persona = personaForBlock(h, block);
      const lid = _lineId(block, si, bi);
      const gen = takes.get(block.id) ?? null;
      const audio = gen !== null ? lineTakes.readTakeWav(gen.audio_path) : null;
      let wav;
      let text;
      if (audio !== null) {
        wav = writeWavContainer(...audio);
        text = gen.text || block.text;
      } else {
        wav = await render(state, persona, block);
        text = block.text;
      }
      const p = `${group}/${lid}.wav`;
      files.push([p, wav]);
      manifest.push({
        line_id: lid,
        scene: scene.title,
        speaker: speaker ? speaker.name : null,
        text,
        file: p,
        // round(…, 3) is a float in Python — "1.0", not "1"
        duration_s: pyFloatValue(pyRound(_wavDurationS(wav), 3)),
        text_hash: createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16),
      });
    }
  }
  files.push(["manifest.json", `${pyJson(manifest, { indent: 2, ensureAscii: false })}\n`]);
  const zip = new ZipWriter();
  for (const [name, data] of files) zip.writestr(name, data);
  return zip.toBuffer();
}

/** The lexicon chosen for the book this scene belongs to (Overview → Pronunciation lexicon). */
export function _bookLexiconId(sceneId) {
  const row = session
    .getDb()
    .one(
      `select ${Project}.default_lexicon_id from ${Project} join ${Scene} on ${Scene}.project_id = ${Project}.id where ${Scene}.id = ? limit 1`,
      [sceneId],
    );
  return row ? row.default_lexicon_id : null;
}

/**
 * One block → one rendered line (`render_core.RenderedLine`) through the production render
 * path — what a take keeps (Studio Slice 4). Async.
 *
 * The same plan the chapter render uses (line_takes.planBlock, over persona_render.planLine,
 * 2026-10-03): the persona's voice and model settings, the direction — its standing delivery,
 * emotion and the block's own — the line's own numbers, its language and seed, its effects,
 * and the book's lexicon then its own. `seed` is ↻ New take's own; `useCache: false` renders
 * past the cache ("↻ Re-render all"). `persona` is the persona ROW (`personaForBlock`) or any
 * `{id, name}`.
 */
export async function renderBlockTake(state, persona, block, { seed = null, useCache = true } = {}) {
  const storeP = persona != null ? state.personas.get(persona.id) : null;
  if (storeP == null || !storeP.voice_id) {
    const who = persona != null ? `the persona ${persona.name}` : "no persona";
    throw badRequest(`line ${block.id} has no voice (${who}) — give every speaker a persona with a voice before exporting`);
  }
  const plan = await lineTakes.planBlock(state, storeP, block, { bookLexicon: self._bookLexiconId(block.scene_id), seed });
  return renderCore.renderLine(state, {
    voice: plan.voice,
    text: plan.text,
    language: plan.language,
    delivery: plan.delivery,
    seed: plan.seed,
    lexicons: plan.lexicons,
    effects: plan.effects,
    cacheScope: `scene:${block.scene_id}`,
    useCache,
  });
}

/** One block → one WAV through the production render path (the game export, Lines ↻):
 * `renderBlockTake`, as a WAV (async). */
export async function _renderBlockProduction(state, persona, block) {
  const rl = await self.renderBlockTake(state, persona, block);
  return writeWavContainer(rl.pcm, rl.sampleRate, rl.channels);
}

/**
 * `[engineKey, render-callable]` per voiced block in scene order — the whole-project warm set
 * for the scheduler (§7 of the 2026-08-08 plan). Returns [] the moment an unvoiced block
 * appears: the export loop throws on that block, so warming past it would render audio the
 * export never reaches. Lines that ship their ★ take need no render and aren't warmed. Async.
 */
export async function collectBlockSpecs(state, projectId) {
  const h = session.getDb();
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
  const specs = [];
  for (const scene of scenes) {
    const blocks = h.all(`select * from ${Block} where scene_id = ? order by position`, [scene.id], Block);
    const taken = lineTakes.playedTakes(
      h,
      blocks.map((b) => b.id),
    );
    for (const block of blocks) {
      if (taken.has(block.id)) continue;
      const persona = personaForBlock(h, block);
      let voice = null;
      if (persona !== null) {
        const storeP = state.personas.get(persona.id);
        if (storeP != null) voice = storeP.voice_id || null;
      }
      if (!voice) return [];
      const engineId = await voiceModel.modelKey(state, voice);
      specs.push([engineId, () => self._renderBlockProduction(state, persona, block)]);
    }
  }
  return specs;
}
