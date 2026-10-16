// SPDX-License-Identifier: MIT
// The one-click audiobook's run — the one-click plan's slice 5 (docs/plans/2026-10-11-one-click-
// audiobook.md §4, §5, §10 item 5): one press turns a book into a finished audiobook, unattended.
//
// A run is a persistent job, the pattern render_jobs.js keeps: a `book_runs` row (the project, its
// scope, the step and chapter it is on, its status, and per step what ran — model, recipe, tokens
// in and out, seconds, counts), driven by a background task on the kit's `background()`, swept to
// "paused" at start-up (app.js) and resumed from where it stopped. The run's own table is not
// synced (sync.js lists what is); what it writes — lines, speakers, voices, personas — syncs as
// those always do, stamped after each step (`flushSync`, as a write request's answer is).
//
// Each step is a function the run calls directly — the same one its route calls (the plan's §4):
//
//   discover     each chapter — extraction_api.discoverChapter
//   merge        the scans' names, one person each — extraction_api.mergeFoundNames
//   add          them as the book's speakers, and the narrator — promoteSpeakers, addNarrator
//   analyze      each chapter — extraction_api.analyzeChapter (Analyze's route)
//   group_lines  each chapter's lines with no single speaker — extraction_api.giveGroupLines
//   describe     each main speaker's voice, in words — book_voices.describeVoices
//   design       each described voice designed and kept — book_voices.makeVoices
//   match        the rest from the library — book_voices.matchRest
//   direction    each chapter — extraction_api.directScene
//   render       every line with no take, one render job — render_jobs.createJob / startJob
//   check        every take in use — take_check.checkTakes
//   export       the chapters mastered, the M4B — export_jobs_api.startM4bExport
//
// Batched by kind, in that order: the language model's steps together, then the voices designed
// on the speech models, the language model again (match, direction), then the render and the
// check — a few model swaps a book (the plan's §4).
//
// Idempotent: a chapter a step already did — before this run or in it — is kept, unless the run
// was asked to redo that step (`redo`); a line you set is never overwritten (each step's own
// rule); Analyze on a chapter with takes stays refused (its 409, recorded as the chapter's and the
// run goes on). It never stops to ask: what it isn't sure of is flagged where Script and Render
// show flags, and the run carries on. A step that cannot go on — no language model, a model that
// fails, no ffmpeg — stops the run with its reason, and Resume picks up there.
//
// A run that sends the book to a cloud model asks once, before it starts: its tokens are estimated
// from the text each AI step reads (`estimateRun`) and priced from the kit's pricing table, and
// the start must carry `accept_price` (book_runs_api.js).

import { LLMNotConfiguredError, resolveRoute, stores as llmStores } from "@delebash/llm-runner/llm";
import { costFor, priceFor } from "@delebash/llm-runner/llm/pricing";
import { resolveFeaturePresetWithSource } from "@delebash/llm-runner/llm/preset_resolve";
import { background } from "@delebash/llm-runner/platform/asyncutil";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { isDict, strip } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { speakerLineCounts } from "./api/_speaker_helpers.js";
import { _sttReadiness } from "./api/capture_readiness_api.js";
import * as exportJobsApi from "./api/export_jobs_api.js";
import * as extraction from "./api/extraction_api.js";
import { promoteSpeakers } from "./api/extraction_api.js";
import { addNarrator } from "./api/speakers_api.js";
import * as appState from "./app_state.js";
import * as bookVoices from "./book_voices/index.js";
import { ACTIONS as VOICE_ACTIONS, FEATURE as VOICES_FEATURE } from "./book_voices/prompts.js";
import { Block, BookRun, Project, Scene, Speaker, utcnow, uuid } from "./database/models.js";
import * as session from "./database/session.js";
import { jvLlmConfig } from "./engines/llm/run.js";
import { conflict, HttpError, notFound } from "./errors.js";
import * as exportAudiobook from "./export_audiobook.js";
import * as direction from "./extraction/direction.js";
import * as groupLines from "./extraction/group_lines.js";
import * as mergeNames from "./extraction/merge_names.js";
import * as pipeline from "./extraction/pipeline.js";
import { around } from "./extraction/second_look.js";
import { resolveMarks, segmentParagraphs, splitIntoParagraphs } from "./extraction/segmentation.js";
import { isMarker } from "./line_takes.js";
import * as lineTakes from "./line_takes.js";
import { construct, ExtractionSettings } from "./models.js";
import * as renderJobs from "./render_jobs.js";
import * as self from "./book_run.js";
import { flushSync } from "./sync.js";
import * as takeCheck from "./take_check.js";
import * as vmod from "./voice_model.js";

export const log = getLogger("justvoice.book_run");

/** The steps, in the order the run takes them. */
export const STEPS = ["discover", "merge", "add", "analyze", "group_lines", "describe", "design", "match", "direction", "render", "check", "export"];

/** The steps a run can be asked to do again over what an earlier pass did. The others redo
 * nothing by their nature: merge and add only add who is missing, the voices steps never recast a
 * speaker, group lines asks only about lines with no speaker, the export always runs. */
export const REDO_STEPS = ["discover", "analyze", "direction", "render", "check"];

