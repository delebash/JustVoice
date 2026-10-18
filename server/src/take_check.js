// SPDX-License-Identifier: MIT
// Check the takes — the one-click plan's step 8 and slice 6 (docs/plans/2026-10-11-one-click-
// audiobook.md §2, §4, §10 item 6; built 2026-10-16): "each take, its text — re-render once where
// the transcript misses the text or the take runs away; flag the rest".
//
// A take is judged two ways (RESEARCH §10.11):
//   - its length: longer than the speech runtime's runaway limit for its text
//     (`runtime.runawayLimitS` — `speech_runtime.runaway_s_per_char` and `runaway_min_s`, the
//     rule the manager prices models by), it fails, and is not read back (a runaway can run for
//     minutes);
//   - read back: the app's own speech recognition transcribes it (captures_api `_sttTranscribe`,
//     the function behind POST /v1/transcribe), both texts go through Whisper's basic normaliser
//     (whisper_normalizer.js) and the transcript is lined up against the line's words with jsdiff
//     (`diffArrays`, the `diff` package). Words of the line the transcript doesn't have are
//     MISSED (skipped, or heard as other words); words it has past them are EXTRA (a repeat, a
//     take that runs on). Thresholds: `settings.take_check` (models.js TakeCheckSettings).
//
// Batched by kind (plan §4 — the AI model and the speech models take turns on one card): every
// take is read back with one recogniser load, then every failed one is rendered again ONCE in
// one render job with a new seed (↻ New take's, render_jobs `newTake`), then the new takes are
// read back; one that still fails is flagged. What the check found lives in each line's
// metadata (line_takes.TAKE_CHECK), so the check is a step that can be stopped and run again:
//   {generation_id, ok: true}               passed — skipped next time
//   {generation_id, ok: false, flagged: false} failed; its one re-render is owed (the next run
//                                           renders it if this run stopped first)
//   {generation_id, ok: false, flagged: true}  failed after its re-render (or the re-render
//                                           failed) — the user's to hear
// A failed record about an OLDER take means the take in use is that take's re-render. `redo`
// ignores every record. Only lines whose take in use was made from what the line is now
// ("rendered") are checked; a stale line is rendered again before it is worth hearing.
//
// The step is a function the one-click run calls directly (plan §4); POST
// /v1/scenes/{id}/check_takes (render_lines_api.js) calls it for one chapter.

import { diffArrays } from "diff";
import { getLogger } from "@delebash/core/platform/log";
import { pyRound, splitWs } from "@delebash/core/platform/py";
import { pyJson } from "@delebash/core/platform/pyjson";
import * as captures from "./api/captures_api.js";
import { personaForBlock } from "./api/_speaker_helpers.js";
import { Block, Generation, Scene } from "./database/models.js";
import * as session from "./database/session.js";
import * as runtime from "./engines/audiocpp/runtime.js";
import { conflict } from "./errors.js";
import * as lineTakes from "./line_takes.js";
import { mediaFile } from "./media_paths.js";
import { dtIso, utcNow } from "./models.js";
import * as renderJobs from "./render_jobs.js";
import * as self from "./take_check.js";
import { BasicTextNormalizer } from "./whisper_normalizer.js";

export const log = getLogger("justvoice.take_check");

// Why a take failed — the record's `reasons`, in this order.
export const RUNAWAY = "runaway"; // longer than the runaway limit for its text
export const MISSED = "missed"; // the read-back misses the line's words
export const EXTRA = "extra"; // the read-back hears words past the line's
export const RERENDER_FAILED = "rerender_failed"; // its one re-render could not be made

const normalizer = new BasicTextNormalizer();

/** A text's words as the check compares them: Whisper's basic normaliser, split on whitespace
 * (jiwer's way after normalising). */
export function words(text) {
  return splitWs(normalizer.normalize(String(text ?? "")));
}

