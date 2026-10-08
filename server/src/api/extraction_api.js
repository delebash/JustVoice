// SPDX-License-Identifier: MIT
// /v1/scenes/{id}/analyze and the rest of Script's AI routes — speaker attribution, the second
// look, Discover, the corrections memory and the Script pages (the port of
// justvoice/api/extraction_api.py).
//
// Phase 3 / Slice 1 of the Profile-kill plan. Runs the extraction pipeline against scene text
// and returns attribution rows for the Studio Script tab.
//
// **The scene-scoped routes PERSIST** (the Script-tab restore, 2026-08-08 —
// docs/plans/2026-08-08-script-tab-restore.md decision 2). Until then the analysis lived in one
// renderer ref, so switching chapters threw it away and a separate "Apply" button re-POSTed the
// rows as NEW blocks on top of the ones the text came from — analyzing twice doubled the
// chapter. Now the run writes itself onto the scene's blocks, "this chapter is analyzed" IS
// `Block.source` being non-null, and Apply is gone. The Lab's text routes (/v1/extraction/*)
// have no scene and still persist nothing.
//
// When no LLM provider is registered, returns HTTP 501 with the actionable message from
// LLMNotConfiguredError.
//
// Python ran the pipeline in a worker thread (it blocked the event loop for the whole model
// call); here it is an async task. The streams' worker is that task feeding a queue the
// response drains — the queue, the stop flag and the "kept" copy are Python's, the thread is
// gone. API agent 2 ported `RunUsage` first; API agent 3 the rest under the same names.

import { LLMNotConfiguredError, stores } from "@delebash/llm-runner/llm";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { B, pyRound, pySorted, strip, truthy } from "@delebash/llm-runner/platform/py";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { getState } from "../app_state.js";
import { Block, Project, Scene, Speaker, SpeakerCorrection, Take } from "../database/models.js";
import * as session from "../database/session.js";
import * as run from "../engines/llm/run.js";
import { ApiError, conflict, HttpError, notFound } from "../errors.js";
import { Line, flaggedLines, flagGroups, modelDisagreed, spokenBlock } from "../extraction/flags.js";
import * as identify from "../extraction/identify.js";
import * as names from "../extraction/names.js";
import * as pipeline from "../extraction/pipeline.js";
import { AttributionModelError, AttributionRow } from "../extraction/pipeline.js";
import * as sl from "../extraction/second_look.js";
import { paragraphsOf, QUOTE_PAIRS, resolveMarks, segmentsFromLines, splitIntoParagraphs } from "../extraction/segmentation.js";
import { leftOutBlocks } from "../extraction/tags.js";
import { isMarker } from "../line_takes.js";
import { construct, dtIso, ExtractionSettings, ProjectScript, SceneScript, utcNow } from "../models.js";
import { cpSlice, isDict, jsonLoads, pyCapitalize, pyStrOf, reEscape } from "../py_compat.js";
import { ensureSpeaker, narratorSpeakerId, speakerAliases } from "./_speaker_helpers.js";
import { sseResponse } from "./sse_streams_api.js";

const log = getLogger("justvoice.api.extraction_api");

const errText = (e) => e?.message ?? String(e);
const marks = (n) => Array.from({ length: n }, () => "?").join(", ");

/** `d.get(k)` on a parsed JSON value — an AttributeError (a 500) when it is not a dict. */
function dget(d, k, dflt = null) {
  if (!isDict(d)) throw new TypeError(`'${Array.isArray(d) ? "list" : typeof d === "string" ? "str" : "int"}' object has no attribute 'get'`);
  return Object.hasOwn(d, k) ? d[k] : dflt;
}

const sceneById = (h, id) => h.one(`select * from ${Scene} where id = ? limit 1`, [id], Scene);
const projectById = (h, id) => h.one(`select * from ${Project} where id = ? limit 1`, [id], Project);
const blocksOf = (h, sceneId) => h.all(`select * from ${Block} where scene_id = ? order by position`, [sceneId], Block);

