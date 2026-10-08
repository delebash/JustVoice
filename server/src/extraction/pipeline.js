// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// End-to-end speaker-attribution pipeline (the port of justvoice/extraction/pipeline.py).
//
// Orchestrates: segmentation → anchor propagation → LLM call (via the shared run path + the
// route presets) → confidence-floor demotion → AttributionRow assembly → the second look.
//
// The dataclasses keep their Python field names: `AttributionRow` IS the wire row
// (`AttributionRowResponse(**row.__dict__)` in extraction_api), so one name per field.

import { getLlmRegistry, LLMNotConfiguredError, resolveFeaturePreset } from "@delebash/llm-runner/llm";
import * as llmDb from "@delebash/llm-runner/llm/db";
import { literal, nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { getLogger } from "@delebash/llm-runner/platform/log";
import {
  B,
  cpLen,
  digitsToInt,
  errText,
  isDict,
  PY_WS,
  pyGet,
  RuntimeError,
  strip,
  truthy,
  ValueError,
} from "@delebash/llm-runner/platform/py";
import { jsonLoads, jsonRawDecode, pyFloatOf, pyStrOf } from "@delebash/llm-runner/platform/pyjson";
import * as run from "../engines/llm/run.js";
import { construct, ExtractionSettings } from "../models.js";
import { findAnchors } from "./anchors.js";
import { match } from "./names.js";
import { ParagraphTooBig, Piece, isBreak, planPieces } from "./pieces.js";
import * as self from "./pipeline.js";
import { formatCharacters, formatCorrections, formatParagraphs } from "./prompts.js";
import { castLines, secondLook } from "./second_look.js";
import { paragraphsOf, segmentParagraphs, splitIntoParagraphs } from "./segmentation.js";

const log = getLogger("justvoice.extraction.pipeline");
const WS = `[${PY_WS}]`;

/** The engine doors, called through this module so a test can stand in for them (Python's
 * tests patch `pipeline.run_feature` / `stream_feature` / `measure_feature`). */
export const runFeature = (action, variables, overrides) => run.runFeature(action, variables, overrides);
export const streamFeature = (action, variables, overrides) => run.streamFeature(action, variables, overrides);
export const measureFeature = (action, variables, overrides) => run.measureFeature(action, variables, overrides);

/**
 * Result row for one segment. Block columns set by POST /v1/scenes/{id}/analyze on persist:
 * speaker_id ← speaker (when not "unknown" or "narrator"), extraction_confidence ←
 * confidence, source ← source.
 *
 * `source`: what the PIPELINE can decide — "narration" | "tag" | "propagated" | "llm" |
 * "floored" (and "second_look" from the second look). Two more reach Block.source once a run
 * is persisted and never come from here: "corrected" and "manual".
 * `floored_from`: when source is "floored", the LLM's pre-floor speaker. `llm_speaker` /
 * `llm_confidence`: when an anchor wins over the LLM, the LLM's pick. `anchor_words`: when an
 * anchor decided the row, the book's own words that named the speaker. `not_in_cast`: who the
 * second look says speaks when they are not in the cast. `second_look_asked`: the second look
 * asked about this row and named no one (2026-10-06).
 */
export class AttributionRow {
  constructor({
    paragraph_idx,
    kind,
    text,
    speaker,
    confidence,
    source,
    floored_from = null,
    llm_speaker = null,
    llm_confidence = null,
    anchor_words = null,
    not_in_cast = null,
    second_look_asked = false,
  }) {
    this.paragraph_idx = paragraph_idx;
    this.kind = kind;
    this.text = text;
    this.speaker = speaker;
    this.confidence = confidence;
    this.source = source;
    this.floored_from = floored_from;
    this.llm_speaker = llm_speaker;
    this.llm_confidence = llm_confidence;
    this.anchor_words = anchor_words;
    this.not_in_cast = not_in_cast;
    this.second_look_asked = second_look_asked;
  }
}

/** Pydantic request shape for POST /v1/scenes/{id}/analyze. */
export const AnalyzeRequest = T.Object({
  text: T.String(),
  characters: opt(T.Array(T.Record(T.String(), T.Any())), []),
  corrections: opt(T.Array(T.Record(T.String(), T.Any())), []),
  // Per-run route force (a route card's Lab run / the API). null = Auto. An unknown value 422s.
  route: opt(nullable(literal("guided", "direct")), null),
  propagate: opt(T.Boolean(), true), // apply anchor propagation pass
  use_floor: opt(T.Boolean(), true), // demote below-floor LLM picks to "unknown"
  // Lab per-column overrides — null means "use the resolved preset / route defaults".
  model: opt(nullable(T.String()), null),
  temperature: opt(nullable(T.Number()), null),
  system_prompt: opt(nullable(T.String()), null),
  // Custom user-prompt template and a per-call floor that beats the route's default.
  user_prompt: opt(nullable(T.String()), null),
  confidence_floor: opt(nullable(T.Number()), null),
  // Route this call through a specific registered LLM provider (Speaker Lab provider dropdown).
  provider_id: opt(nullable(T.String()), null),
  // The Lab column's remaining tunables, forwarded to the shared run path. null = the resolved
  // preset's value (empty preset = uncapped; no code-computed budget).
  think: opt(nullable(T.Boolean()), null),
  reasoning_effort: opt(nullable(T.String()), null),
  max_tokens: opt(nullable(T.Integer()), null),
  top_p: opt(nullable(T.Number()), null),
  samplers: opt(T.Array(T.Record(T.String(), T.Any())), []),
  // Treat the model's context as at most this many tokens (forces chapter splitting).
  max_context: opt(nullable(T.Integer()), null),
  // The second look (2026-10-05): the neighbouring chapters' text, whether to run it (null =
  // settings.extraction.second_look), and the row indices not to ask about.
  before_text: opt(nullable(T.String()), null),
  after_text: opt(nullable(T.String()), null),
  second_look: opt(nullable(T.Boolean()), null),
  second_look_skip: opt(T.Array(T.Integer()), []),
});

/** Drop <think>…</think> blocks from reasoning models so the JSON parse doesn't choke. */
function _stripThinking(text) {
  return strip(text.replace(/<think>[\s\S]*?<\/think>/g, ""));
}

const ARRAY_START = new RegExp(`\\[${WS}*\\{`, "gu");

/**
 * Pull the answer array out of possibly-noisy model output.
 *
 * Measured 2026-09-28 (Qwen3.6-35B-A3B, reasoning on): on some runs whole chapters came back
 * blank — the reply carried prose around the JSON, and the old greedy `[.*]` spanned from a
 * bracket in that prose ("[D5]") to the array's end. Now: every place an array of objects can
 * start is tried, and the longest one that parses wins. Failing that, the individual answer
 * objects are salvaged one by one — safe because each answer names its own [D#].
 */
export function _extractFirstJsonArray(text) {
  text = _stripThinking(text);
  let best = [];
  for (const m of text.matchAll(ARRAY_START)) {
    let value;
    try {
      [value] = jsonRawDecode(text, m.index);
    } catch (e) {
      if (e instanceof ValueError) continue;
      throw e;
    }
    if (Array.isArray(value) && value.length > best.length) best = value;
  }
  if (best.length) return best;
  const salvaged = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    let obj;
    try {
      obj = jsonLoads(m[0]);
    } catch (e) {
      if (e instanceof ValueError) continue;
      throw e;
    }
    if (isDict(obj) && Object.hasOwn(obj, "speaker")) salvaged.push(obj);
  }
  return salvaged;
}