/**
 * The transcript lined up against the text → `{words, missed, extra}`: the text's word count,
 * its words the transcript doesn't have, and the transcript's words past them. jsdiff gives the
 * fewest words added and removed; within a run of changes the removed and added words pair off
 * as words heard wrong (they count as missed), the rest of the added ones are extra.
 */
export function readBack(text, heard) {
  const want = words(text);
  let missed = 0;
  let extra = 0;
  let removed = 0;
  let added = 0;
  const settle = () => {
    missed += removed;
    extra += Math.max(0, added - removed);
    removed = 0;
    added = 0;
  };
  for (const part of diffArrays(want, words(heard))) {
    if (part.removed) removed += part.count;
    else if (part.added) added += part.count;
    else settle();
  }
  settle();
  return { words: want.length, missed, extra };
}

/** The limits a take of `text` is judged by: `settings.take_check` and the runaway limit. */
export function limitsFor(settings, text) {
  const tc = settings.take_check;
  return {
    missedShare: Number(tc.missed_share),
    extraShare: Number(tc.extra_share),
    minWords: Math.max(1, Number(tc.min_words)),
    runawayS: runtime.runawayLimitS(text),
  };
}

/** Is a take of `seconds` longer than its text allows? */
export function runsAway(seconds, limits) {
  return seconds != null && Number(seconds) > limits.runawayS;
}

/**
 * One take's verdict → `{ok, reasons, words, missed, extra}`. `heard`: the recogniser's text, or
 * null when the take was not read back (it runs away — missed and extra are then null);
 * `seconds`: the take's length. A line with no words after normalising (a lone tag) is judged by
 * its length only.
 */
export function judgeTake({ text, heard, seconds, limits }) {
  const reasons = [];
  if (runsAway(seconds, limits)) reasons.push(RUNAWAY);
  if (heard == null) return { ok: !reasons.length, reasons, words: words(text).length, missed: null, extra: null };
  const rb = readBack(text, heard);
  if (rb.words) {
    if (rb.missed >= limits.minWords && rb.missed > limits.missedShare * rb.words) reasons.push(MISSED);
    if (rb.extra >= limits.minWords && rb.extra > limits.extraShare * rb.words) reasons.push(EXTRA);
  }
  return { ok: !reasons.length, reasons, ...rb };
}

// ── the step ─────────────────────────────────────────────────────────

const _checking = new Set(); // scene ids being checked now

/**
 * Check the takes of these chapters (async): read every take in use back, render each failed one
 * again once, read those back, flag what still fails. `redo`: judge every take again, records
 * ignored. `signal`: stop at the next line (what was found so far is kept). `onProgress({phase,
 * done, total})`: phase "check", "render" or "recheck". Returns what this run did:
 * {scene_ids, recogniser, checked, passed, rerendered, flagged, skipped, unchecked, errors,
 * lines: [{block_id, scene_id, n, check}], stopped}. Throws 409 while one of the chapters is
 * being checked already, 404 for an unknown chapter, 400 when speech recognition isn't installed.
 */
export async function checkTakes(state, sceneIds, { redo = false, signal = null, onProgress = null } = {}) {
  const ids = [...new Set(sceneIds)];
  if (ids.some((id) => _checking.has(id))) throw conflict("these takes are being checked already");
  for (const id of ids) _checking.add(id);
  try {
    return await _check(state, ids, { redo, signal, onProgress });
  } finally {
    for (const id of ids) _checking.delete(id);
  }
}