/** A small FIFO the stream worker feeds and the response drains (Python's SimpleQueue). */
class Queue {
  constructor() {
    this.items = [];
    this.waiters = [];
  }
  put(item) {
    const w = this.waiters.shift();
    if (w) w(item);
    else this.items.push(item);
  }
  get() {
    if (this.items.length) return Promise.resolve(this.items.shift());
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

// ── The models ───────────────────────────────────────────────────────────

export const AttributionRowResponse = T.Object({
  paragraph_idx: T.Integer(),
  kind: T.String(),
  text: T.String(),
  speaker: T.String(),
  confidence: T.Number(),
  source: T.String(),
  floored_from: opt(nullable(T.String()), null),
  llm_speaker: opt(nullable(T.String()), null),
  llm_confidence: opt(nullable(T.Number()), null),
  anchor_words: opt(nullable(T.String()), null),
  not_in_cast: opt(nullable(T.String()), null),
});

/**
 * Body for POST /v1/scenes/{id}/analyze. `text` is the raw scene prose to attribute.
 * `characters` defaults to the book's speakers when omitted; `corrections` to the most-recent
 * SpeakerCorrection rows for the project.
 */
export const AnalyzeSceneRequest = T.Object({
  text: T.String(),
  characters: opt(nullable(T.Array(T.Record(T.String(), T.Any()))), null),
  corrections: opt(nullable(T.Array(T.Record(T.String(), T.Any()))), null),
  // Per-run route force; null = Auto. Renamed from `tier` in the tier-debris cleanup
  // (2026-08-07); an unknown value 422s loudly.
  route: opt(nullable(literal("guided", "direct")), null),
  propagate: opt(T.Boolean(), true),
  use_floor: opt(T.Boolean(), true),
});

/** The run's usage numbers (§16 — every AI response carries them; the server always had them,
 * the responses just didn't). 0 = unreported. */
export const RunUsage = T.Object({
  prompt_tokens: opt(T.Integer(), 0),
  completion_tokens: opt(T.Integer(), 0),
  duration_ms: opt(T.Integer(), 0),
  model: opt(T.String(), ""),
  // Model calls the run took: 1 when the chapter fit, more when it was read in pieces (chapter
  // splitting, 2026-09-28).
  pieces: opt(T.Integer(), 1),
});

/** What the run wrote onto the scene's blocks. null on the Lab's text routes. */
export const PersistInfo = T.Object({
  // "in_place" — every row PATCHed the block it came from. "resegmented" — the blocks were
  // replaced (first analyze of an imported chapter; the segmenter cuts paragraphs into spans).
  mode: T.String(),
  written: opt(T.Integer(), 0),
  // Rows left alone because the user had already corrected them (decision 3 — re-analyze never
  // overwrites a human answer).
  kept_corrected: opt(T.Integer(), 0),
});

export const AnalyzeSceneResponse = T.Object({
  scene_id: T.String(),
  rows: T.Array(AttributionRowResponse),
  route_used: T.String(),
  // Why that route ran (the restore's no-silent-state rule): "forced" (per-run override) |
  // "auto".
  route_source: opt(T.String(), "auto"),
  confidence_floor: T.Number(),
  // Raw LLM reply text — Speaker Lab's "Raw" tab. null when the call was anchors-only / no
  // dialogue.
  raw_llm: opt(nullable(T.String()), null),
  // null when no LLM call ran (anchors-only / no dialogue).
  usage: opt(nullable(RunUsage), null),
  // What landed in the database (scene routes only).
  persisted: opt(nullable(PersistInfo), null),
});

// The fields a streamed row frame writes (`row.__dict__`), its floats Python's floats.
const StreamRow = T.Object({
  paragraph_idx: T.Integer(),
  kind: T.String(),
  text: T.String(),
  speaker: T.String(),
  confidence: T.Number(),
  source: T.String(),
  floored_from: nullable(T.String()),
  llm_speaker: nullable(T.String()),
  llm_confidence: nullable(T.Number()),
  anchor_words: nullable(T.String()),
  not_in_cast: nullable(T.String()),
  second_look_asked: T.Boolean(),
});

/** `row.__dict__` as json.dumps writes it: every field in order, the floats as floats. */
function rowDict(row) {
  const out = {};
  for (const k of Object.keys(StreamRow.properties)) out[k] = row[k] ?? (k === "second_look_asked" ? false : null);
  if (typeof out.confidence === "number") out.confidence = pyFloatValue(out.confidence);
  if (typeof out.llm_confidence === "number") out.llm_confidence = pyFloatValue(out.llm_confidence);
  return out;
}

/** The analyze answer's rows (`AttributionRowResponse(**row.__dict__)`). */
const rowsOut = (rows) => rows.map((row) => ({ ...row }));

// ── Inputs ────────────────────────────────────────────────────────────────

/**
 * The top-N most-recent SpeakerCorrection rows for the project. Phase 5 feedback loop — these
 * inject into the LLM prompt via prompts.formatCorrections as worked examples.
 */
export function _resolveCorrections(projectId, h, { limit = 12 } = {}) {
  const rows = h.all(`select * from ${SpeakerCorrection} where project_id = ? order by created_at desc limit ?`, [projectId, limit], SpeakerCorrection);
  return rows.map((r) => ({ text_snippet: r.text_snippet, speaker_id: r.speaker_id || "unknown" }));
}

/** The book's speakers for `sceneId`, as attribution and Discover read them: name, the other
 * names the text uses, and who they are. */
export function _resolveCast(sceneId, h) {
  const scene = sceneById(h, sceneId);
  if (scene === null) return [];
  return h.all(`select * from ${Speaker} where project_id = ?`, [scene.project_id], Speaker).map((s) => ({
    id: s.id,
    name: s.name,
    role: null,
    gender: null,
    // Cast's Pronouns (persona build P9) — who "she said" can be.
    pronouns: s.pronouns,
    // "Also called" — anchors and the attribution prompt read it.
    aliases: speakerAliases(s),
    // Who they are — one line of it is Discover's known list (fix 2).
    description: s.description,
  }));
}

// ── Persistence — the analysis IS the chapter's blocks ───────────────────
//
// Decision 2 of the Script-tab restore: no new table, no new column, no renderer-side store. A
// block that carries a `source` was attributed; the Script tab rebuilds its table from
// `speaker_id` + `extraction_confidence` + `source` every time you open the chapter.

// The Block.source values an Analyze run writes (pipeline.AttributionRow). "corrected" and
// "manual" are the user's and the import's.
export const PIPELINE_SOURCES = new Set(["narration", "tag", "propagated", "llm", "floored", "second_look"]);

/**
 * The text a row stores as its block — dialogue keeps its quote marks.
 *
 * The segmenter returns the INNER text of a quoted span, so writing that verbatim would strip
 * the manuscript's quotes: the chapter would read wrong in Chapters, and re-segmenting the
 * stored blocks would find zero dialogue. Restore the span the source ACTUALLY had — never a
 * tidier one: a dialogue that opens and runs to the end of a line without ever closing gets no
 * closing quote the author did not write.
 *
 * `marks` is the style the chapter was cut by; its pairs are tried first
 * (`segmentation.QUOTE_PAIRS`), then every other style's.
 */
export function _blockText(kind, text, sourceText, marksStyle = "double") {
  if (kind !== "dialogue") return text;
  const pairs = [
    ...(Object.hasOwn(QUOTE_PAIRS, marksStyle) ? QUOTE_PAIRS[marksStyle] : []),
    ...Object.entries(QUOTE_PAIRS)
      .filter(([style]) => style !== marksStyle)
      .flatMap(([, ps]) => ps),
  ];
  for (const [openQ, closeQ] of pairs) if (sourceText.includes(`${openQ}${text}${closeQ}`)) return `${openQ}${text}${closeQ}`;
  for (const [openQ] of pairs) if (sourceText.includes(`${openQ}${text}`)) return `${openQ}${text}`;
  return `"${text}"`;
}

/** `json.loads(raw or "{}")`, {} when it can't be read. */
export function _jsonMeta(raw) {
  try {
    return jsonLoads(raw || "{}");
  } catch {
    return {};
  }
}

export const _sceneMeta = (scene) => _jsonMeta(scene.metadata_json);

/** A project's settings kept in its metadata — among them Overview's Speech marks
 * (`speech_marks`) and Leave out dialogue tags (`leave_out_tags`), 2026-09-30. */
export function _projectMeta(h, projectId) {
  const p = projectById(h, projectId);
  return p ? _jsonMeta(p.metadata_json) : {};
}

/**
 * The lines to re-analyze as they stand, or null to cut the text again.
 *
 * An analyzed chapter whose lines were edited since — a line's words changed, a line added,
 * removed, split or merged — no longer has the text it was cut from: the edit dropped it
 * (`projects_api._dropSceneSourceText`). Joining the lines back up read every line as a
 * paragraph of its own, so every anchor in the chapter was lost (2026-09-30). Now the lines are
 * kept, read by the paragraph they came from, and only their speakers are decided again. A
 * chapter never analyzed, or that still has its text, is cut from the text as before.
 */
export function _linesToKeep(scene, blocks) {
  const meta = _sceneMeta(scene);
  if (truthy(dget(meta, "source_text"))) return null;
  if (!(truthy(dget(meta, "analyzed_at")) || blocks.some((b) => PIPELINE_SOURCES.has(b.source)))) return null;
  const kept = blocks.filter((b) => strip(b.text || ""));
  return kept.length ? kept : null;
}

/** A chapter's text: the analyzed text it was cut from, else its lines. */
export function _sceneText(h, scene) {
  const stored = dget(_sceneMeta(scene), "source_text");
  if (truthy(stored)) return stored;
  return blocksOf(h, scene.id)
    .filter((b) => strip(b.text || ""))
    .map((b) => b.text)
    .join("\n\n");
}

/** The chapters either side of `scene`, by position — the second look reads the end of the one
 * before and the start of the one after (2026-10-05). */
export function _neighbourTexts(h, scene) {
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [scene.project_id], Scene);
  const at = scenes.findIndex((s) => s.id === scene.id);
  if (at < 0) return [null, null];
  const before = at > 0 ? _sceneText(h, scenes[at - 1]) : null;
  const after = at + 1 < scenes.length ? _sceneText(h, scenes[at + 1]) : null;
  return [before || null, after || null];
}

/** Row indices of the lines you set, when the chapter is re-read as its lines stand — the second
 * look never asks about them (they are never rewritten). A chapter cut afresh has none. */
export function _setByYou(h, lineIds) {
  if (!lineIds?.length) return [];
  const src = new Map(h.all(`select id, source from ${Block} where id in (${marks(lineIds.length)})`, lineIds).map((b) => [b.id, b.source]));
  return lineIds.flatMap((lid, i) => (src.get(lid) === "corrected" ? [i] : []));
}

/** What an Analyze of `scene` reads → `[text, marks, the ids of the lines kept, their
 * segments]`. The last two are null when the text is cut again — then `text` is the caller's. */
export function _analysisInput(h, scene, text) {
  const blocks = blocksOf(h, scene.id);
  const kept = _linesToKeep(scene, blocks);
  let segments = null;
  if (kept) {
    segments = segmentsFromLines(
      kept.map((b) => ({ text: b.text, spoken: spokenBlock(b.source, b.text), paragraph: dget(_jsonMeta(b.metadata_json), "paragraph_idx") })),
    );
    text = paragraphsOf(segments).join("\n\n");
  }
  const style = resolveMarks(dget(_projectMeta(h, scene.project_id), "speech_marks"), text);
  return [text, style, kept ? kept.map((b) => b.id) : null, segments];
}

/**
 * Everything a paragraph's block carries that its segments must inherit — re-cutting a chapter
 * DELETES the blocks, and a block is not just text: `metadata.source_ref` (the import's stable
 * line id: re-import merges on it and voiceline export names files from it), `metadata.marker`
 * (a podcast music/ad line, speaker-less by design) and `direction` (the performance note —
 * authored content). → one entry per PARAGRAPH of `text`, so a row's `paragraph_idx` indexes
 * it. Empty when `text` isn't the stored blocks joined back together. The join matches the
 * renderer's `proseFromBlocks` EXACTLY — it drops empty blocks and trims.
 */
export function _inherited(blocks, text) {
  const carried = blocks.filter((b) => strip(b.text || ""));
  if (
    strip(text) !==
    strip(
      carried.map((b) => b.text).join("\n\n"),
    )
  ) {
    return [];
  }
  const out = [];
  for (const b of carried) {
    const entry = [_jsonMeta(b.metadata_json), b.direction];
    // A block holding a blank line splits into more than one paragraph.
    const n = Math.max(1, splitIntoParagraphs(b.text).length);
    for (let i = 0; i < n; i++) out.push(entry);
  }
  return out;
}

const UNCHANGED = Symbol("unchanged");

/**
 * Write an analyze run onto the scene's blocks → PersistInfo. The caller runs it in a
 * transaction.
 *
 * Two paths: **in place** — the split matches the blocks already stored, so each row updates
 * the block it came from (every re-analyze; blocks the user corrected are skipped — a human
 * answer outranks the model's); **re-segment** — the split does NOT match (the first analyze of
 * an imported chapter: N blocks become M rows), so the blocks are replaced. The re-segment path
 * is REFUSED once the scene has takes: Take.block_id is ON DELETE CASCADE, so replacing blocks
 * would destroy approved audio with no warning.
 *
 * The text that produced these rows is stored on the scene, because the split is only
 * reproducible from it. `lineIds` names the lines a run over an EDITED chapter read as they
 * stood (`_linesToKeep`): one row each, written in place, and the text is not stored — the
 * chapter keeps being read as its lines, so a hand-made cut is never undone by a re-analyze.
 */
export function _persistAttribution(h, scene, rows, text, { marks: style = "double", lineIds = null } = {}) {
  let blocks = blocksOf(h, scene.id);
  if (!rows.length) {
    // Nothing came back — an empty or whitespace-only text, or a pipeline that produced no
    // segments. Falling through would take the re-segment path and delete every block without
    // writing one back, wiping the chapter on a run that decided nothing.
    throw conflict("That run produced no lines to attribute, so nothing was saved. Check the chapter has text.");
  }
  const narratorId = narratorSpeakerId(h, scene.project_id);
  // The speakers the model was actually offered. An invented id would fail the foreign key;
  // an unrecognized name means the line is unplaced.
  const known = new Set(h.all(`select id from ${Speaker} where project_id = ?`, [scene.project_id]).map((r) => r.id));

  const speakerFor = (speaker) => {
    if (speaker === "narrator") return narratorId;
    if (!speaker || speaker === "unknown") return null;
    return known.has(speaker) ? speaker : null;
  };

  const meta = _sceneMeta(scene);
  let texts;
  let inPlace;
  if (lineIds === null) {
    texts = rows.map((r) => _blockText(r.kind, r.text, text, style));
    inPlace = blocks.length === rows.length && blocks.every((b, i) => b.text === texts[i]);
    meta.source_text = text;
  } else {
    const now = blocks.filter((b) => strip(b.text || ""));
    if (now.length !== lineIds.length || now.some((b, i) => b.id !== lineIds[i]) || now.length !== rows.length) {
      throw conflict("This chapter's lines changed while it was being analyzed, so nothing was saved. Analyze it again.");
    }
    [blocks, texts, inPlace] = [now, [], true];
  }
  // "Analyzed" is Analyze having run, never "a line has a speaker" — an imported script arrives
  // with speakers and was never analyzed. The cast it could choose from is what "added since"
  // compares against (§8.24).
  meta.analyzed_at = dtIso(utcNow());
  meta.analyzed_cast = pySorted([...known]);
  const sceneMetaJson = pyJson(meta);

  /**
   * Keep the block's own metadata, and record what Script's check column and "Decided by" read
   * (§8.24, 3a): `floored_from`, `paragraph_idx`, `anchor_words`, `llm_speaker` (the model's
   * pick, kept only where the book's words won and the model had said someone else),
   * `prev_speaker_id` (who the line was before this re-analyze changed it; the key's presence
   * is the mark, its value may be null), `not_in_cast` and `second_look_asked`.
   */
  const withAudit = (existing, row, prev = UNCHANGED) => {
    const m = { ...existing };
    if (row.source === "floored" && row.floored_from) m.floored_from = row.floored_from;
    else delete m.floored_from;
    m.paragraph_idx = row.paragraph_idx;
    const anchored = row.source === "tag" || row.source === "propagated";
    if (anchored && row.anchor_words) m.anchor_words = row.anchor_words;
    else delete m.anchor_words;
    const modelPick = speakerFor(modelDisagreed(row.source, row.speaker, row.llm_speaker) || "");
    if (modelPick) m.llm_speaker = modelPick;
    else delete m.llm_speaker;
    if (prev === UNCHANGED) delete m.prev_speaker_id;
    else m.prev_speaker_id = prev;
    // The second look's "not in the cast" name (2026-10-05) — Script offers to add them; set and
    // cleared with every run, never left stale.
    if (row.not_in_cast) m.not_in_cast = row.not_in_cast;
    else delete m.not_in_cast;
    // Asked by the second look, named no one (2026-10-06) — set and cleared with every run.
    if (row.second_look_asked) m.second_look_asked = true;
    else delete m.second_look_asked;
    return Object.keys(m).length ? pyJson(m) : null;
  };

  if (inPlace) {
    let kept = 0;
    h.update(Scene, { metadata_json: sceneMetaJson }, { id: scene.id });
    blocks.forEach((block, i) => {
      const row = rows[i];
      if (block.source === "corrected") {
        kept += 1;
        return;
      }
      const newSpeaker = speakerFor(row.speaker);
      // Only a RE-analyze changes a line: the first run over imported lines decides them, it
      // doesn't change anyone's mind.
      const reanalyzed = PIPELINE_SOURCES.has(block.source);
      const prev = reanalyzed && block.speaker_id !== newSpeaker ? block.speaker_id : UNCHANGED;
      const changes = {
        speaker_id: newSpeaker,
        extraction_confidence: row.confidence,
        source: row.source,
        metadata_json: withAudit(_jsonMeta(block.metadata_json), row, prev),
      };
      const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => block[k] !== v));
      if (Object.keys(diff).length) h.update(Block, diff, { id: block.id });
    });
    return construct(PersistInfo, { mode: "in_place", written: rows.length - kept, kept_corrected: kept });
  }

  // Read the outgoing blocks BEFORE deleting them.
  const inherited = _inherited(blocks, text);

  if (blocks.length) {
    const takes = h.value(`select count(${Take}.id) from ${Take} join ${Block} on ${Block}.id = ${Take}.block_id where ${Block}.scene_id = ?`, [scene.id]);
    if (takes) {
      throw conflict(
        `This chapter's text no longer matches its ${blocks.length} rendered blocks, so analyzing would have to re-cut it — and that ` +
          `deletes the ${takes} take(s) already recorded against them. Delete the takes (or re-render after) if you want the new split.`,
      );
    }
    // The deletes flush first, then the scene and the new blocks (Python's order — the rowids
    // follow it).
    for (const block of blocks) h.delete(Block, { id: block.id });
  }
  h.update(Scene, { metadata_json: sceneMetaJson }, { id: scene.id });

  rows.forEach((row, i) => {
    const [parentMeta, parentDirection] = row.paragraph_idx < inherited.length ? inherited[row.paragraph_idx] : [{}, null];
    h.insert(Block, {
      scene_id: scene.id,
      position: i,
      text: texts[i],
      speaker_id: speakerFor(row.speaker),
      direction: parentDirection,
      extraction_confidence: row.confidence,
      source: row.source,
      metadata_json: withAudit(parentMeta, row),
    });
  });
  return construct(PersistInfo, { mode: "resegmented", written: rows.length });
}