/** The model call behind Script failed; the message is for the user. */
export class AttributionModelError extends RuntimeError {
  constructor(m, options) {
    super(m, options);
    this.name = "AttributionModelError";
  }
}

const _CTX = new RegExp(`"n_prompt_tokens"${WS}*:${WS}*(\\p{Nd}+)[\\s\\S]*?"n_ctx"${WS}*:${WS}*(\\p{Nd}+)`, "u");

/** `{n:,}` — thousands with commas. */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The provider's reason, in words a user can act on. An overflow reaches here only once
 * splitting has run out — one paragraph alone too big — and names both sizes when the provider
 * gave them; anything else is the provider's own text. */
export function modelFailureMessage(e) {
  const text = errText(e);
  if (_isOverflow(e)) {
    const m = _CTX.exec(text);
    return _oneParagraphTooBig(m ? digitsToInt(m[1]) : null, m ? digitsToInt(m[2]) : null);
  }
  return `The model call failed: ${text}`;
}

// The whole id must be a line number ("D12", "d 3", "[D4]", 7) — a handle that happens to hold
// a digit ("nettle_2") is not line 2.
const _DID = new RegExp(`^${WS}*\\[?${WS}*D?${WS}*(\\p{Nd}+)${WS}*\\]?${WS}*$`, "iu");