async function _check(state, sceneIds, { redo, signal, onProgress }) {
  const h = session.getDb();
  const out = {
    scene_ids: sceneIds,
    recogniser: null,
    checked: 0,
    passed: 0,
    rerendered: 0,
    flagged: 0,
    skipped: 0,
    unchecked: 0,
    errors: [],
    lines: [],
    stopped: false,
  };
  const stop = () => {
    if (signal?.aborted) out.stopped = true;
    return out.stopped;
  };
  const found = new Map(); // block id → its line in `out.lines`
  const note = (item, rec) => {
    const row = { block_id: item.block.id, scene_id: item.block.scene_id, n: item.n, check: rec };
    if (found.has(item.block.id)) Object.assign(found.get(item.block.id), row);
    else {
      found.set(item.block.id, row);
      out.lines.push(row);
    }
  };

  // What each chapter's lines need.
  const toCheck = [];
  const owed = []; // failed before; their one re-render was not made
  for (const sceneId of sceneIds) {
    const page = await lineTakes.sceneLines(h, state, sceneId);
    for (const row of page.lines) {
      if (row.state !== "rendered" || row.live === null) {
        out.unchecked += 1;
        continue;
      }
      const block = h.get(Block, row.block_id);
      const item = { block, n: row.n, genId: row.live.generation_id, retryOf: null };
      const rec = redo ? null : lineTakes.takeCheckOf(block);
      if (rec !== null && rec.generation_id === item.genId) {
        if (rec.ok === true || rec.flagged === true) out.skipped += 1;
        else owed.push(item);
        continue;
      }
      if (rec !== null && rec.ok !== true && rec.flagged !== true) item.retryOf = rec.generation_id;
      toCheck.push(item);
    }
  }

  // 1. Read every take back.
  const rerender = [...owed];
  await self._readAll(state, toCheck, out, { signal, onProgress, phase: "check" }, (item, verdict, rec) => {
    if (verdict.ok) out.passed += 1;
    else if (rec.flagged) out.flagged += 1;
    else rerender.push(item);
    note(item, rec);
  });
  if (stop() || !rerender.length) return out;

  // 2. Render each failed take again, once, with a new seed — one job per book.
  onProgress?.({ phase: "render", done: 0, total: rerender.length });
  const byProject = new Map();
  for (const item of rerender) {
    const scene = h.get(Scene, item.block.scene_id);
    if (!byProject.has(scene.project_id)) byProject.set(scene.project_id, []);
    byProject.get(scene.project_id).push(item);
  }
  const recheck = [];
  for (const [projectId, items] of byProject) {
    const job = renderJobs.createJob(
      projectId,
      "blocks",
      items.map((i) => i.block.id),
      { newTake: true },
    );
    if (job.total_blocks) renderJobs.startJob(job.id);
    const done = await self._waitFor(renderJobs.finished(job.id), signal);
    if (done === null) {
      // Stopped while it renders: the job carries on (Render shows it); the next run reads its
      // takes back as the re-renders they are.
      out.stopped = true;
      return out;
    }
    const status = new Map((done.blocks || []).map((b) => [b.block_id, b.status]));
    for (const item of items) {
      const st = status.get(item.block.id);
      if (st === "completed") {
        out.rerendered += 1;
        recheck.push(item);
      } else if (st === "failed") {
        const rec = self._flagUnrendered(h, item.block.id, item.genId);
        if (rec !== null) {
          out.flagged += 1;
          note(item, rec);
        }
      }
      // Withdrawn (the job was cancelled): its re-render stays owed.
    }
  }

  // 3. Read the new takes back; what still fails is flagged.
  const again = [];
  const live = lineTakes.liveTakes(
    h,
    recheck.map((i) => i.block.id),
  );
  for (const item of recheck) {
    const pair = live.get(item.block.id);
    if (pair === undefined) continue;
    again.push({ block: h.get(Block, item.block.id), n: item.n, genId: pair[1].id, retryOf: item.genId });
  }
  await self._readAll(state, again, out, { signal, onProgress, phase: "recheck" }, (item, verdict, rec) => {
    if (verdict.ok) out.passed += 1;
    else out.flagged += 1;
    note(item, rec);
  });
  stop();
  return out;
}

/** Judge `items`, each read back with one recogniser load and its record written; `then(item,
 * verdict, record)` after each. A take that runs away fails by its length, unread — a runaway
 * can run for minutes. A take the recogniser fails on is listed in `out.errors` and left as it
 * was. (async) */