/** The pipeline's request for a scene-scoped run (Python's `AnalyzeRequest(...)`). */
function sceneRequest(h, scene, body) {
  const characters = body.characters !== null ? body.characters : _resolveCast(scene.id, h);
  const corrections = body.corrections !== null ? body.corrections : _resolveCorrections(scene.project_id, h);
  const [text, style, lineIds, segments] = _analysisInput(h, scene, body.text);
  const [beforeText, afterText] = _neighbourTexts(h, scene);
  // Route precedence lives in ONE place (pipeline.pickRoute): the body's explicit route (a
  // per-run override) > Auto. The pipeline reports the pick that RAN via rawOut.
  const request = {
    text,
    characters,
    corrections,
    route: body.route,
    propagate: body.propagate,
    use_floor: body.use_floor,
    before_text: beforeText,
    after_text: afterText,
    second_look_skip: _setByYou(h, lineIds),
  };
  return { request, text, style, lineIds, segments };
}

/** The pipeline's refusals as the routes answer them: 501 unconfigured, 502 the model's own
 * words, 502 "extraction failed: …" for anything else. */
function analyzeError(e) {
  if (e instanceof LLMNotConfiguredError) return new HttpError(501, errText(e));
  if (e instanceof AttributionModelError) return new HttpError(502, errText(e));
  log.exception("extraction pipeline failed", e);
  return new HttpError(502, `extraction failed: ${errText(e)}`);
}

// ── Script's 🔎 Second look — the blank lines only (decided 2026-10-06) ─────

/** The chapter's spoken lines with no speaker that you didn't set, in order — what the
 * 🔎 Second look asks about. */
export function _secondLookAsks(h, scene) {
  return blocksOf(h, scene.id).filter(
    (b) => strip(b.text || "") && !b.speaker_id && b.source !== "corrected" && !isMarker(b) && spokenBlock(b.source, b.text),
  );
}