/** The AI steps: the feature and the prompt row each runs on, and its recipe (null — it has one). */
const AI_STEPS = {
  discover: { feature: "speaker_discovery", action: () => "speaker_attribution.identify", recipe: () => null },
  merge: {
    feature: mergeNames.FEATURE,
    action: () => (mergeNames.mergeRecipe() === "frontier" ? mergeNames.FRONTIER_ACTION : mergeNames.LOCAL_ACTION),
    recipe: () => mergeNames.mergeRecipe(),
  },
  analyze: {
    feature: "speaker_attribution",
    action: (settings) => `speaker_attribution.${pipeline.pickRoute(null, settings).name}`,
    recipe: (settings) => pipeline.routeRecipe(pipeline.pickRoute(null, settings).name),
  },
  group_lines: { feature: groupLines.ACTION, action: () => groupLines.ACTION, recipe: () => null },
  describe: {
    feature: VOICES_FEATURE,
    action: () => (bookVoices.describeRecipe() === "frontier" ? VOICE_ACTIONS.cast : VOICE_ACTIONS.speaker),
    recipe: () => bookVoices.describeRecipe(),
  },
  match: { feature: "smart_assign", action: () => "smart_assign", recipe: () => null },
  direction: {
    feature: direction.FEATURE,
    action: () => direction.actionOf(direction.directionRecipe()),
    recipe: () => direction.directionRecipe(),
  },
};

const TERMINAL = ["completed", "failed", "cancelled"];

export const _running = new Set(); // run ids with a live runner
const _controllers = new Map(); // run id → its AbortController (Stop)
const _runners = new Map(); // run id → its runner's promise (`finished`)

const _db = () => session.getDb();
const seconds = (since) => Math.round((performance.now() - since) / 100) / 10;

/** A refusal's or failure's words: an HttpError's detail, else its message. */
export function reasonOf(e) {
  if (e instanceof HttpError && typeof e.detail === "string") return e.detail;
  return String(e?.message ?? e);
}
const statusOf = (e) => (e instanceof HttpError ? e.statusCode : e instanceof LLMNotConfiguredError ? 501 : null);

/** The run was stopped (its Stop, or its book deleted). */
class Stopped extends Error {}

function _json(raw, dflt) {
  try {
    const v = raw ? JSON.parse(raw) : dflt;
    return v ?? dflt;
  } catch {
    return dflt;
  }
}

/** A step's record as a run keeps it. */
function freshStep() {
  return {
    status: "pending", // pending | running | done | skipped | failed
    done: 0,
    total: 0,
    kept: 0, // chapters an earlier pass had done — left as they were
    model: null,
    recipe: null,
    tokens_in: 0,
    tokens_out: 0,
    calls: 0,
    seconds: 0,
    note: null,
    error: null,
    chapters: {}, // scene id → "done" | "kept" | "refused" — what this run did with it
    refused: [], // [{scene_id, title, reason}] — the step's own refusal, kept as it said it
  };
}

/** The run's steps, every one present. */
function stepsOf(row) {
  const raw = _json(row?.steps_json, {});
  const out = {};
  for (const key of STEPS) out[key] = { ...freshStep(), ...(isDict(raw[key]) ? raw[key] : {}) };
  return out;
}

const optionsOf = (row) => {
  const o = _json(row?.options_json, {});
  return isDict(o) ? o : {};
};

function projectOf(h, projectId) {
  const p = h.one(`select * from ${Project} where id = ? limit 1`, [projectId], Project);
  if (p === null) throw notFound(`project ${projectId}`);
  return p;
}

function projectLanguage(project) {
  const meta = _json(project.metadata_json, {});
  return isDict(meta) ? strip(String(meta.language || "")) : "";
}

/** The book's chapters that have text, in order — what the per-chapter steps go through. */
export function bookChapters(h, projectId) {
  const scenes = h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
  return scenes.filter((s) => h.all(`select * from ${Block} where scene_id = ?`, [s.id], Block).some((b) => strip(b.text || "") && !isMarker(b)));
}

/** Has Analyze decided this chapter — or did the import, every line with its speaker (Script's
 * "From the import")? Direction reads it either way (directScene's own rule). */
function decided(h, scene) {
  const blocks = h.all(`select * from ${Block} where scene_id = ?`, [scene.id], Block).filter((b) => strip(b.text || "") && !isMarker(b));
  return analyzed(h, scene) || (blocks.length > 0 && blocks.every((b) => b.speaker_id));
}

function analyzed(h, scene) {
  const meta = extraction._sceneMeta(scene);
  if (meta.analyzed_at) return true;
  return h.all(`select source from ${Block} where scene_id = ?`, [scene.id]).some((b) => extraction.PIPELINE_SOURCES.has(b.source));
}

/** What a per-chapter step finds already done on a chapter, before or outside this run. */
const ALREADY = {
  discover: (h, scene) => isDict(extraction._sceneMeta(scene).discover),
  analyze: (h, scene) => decided(h, scene),
  // Only a chapter Analyze decided has lines it left with no speaker to ask about.
  group_lines: (h, scene) => !analyzed(h, scene),
  direction: (h, scene) => isDict(extraction._sceneMeta(scene).direction),
};

// ── the route each AI step runs on, and the price ─────────────────────────

/**
 * The model an AI step runs on right now → `{configured, model, provider, provider_id, cloud,
 * detail}` — the kit's own resolution, as GET /v1/ai/resolved-route reports it (the action's
 * preset over the feature's route). `cloud`: a provider that isn't on this machine (a metered
 * account — the kit's `local` flag, which `presetRecipe` reads too).
 */
export function stepRoute(feature, action) {
  const [preset] = resolveFeaturePresetWithSource(action, feature);
  try {
    const [adapter, model] = resolveRoute(jvLlmConfig(), feature, {
      action,
      providerOverride: preset?.providerId || null,
      modelOverride: preset?.model || null,
    });
    const provider = llmStores.getProviderStore().get(adapter.provider_id);
    return {
      configured: true,
      model,
      provider: provider?.name || adapter.provider_id,
      provider_id: adapter.provider_id,
      cloud: provider?.local === false,
      detail: null,
    };
  } catch (e) {
    if (!(e instanceof LLMNotConfiguredError)) throw e;
    return { configured: false, model: null, provider: null, provider_id: null, cloud: false, detail: reasonOf(e) };
  }
}