/** The [D#] an answer names, read the way alignPicks reads it. */
function _pickDid(p) {
  if (!isDict(p) || p.id === null || p.id === undefined) return null;
  const m = _DID.exec(pyStrOf(p.id));
  return m ? digitsToInt(m[1]) : null;
}

/**
 * One pick per dialogue segment, in segment order.
 *
 * Matched by the answer's own `id` ("D12") when the model gives one — the measured failure it
 * fixes (2026-09-28, The Ninth Facet): with a plain positional array, one merged or skipped
 * answer early in a chapter shifted EVERY later answer onto the next line, each still at
 * confidence 1.00. A segment whose id is missing from the reply gets the unknown pad, so a gap
 * stays a gap. A reply with no ids at all (an older prompt) falls back to position.
 */
export function alignPicks(picks, dialogueSegments) {
  const pad = { speaker: "unknown", confidence: 0.4 };
  const byId = new Map();
  for (const p of picks || []) {
    const did = _pickDid(p);
    if (did !== null && !byId.has(did)) byId.set(did, p);
  }
  if (byId.size) return dialogueSegments.map((s) => (byId.has(s.dialogue_id) ? byId.get(s.dialogue_id) : pad));
  const all = (picks || []).map((p) => (isDict(p) ? p : pad));
  const n = dialogueSegments.length;
  return [...all, ...Array(n).fill(pad)].slice(0, n);
}

/**
 * The cast as the model sees it — each persona under a short readable handle made from its
 * name ("cael_ferren"), not its real id — and the map back to the real ids.
 *
 * Measured 2026-09-28 (The Ninth Facet, "The Same Hour", reasoning on): with the app's UUID
 * persona ids in the prompt the model gave three of Cael's lines to Nettle in 7 of 7 runs; with
 * readable ids it was right 2 of 2. Anchors and persistence keep the real ids — only the prompt
 * and the answer mapping use handles. → `[shownCast, Map handle → real id]`.
 */
export function promptHandles(characters) {
  const out = [];
  const toId = new Map();
  for (const c of characters) {
    const real = c.id ?? null;
    const base = strip(pyStrOf(truthy(c.name) ? c.name : "").toLowerCase().replace(/[^a-z0-9]+/g, "_"), "_") || "speaker";
    let handle = base;
    let n = 2;
    while (toId.has(handle)) {
      handle = `${base}_${n}`;
      n += 1;
    }
    toId.set(handle, real);
    out.push({ ...c, id: handle });
  }
  return [out, toId];
}

const _ID_PREFIX = /^(?:c|p|id|char|character|persona)[_-]/i;

/**
 * The model's speaker answer as a real cast id, "narrator" or "unknown".
 *
 * Measured 2026-09-28: on the guided route the model copied the worked examples' id SHAPE
 * ("c_mara") and answered "c_iven_sarraz" for a cast id it had been given — the right person,
 * an id that exists nowhere. An answer that is not a cast id is matched back to the cast by name
 * (names.match: exact name or alias, first/last name, ambiguity refused) after dropping an
 * id-looking prefix and underscores. Anything still unmatched becomes "unknown".
 */
export function resolveSpeaker(raw, characters) {
  const s = strip(pyStrOf(truthy(raw) ? raw : ""));
  if (!s) return "unknown";
  if (s.toLowerCase() === "unknown" || s.toLowerCase() === "narrator") return s.toLowerCase();
  const ids = new Set(characters.filter((c) => truthy(c.id)).map((c) => c.id));
  if (ids.has(s)) return s;
  const name = strip(s.replace(_ID_PREFIX, "").replaceAll("_", " "));
  const hit = match(name, characters) || match(s, characters);
  return hit && truthy(hit.id) ? hit.id : "unknown";
}

export const ROUTES = ["guided", "direct"];