/** The paragraph a line came from: Analyze's `paragraph_idx`, else the first paragraph holding
 * its words (a line typed in or split off has no index). */
export function _paragraphOf(paragraphs, block) {
  let idx = dget(_jsonMeta(block.metadata_json), "paragraph_idx");
  if (typeof idx === "boolean") idx = Number(idx); // isinstance(True, int)
  if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < paragraphs.length) return idx;
  const words = strip(strip(block.text || ""), "\"'“”‘’ ,.");
  const at = paragraphs.findIndex((p) => words && p.includes(words));
  return at;
}

/**
 * One answer onto its line. A line given a speaker or set by you meanwhile is left alone, and so
 * is a line whose question failed. Named: the speaker, marked to check; its "changed" mark says
 * who it was before the last Analyze, dropped when that is who it is again. Not named: marked
 * asked (Script's Check column says so), and the "not in the cast" name the answer gave.
 */
export function _saveSecondLook(blockId, row, outcome) {
  const h = session.getDb();
  const b = h.one(`select * from ${Block} where id = ? limit 1`, [blockId], Block);
  if (b === null || b.speaker_id || b.source === "corrected" || outcome === "failed") return;
  const meta = _jsonMeta(b.metadata_json);
  const changes = {};
  if (outcome === "named") {
    changes.speaker_id = row.speaker;
    changes.source = "second_look";
    changes.extraction_confidence = row.confidence;
    delete meta.floored_from;
    delete meta.not_in_cast;
    delete meta.second_look_asked;
    if (Object.hasOwn(meta, "prev_speaker_id")) {
      if (meta.prev_speaker_id === row.speaker) delete meta.prev_speaker_id;
    } else meta.prev_speaker_id = null;
  } else {
    meta.second_look_asked = true;
    if (row.not_in_cast) meta.not_in_cast = row.not_in_cast;
    else delete meta.not_in_cast;
  }
  changes.metadata_json = Object.keys(meta).length ? pyJson(meta) : null;
  const diff = Object.fromEntries(Object.entries(changes).filter(([k, v]) => b[k] !== v));
  if (Object.keys(diff).length) h.update(Block, diff, { id: blockId });
}

// ── The Lab's text routes ──────────────────────────────────────────────────

/**
 * Speaker-Lab body — analyze raw text without a scene id. The caller supplies the cast
 * directly + the same tuning flags as the scene-scoped endpoint. Corrections: pass `project_id`
 * and the run uses that project's STORED corrections through the same resolver production uses;
 * an explicit non-empty `corrections` list still wins (API compat).
 */
export const AnalyzeTextRequest = T.Object({
  text: T.String(),
  characters: opt(T.Array(T.Record(T.String(), T.Any())), []),
  corrections: opt(T.Array(T.Record(T.String(), T.Any())), []),
  project_id: opt(nullable(T.String()), null),
  // Per-run route force (a card's Lab run always sends its own); null = Auto.
  route: opt(nullable(literal("guided", "direct")), null),
  propagate: opt(T.Boolean(), true),
  use_floor: opt(T.Boolean(), true),
  // Lab per-column overrides (null = preset/route defaults). camelCase to match the shared
  // LLM-config contract the renderer sends.
  providerId: opt(nullable(T.String()), null),
  model: opt(nullable(T.String()), null),
  temperature: opt(nullable(T.Number()), null),
  systemPrompt: opt(nullable(T.String()), null),
  userPrompt: opt(nullable(T.String()), null),
  confidence_floor: opt(nullable(T.Number()), null),
  // The column's remaining tunables (Part 2, 2026-08-06 — the controls are REAL): passed
  // straight through to the shared run path. null/[] = the resolved preset's values.
  think: opt(nullable(T.Boolean()), null),
  reasoningEffort: opt(nullable(T.String()), null),
  maxTokens: opt(nullable(T.Integer()), null),
  topP: opt(nullable(T.Number()), null),
  samplers: opt(T.Array(T.Record(T.String(), T.Any())), []),
  // Force chapter splitting by treating the model's context as this small (eval).
  max_context: opt(nullable(T.Integer()), null),
  // The second look (2026-10-05): the neighbouring chapters' text, and an on/off for this run
  // (null = settings.extraction.second_look).
  before_text: opt(nullable(T.String()), null),
  after_text: opt(nullable(T.String()), null),
  second_look: opt(nullable(T.Boolean()), null),
});

// ── Lab config — the truth the Speaker Lab displays ──────────────────────

export const ExtractionRouteInfo = T.Object({ name: T.String(), label: T.String(), confidence_floor: T.Number() });

/** One line of Auto's shown work: the rule, the model it judged (that card's OWN model — no
 * hidden anchor), and whether it passed. */
export const AutoCheckInfo = T.Object({ route: T.String(), model: T.String(), passed: T.Boolean(), rule: T.String() });

/**
 * Everything the attribution Lab + the Auto row need to SHOW what the pipeline will actually
 * do: the TWO routes (Guided · Direct), their prompt bodies, the user-prompt template, the
 * editable size rule, and Auto's current pick with its work. The server is the single source
 * of truth — the UI never duplicates prompt text or re-derives the pick.
 */
export const ExtractionConfigResponse = T.Object({
  routes: T.Array(ExtractionRouteInfo),
  // {"guided": <full body>, "direct": <full body>}
  system_prompts: T.Record(T.String(), T.String()),
  user_template: T.String(),
  // The editable size rule (settings.extraction.direct_min_b).
  direct_min_b: opt(T.Number(), 14.0),
  // Auto's pick right now + the readout lines that justify it.
  auto_picked: opt(T.String(), "guided"),
  auto_checks: opt(T.Array(AutoCheckInfo), []),
  // The second look's on/off (settings.extraction.second_look, 2026-10-05).
  second_look: opt(T.Boolean(), true),
});

// ── Script — the chapter grid and the chapter page (Slice 3, §8.24) ─────
//
// Both screens read the chapter's blocks, as the Script table always has; the flags and the
// counts are computed here by the same function the eval scores (`extraction/flags.js`), so
// what was measured is what ships.

/** `\b(name|…)\b`, case-blind, longest name first — null when there are none. */
export function _namePattern(nameList) {
  const uniq = [...new Set(nameList.filter((n) => n && strip(n)).map((n) => strip(n)))];
  uniq.sort((a, b) => Array.from(b).length - Array.from(a).length);
  if (!uniq.length) return null;
  return new RegExp(`${B}(${uniq.map(reEscape).join("|")})${B}`, "iu");
}

/**
 * One chapter's Script state → `[ScriptChapter, ScriptLine[], FlagGroup[]]`.
 *
 * One rule decides "analyzed" everywhere (§8.24): Analyze has run (`analyzed_at`), or — older
 * data, no migration — its lines carry a pipeline source. "From the import": never analyzed,
 * and every line already has a speaker.
 */