/** A prompt row's own words — its system prompt and template — in characters. */
function rowChars(action) {
  const row = llmStores.getPromptStore().get(action);
  return row ? (row.system || "").length + (row.user_template || "").length : 0;
}

/** Each chapter as the estimate reads it: its text, its spoken lines (the segmenter's count), and
 * the size of the text around each line whose narration says several people speak it — what the
 * step for lines with no single speaker sends (`group_lines.severalSpeak` without the cast's names,
 * which aren't known before Discover; a line Analyze will leave blank can't be foreseen). */
function chapterSizes(h, projectId, chapters, words) {
  const marks = extraction._projectMeta(h, projectId).speech_marks;
  const several = groupLines.severalSpeak([]);
  return chapters.map((scene) => {
    const text = extraction._sceneText(h, scene);
    const style = resolveMarks(marks, text);
    const paragraphs = splitIntoParagraphs(text);
    const segments = segmentParagraphs(paragraphs, { marks: style });
    const lines = segments.filter((s) => s.kind === "dialogue");
    const near = direction.narrationAround(segments);
    const groupAsks = lines
      .filter((s) => several(near.get(s.dialogue_id).before, "before") || several(near.get(s.dialogue_id).after, "after"))
      .map((s) => around(paragraphs, s.paragraph_idx, s.text, words).length);
    return { scene, chars: text.length, spoken: lines.length, groupAsks };
  });
}

/**
 * The tokens each AI step will send and get back, and their price → `{steps: {key: {tokens_in,
 * tokens_out, price}}, tokens_in, tokens_out, price, unpriced}`. Arithmetic, not a measurement:
 * what a step sends is its prompt rows and the text it reads, at `book_run.chars_per_token`
 * characters a token; what comes back is `extraction.answer_tokens_per_line` a spoken line for the
 * steps that answer line by line (Analyze, Direction) and once a call for the rest. Chapters a step
 * already did are left out, as the run leaves them (`redo` aside). The lines with no single speaker:
 * one call for each line whose narration says several speak it, in the chapters Analyze will read,
 * with the text around it (Alice VII, 2026-10-16: 3 calls, 9,949 tokens — a third of the run's).
 * The answers are counted at the reserve a line gets, so the figure leans high: the price is shown
 * as "up to about" (decided 2026-10-16). A step on a model of this machine costs nothing; a cloud
 * model with no row in AI Settings → Pricing has no price (`unpriced`), and then neither has the
 * total.
 */
export function estimateRun(h, projectId, routes, { redo = [], settings }) {
  const cpt = Number(settings.book_run.chars_per_token) || 4;
  const ext = settings.extraction ?? construct(ExtractionSettings, {});
  const apt = ext.answer_tokens_per_line;
  const chapters = bookChapters(h, projectId);
  const sizes = chapterSizes(h, projectId, chapters, ext.second_look_words);
  const todo = (key) => sizes.filter((s) => redo.includes(key) || !ALREADY[key](h, s.scene));
  const tokens = (chars) => Math.ceil(chars / cpt);
  const bookChars = sizes.reduce((n, s) => n + s.chars, 0);
  const raw = {};
  const perChapter = (key, extra = () => 0) => {
    const list = todo(key);
    const row = rowChars(routes[key].action);
    return {
      tokens_in: list.reduce((n, s) => n + tokens(row + s.chars + extra(s)), 0),
      tokens_out: list.reduce((n, s) => n + apt * (key === "discover" ? 1 : s.spoken), 0),
    };
  };
  raw.discover = perChapter("discover");
  raw.merge = { tokens_in: tokens(rowChars(routes.merge.action)), tokens_out: apt };
  raw.analyze = perChapter("analyze");
  // Asked in the chapters Analyze reads this run (a chapter decided before has its answers).
  const asks = todo("analyze").flatMap((s) => s.groupAsks);
  const groupRow = rowChars(routes.group_lines.action);
  raw.group_lines = { tokens_in: asks.reduce((n, chars) => n + tokens(groupRow + chars), 0), tokens_out: apt * asks.length };
  // The voices steps ask only about speakers with no persona: a book whose speakers are all cast
  // costs them nothing (a re-run); before Discover nobody is known, so the estimate counts them.
  const speakers = h.all(`select persona_id from ${Speaker} where project_id = ?`, [projectId]);
  const allCast = speakers.length > 0 && speakers.every((sp) => sp.persona_id);
  raw.describe = allCast ? { tokens_in: 0, tokens_out: 0 } : { tokens_in: tokens(rowChars(routes.describe.action) + bookChars), tokens_out: apt };
  raw.match = allCast ? { tokens_in: 0, tokens_out: 0 } : { tokens_in: tokens(rowChars(routes.match.action)), tokens_out: apt };
  if (routes.direction.recipe === "frontier") {
    // The Frontier recipe reads every chapter before the one it directs.
    const before = new Map();
    let sum = 0;
    for (const s of sizes) {
      before.set(s.scene.id, sum);
      sum += s.chars;
    }
    raw.direction = perChapter("direction", (s) => before.get(s.scene.id));
  } else raw.direction = perChapter("direction");

  const out = { steps: {}, tokens_in: 0, tokens_out: 0, price: 0, unpriced: [] };
  for (const [key, t] of Object.entries(raw)) {
    const route = routes[key];
    let price = 0;
    if (route.cloud) {
      if (priceFor(route.model)) price = costFor(route.model, t.tokens_in, t.tokens_out);
      else {
        price = null;
        if (!out.unpriced.includes(route.model)) out.unpriced.push(route.model);
      }
    }
    out.steps[key] = { ...t, price };
    out.tokens_in += t.tokens_in;
    out.tokens_out += t.tokens_out;
    if (out.price !== null) out.price = price === null ? null : out.price + price;
  }
  if (out.price !== null) out.price = Math.round(out.price * 100) / 100;
  return out;
}