// The per-route confidence floors — JV-local since the tier-debris cleanup (2026-08-07).
// Guided filters stricter because small models spread confidence wider. Route data, not a
// request param: the floor demotes below-floor picks to "unknown" AFTER the model answers.
export const ROUTE_FLOORS = { guided: 0.7, direct: 0.5 };

/** Which attribution route runs, and why — echoed to the caller so the UI shows the SAME choice
 * the pipeline made. `source`: "forced" (per-run override) | "setting" | "auto". */
export class RoutePick {
  constructor(name, floor, source) {
    this.name = name;
    this.floor = floor;
    this.source = source;
    Object.freeze(this);
  }
}

/** The default model of a registered provider — the same fall-through the run itself applies.
 * Empty when unknown. */
function _providerDefaultModel(providerId) {
  if (!providerId) return "";
  try {
    const adapter = getLlmRegistry().get(providerId);
    return adapter != null ? adapter.default_model || "" : "";
  } catch {
    // judging falls to "unknown", never breaks a run
    return "";
  }
}

/** The model a route's run would ACTUALLY use (judge-what-runs, ruled 2026-08-06): the card's
 * preset model when set, else that preset's provider default. Empty when neither is set (Auto
 * then plays it safe). */
export function routeModel(route) {
  const preset = resolveFeaturePreset(`speaker_attribution.${route}`, "speaker_attribution");
  if (preset == null) return "";
  if (strip(preset.model || "")) return preset.model;
  return _providerDefaultModel(preset.providerId || "");
}

const SIZE = new RegExp(`(\\p{Nd}+(?:\\.\\p{Nd}+)?)${WS}*b${B}`, "iu");

/** Billions of parameters for the Auto size rule: the catalog row's total_params when the model
 * is cataloged ("26B", "E4B"), else the first size token in the id ("…-12b-…"). Unknown → 0
 * (reads as small → Guided). */
export function modelSizeB(modelId) {
  let total = "";
  if (modelId) {
    try {
      const row = llmDb.session().one("select total_params from model_catalog where id = ?", [modelId]);
      total = row ? row.total_params || "" : "";
    } catch {
      // any lookup failure falls to the id parse
      total = "";
    }
  }
  for (const source of [total, modelId || ""]) {
    const m = SIZE.exec(source);
    if (m) {
      try {
        return pyFloatOf(m[1]);
      } catch {
        continue;
      }
    }
  }
  return 0.0;
}