export function _chapterScript(scene, blocks, { castIds, narratorId, speakers, projectMeta = null, takeCounts = null }) {
  const meta = _sceneMeta(scene);
  const pm = projectMeta || {};
  const tagsLeftOut = truthy(dget(pm, "leave_out_tags")) ? leftOutBlocks(blocks) : new Set();
  const rows = blocks.map((b) => {
    const bm = _jsonMeta(b.metadata_json);
    const marker = truthy(dget(bm, "marker"));
    const speakable = !marker && Boolean(strip(b.text || ""));
    const spoken = speakable && spokenBlock(b.source, b.text);
    return [b, bm, marker, speakable, spoken];
  });

  const analyzedAt = dget(meta, "analyzed_at");
  const analyzed = truthy(analyzedAt) || rows.some(([b]) => PIPELINE_SOURCES.has(b.source));
  const speakableRows = rows.filter((r) => r[3]);
  const fromImport = !analyzed && speakableRows.length > 0 && speakableRows.every((r) => r[0].speaker_id);

  const lines = rows.map(
    ([b, bm, marker, , spoken]) =>
      new Line({
        id: b.id,
        speaker: b.speaker_id,
        text: b.text || "",
        spoken,
        source: b.source,
        paragraph: dget(bm, "paragraph_idx"),
        llm_speaker: dget(bm, "llm_speaker"),
        marker,
      }),
  );
  // Flags run only on what Analyze decided, reading quotes in the chapter's speech-mark style
  // (a speech left open carries on into the next paragraph).
  const style = resolveMarks(
    dget(pm, "speech_marks"),
    dget(meta, "source_text") ||
      blocks
        .map((b) => b.text || "")
        .join("\n\n"),
  );
  const groups = analyzed ? flagGroups(lines, castIds, { marks: style }) : [];
  const marked = flaggedLines(groups);
  // Narration (read, not spoken) with no speaker in a book with no narrator waits for one — a
  // book-level fix, ＋ Add Narrator, not a line to check (decided 2026-10-05). Everything else
  // with no speaker is "No speaker".
  const waiting = narratorId === null ? new Set(speakableRows.filter((r) => !r[0].speaker_id && !r[4]).map((r) => r[0].id)) : new Set();
  const noSpeaker = new Set(speakableRows.filter((r) => !r[0].speaker_id && !waiting.has(r[0].id)).map((r) => r[0].id));

  const byGroup = new Map();
  groups.forEach((g, gi) => {
    for (const lid of g.lines) {
      if (!byGroup.has(lid)) byGroup.set(lid, []);
      byGroup.get(lid).push(gi);
    }
  });

  const outLines = rows.map(([b, bm, marker, speakable, spoken]) =>
    construct(ScriptLineSchema, {
      id: b.id,
      position: b.position,
      text: b.text || "",
      speaker_id: b.speaker_id,
      source: b.source,
      confidence: b.extraction_confidence,
      paragraph: dget(bm, "paragraph_idx"),
      spoken,
      marker,
      speakable,
      anchor_words: dget(bm, "anchor_words"),
      llm_speaker: dget(bm, "llm_speaker"),
      floored_from: dget(bm, "floored_from"),
      changed: Object.hasOwn(bm, "prev_speaker_id"),
      prev_speaker_id: dget(bm, "prev_speaker_id"),
      flags: byGroup.get(b.id) ?? [],
      metadata: bm,
      left_out: tagsLeftOut.has(b.id),
      takes: takeCounts?.get(b.id) ?? 0,
      waits_for_narrator: waiting.has(b.id),
    }),
  );

  const spokenRows = rows.filter((r) => r[4]);
  const added = [];
  const before = dget(meta, "analyzed_cast");
  if (analyzed && Array.isArray(before)) {
    const text =
      dget(meta, "source_text") ||
      blocks
        .map((b) => b.text || "")
        .join("\n\n");
    // A speaker who already has lines here is no longer waiting for a Re-analyze — the 🔎 Second
    // look (or you) gave them theirs (decided 2026-10-06).
    const speaking = new Set(spokenRows.filter((r) => r[0].speaker_id).map((r) => r[0].speaker_id));
    const beforeSet = new Set(before);
    const fresh = pySorted([...castIds].filter((sid) => !beforeSet.has(sid) && sid !== narratorId && !speaking.has(sid)));
    for (const sid of fresh) {
      const sp = speakers.get(sid) ?? null;
      const pat = sp ? _namePattern([sp.name, ...speakerAliases(sp)]) : null;
      if (pat?.test(text)) added.push(sp.name);
    }
  }

  const chapter = {
    scene_id: scene.id,
    position: scene.position,
    title: scene.title,
    lines: speakableRows.length,
    spoken: spokenRows.length,
    analyzed_at: analyzedAt,
    analyzed: Boolean(analyzed),
    from_import: fromImport,
    // Book says + AI decided + by you + no speaker = spoken: a line left with no speaker is
    // counted there, never as decided.
    anchored: spokenRows.filter((r) => (r[0].source === "tag" || r[0].source === "propagated") && r[0].speaker_id).length,
    guessed: spokenRows.filter((r) => (r[0].source === "llm" || r[0].source === "second_look") && r[0].speaker_id).length,
    by_you: spokenRows.filter((r) => r[0].source === "corrected" && r[0].speaker_id).length,
    no_speaker: noSpeaker.size,
    flagged: marked.size,
    flag_groups: groups.length,
    // "To check" is for what Analyze (or the import) decided; a chapter never analyzed needs
    // Analyze, not checking.
    to_check: analyzed || fromImport ? new Set([...marked, ...noSpeaker]).size : 0,
    narration_waiting: waiting.size,
    changed: outLines.filter((ln) => ln.changed).length,
    no_dialogue_found: Boolean(analyzed) && speakableRows.length > 0 && !spokenRows.length,
    added_since: added,
    edited_since: analyzed ? speakableRows.filter((r) => r[0].source === null || r[0].source === "manual").length : 0,
  };
  return [chapter, outLines, groups];
}

const ScriptLineSchema = SceneScript.properties.lines.items;

/** The book's speakers (a Map id → row), their ids (a Set), and the narrator's. */
export function _scriptContext(h, projectId) {
  const speakers = new Map(h.all(`select * from ${Speaker} where project_id = ?`, [projectId], Speaker).map((s) => [s.id, s]));
  return [new Set(speakers.keys()), narratorSpeakerId(h, projectId), speakers];
}

// ── Speaker-correction management (Phase 5) ──────────────────────────────

export const CorrectionsCountResponse = T.Object({ project_id: T.String(), count: T.Integer() });

/**
 * THE one correction writer (parity batch 2026-08-06): the Studio block-PATCH side effect and
 * the Lab's reassign both call this — same row shape, same 200-per-project cap (oldest dropped),
 * so the two doors can't drift. → the new fix's id, so the change that saved it can be undone.
 * The caller runs it in its transaction.
 */
export function recordCorrection(h, projectId, textSnippet, speakerId) {
  h.insert(SpeakerCorrection, { project_id: projectId, text_snippet: cpSlice(textSnippet || "", 0, 400), speaker_id: speakerId });
  const fix = h.one(`select id from ${SpeakerCorrection} where rowid = last_insert_rowid()`);
  const overflow = h.all(`select id from ${SpeakerCorrection} where project_id = ? order by created_at desc limit -1 offset 200`, [projectId]);
  for (const row of overflow) h.delete(SpeakerCorrection, { id: row.id });
  return fix.id;
}

export const CorrectionIn = T.Object({ text_snippet: T.String(), speaker_id: T.String() });

function _countProjectCorrections(h, projectId) {
  return h.count(SpeakerCorrection, { project_id: projectId });
}

// ── Speaker identification — Studio's Discover step (CONCEPTS §3) ──
//
// A chapter's scan is SAVED on the chapter (decided 2026-09-27, "both"): the scene's
// `metadata.discover = {scanned_at, candidates, named_cast}`. It is what lets the Discover step
// survive a restart and what gives Overview and Discover real "scanned / last scanned" data.
// Nothing becomes a speaker until promote. Since 2026-09-29 the record is everyone the chapter
// names — the AI's new names (`candidates`) and the book's speakers found by name
// (`named_cast`) — and it is KEPT: Add and Ignore change a name's status on the page, they
// never delete it from the record.

export const DiscoverSpeakersRequest = T.Object({ text: T.String() });

export const SpeakerCandidateOut = T.Object({
  name: T.String(),
  role_hint: opt(nullable(T.String()), null),
  approx_lines: opt(nullable(T.Integer()), null),
  // The quote that names them (Discover's "First appearance").
  evidence: opt(nullable(T.String()), null),
  // Is that quote really in the chapter? false = the model made it up, which is the tell of a
  // made-up name (fix 3). null = no quote given.
  evidence_found: opt(nullable(T.Boolean()), null),
});

/** A speaker of this book the chapter names — found by `names.castNamedIn`, no AI. */
export const NamedCastMember = T.Object({
  speaker_id: T.String(),
  name: T.String(),
  mentions: opt(T.Integer(), 0),
  evidence: opt(nullable(T.String()), null),
});

export const DiscoverSpeakersResponse = T.Object({
  scene_id: T.String(),
  // The names the AI found that are not speakers here (ignored ones included — the page shows
  // them as Ignored).
  candidates: T.Array(SpeakerCandidateOut),
  // The book's speakers the chapter names (2026-09-29: a scan records everyone).
  named_cast: opt(T.Array(NamedCastMember), []),
  // The run's usage (§16) — null only if the call never ran.
  usage: opt(nullable(RunUsage), null),
});

export const IgnoreDiscoveredRequest = T.Object({ names: T.Array(T.String()) });

// The project's whole ignore list after the change.
export const IgnoreDiscoveredResponse = T.Object({ ignored: T.Array(T.String()) });

/** The names Discover was told to ignore in this project. */
export function projectIgnored(project) {
  const raw = project?.discover_ignored ?? null;
  let out;
  try {
    out = raw ? jsonLoads(raw) : [];
  } catch {
    return [];
  }
  return Array.isArray(out) ? out.map((n) => pyStrOf(n)).filter((n) => strip(n)) : [];
}