/** What each step will run on: the AI steps' routes and recipes, the speech steps' models. */
function stepModels(settings) {
  const out = {};
  for (const [key, s] of Object.entries(AI_STEPS)) {
    const action = s.action(settings);
    out[key] = { ...self.stepRoute(s.feature, action), feature: s.feature, action, recipe: s.recipe(settings) };
  }
  const cfg = settings.book_voices;
  const name = (m) => {
    try {
      return vmod.modelName(m);
    } catch {
      return m;
    }
  };
  out.design = { model: `${name(cfg.design_model)} → ${name(cfg.clone_model)}` };
  const stt = _sttReadiness();
  out.check = { model: stt.display_name, ready: Boolean(stt.ready) };
  return out;
}

/**
 * What a run of this book would do now, before it starts → `{project_id, chapters, steps:
 * [{key, kind, model, provider, cloud, configured, recipe, action, estimate}], estimate,
 * ask_price, problems, warnings}`. `problems` stop it starting (no chapter with text, no language
 * model, the book's language not set); `warnings` don't (no ffmpeg — it stops before the M4B; no
 * speech recognition — the takes go unchecked). `ask_price`: an AI step runs on a cloud model, so
 * the start must carry `accept_price` (the plan's Q8: "shown before it starts, and the run asks
 * once").
 */
export function planRun(h, projectId, { redo = [] } = {}) {
  const project = projectOf(h, projectId);
  const settings = appState.getState().settings.get();
  const models = stepModels(settings);
  const chapters = bookChapters(h, projectId);
  const problems = [];
  const warnings = [];
  if (!chapters.length) problems.push({ step: "discover", code: "no_text" });
  const unconfigured = Object.keys(AI_STEPS).find((k) => !models[k].configured);
  if (unconfigured) problems.push({ step: unconfigured, code: "no_model", detail: models[unconfigured].detail });
  if (!projectLanguage(project)) problems.push({ step: "design", code: "no_language" });
  if (!exportAudiobook.haveFfmpeg()) warnings.push({ step: "export", code: "no_ffmpeg" });
  if (!models.check.ready) warnings.push({ step: "check", code: "no_recognition" });
  const routes = Object.fromEntries(Object.keys(AI_STEPS).map((k) => [k, models[k]]));
  const estimate = unconfigured || !chapters.length ? null : estimateRun(h, projectId, routes, { redo, settings });
  const steps = STEPS.map((key) => {
    const m = models[key] ?? {};
    return {
      key,
      kind: AI_STEPS[key] ? "ai" : key === "design" || key === "render" ? "speech" : key === "check" ? "recognition" : key === "export" ? "file" : "book",
      model: m.model ?? null,
      provider: m.provider ?? null,
      cloud: Boolean(m.cloud),
      configured: m.configured ?? true,
      recipe: m.recipe ?? null,
      action: m.action ?? null,
      feature: m.feature ?? null,
      estimate: estimate?.steps[key] ?? null,
    };
  });
  return {
    project_id: projectId,
    chapters: chapters.length,
    steps,
    estimate: estimate ? { tokens_in: estimate.tokens_in, tokens_out: estimate.tokens_out, price: estimate.price, unpriced: estimate.unpriced } : null,
    ask_price: steps.some((s) => s.kind === "ai" && s.cloud),
    problems,
    warnings,
  };
}

// ── the run's life ────────────────────────────────────────────────────────

/** The live run of a book (queued or running), or null. */
export function liveRun(h, projectId) {
  return h.one(`select * from ${BookRun} where project_id = ? and status in ('queued', 'running') order by created_at desc limit 1`, [projectId], BookRun);
}

/** The book's latest run, or null. */
export function latestRun(h, projectId) {
  return h.one(`select * from ${BookRun} where project_id = ? order by created_at desc, rowid desc limit 1`, [projectId], BookRun);
}

/**
 * A new run of the book → its row. Refused (409) while one runs, when a problem stops it
 * (`planRun`), and — when it would send the book to a cloud model — unless `acceptPrice`: the
 * estimate it was shown is kept with the run. `redo`: the steps to do again over what an earlier
 * pass did (REDO_STEPS).
 */
export function createRun(projectId, { scope = "project", acceptPrice = false, redo = [] } = {}) {
  const h = _db();
  projectOf(h, projectId);
  if (liveRun(h, projectId) !== null) throw conflict("This book is being made into an audiobook already.");
  const asked = [...new Set(redo)].filter((k) => REDO_STEPS.includes(k));
  const plan = planRun(h, projectId, { redo: asked });
  const problem = plan.problems[0];
  if (problem) throw conflict(problemText(problem));
  if (plan.ask_price && !acceptPrice) {
    throw conflict(`This run sends the book to a cloud model — ${priceWords(plan.estimate)}. Start it again with accept_price to go ahead.`);
  }
  const runId = uuid();
  const options = { redo: asked, accept_price: Boolean(acceptPrice), estimate: plan.estimate, ask_price: plan.ask_price };
  h.insert(BookRun, { id: runId, project_id: projectId, scope, status: "queued", steps_json: pyJson(stepsOf(null)), options_json: pyJson(options) });
  return h.get(BookRun, runId);
}

/** A problem's words, for an API caller (the screen says its own). */
export function problemText(p) {
  if (p.code === "no_text") return "This book has no text yet — import it or add its chapters first.";
  if (p.code === "no_model") return p.detail || "No language model is set up — set one in AI Settings first.";
  if (p.code === "no_language") return "Set the book's language on its Overview first — its voices are made in it.";
  return p.code;
}