/** Python's `format(x, "g")`: six significant digits, scientific below 1e-4 and from 1e6. */
export function formatG(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const [mant, e] = x.toExponential(5).split("e");
  const exp = Number(e);
  const trim = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  if (exp < -4 || exp >= 6) return `${trim(mant)}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  return trim(x.toFixed(Math.max(0, 5 - exp)));
}

/**
 * The Auto pick + its shown work — SIZE ONLY: Direct when the model is at least `directMinB`
 * billion params (a MoE counts TOTAL params), Guided otherwise, including when the size is
 * unknown (worked examples never hurt a big model; missing them hurts a small one).
 *
 * Production (no override): judged against THAT CARD'S OWN model. A per-call MODEL override (a
 * Lab column's pin) is the model that actually runs, so the rule judges IT. → [route, checks].
 */
export function autoRoute(directMinB, modelOverride = "") {
  const m = (route) => modelOverride || self.routeModel(route);
  const checks = [];
  const mDirect = m("direct");
  const size = modelSizeB(mDirect);
  const big = size >= Number(directMinB || 0);
  checks.push({ route: "direct", model: mDirect, passed: big, rule: `when the model is at least ${formatG(Number(directMinB))} B` });
  if (big) return ["direct", checks];
  checks.push({ route: "guided", model: m("guided"), passed: true, rule: "otherwise" });
  return ["guided", checks];
}

/** The route choice: the caller's per-run override wins; otherwise Auto — the size rule,
 * judging the per-call model override when one rides the request. Floors come from
 * ROUTE_FLOORS. */
export function pickRoute(routeOverride, settings, modelOverride = "") {
  if (ROUTES.includes(routeOverride)) return new RoutePick(routeOverride, ROUTE_FLOORS[routeOverride], "forced");
  const ext = settings?.extraction;
  const minB = ext != null && Object.hasOwn(ext, "direct_min_b") ? ext.direct_min_b : 14.0;
  const [name] = autoRoute(minB, modelOverride || "");
  return new RoutePick(name, ROUTE_FLOORS[name], "auto");
}

const _OVERFLOW_WORDS = ["exceed_context_size", "context_length_exceeded", "maximum context length", "prompt is too long"];

/** The provider refused the request as bigger than the model's context. */
function _isOverflow(e) {
  const text = errText(e);
  return _CTX.test(text) || _OVERFLOW_WORDS.some((w) => text.includes(w));
}

/** A piece's answers, each carrying the [D#] it answers — or null when the reply cannot be
 * placed. Answers that name their line are kept as they are. A reply that names NO line but
 * gives exactly one answer per line of the piece is placed by order; any other id-less reply
 * cannot be trusted to line up and is null. */
function _placePieceAnswers(got, pieceIds) {
  if (got.some((p) => _pickDid(p) !== null)) return got;
  if (got.length && got.length === pieceIds.length) {
    const out = [];
    got.forEach((p, i) => {
      if (isDict(p)) out.push({ ...p, id: `D${pieceIds[i]}` });
    });
    return out;
  }
  return null;
}

function _oneParagraphTooBig(tokens, context) {
  const sizes = tokens && context ? ` It needs about ${grouped(tokens)} tokens and the model holds ${grouped(context)}.` : "";
  return `A paragraph of this chapter is too long for the model to read, even on its own.${sizes} Use a model with a larger context.`;
}

/**
 * The model's answers for every dialogue line, read in as many calls as the model's context
 * needs — usually one (2026-09-28, the chapter-splitting plan).
 *
 * The prompt is measured first (the kit's measureAction: the model's own tokenizer against its
 * real context). When the chapter plus the room its answer needs does not fit, it is cut into
 * pieces of whole paragraphs, each with a lead-in from the piece before (pieces.js). Every piece
 * is sent with the same cast, corrections and prompt; its answers for the lines it OWNS are kept.
 *
 * Two backstops, for what measuring cannot see: a refusal as too big, or a reply cut off at the
 * context (finish_reason "length"), halves the piece and runs both halves. Only a single
 * paragraph that still does not fit fails.
 */
async function _attributeInPieces(request, settings, pick, paragraphs, segments, promptCast, promptCorrections, { onDelta, onProgress, rawOut, onThinking = null }) {
  const t0 = performance.now() / 1000;
  const ext = settings?.extraction ?? construct(ExtractionSettings, {});
  const leadIn = ext.split_lead_in_paragraphs;
  const callKwargs = {
    system: request.system_prompt || null,
    userTemplate: request.user_prompt || null,
    temperature: request.temperature,
    // Caps ruling 2026-08-07: no code-computed budget. An explicit per-call value rides; null
    // falls to the preset (empty = uncapped, nothing sent).
    maxTokens: request.max_tokens,
    model: request.model || "",
    providerId: request.provider_id || "",
    think: request.think,
    reasoningEffort: request.reasoning_effort,
    topP: request.top_p,
    samplers: request.samplers || [],
  };
  // The route's OWN template row + OWN preset run (per-route routing). The Lab's system/user
  // candidates ride the explicit-prompt door.
  const action = `speaker_attribution.${pick.name}`;
  const baseVars = { speakers: formatCharacters(promptCast), corrections: formatCorrections(promptCorrections) };
  const nPara = paragraphs.length;
  const segsIn = (lo, hi) => segments.filter((s) => lo <= s.paragraph_idx && s.paragraph_idx < hi);
  const varsFor = (segs) => ({ ...baseVars, paragraphs: formatParagraphs(segs) });

  let plan = [new Piece(0, 0, nPara)];
  let fit;
  let empty;
  try {
    fit = await self.measureFeature(action, varsFor(segments), callKwargs);
    empty = fit != null ? await self.measureFeature(action, varsFor([]), callKwargs) : null;
  } catch (e) {
    // measuring only sizes pieces; the call itself reports failures
    log.info(`speaker_attribution: could not measure the prompt (${errText(e)}) - running unmeasured`);
    fit = empty = null;
  }
  if (fit != null && empty != null) {
    const context = Math.min(fit.context, request.max_context || fit.context);
    const overhead = empty.prompt_tokens;
    const textTokens = Math.max(fit.prompt_tokens - overhead, 0);
    const rendered = [];
    const lines = [];
    for (let i = 0; i < nPara; i++) {
      const segs = segsIn(i, i + 1);
      rendered.push(formatParagraphs(segs));
      lines.push(segs.filter((s) => s.kind === "dialogue").length);
    }
    const totalChars = rendered.reduce((a, r) => a + cpLen(r), 0) || 1;
    const costs = rendered.map((r, i) => Math.ceil((cpLen(r) * textTokens) / totalChars) + ext.answer_tokens_per_line * lines[i]);
    const room = context - overhead;
    if (costs.reduce((a, b) => a + b, 0) > room) {
      const breaks = new Set();
      paragraphs.forEach((para, i) => {
        if (isBreak(para)) breaks.add(i);
      });
      try {
        plan = planPieces(costs, room, leadIn, breaks);
      } catch (e) {
        if (e instanceof ParagraphTooBig) throw new AttributionModelError(_oneParagraphTooBig(costs[e.index] + overhead, context), { cause: e });
        throw e;
      }
    }
  }

  const state = { done: 0, total: plan.length };
  const texts = [];
  const picks = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, model: "" };

  /** One model call → [reply text, finish_reason]. */
  const call = async (variables) => {
    if (onDelta === null) {
      const resp = await self.runFeature(action, variables, callKwargs);
      usage.prompt_tokens += Math.trunc(Number(resp?.prompt_tokens || 0));
      usage.completion_tokens += Math.trunc(Number(resp?.completion_tokens || 0));
      usage.model = resp?.model || usage.model;
      return [resp.text, resp?.finish_reason || ""];
    }
    // Lane 2A: same route, same template row, same preset — the reply just STREAMS. The final
    // delta carries the usage and why it ended.
    const parts = [];
    let finish = "";
    for await (const delta of await self.streamFeature(action, variables, callKwargs)) {
      if (delta.done) {
        usage.prompt_tokens += Math.trunc(Number(delta.prompt_tokens || 0));
        usage.completion_tokens += Math.trunc(Number(delta.completion_tokens || 0));
        usage.model = delta.model || usage.model;
        finish = delta.finish_reason || "";
      } else if (delta.progress !== null && delta.progress !== undefined) {
        // One bar across every piece.
        if (onProgress !== null) onProgress(Math.min(1.0, (state.done + delta.progress) / state.total));
      } else if (delta.reasoning) {
        // The model thinking before its answer — shown and counted on the strip, never part
        // of the reply (2026-10-06).
        if (onThinking !== null) onThinking(delta.reasoning);
      } else if (delta.text) {
        parts.push(delta.text);
        onDelta(delta.text);
      }
    }
    return [parts.join(""), finish];
  };

  const queue = [...plan];
  const retried = new Set();
  while (queue.length) {
    const pc = queue.shift();
    const segs = segsIn(pc.lead, pc.end);
    const owned = new Set(segs.filter((s) => s.kind === "dialogue" && s.paragraph_idx >= pc.start).map((s) => s.dialogue_id));
    if (!owned.size) {
      state.done += 1;
      continue;
    }
    let refused = null;
    let text;
    let cutOff;
    try {
      let finish;
      [text, finish] = await call(varsFor(segs));
      cutOff = finish === "length";
    } catch (e) {
      if (!_isOverflow(e)) throw e;
      [cutOff, text, refused] = [true, "", e];
    }
    if (cutOff) {
      if (pc.end - pc.start < 2) {
        throw new AttributionModelError(refused ? modelFailureMessage(refused) : _oneParagraphTooBig(null, null));
      }
      const mid = Math.floor((pc.start + pc.end) / 2);
      queue.unshift(new Piece(pc.lead, pc.start, mid), new Piece(Math.max(mid - leadIn, 0), mid, pc.end));
      state.total += 1;
      log.info(`speaker_attribution: paragraphs ${pc.start}-${pc.end - 1} did not fit - halved`);
      continue;
    }
    let got = _extractFirstJsonArray(text);
    const whole = pc.lead === 0 && pc.start === 0 && pc.end === nPara;
    if (!whole) {
      got = _placePieceAnswers(
        got,
        segs.filter((s) => s.kind === "dialogue").map((s) => s.dialogue_id),
      );
      if (got === null && !retried.has(pc.key)) {
        // Measured 2026-09-28 (Gemma, forced 5k context, 1 run in 3): a piece's reply put the
        // speaker in the id field — nothing to place it by. Once more, then the lines stay
        // unknown like any unanswered line.
        retried.add(pc.key);
        queue.unshift(pc);
        log.info(`speaker_attribution: paragraphs ${pc.start}-${pc.end - 1} answered without line numbers - retrying`);
        continue;
      }
      got = (got || []).filter((p) => owned.has(_pickDid(p)));
    }
    texts.push(text);
    // The whole chapter in one call keeps every answer (an id-less reply from an older prompt
    // still aligns by position in alignPicks); a piece keeps the lines it owns.
    picks.push(...got);
    state.done += 1;
  }

  if (rawOut !== null) {
    rawOut.llm_text = texts.join("\n\n");
    // §16: the run's usage rides the response (0 = unreported); `pieces` is how many model
    // calls it took (1 = the chapter fit).
    rawOut.usage = { ...usage, duration_ms: Math.trunc((performance.now() / 1000 - t0) * 1000), pieces: texts.length };
  }
  return picks;
}

/** `x in dict` raises for an unhashable x (a list or a dict) in Python. */
function hashable(x) {
  if (Array.isArray(x) || isDict(x)) throw new TypeError(`unhashable type: '${Array.isArray(x) ? "list" : "dict"}'`);
  return x;
}

/**
 * Run the full pipeline → the AttributionRow list in the same order as the segments appear in
 * the scene. Narration rows have speaker "narrator", confidence 1.0, source "narration".
 * `settings` carries the Auto size rule (settings.extraction); engine routing itself stays
 * preset-resolved.
 *
 * `marks` is the chapter's speech-mark style (segmentation.SPEECH_MARKS); null reads it from the
 * text. `segments` skips segmenting altogether: an analyzed chapter whose lines were edited since
 * is re-read as its lines stand (`extraction_api._segments_from_lines`), one row per segment, in
 * order — `request.text` is then only what the rows are reported against.
 *
 * `onDelta` (lane 2A): when set, the LLM call STREAMS — each raw text chunk is passed to
 * `onDelta(text)` as it arrives, and `onProgress(0..1)` gets the builtin engine's prompt-eval
 * frames. Inputs, outputs, parsing, floor and rawOut are IDENTICAL either way. The second look
 * streams through the same `onDelta`; `onStep(done, total, rows)` hears it start and finish
 * each line, and `stop()` ends it before its next line.
 */
export async function analyzeScene({
  settings,
  request,
  rawOut = null,
  onDelta = null,
  onProgress = null,
  marks = null,
  segments = null,
  onStep = null,
  stop = null,
  onThinking = null,
}) {
  request = construct(AnalyzeRequest, request);
  // ── 1. Segment ───────────────────────────────────────────────
  let paragraphs;
  if (segments === null) {
    paragraphs = splitIntoParagraphs(request.text);
    segments = segmentParagraphs(paragraphs, { marks });
  } else {
    paragraphs = paragraphsOf(segments);
  }
  if (!segments.length) return [];

  // ── 2. Deterministic anchors (pre-LLM) ───────────────────────
  const anchors = request.propagate ? findAnchors(segments, request.characters) : new Map();

  // ── 3. Pick the route + run through the shared path ──────────
  const pick = pickRoute(request.route, settings, request.model || "");
  const floor = request.confidence_floor !== null ? request.confidence_floor : pick.floor;
  if (rawOut !== null) {
    // The pick that RAN, for the response meta — one source, no re-derive.
    rawOut.route = pick.name;
    rawOut.route_source = pick.source;
    rawOut.floor = floor;
  }

  const dialogueSegments = segments.filter((s) => s.kind === "dialogue");
  const [promptCast, handleToId] = promptHandles(request.characters);
  const idToHandle = new Map([...handleToId].map(([k, v]) => [v, k]));
  const promptCorrections = (request.corrections || []).map((c) => {
    const sid = pyGet(c, "speaker_id");
    return { ...c, speaker_id: idToHandle.has(sid) ? idToHandle.get(sid) : sid };
  });

  let llmPicks = [];
  if (dialogueSegments.length > 0) {
    try {
      llmPicks = await _attributeInPieces(request, settings, pick, paragraphs, segments, promptCast, promptCorrections, {
        onDelta,
        onProgress,
        rawOut,
        onThinking,
      });
    } catch (e) {
      // Not configured → the API layer's 501 with the actionable message.
      if (e instanceof LLMNotConfiguredError || e instanceof AttributionModelError) throw e;
      // A failed call stops the run with the provider's reason. Swallowing it turned every
      // failure into a chapter of "unknown" lines with no message (pass 10).
      log.warning(`speaker_attribution LLM call failed: ${errText(e)}`);
      throw new AttributionModelError(modelFailureMessage(e), { cause: e });
    }
  }

  llmPicks = alignPicks(llmPicks, dialogueSegments);

  // ── 4. Assemble rows ─────────────────────────────────────────
  const rows = [];
  let d = 0;
  for (const seg of segments) {
    if (seg.kind === "narration") {
      rows.push(new AttributionRow({ paragraph_idx: seg.paragraph_idx, kind: "narration", text: seg.text, speaker: "narrator", confidence: 1.0, source: "narration" }));
      continue;
    }
    // Dialogue
    const ds = dialogueSegments[d];
    const p = llmPicks[d];
    d += 1;
    const did = ds.dialogue_id;
    // The model sees name handles; a real id echoed back still counts.
    const rawSpeaker = hashable(pyGet(p, "speaker"));
    let llmSpeaker;
    if (idToHandle.has(rawSpeaker)) llmSpeaker = rawSpeaker;
    else {
      const h = resolveSpeaker(rawSpeaker, promptCast);
      llmSpeaker = handleToId.has(h) ? handleToId.get(h) : h;
    }
    let llmConf;
    try {
      const c = pyGet(p, "confidence");
      llmConf = pyFloatOf(truthy(c) ? c : 0.4);
    } catch (e) {
      if (!(e instanceof TypeError) && !(e instanceof ValueError)) throw e;
      llmConf = 0.4;
    }

    const anchor = anchors.get(did);
    if (anchor !== undefined) {
      // Anchor wins on tie-break.
      rows.push(
        new AttributionRow({
          paragraph_idx: seg.paragraph_idx,
          kind: "dialogue",
          text: seg.text,
          speaker: anchor.speaker,
          confidence: 1.0,
          source: anchor.source, // "tag" or "propagated"
          llm_speaker: llmSpeaker,
          llm_confidence: llmConf,
          anchor_words: anchor.words || null,
        }),
      );
      continue;
    }

    // No anchor — defer to LLM but apply confidence floor.
    if (request.use_floor && llmConf < floor) {
      rows.push(
        new AttributionRow({
          paragraph_idx: seg.paragraph_idx,
          kind: "dialogue",
          text: seg.text,
          speaker: "unknown",
          confidence: llmConf,
          source: "floored",
          floored_from: llmSpeaker,
          llm_speaker: llmSpeaker,
          llm_confidence: llmConf,
        }),
      );
    } else {
      rows.push(new AttributionRow({ paragraph_idx: seg.paragraph_idx, kind: "dialogue", text: seg.text, speaker: llmSpeaker, confidence: llmConf, source: "llm" }));
    }
  }

  // ── 6. The second look at lines left with no speaker (2026-10-05) ──
  const cfg = settings?.extraction ?? construct(ExtractionSettings, {});
  if (request.second_look === null ? cfg.second_look : request.second_look) {
    await secondLook(rows, paragraphs, {
      castText: castLines(promptCast),
      resolve: (raw) => {
        const h = resolveSpeaker(raw, promptCast);
        return handleToId.has(h) ? handleToId.get(h) : h;
      },
      castNames: (name) => Boolean(match(name, promptCast)),
      floor,
      useFloor: request.use_floor,
      beforeText: request.before_text,
      afterText: request.after_text,
      cfg,
      skip: new Set(request.second_look_skip),
      rawOut,
      onDelta,
      onStep,
      stop,
      onThinking,
    });
  }
  return rows;
}