/** The Lab's discovery body — the identify twin of AnalyzeTextRequest (free-form text, no
 * scene). The camelCase override fields are the Lab column's pins. */
export const DiscoverTextRequest = T.Object({
  text: T.String(),
  known_characters: opt(T.Array(T.String()), []),
  providerId: opt(nullable(T.String()), null),
  model: opt(nullable(T.String()), null),
  temperature: opt(nullable(T.Number()), null),
  systemPrompt: opt(nullable(T.String()), null),
  userPrompt: opt(nullable(T.String()), null),
  // The column's remaining tunables (Part 2, 2026-08-06) — same contract as analyze-text.
  think: opt(nullable(T.Boolean()), null),
  reasoningEffort: opt(nullable(T.String()), null),
  maxTokens: opt(nullable(T.Integer()), null),
  topP: opt(nullable(T.Number()), null),
  samplers: opt(T.Array(T.Record(T.String(), T.Any())), []),
});

export const PromoteCandidate = T.Object({
  name: T.String(),
  // The discovery pass's role hint ("Mara's neighbour") — "Who they are".
  description: opt(nullable(T.String()), null),
  // Other spellings the scan found for the same person ("Sedge" beside "Old Sedge") — kept as
  // "Also called".
  aliases: opt(T.Array(T.String()), []),
});

export const PromoteSpeakersRequest = T.Object({ candidates: T.Array(PromoteCandidate) });

export const PromoteSpeakersResponse = T.Object({ created: T.Array(T.String()), reused: T.Array(T.String()) });

/** The candidates a Discover answer names (`SpeakerCandidateOut(...)` of each). */
const candidateOut = (c, extra = {}) => ({ name: c.name, role_hint: c.role_hint, approx_lines: c.approx_lines, evidence: c.evidence, ...extra });

/** The frames' text: `data: <json.dumps(item)>\n\n`. */
const frame = (item) => `data: ${pyJson(item)}\n\n`;

// ── The routes ─────────────────────────────────────────────────────────────