function priceWords(estimate) {
  if (!estimate) return "its price can't be estimated";
  const tokens = `about ${estimate.tokens_in.toLocaleString("en-US")} tokens in and ${estimate.tokens_out.toLocaleString("en-US")} out`;
  return estimate.price === null ? `${tokens}, at a price AI Settings → Pricing doesn't have` : `${tokens}, up to about $${estimate.price.toFixed(2)}`;
}

/** Start the runner. Idempotent — one live runner per run. */
export function startRun(runId) {
  if (_running.has(runId)) return false;
  _running.add(runId);
  _controllers.set(runId, new AbortController());
  const runner = background(`book-run-${runId.slice(0, 8)}`, () => self._runBook(runId), log);
  _runners.set(runId, runner);
  runner.finally(() => {
    if (_runners.get(runId) === runner) _runners.delete(runId);
  });
  return true;
}

/** The run once its live runner has stopped, as `runStatus` shows it (async). */
export async function finished(runId) {
  const runner = _runners.get(runId);
  if (runner !== undefined) await runner;
  return runStatus(runId);
}

/** Stop: the run stops at the next chapter or line, its render or export job with it; what is
 * done is kept, and Resume picks up there. A run with no live runner goes "cancelled" at once. */
export function cancelRun(runId) {
  const h = _db();
  const row = h.get(BookRun, runId);
  if (row === null) return null;
  const ctl = _controllers.get(runId);
  if (ctl !== undefined) {
    ctl.abort(new Stopped("stopped"));
    const steps = stepsOf(row);
    if (steps.render.job_id) renderJobs.cancelJob(steps.render.job_id);
    if (steps.export.export_job_id) exportJobsApi.cancelExportJob(steps.export.export_job_id);
  } else if (!TERMINAL.includes(row.status)) {
    h.update(BookRun, { status: "cancelled", finished_at: utcnow() }, { id: runId });
  }
  return runStatus(runId);
}

/** Resume a paused, stopped or failed run where it stopped. Refused while another run of the book
 * is live; a finished run is left as it is. */
export function resumeRun(runId) {
  const h = _db();
  const row = h.get(BookRun, runId);
  if (row === null) return null;
  if (_running.has(runId) || row.status === "completed") return runStatus(runId);
  const other = liveRun(h, row.project_id);
  if (other !== null && other.id !== runId) throw conflict("This book is being made into an audiobook already.");
  h.update(BookRun, { status: "queued", error: null, finished_at: null }, { id: runId });
  startRun(runId);
  return runStatus(runId);
}

/** Stop a deleted book's runs (DELETE /v1/projects/{id}, as its exports stop). */
export function cancelProjectRuns(projectId) {
  let n = 0;
  for (const runId of [..._running]) {
    const ctl = _controllers.get(runId);
    // The row is gone with its book; the runner notices at its next step.
    if (ctl !== undefined && _db().get(BookRun, runId) === null) {
      ctl.abort(new Stopped("the book was deleted"));
      n += 1;
    }
  }
  if (n) log.info(`book ${projectId} deleted: ${n} run(s) stopped`);
  return n;
}

/** Boot sweep: runs a dead server left queued or running become "paused" — Resume picks up. */
export function sweepStaleRuns() {
  const h = _db();
  const rows = h.all(`select id from ${BookRun} where status in ('queued', 'running')`);
  if (rows.length) h.tx(() => rows.forEach((r) => h.update(BookRun, { status: "paused" }, { id: r.id })));
  return rows.length;
}

// ── what the API shows ────────────────────────────────────────────────────

/** A step as the API shows it: where it stands and what ran, without its working lists. */
function stepOut(key, st) {
  const out = {
    key,
    status: st.status,
    done: st.done,
    total: st.total,
    kept: st.kept,
    model: st.model,
    recipe: st.recipe,
    tokens_in: st.tokens_in,
    tokens_out: st.tokens_out,
    calls: st.calls,
    seconds: st.seconds,
    note: st.note,
    error: st.error,
    refused: st.refused.length,
  };
  // What a step's own counts say.
  if (key === "add") out.added = st.added?.length ?? 0;
  if (key === "design") out.made = st.made?.length ?? 0;
  if (key === "match") out.unmatched = st.unmatched?.length ?? 0;
  if (key === "render") Object.assign(out, { failed: st.failed_lines ?? 0, audio_seconds: st.audio_seconds ?? 0 });
  if (key === "check") Object.assign(out, { flagged: st.flagged ?? 0, rerendered: st.rerendered ?? 0, phase: st.phase ?? null });
  return out;
}

/** The run as the API shows it (a wire dict), or null. `review`: the flags to look at — the run's
 * own findings, read from the book as it is now (async then). */