export async function _readAll(state, items, out, { signal, onProgress, phase }, then) {
  if (!items.length) return;
  const h = session.getDb();
  const settings = state.settings.get();
  let loaded = false;
  let done = 0;
  onProgress?.({ phase, done, total: items.length });
  for (const item of items) {
    if (signal?.aborted) {
      out.stopped = true;
      return;
    }
    const gen = h.get(Generation, item.genId);
    const text = gen?.text ?? item.block.text ?? "";
    const limits = limitsFor(settings, text);
    let heard = null;
    try {
      if (gen === null || !lineTakes.hasAudio(gen)) throw new Error("the take has no audio");
      if (!runsAway(gen.duration_sec, limits)) {
        if (!loaded) {
          // The recogniser, loaded once for the pass (or the one already loaded).
          const [mgr] = await captures.ensureSttLoaded();
          const engine = mgr.currentFor("stt");
          out.recogniser = (engine ? mgr.currentVariantId(engine) || engine : null) ?? out.recogniser;
          loaded = true;
        }
        heard = await captures._sttTranscribe(mediaFile(gen.audio_path), await _language(h, state, item.block));
      }
    } catch (e) {
      // Speech recognition that can't load at all stops the check with its own words.
      if (!loaded && gen !== null && lineTakes.hasAudio(gen)) throw e;
      log.warning(`take check: line ${item.block.id}: ${e?.message ?? e}`);
      out.errors.push({ block_id: item.block.id, error: String(e?.message ?? e) });
      onProgress?.({ phase, done: ++done, total: items.length });
      continue;
    }
    out.checked += 1;
    const verdict = judgeTake({ text, heard, seconds: gen.duration_sec, limits });
    const rec = {
      generation_id: gen.id,
      ok: verdict.ok,
      // A take that fails as a re-render of a failed one is the user's to hear.
      flagged: !verdict.ok && item.retryOf !== null,
      reasons: verdict.reasons,
      heard,
      words: verdict.words,
      missed: verdict.missed,
      extra: verdict.extra,
      seconds: gen.duration_sec ?? null,
      limit_s: pyRound(limits.runawayS, 2),
      retry_of: item.retryOf,
      recogniser: heard !== null ? out.recogniser : null,
      checked_at: dtIso(utcNow()),
    };
    _write(h, item.block.id, rec);
    then(item, verdict, rec);
    onProgress?.({ phase, done: ++done, total: items.length });
  }
}

/** A failed take whose re-render could not be made: its record is flagged with why. Returns the
 * record, or null when the line has no record about that take (it changed meanwhile). */
export function _flagUnrendered(h, blockId, generationId) {
  const block = h.get(Block, blockId);
  const rec = block !== null ? lineTakes.takeCheckOf(block, generationId) : null;
  if (rec === null) return null;
  const reasons = [...(Array.isArray(rec.reasons) ? rec.reasons : [])];
  if (!reasons.includes(RERENDER_FAILED)) reasons.push(RERENDER_FAILED);
  const flagged = { ...rec, flagged: true, reasons };
  _write(h, blockId, flagged);
  return flagged;
}

/** `promise`'s value, or null once `signal` aborts first. */
export async function _waitFor(promise, signal) {
  if (signal == null) return promise;
  if (signal.aborted) return null;
  let onAbort;
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** The line's record, written into its metadata beside what is there. */
function _write(h, blockId, rec) {
  h.tx(() => {
    const block = h.get(Block, blockId);
    if (block === null) return;
    const meta = lineTakes.blockMeta(block);
    meta[lineTakes.TAKE_CHECK] = rec;
    h.update(Block, { metadata_json: pyJson(meta) }, { id: blockId });
  });
}

/** The language the line was spoken in — its plan's — so the recogniser needn't guess it on a
 * short line; null lets it detect. */
async function _language(h, state, block) {
  const persona = personaForBlock(h, block);
  const storeP = persona !== null ? state.personas.get(persona.id) : null;
  if (storeP == null) return null;
  try {
    return (await lineTakes.planBlock(state, storeP, block)).language || null;
  } catch {
    return null;
  }
}