export async function router(app) {
  app.post("/v1/scenes/:scene_id/analyze", { schema: { body: AnalyzeSceneRequest } }, async (req) => {
    const h = session.getDb();
    const sceneId = req.params.scene_id;
    const scene = sceneById(h, sceneId);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const settings = getState().settings.get();
    const { request, text, style, lineIds, segments } = sceneRequest(h, scene, req.body);

    const rawOut = {};
    let rows;
    try {
      rows = await pipeline.analyzeScene({ settings, request, rawOut, marks: style, segments });
    } catch (e) {
      throw analyzeError(e);
    }

    // The scene as this request read it (Python's session object, never refreshed).
    const persisted = h.tx(() => _persistAttribution(h, scene, rows, text, { marks: style, lineIds }));
    return construct(AnalyzeSceneResponse, {
      scene_id: sceneId,
      raw_llm: rawOut.llm_text ?? null,
      rows: rowsOut(rows),
      route_used: rawOut.route ?? "guided",
      route_source: rawOut.route_source ?? "auto",
      confidence_floor: rawOut.floor ?? 0.7,
      usage: rawOut.usage ?? null,
      persisted,
    });
  });

  /**
   * Lane 2A of the AI-call convention (2026-08-08): the SAME pipeline as /analyze — same
   * cast/corrections resolution, same route pick, same parsing and floor — but the LLM reply
   * streams. Frames are the family contract (`data:{"delta"}` · `data:{"progress"}` ·
   * `data:{"step":{"name":"second_look","done","total"}}` as the second look starts and after
   * each line it asks about · a final `data:{"done":true,...}` carrying the usage names
   * top-level PLUS everything AnalyzeSceneResponse carries · `data:[DONE]`; errors as
   * `data:{"error"}` — the stream has started, so there is no HTTP status to send).
   *
   * **The worker never writes.** It hands its rows back and the response layer persists, after
   * checking the client is still there: Cancel has to mean cancel. **Except in the second look
   * (decided 2026-10-06):** a cancel there keeps the main pass — the worker hands over a copy
   * of the rows as the second look starts and after each line (`onStep`), and a cancel saves
   * that copy and stops the look before its next line. A cancel during the main pass still
   * writes nothing.
   */
  app.post("/v1/scenes/:scene_id/analyze/stream", { schema: { body: AnalyzeSceneRequest } }, async (req, reply) => {
    const h = session.getDb();
    const sceneId = req.params.scene_id;
    const scene = sceneById(h, sceneId);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const settings = getState().settings.get();
    const { request, text, style, lineIds, segments } = sceneRequest(h, scene, req.body);

    const q = new Queue();
    let stop = false;
    let gone = false;
    let finished = false;
    // The chapter as the second look last left it whole — what a cancel during the second look
    // saves. null until the second look starts.
    const kept = { rows: null };

    const onStep = (done, total, rows) => {
      kept.rows = rows.map((r) => new AttributionRow({ ...r }));
      q.put({ step: { name: "second_look", done, total } });
    };

    const worker = async () => {
      const rawOut = {};
      try {
        const rows = await pipeline.analyzeScene({
          settings,
          request,
          rawOut,
          onDelta: (t) => q.put({ delta: t }),
          onThinking: (t) => q.put({ thinking: t }),
          onProgress: (p) => q.put({ progress: pyFloatValue(p) }),
          marks: style,
          segments,
          onStep,
          stop: () => stop,
        });
        const usage = rawOut.usage || {};
        q.put({
          done: true,
          // Handed to the response layer, which persists and replaces this with the PersistInfo
          // before the frame goes out.
          __rows__: rows,
          // The family usage names, top level — the kit client normalizes exactly these.
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          model: usage.model ?? "",
          // The domain payload — the same fields AnalyzeSceneResponse carries, same names.
          scene_id: sceneId,
          rows: rows.map(rowDict),
          route_used: rawOut.route ?? "guided",
          route_source: rawOut.route_source ?? "auto",
          confidence_floor: pyFloatValue(rawOut.floor ?? 0.7),
          raw_llm: rawOut.llm_text ?? null,
          usage: Object.keys(usage).length ? usage : null,
        });
      } catch (e) {
        if (e instanceof LLMNotConfiguredError || e instanceof AttributionModelError) {
          q.put({ error: errText(e) }); // written for the user; never cut
        } else {
          log.exception("extraction stream failed", e);
          q.put({ error: cpSlice(errText(e), 0, 200) });
        }
      } finally {
        q.put(null);
      }
    };

    /** The write, in a transaction of its own; refusals are user-facing sentences. */
    const persist = (rows) => {
      const sc = sceneById(h, sceneId);
      if (sc === null) throw notFound(`scene ${sceneId}`); // deleted mid-run
      const info = h.tx(() => _persistAttribution(h, sc, rows, text, { marks: style, lineIds }));
      return { mode: info.mode, written: info.written, kept_corrected: info.kept_corrected };
    };

    /** Cancel during the second look keeps what the run had (decided 2026-10-06). */
    const saveOnCancel = (rows) => {
      try {
        persist(rows);
        log.info(`analyze stream: cancelled in the second look — scene ${sceneId} saved as it stood`);
      } catch (e) {
        log.exception("analyze stream: saving the main pass on cancel failed", e);
      }
    };

    // The client going away is Python's cancelled generator: the look stops before its next
    // line, the kept copy (if the second look had started) is saved, and nothing else is.
    reply.raw.once("close", () => {
      if (finished) return;
      gone = true;
      stop = true;
      if (kept.rows !== null) {
        saveOnCancel(kept.rows);
        kept.rows = null;
      }
      q.put(null);
    });

    worker();

    async function* frames() {
      try {
        for (;;) {
          let item = await q.get();
          if (item === null || gone) break;
          if (isDict(item) && Object.hasOwn(item, "__rows__")) {
            const rows = item.__rows__;
            delete item.__rows__;
            // The one place the chapter is written. A cancelled run leaves it as it was.
            if (gone) break;
            // The whole run is being written now; a cancel from here on must not write the kept
            // copy over it.
            kept.rows = null;
            try {
              item.persisted = persist(rows);
            } catch (e) {
              if (e instanceof ApiError || e instanceof HttpError) item = { error: String(e.detail) };
              else {
                log.exception("analyze stream: persist failed", e);
                item = { error: cpSlice(errText(e), 0, 200) };
              }
            }
          }
          yield frame(item);
        }
        if (!gone) yield "data: [DONE]\n\n";
      } finally {
        finished = !gone;
        stop = true;
      }
    }
    return sseResponse(reply, frames(), {});
  });

  /**
   * Script's 🔎 Second look: `{"delta"}` as each question streams, `{"step": {"name":
   * "second_look", "done", "total"}}` as it starts and after each line, then `{"done": true,
   * asked, named, not_in_cast, failed, seconds}` with the usage names, then `[DONE]`; errors as
   * `{"error"}`. Writes each answer to its line as it comes (`_saveSecondLook`); nothing else.
   * The question is Analyze's own (second_look.lookAt, the same context).
   */
  app.post("/v1/scenes/:scene_id/second-look/stream", async (req, reply) => {
    const h = session.getDb();
    const sceneId = req.params.scene_id;
    const scene = sceneById(h, sceneId);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const settings = getState().settings.get();
    const cfg = settings?.extraction ?? construct(ExtractionSettings, {});
    const asks = _secondLookAsks(h, scene);
    const blocks = blocksOf(h, scene.id);
    const stored = dget(_sceneMeta(scene), "source_text");
    const [text, , , segments] = _analysisInput(
      h,
      scene,
      truthy(stored)
        ? stored
        : blocks
            .filter((b) => b.text)
            .map((b) => b.text)
            .join("\n\n"),
    );
    const paragraphs = segments === null ? splitIntoParagraphs(text) : paragraphsOf(segments);
    const [promptCast, handleToId] = pipeline.promptHandles(_resolveCast(sceneId, h));
    const castText = sl.castLines(promptCast);
    const [before, after] = sl.context(..._neighbourTexts(h, scene), cfg);
    const floor = pipeline.pickRoute(null, settings).floor;
    const rows = asks.map((b) => [
      b.id,
      { paragraph_idx: _paragraphOf(paragraphs, b), text: b.text, speaker: "unknown", confidence: 0.0, source: b.source, floored_from: null, not_in_cast: null },
    ]);

    const q = new Queue();
    let stop = false;

    const resolve = (raw) => {
      const handle = pipeline.resolveSpeaker(raw, promptCast);
      return handleToId.has(handle) ? handleToId.get(handle) : handle;
    };

    const worker = async () => {
      const report = { asked: rows.length, named: 0, not_in_cast: [], failed: 0, seconds: 0.0 };
      const usage = { prompt_tokens: 0, completion_tokens: 0 };
      const t0 = Date.now() / 1000;
      try {
        q.put({ step: { name: "second_look", done: 0, total: rows.length } });
        for (let k = 0; k < rows.length; k++) {
          const [blockId, row] = rows[k];
          if (stop) break;
          const outcome = await sl.lookAt(row, paragraphs, {
            castText,
            before,
            after,
            resolve,
            castNames: (name) => Boolean(names.match(name, promptCast)),
            floor,
            useFloor: true,
            cfg,
            report,
            usage,
            onDelta: (t) => q.put({ delta: t }),
            onThinking: (t) => q.put({ thinking: t }),
          });
          if (stop) break; // the answer landed after the cancel — dropped
          _saveSecondLook(blockId, row, outcome);
          q.put({ step: { name: "second_look", done: k + 1, total: rows.length } });
        }
        report.seconds = pyFloatValue(pyRound(Date.now() / 1000 - t0, 1));
        q.put({
          done: true,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          model: "",
          scene_id: sceneId,
          ...report,
        });
      } catch (e) {
        if (e instanceof LLMNotConfiguredError) q.put({ error: errText(e) });
        else {
          log.exception("second look stream failed", e);
          q.put({ error: cpSlice(errText(e), 0, 200) });
        }
      } finally {
        q.put(null);
      }
    };

    reply.raw.once("close", () => {
      stop = true;
      q.put(null);
    });
    worker();

    async function* frames() {
      try {
        for (;;) {
          const item = await q.get();
          if (item === null) break;
          yield frame(item);
        }
        if (!stop) yield "data: [DONE]\n\n";
      } finally {
        stop = true;
      }
    }
    return sseResponse(reply, frames(), {});
  });

  /** No scene id — for the Speaker Lab + ad-hoc analysis. Returns the same
   * AnalyzeSceneResponse shape with scene_id="(adhoc)". */
  app.post("/v1/extraction/analyze-text", { schema: { body: AnalyzeTextRequest } }, async (req) => {
    const h = session.getDb();
    const body = req.body;
    let corrections = body.corrections;
    if (!corrections.length && body.project_id) {
      // The open project's stored corrections, exactly like production (Part 5 — same resolver,
      // same top-12, zero drift).
      corrections = _resolveCorrections(body.project_id, h);
    }
    const settings = getState().settings.get();
    const request = {
      text: body.text,
      characters: body.characters,
      corrections,
      route: body.route,
      propagate: body.propagate,
      use_floor: body.use_floor,
      model: body.model,
      temperature: body.temperature,
      system_prompt: body.systemPrompt,
      user_prompt: body.userPrompt,
      confidence_floor: body.confidence_floor,
      provider_id: body.providerId,
      think: body.think,
      reasoning_effort: body.reasoningEffort,
      max_tokens: body.maxTokens,
      top_p: body.topP,
      samplers: body.samplers,
      max_context: body.max_context,
      before_text: body.before_text,
      after_text: body.after_text,
      second_look: body.second_look,
    };
    const rawOut = {};
    let rows;
    try {
      rows = await pipeline.analyzeScene({ settings, request, rawOut });
    } catch (e) {
      throw analyzeError(e);
    }
    return construct(AnalyzeSceneResponse, {
      scene_id: "(adhoc)",
      raw_llm: rawOut.llm_text ?? null,
      rows: rowsOut(rows),
      route_used: rawOut.route ?? "guided",
      route_source: rawOut.route_source ?? "auto",
      confidence_floor: rawOut.floor ?? 0.7,
      usage: rawOut.usage ?? null,
    });
  });

  app.get("/v1/extraction/config", async () => {
    // Prompt truth = the SHARED template rows (the same rows the run renders).
    const store = stores.getPromptStore();
    const rowsBy = Object.fromEntries(pipeline.ROUTES.map((name) => [name, store.get(`speaker_attribution.${name}`)]));
    const settings = getState().settings.get();
    const [picked, checks] = pipeline.autoRoute(settings.extraction.direct_min_b);
    return construct(ExtractionConfigResponse, {
      routes: pipeline.ROUTES.map((name) => ({ name, label: pyCapitalize(name), confidence_floor: pipeline.ROUTE_FLOORS[name] })),
      system_prompts: Object.fromEntries(Object.entries(rowsBy).map(([name, r]) => [name, r ? r.system : ""])),
      user_template: rowsBy.guided ? rowsBy.guided.user_template : "",
      direct_min_b: settings.extraction.direct_min_b,
      auto_picked: picked,
      auto_checks: checks,
      second_look: settings.extraction.second_look,
    });
  });

  // ── Script ──

  app.get("/v1/projects/:project_id/script", async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    if (projectById(h, projectId) === null) throw notFound(`project ${projectId}`);
    const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
    const byScene = new Map(scenes.map((s) => [s.id, []]));
    if (scenes.length) {
      const ids = [...byScene.keys()];
      for (const b of h.all(`select * from ${Block} where scene_id in (${marks(ids.length)}) order by scene_id, position`, ids, Block)) {
        byScene.get(b.scene_id).push(b);
      }
    }
    const [castIds, narratorId, speakers] = _scriptContext(h, projectId);
    const pm = _projectMeta(h, projectId);
    return construct(ProjectScript, {
      project_id: projectId,
      chapters: scenes.map((s) => _chapterScript(s, byScene.get(s.id), { castIds, narratorId, speakers, projectMeta: pm })[0]),
    });
  });

  app.get("/v1/scenes/:scene_id/script", async (req) => {
    const h = session.getDb();
    const sceneId = req.params.scene_id;
    const scene = sceneById(h, sceneId);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const blocks = blocksOf(h, sceneId);
    const [castIds, narratorId, byId] = _scriptContext(h, scene.project_id);
    const takes = new Map();
    if (blocks.length) {
      const ids = blocks.map((b) => b.id);
      for (const r of h.all(`select block_id, count(id) as n from ${Take} where block_id in (${marks(ids.length)}) group by block_id`, ids)) {
        takes.set(r.block_id, r.n);
      }
    }
    const [chapter, lines, groups] = _chapterScript(scene, blocks, {
      castIds,
      narratorId,
      speakers: byId,
      projectMeta: _projectMeta(h, scene.project_id),
      takeCounts: takes,
    });
    // Every line a speaker reads — the narrator's narration included, as the speaker filter
    // shows it ("Narrator · 118").
    const counts = new Map();
    for (const ln of lines) if (ln.speakable && ln.speaker_id) counts.set(ln.speaker_id, (counts.get(ln.speaker_id) ?? 0) + 1);
    const speakers = pySorted(
      [...byId].map(([sid, sp]) => ({ speaker_id: sid, name: sp.name, lines: counts.get(sid) ?? 0 })),
      (sp) => [-sp.lines, sp.name.toLowerCase()],
    );
    return construct(SceneScript, {
      chapter,
      project_id: scene.project_id,
      narrator_id: narratorId,
      lines,
      flag_groups: groups.map((g) => ({ check: g.check, speaker: g.speaker, lines: g.lines, turns: g.turns, other: g.other })),
      speakers,
    });
  });

  // ── Speaker-correction management (Phase 5) ──

  app.get("/v1/projects/:project_id/corrections/count", async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    return construct(CorrectionsCountResponse, { project_id: projectId, count: _countProjectCorrections(h, projectId) });
  });

  app.delete("/v1/projects/:project_id/corrections", async (req) => {
    const h = session.getDb();
    return { deleted: h.delete(SpeakerCorrection, { project_id: req.params.project_id }).changes };
  });

  /** Remove ONE saved fix — Script's Undo, taking back the fix the undone change saved. A fix
   * already gone (capped out) is not an error. */
  app.delete("/v1/projects/:project_id/corrections/:fix_id", async (req) => {
    const h = session.getDb();
    return { deleted: h.delete(SpeakerCorrection, { project_id: req.params.project_id, id: req.params.fix_id }).changes };
  });

  /**
   * The Lab's reassign door (parity batch 2026-08-06): a corrected speaker in the attribution
   * Lab writes correction memory exactly as Studio's block reassign does. speaker_id must be a
   * REAL speaker of this book (the FK the table carries) — the Lab's typed cast uses synthetic
   * ids, which teach nothing and are refused here.
   */
  app.post("/v1/projects/:project_id/corrections", { schema: { body: CorrectionIn } }, async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    const body = req.body;
    const sp = h.get(Speaker, body.speaker_id);
    if (sp === null || sp.project_id !== projectId) throw new HttpError(404, `speaker ${body.speaker_id} not found in this book`);
    h.tx(() => recordCorrection(h, projectId, body.text_snippet, body.speaker_id));
    return { ok: true, count: _countProjectCorrections(h, projectId) };
  });

  // ── Discover ──

  /**
   * Identification, not attribution: proposes NEW speakers for Studio's Discover step. No
   * speaker is created here — promotion is POST /v1/projects/{id}/speakers/promote. The scan
   * itself IS saved, on the chapter (`metadata.discover`), replacing that chapter's previous
   * scan.
   */
  app.post("/v1/scenes/:scene_id/discover-speakers", { schema: { body: DiscoverSpeakersRequest } }, async (req) => {
    const h = session.getDb();
    const sceneId = req.params.scene_id;
    const body = req.body;
    const scene = sceneById(h, sceneId);
    if (scene === null) throw notFound(`scene ${sceneId}`);
    const cast = _resolveCast(sceneId, h);
    const settings = getState().settings.get();
    const rawOut = {};
    let candidates;
    try {
      const style = resolveMarks(dget(_projectMeta(h, scene.project_id), "speech_marks"), body.text);
      candidates = await identify.identifySpeakers(body.text, cast, { settings, rawOut, marks: style });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      log.exception("speaker identification failed", e);
      throw new HttpError(502, `identification failed: ${errText(e)}`);
    }
    const out = [];
    for (const c of candidates) {
      // Already a speaker under a name the model could not connect — a first or last name alone
      // ("Cael" for Cael Ferren): that person is recorded below, as a speaker the chapter names.
      // An IGNORED name stays in the record; the page shows it as Ignored.
      if (names.match(c.name, cast) !== null) continue;
      out.push(construct(SpeakerCandidateOut, candidateOut(c, { evidence_found: c.evidence ? names.quoteInText(c.evidence, body.text) : null })));
    }
    // Every speaker of this book the chapter names, found by name in the text (no AI — the same
    // on every scan). The narrator is a speaker like any other; prose rarely names it.
    const namedCast = names.castNamedIn(body.text, cast).map((r) => construct(NamedCastMember, r));
    const meta = _sceneMeta(scene);
    meta.discover = { scanned_at: dtIso(utcNow()), candidates: out, named_cast: namedCast };
    h.update(Scene, { metadata_json: pyJson(meta) }, { id: sceneId });
    return construct(DiscoverSpeakersResponse, { scene_id: sceneId, candidates: out, named_cast: namedCast, usage: rawOut.usage ?? null });
  });

  /** Discover's Ignore: the name is remembered for the project, and every chapter that names it
   * shows it as Ignored (fix 4). /discover/unignore takes it back off the list. */
  app.post("/v1/projects/:project_id/discover/ignore", { schema: { body: IgnoreDiscoveredRequest } }, async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    const project = projectById(h, projectId);
    if (project === null) throw notFound(`project ${projectId}`);
    const current = projectIgnored(project);
    const have = new Set(current.map((n) => names.norm(n)));
    for (const n of req.body.names) {
      if (strip(n) && !have.has(names.norm(n))) {
        current.push(strip(n));
        have.add(names.norm(n));
      }
    }
    _setIgnored(h, project, current);
    return construct(IgnoreDiscoveredResponse, { ignored: current });
  });

  /** Takes names off the project's ignore list; the chapters that name them show them as
   * proposals again. */
  app.post("/v1/projects/:project_id/discover/unignore", { schema: { body: IgnoreDiscoveredRequest } }, async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    const project = projectById(h, projectId);
    if (project === null) throw notFound(`project ${projectId}`);
    const drop = new Set(req.body.names.map((n) => names.norm(n)));
    const current = projectIgnored(project).filter((n) => !drop.has(names.norm(n)));
    _setIgnored(h, project, current);
    return construct(IgnoreDiscoveredResponse, { ignored: current });
  });

  /** No scene id — the Lab's discovery door (parity batch 2026-08-06), beside
   * /v1/extraction/analyze-text. Same identify pipeline; candidates are a review list. */
  app.post("/v1/extraction/discover-speakers", { schema: { body: DiscoverTextRequest } }, async (req) => {
    const body = req.body;
    const all = {
      providerId: body.providerId,
      model: body.model,
      temperature: body.temperature,
      system: body.systemPrompt,
      userTemplate: body.userPrompt,
      think: body.think,
      reasoningEffort: body.reasoningEffort,
      maxTokens: body.maxTokens,
      topP: body.topP,
      samplers: body.samplers.length ? body.samplers : null,
    };
    const overrides = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null));
    const runFn = (action, variables) => run.runFeature(action, variables, overrides);
    const settings = getState().settings.get();
    const rawOut = {};
    let candidates;
    try {
      candidates = await identify.identifySpeakers(body.text, body.known_characters, { settings, runFn, rawOut });
    } catch (e) {
      if (e instanceof LLMNotConfiguredError) throw new HttpError(501, errText(e));
      log.exception("speaker identification failed", e);
      throw new HttpError(502, `identification failed: ${errText(e)}`);
    }
    return construct(DiscoverSpeakersResponse, {
      scene_id: "(adhoc)",
      candidates: candidates.map((c) => candidateOut(c)),
      usage: rawOut.usage ?? null,
    });
  });

  /**
   * Discover's Add: each name becomes a speaker in this book, cast with the persona of exactly
   * its name when the library has one ("Every new speaker", 2026-09-29). A name the book already
   * has is refused (names are unique within a book) and nothing in the batch is saved.
   */
  app.post("/v1/projects/:project_id/speakers/promote", { schema: { body: PromoteSpeakersRequest } }, async (req) => {
    const h = session.getDb();
    const projectId = req.params.project_id;
    if (projectById(h, projectId) === null) throw notFound(`project ${projectId}`);
    const created = [];
    const reused = [];
    h.tx(() => {
      for (const cand of req.body.candidates) {
        const [speaker, wasCreated] = ensureSpeaker(h, projectId, { name: cand.name, description: cand.description, aliases: cand.aliases, unique: true });
        (wasCreated ? created : reused).push(speaker.id);
      }
    });
    return construct(PromoteSpeakersResponse, { created, reused });
  });
}

/** `project.discover_ignored = json.dumps(names) if names else None`. */
function _setIgnored(h, project, nameList) {
  const value = nameList.length ? pyJson(nameList) : null;
  if (project.discover_ignored !== value) h.update(Project, { discover_ignored: value }, { id: project.id });
}