export function runStatus(runId) {
  const h = _db();
  const row = h.get(BookRun, runId);
  if (row === null) return null;
  const steps = stepsOf(row);
  const options = optionsOf(row);
  // The render and export jobs report their own progress while the run waits on them.
  if (steps.render.status === "running" && steps.render.job_id) {
    const job = renderJobs.jobStatus(steps.render.job_id);
    if (job !== null) {
      steps.render.total = job.total_blocks;
      steps.render.done = job.completed_blocks + job.failed_blocks;
    }
  }
  if (steps.export.status === "running" && steps.export.export_job_id) {
    const job = exportJobsApi.exportJob(steps.export.export_job_id);
    if (job !== null) {
      steps.export.total = job.total;
      steps.export.done = job.done;
      steps.export.note = job.step;
    }
  }
  const scene = row.scene_id ? h.get(Scene, row.scene_id) : null;
  let price = 0;
  for (const key of STEPS) {
    const st = steps[key];
    if (st.model && (st.tokens_in || st.tokens_out)) price += costFor(st.model, st.tokens_in, st.tokens_out);
  }
  const exp = steps.export;
  const m4b = exp.status === "done" && exp.export_job_id ? exportJobsApi.exportJob(exp.export_job_id) : null;
  return {
    id: row.id,
    project_id: row.project_id,
    scope: row.scope,
    status: row.status,
    step: row.step,
    scene_id: row.scene_id,
    scene_title: scene ? scene.title || "" : null,
    error: row.error ? { step: row.step, text: row.error } : null,
    steps: STEPS.map((key) => stepOut(key, steps[key])),
    totals: {
      tokens_in: STEPS.reduce((n, k) => n + steps[k].tokens_in, 0),
      tokens_out: STEPS.reduce((n, k) => n + steps[k].tokens_out, 0),
      // The steps' own time — a pause or a stop between them doesn't count — the running one's so far.
      seconds: Math.round(STEPS.reduce((n, k) => n + steps[k].seconds + (_running.has(runId) && steps[k].since ? (Date.now() - steps[k].since) / 1000 : 0), 0) * 10) / 10,
      price: Math.round(price * 100) / 100,
    },
    redo: options.redo ?? [],
    estimate: options.estimate ?? null,
    // The M4B the run made, while its file waits to be saved (an export job lives in memory: it
    // goes once saved, or with a restart — Export makes it again).
    m4b: m4b !== null && m4b.status === "done" ? { job_id: m4b.id, filename: m4b.filename } : null,
    started_at: row.started_at,
    finished_at: row.finished_at,
    created_at: row.created_at,
  };
}

/**
 * What to check after a run → `{script, takes, voices, uncast, refused}`: each chapter whose lines
 * Script marks to check (its To check count), each line whose take the take check flagged, the
 * voices the run made from the book (yours to hear on Cast), the speakers with lines and no
 * persona, and the chapters a step refused. Read from the book as it is now (async).
 */
export async function runReview(runId) {
  const h = _db();
  const row = h.get(BookRun, runId);
  if (row === null) return null;
  const state = appState.getState();
  const steps = stepsOf(row);
  const projectId = row.project_id;
  const [castIds, narratorId, speakers] = extraction._scriptContext(h, projectId);
  const projectMeta = extraction._projectMeta(h, projectId);
  const out = { script: [], takes: [], voices: [], uncast: [], refused: [] };
  for (const scene of h.all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene)) {
    const blocks = h.all(`select * from ${Block} where scene_id = ? order by position`, [scene.id], Block);
    const [chapter] = extraction._chapterScript(scene, blocks, { castIds, narratorId, speakers, projectMeta });
    if (chapter.to_check) out.script.push({ scene_id: scene.id, title: scene.title || "", lines: chapter.to_check });
    const page = await lineTakes.sceneLines(h, state, scene.id);
    for (const line of page.lines) {
      if (!line.check?.flagged) continue;
      out.takes.push({ scene_id: scene.id, title: scene.title || "", block_id: line.block_id, n: line.n, reasons: line.check.reasons ?? [] });
    }
  }
  for (const m of steps.design.made ?? []) {
    const sp = h.get(Speaker, m.speaker_id);
    if (sp !== null) out.voices.push({ speaker_id: sp.id, name: sp.name, persona_id: m.persona_id });
  }
  const counts = speakerLineCounts(h, projectId);
  for (const sp of h.all(`select * from ${Speaker} where project_id = ? order by name`, [projectId], Speaker)) {
    if (!sp.persona_id && counts.get(sp.id)) out.uncast.push({ speaker_id: sp.id, name: sp.name, lines: counts.get(sp.id) });
  }
  for (const key of STEPS) for (const r of steps[key].refused ?? []) out.refused.push({ step: key, ...r });
  return out;
}

// ── the runner ───────────────────────────────────────────────────────────

/** One run's working state: its row's steps, saved as they change. */
class RunCtx {
  constructor(runId, signal) {
    this.runId = runId;
    this.signal = signal;
    const row = _db().get(BookRun, runId);
    this.projectId = row.project_id;
    this.steps = stepsOf(row);
    this.options = optionsOf(row);
    this.at = { step: row.step, scene_id: row.scene_id };
  }
  get h() {
    return _db();
  }
  get settings() {
    return appState.getState().settings.get();
  }
  gone() {
    return this.h.get(BookRun, this.runId) === null;
  }
  stopped() {
    return this.signal.aborted;
  }
  throwIfStopped() {
    if (this.signal.aborted) throw new Stopped("stopped");
  }
  redo(key) {
    return (this.options.redo ?? []).includes(key);
  }
  /** Save the steps and where the run is. */
  save(fields = {}) {
    if (this.gone()) throw new Stopped("the book was deleted");
    this.h.update(BookRun, { steps_json: pyJson(this.steps), step: this.at.step, scene_id: this.at.scene_id, ...fields }, { id: this.runId });
  }
  /** Count a model's work onto a step: its usage (RunUsage) and recipe. */
  count(key, usage, recipe = null) {
    const st = this.steps[key];
    if (usage) {
      st.tokens_in += Number(usage.prompt_tokens || 0);
      st.tokens_out += Number(usage.completion_tokens || 0);
      st.calls += Number(usage.pieces ?? 1);
      if (usage.model) st.model = usage.model;
    }
    if (recipe) st.recipe = recipe;
  }
  /**
   * A per-chapter step over the book's chapters with text: a chapter this run did is passed over
   * (a resume), one the step had done before is kept unless the run redoes the step (`ALREADY`),
   * the rest run one at a time, saved and stamped after each. A chapter the step refuses (409) is
   * recorded with its reason and the run goes on; a chapter deleted meanwhile is passed over.
   */
  async eachChapter(key, run) {
    const st = this.steps[key];
    const chapters = bookChapters(this.h, this.projectId);
    st.total = chapters.length;
    st.done = chapters.filter((s) => st.chapters[s.id]).length;
    this.save();
    for (const listed of chapters) {
      this.throwIfStopped();
      if (st.chapters[listed.id]) continue;
      const scene = this.h.get(Scene, listed.id);
      if (scene === null) continue;
      if (!this.redo(key) && ALREADY[key](this.h, scene)) {
        st.chapters[scene.id] = "kept";
        st.kept += 1;
        st.done += 1;
        this.save();
        continue;
      }
      this.at.scene_id = scene.id;
      this.save();
      let out;
      try {
        out = await run(scene);
      } catch (e) {
        if (statusOf(e) === 409) {
          st.chapters[scene.id] = "refused";
          st.refused.push({ scene_id: scene.id, title: scene.title || "", reason: reasonOf(e) });
          st.done += 1;
          this.save();
          continue;
        }
        if (statusOf(e) === 404 && this.h.get(Scene, scene.id) === null) continue;
        throw e;
      }
      this.count(key, out?.usage, out?.recipe);
      st.chapters[scene.id] = "done";
      st.done += 1;
      this.save();
      flushSync();
    }
    this.at.scene_id = null;
  }
}

const STEP_FNS = {
  async discover(ctx) {
    await ctx.eachChapter("discover", async (scene) => {
      const got = await extraction.discoverChapter(ctx.h, scene, null, { settings: ctx.settings });
      return { usage: got.usage };
    });
  },

  async merge(ctx) {
    const st = ctx.steps.merge;
    const out = await extraction.mergeFoundNames(ctx.h, ctx.projectId);
    ctx.count("merge", out.usage, out.recipe);
    st.people = out.people.map((p) => ({ name: p.name, description: p.description ?? null, aliases: p.aliases ?? [], lines: p.lines ?? null }));
    st.left_out = out.left_out.map((p) => p.name);
    st.total = st.done = st.people.length;
  },

  async add(ctx) {
    const st = ctx.steps.add;
    const people = ctx.steps.merge.people ?? [];
    const h = ctx.h;
    st.added = [];
    st.total = people.length;
    for (const p of people) {
      try {
        const got = h.tx(() => promoteSpeakers(h, ctx.projectId, [p]));
        if (got.created.length) st.added.push(p.name);
      } catch (e) {
        // A name the book gained since the merge stays as it is.
        if (statusOf(e) !== 409) throw e;
      }
      st.done += 1;
    }
    st.narrator_lines = addNarrator(h, ctx.projectId);
  },

  async analyze(ctx) {
    await ctx.eachChapter("analyze", async (scene) => {
      const out = await extraction.analyzeChapter(ctx.h, scene, { text: extraction._sceneText(ctx.h, scene) }, { settings: ctx.settings });
      return { usage: out.usage, recipe: pipeline.routeRecipe(out.route_used) };
    });
  },

  async group_lines(ctx) {
    await ctx.eachChapter("group_lines", async (scene) => {
      const out = await extraction.giveGroupLines(ctx.h, scene, { settings: ctx.settings });
      return { usage: out.asked ? out.usage : null };
    });
  },

  async describe(ctx) {
    const st = ctx.steps.describe;
    const out = await bookVoices.describeVoices(ctx.h, ctx.projectId);
    ctx.count("describe", out.usage, out.recipe);
    // Held for the next step: nothing in the book stores them (RESEARCH §10.20).
    st.descriptions = out.descriptions;
    st.failed = out.failed.map((f) => ({ speaker_id: f.speaker_id, name: f.name, error: f.error }));
    st.total = out.descriptions.length + out.failed.length;
    st.done = st.total;
  },

  async design(ctx) {
    const st = ctx.steps.design;
    const settings = ctx.settings.book_voices;
    st.model = stepModels(ctx.settings).design.model;
    const descriptions = ctx.steps.describe.descriptions ?? [];
    st.total = descriptions.length;
    ctx.save();
    const out = await bookVoices.makeVoices(ctx.h, ctx.projectId, descriptions, { signal: ctx.signal });
    st.made = [...(st.made ?? []), ...out.made.map((m) => ({ speaker_id: m.speaker_id, name: m.name, persona_id: m.persona_id, voice_id: m.voice_id, narrator: m.narrator }))];
    st.failed = out.failed;
    st.done = (st.made?.length ?? 0) + out.cast_by_name.length + out.left_alone.length + out.failed.length;
    flushSync();
    ctx.throwIfStopped();
    log.info(`book run ${ctx.runId}: ${out.made.length} voices on ${settings.design_model} → ${settings.clone_model}`);
  },

  async match(ctx) {
    const st = ctx.steps.match;
    const out = await bookVoices.matchRest(ctx.h, ctx.projectId);
    ctx.count("match", out.usage);
    st.assigned = out.assigned.map((a) => a.name);
    st.unmatched = out.unmatched.map((u) => u.name);
    st.total = st.done = out.cast_by_name.length + out.assigned.length + out.unmatched.length;
  },

  async direction(ctx) {
    await ctx.eachChapter("direction", async (scene) => {
      const out = await extraction.directScene(scene.id);
      return { usage: out.usage, recipe: out.recipe };
    });
  },

  async render(ctx) {
    const st = ctx.steps.render;
    const h = ctx.h;
    let job = st.job_id ? renderJobs.jobStatus(st.job_id) : null;
    if (job === null) {
      const state = appState.getState();
      const wanted = ctx.redo("render") ? ["ready", "rendered", "stale"] : ["ready"];
      const ids = [];
      for (const scene of bookChapters(h, ctx.projectId)) {
        const page = await lineTakes.sceneLines(h, state, scene.id);
        for (const line of page.lines) if (wanted.includes(line.state)) ids.push(line.block_id);
      }
      job = renderJobs.jobStatus(renderJobs.createJob(ctx.projectId, "blocks", ids, { fresh: ctx.redo("render") }).id);
      st.job_id = job.id;
      st.total = job.total_blocks;
      ctx.save();
      if (job.total_blocks) renderJobs.startJob(job.id);
    } else if (job.status !== "completed") {
      // Paused by a restart, or stopped with the run: its unfinished lines render again.
      renderJobs.resumeJob(job.id);
    }
    const done = await takeCheck._waitFor(renderJobs.finished(job.id), ctx.signal);
    if (done === null || done.status === "cancelled") {
      renderJobs.cancelJob(job.id);
      throw new Stopped("stopped");
    }
    st.total = done.total_blocks;
    st.done = done.completed_blocks + done.failed_blocks;
    st.rendered = done.completed_blocks;
    st.failed_lines = done.failed_blocks;
    st.audio_seconds = Number(done.audio_seconds || 0);
    if (done.failed_blocks && !done.completed_blocks) {
      throw new Error(`${done.failed_blocks} line${done.failed_blocks === 1 ? "" : "s"} failed to render.`);
    }
  },

  async check(ctx) {
    const st = ctx.steps.check;
    const ids = bookChapters(ctx.h, ctx.projectId).map((s) => s.id);
    let out;
    try {
      out = await takeCheck.checkTakes(appState.getState(), ids, {
        redo: ctx.redo("check"),
        signal: ctx.signal,
        onProgress: ({ phase, done, total }) => {
          st.phase = phase;
          st.done = done;
          st.total = total;
          ctx.save();
        },
      });
    } catch (e) {
      // No speech recognition installed: the takes go unchecked, said on the step, and the run
      // goes on to the M4B.
      if (statusOf(e) === 400) {
        st.status = "skipped";
        st.note = reasonOf(e);
        return;
      }
      throw e;
    }
    if (out.stopped) throw new Stopped("stopped");
    st.model = out.recogniser;
    Object.assign(st, { checked: out.checked, passed: out.passed, rerendered: out.rerendered, flagged: out.flagged, unchecked: out.unchecked });
    // Lines judged: each once, however often its take was read back.
    st.total = st.done = out.lines.length + out.skipped;
  },

  async export(ctx) {
    const st = ctx.steps.export;
    let job = st.export_job_id ? exportJobsApi.exportJob(st.export_job_id) : null;
    if (job === null || job.status === "cancelled" || job.status === "error") {
      const started = exportJobsApi.startM4bExport(ctx.projectId);
      st.export_job_id = started.id;
      st.filename = started.filename;
      ctx.save();
      job = exportJobsApi.exportJob(started.id);
    }
    const ended = await takeCheck._waitFor(job.task, ctx.signal);
    if (ended === null) {
      exportJobsApi.cancelExportJob(job.id);
      throw new Stopped("stopped");
    }
    const end = exportJobsApi.exportJob(job.id);
    if (end !== null) Object.assign(st, { done: end.done, total: end.total });
    if (end === null || end.status === "done") return;
    if (end.status === "cancelled") throw new Stopped("stopped");
    throw new Error(end.error || "the M4B export failed");
  },
};

/** The run's runner (async; started by `startRun`). */
export async function _runBook(runId) {
  const ctl = _controllers.get(runId) ?? new AbortController();
  let ctx;
  try {
    const h = _db();
    const row = h.get(BookRun, runId);
    if (row === null) return;
    h.update(BookRun, { status: "running", error: null, ...(row.started_at == null ? { started_at: utcnow() } : {}) }, { id: runId });
    ctx = new RunCtx(runId, ctl.signal);
    for (const key of STEPS) {
      const st = ctx.steps[key];
      if (st.status === "done" || st.status === "skipped") continue;
      ctx.throwIfStopped();
      ctx.at = { step: key, scene_id: null };
      st.status = "running";
      st.error = null;
      st.since = Date.now(); // the step's time so far, while it runs (runStatus)
      ctx.save();
      const t0 = performance.now();
      try {
        await STEP_FNS[key](ctx);
        if (st.status === "running") st.status = "done";
      } catch (e) {
        st.status = e instanceof Stopped || ctx.stopped() ? "pending" : "failed";
        if (st.status === "failed") st.error = reasonOf(e);
        throw e;
      } finally {
        st.seconds = Math.round((st.seconds + seconds(t0)) * 10) / 10;
        delete st.since;
        if (!ctx.gone()) ctx.save();
        flushSync();
      }
      log.info(`book run ${runId}: ${key} ${st.status} (${st.done}/${st.total}, ${st.seconds} s)`);
    }
    ctx.at = { step: null, scene_id: null };
    ctx.save({ status: "completed", finished_at: utcnow() });
  } catch (e) {
    if (ctx?.gone() ?? _db().get(BookRun, runId) === null) return; // its book was deleted
    const stopped = e instanceof Stopped || ctl.signal.aborted;
    if (!stopped) log.warning(`book run ${runId} stopped on ${ctx?.at.step ?? "?"}: ${reasonOf(e)}`);
    try {
      _db().update(
        BookRun,
        stopped ? { status: "cancelled", finished_at: utcnow() } : { status: "failed", error: reasonOf(e), finished_at: utcnow() },
        { id: runId },
      );
    } catch {
      /* nothing more to do */
    }
  } finally {
    _running.delete(runId);
    _controllers.delete(runId);
  }
}
