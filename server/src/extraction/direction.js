// SPDX-License-Identifier: MIT
// Direction — how each spoken line should be said, where the book says so: the one-click plan's
// step 6, built as its slice 2 (docs/plans/2026-10-11-one-click-audiobook.md §2 step 6, §3, §5).
//
// For a chapter the model reads the text with its spoken lines marked [D#] and the speaker named,
// and answers, per line, one of the nine emotions (models.js EMOTION_VALUES) and a few words of
// direction — only where the text gives a reason. Then the CARRY: a speaker's direction goes to
// their other lines in the same paragraph that got none, forward, then back (RESEARCH §10.5,
// measured by hand on Alice VII: cue lines caught 60 % → 88 %, no-cue lines marked 4 % → 5 %).
//
// Two recipes, each its own prompt row under the "direction" feature (decided 2026-10-10, "Frontier
// models get their own recipe, not the small-model one"): **Local** (`direction.local`) — the
// chapter alone, JSON mode, read in pieces when it doesn't fit the model; **Frontier**
// (`direction.frontier`) — the chapter with the book's earlier chapters and the cast in context,
// the reply free of JSON mode so the preset's thinking runs (the kit turns thinking off under JSON
// mode). The carry applies to both. Which runs is the kit's `presetRecipe` of the Frontier card's
// preset — speaker attribution's Auto rule (pipeline.autoRoute) for its Direct card.
//
// The answer is shaped to the model that speaks the line (`shapeFor`): words go to `direction` on
// a model that takes written direction, with the emotion where its choices name it; on a tag model
// the emotion becomes its own tag (render_core's `value_map`); a sliders-only model, or a line with
// no voice yet, gets nothing. Writing it is extraction_api's `_persistDirection`.

import { LLMNotConfiguredError, presetRecipe, resolveFeaturePreset } from "@delebash/core/llm";
import { getLogger } from "@delebash/core/platform/log";
import { B, cpLen, errText, isDict, RuntimeError, splitWs, strip, truthy } from "@delebash/core/platform/py";
import { jsonRawDecode, pyStrOf } from "@delebash/core/platform/pyjson";
import * as run from "../engines/llm/run.js";
import { construct, EMOTION_VALUES, ExtractionSettings } from "../models.js";
import { emotionChoices } from "../persona_render.js";
import { _emotionTagset } from "../render_core.js";
import { directedBy, TAGS, WORDS } from "../voice_model.js";
import { DIALOGUE_VERBS } from "./anchors.js";
import { ParagraphTooBig, Piece, isBreak, planPieces } from "./pieces.js";
import { _isOverflow, _pickDid, modelFailureMessage } from "./pipeline.js";
import * as self from "./direction.js";

const log = getLogger("justvoice.extraction.direction");

/** The feature both recipes' rows belong to (feature_catalog), and its two recipes. */
export const FEATURE = "direction";
export const RECIPES = ["local", "frontier"];

/** The prompt row a recipe runs. */
export const actionOf = (recipe) => `${FEATURE}.${recipe}`;

/** The engine doors, called through this module so a test can stand in for them (as
 * pipeline.runFeature / measureFeature). */
export const runFeature = (action, variables, overrides) => run.runFeature(action, variables, overrides);
export const measureFeature = (action, variables, overrides) => run.measureFeature(action, variables, overrides);

// ── The prompts (seeded by seed_feature_prompts; what runs is the live row) ─────────────────

const RULES = `For a line, give a direction ONLY when the text gives a reason:
  - a speech verb that says how it is said (shouted, whispered, sighed,
    muttered, grumbled, cried, sobbed);
  - a word or phrase about the manner (angrily, indignantly, in a frightened
    tone, as politely as she could, talking in his sleep);
  - narration right beside the line that shows the speaker's state (looked at
    it gloomily, tossing his head contemptuously);
  - a thought rather than speech ("thought Alice").
The words of the line alone, or an exclamation mark alone, are not a reason.
Most lines get nothing.

For each line you mark, answer:
  - "emotion": the nearest of neutral, happy, sad, angry, fearful, whispered,
    shouted, sarcastic, contemptuous — or "" when none of them fits the cue;
  - "direction": a few words for the narrator, from the text's own cue
    ("indignantly", "grumbling", "talking in his sleep", "thinking to herself").

Return JSON only, listing only the lines you mark, each naming its [D#]:

  {"lines": [{"id": "D4", "emotion": "angry", "direction": "indignantly"}, ...]}

Return {"lines": []} when no line has a reason.
`;

export const LOCAL_SYSTEM = `You mark how the spoken lines of a novel chapter should be said by an audiobook narrator, using only what the text says.

You receive the chapter's paragraphs. Each spoken line is marked [D#] with the name of who speaks it, like [D4 · Alice] "...". Narration is never marked.

${RULES}`;

export const FRONTIER_SYSTEM = `You mark how the spoken lines of a novel chapter should be said by an audiobook narrator, using only what the text says.

You receive who is who, the book's earlier chapters for context, and this chapter's paragraphs. Each spoken line of this chapter is marked [D#] with the name of who speaks it, like [D4 · Alice] "...". Narration is never marked. Answer for this chapter's [D#] lines only; the earlier chapters tell you who these people are and how things stand, but a line still needs a reason in this chapter's text.

${RULES}`;

export const LOCAL_USER_TEMPLATE = `The chapter (each spoken line marked [D#] with who speaks it):

{{paragraphs}}

Return only the JSON object.
`;

export const FRONTIER_USER_TEMPLATE = `Who is who:
{{speakers}}

The book so far — the chapters before this one, for context only:

{{earlier}}

This chapter (each spoken line marked [D#] with who speaks it):

{{paragraphs}}

Return only the JSON object.
`;

// ── Choosing the recipe ───────────────────────────────────────────────────────

/** The recipe the step runs: "frontier" when the Frontier card's preset is a frontier model's (the
 * kit's presetRecipe — the preset's own setting, else its provider's kind: on this machine local,
 * a cloud account frontier), else "local". The card judges its own model, as speaker
 * attribution's Auto judges its Direct card's (pipeline.autoRoute). */
export function directionRecipe() {
  return presetRecipe(resolveFeaturePreset(actionOf("frontier"), FEATURE)) === "frontier" ? "frontier" : "local";
}

// ── What the model reads ──────────────────────────────────────────────────────

/**
 * The chapter as the model reads it: its paragraphs, each spoken line marked [D#] with who speaks
 * it — prompts.formatParagraphs's shape with the speaker beside the number. `segments` are the
 * segmenter's (`kind`, `text`, `paragraph_idx`, `dialogue_id`), each spoken one carrying
 * `speaker_name` (null → "unknown").
 */
export function formatLines(segments) {
  const byPara = new Map();
  for (const seg of segments) {
    const idx = seg.paragraph_idx ?? 0;
    if (!byPara.has(idx)) byPara.set(idx, []);
    byPara.get(idx).push(seg.kind === "dialogue" ? `[D${seg.dialogue_id} · ${seg.speaker_name || "unknown"}] "${seg.text}"` : seg.text);
  }
  return [...byPara.keys()]
    .sort((a, b) => a - b)
    .map((i) => byPara.get(i).join(" "))
    .join("\n\n");
}

/** Who is who, for the Frontier recipe: one line per speaker — name, other names, who they are. */
export function formatCast(characters) {
  const out = [];
  for (const c of characters || []) {
    const bits = [pyStrOf(c.name ?? "")];
    if (truthy(c.aliases) && c.aliases.length) bits.push(`also called ${c.aliases.join(", ")}`);
    const who = splitWs(pyStrOf(truthy(c.description) ? c.description : "")).join(" ");
    if (who) bits.push(who);
    out.push(`- ${bits.join(" — ")}`);
  }
  return out.length ? out.join("\n") : "(no cast list)";
}

/** The chapters before this one, as the Frontier recipe reads them: each its title, then its
 * text. `chapters` = [[title, text], …] in book order. */
export function formatEarlier(chapters) {
  const parts = (chapters || []).filter(([, text]) => strip(text || "")).map(([title, text]) => `${strip(title || "") || "Chapter"}\n\n${strip(text)}`);
  return parts.length ? parts.join("\n\n") : "(none — this is the first chapter)";
}

// ── Reading the answer ────────────────────────────────────────────────────────

const EMOTIONS = new Set(EMOTION_VALUES);

/** The answer entries a JSON value holds: an array of entries, `{"lines": [...]}`, or an object
 * keyed by line id (`{"D4": {...}}`). null when it holds none of these. */
function _entries(value) {
  if (Array.isArray(value)) return value;
  if (!isDict(value)) return null;
  if (Array.isArray(value.lines)) return value.lines;
  const keyed = Object.entries(value).filter(([k, v]) => isDict(v) && _pickDid({ id: k }) !== null);
  return keyed.length ? keyed.map(([k, v]) => ({ id: k, ...v })) : null;
}

/** One line's answer as stored: an emotion from the nine (else "") and the direction's words,
 * whitespace folded. */
function _clean(entry) {
  const emotion = strip(pyStrOf(entry.emotion ?? "")).toLowerCase();
  return {
    emotion: EMOTIONS.has(emotion) ? emotion : "",
    direction: splitWs(pyStrOf(entry.direction ?? "")).join(" "),
  };
}

/** Does this answer mark its line — an emotion that says something, or words? "neutral" alone
 * says nothing (on a model that takes written direction it would arrive as the bare word). */
export const isMarked = (a) => Boolean(a && ((a.emotion && a.emotion !== "neutral") || a.direction));

/**
 * The model's reply → Map line number → {emotion, direction}, only lines it marks.
 *
 * Every place a JSON object or array can start is tried and the one with the most answers wins —
 * a thinking model's reply can carry prose around its JSON (the lesson of
 * pipeline._extractFirstJsonArray, 2026-09-28). An answer names its line by `id` ("D12", 12); an
 * emotion outside the nine is dropped, the words kept.
 */
export function parseAnswers(text) {
  const reply = strip((text || "").replace(/<think>[\s\S]*?<\/think>/g, ""));
  let best = [];
  for (let i = 0; i < reply.length; i++) {
    const ch = reply[i];
    if (ch !== "{" && ch !== "[") continue;
    let value;
    let end;
    try {
      [value, end] = jsonRawDecode(reply, i);
    } catch {
      continue;
    }
    const entries = _entries(value);
    if (!entries) continue;
    if (entries.length > best.length) best = entries;
    i = end - 1; // what sits inside an answer holds fewer answers
  }
  const out = new Map();
  for (const entry of best) {
    if (!isDict(entry)) continue;
    const did = _pickDid(entry);
    if (did === null || out.has(did)) continue;
    const a = _clean(entry);
    if (isMarked(a)) out.set(did, a);
  }
  return out;
}

// ── The carry ─────────────────────────────────────────────────────────────────

// A speech tag's verbs (anchors.DIALOGUE_VERBS), the ones that carry a speech on — "she added
// aloud", "the Rabbit began", "she went on" — and loud ones its list lacks ("screamed the Queen").
// English, as the tag rule's.
const MORE_TAG_VERBS = [
  "added", "adds", "began", "begins", "continued", "continues", "went on", "goes on",
  "screamed", "screams", "shrieked", "shrieks", "roared", "roars", "bellowed", "bellows", "gasped", "gasps",
];
const TAG_ALT = `${B}(?:${[...DIALOGUE_VERBS, ...MORE_TAG_VERBS].join("|")})${B}`;
const TAG_VERB = new RegExp(TAG_ALT, "iu");
const TAG_VERBS = new RegExp(TAG_ALT, "giu");
// How near a narration's start or end its tag sits ("said the Dormouse", "she went on").
const TAG_WORDS = 4;
// A sentence that ends inside the narration, more words after it — "said the Dormouse
// indignantly. However, he consented to go on." — a title's full stop aside.
const INNER_END = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr))[.!?;…](?=[^\p{L}]*\p{L})/u;

/**
 * Does a direction carry across `between`, the narration between two lines of one paragraph, `way`
 * "forward" (from the line before it) or "back" (from the line after)? Across nothing, an aside in
 * brackets, or the giving line's own tag alone: one sentence, with no tag but the giver's —
 * forward, a tag opening the narration ("screamed the Queen." → "You make me giddy."); back, none,
 * or one closing it. A narration with a sentence after the tag, or a tag of the other line's ("she
 * went on,"), stops it — measured on Alice VII–VIII (RESEARCH §10.24: the carry had marked 7 lines
 * with no cue).
 */
export function carriesAcross(between, way) {
  const n = strip(between || "");
  if (!/\p{L}/u.test(n)) return true;
  // An aside inside the speech — "(pointing with his tea spoon at the March Hare,)".
  if (/^\(.*\)[\s.,;:!?…—–]*$/su.test(n)) return true;
  if (INNER_END.test(n)) return false;
  const words = splitWs(n);
  const head = TAG_VERB.test(words.slice(0, TAG_WORDS).join(" "));
  const tail = TAG_VERB.test(words.slice(-TAG_WORDS).join(" "));
  const tags = [...n.matchAll(TAG_VERBS)].length;
  // Forward: the giver's tag opens it — or a few words, a tag whose verb the list lacks ("the
  // Hatter grumbled:").
  if (way === "forward") return (tags === 1 && head) || (tags === 0 && words.length <= TAG_WORDS);
  // Back: no tag, or the giver's closing it ("Alice hastily replied;" between "I do," and the rest).
  return tags === 0 || (tags === 1 && tail);
}

/**
 * RESEARCH §10.5's carry: within a paragraph, a speaker's direction goes to their other lines there
 * that got none — forward, then back. The shape of the attribution propagation pass
 * (anchors.findAnchors pass 2): per paragraph, a forward sweep, then a backward one. Only the
 * model's own answers carry — a carried answer is never carried again — and a line with no speaker
 * neither gives nor takes; the narration between two lines that holds more than the giver's tag
 * stops every carry across it (`carriesAcross`), and a line with a tag of its own right after it
 * takes none forward. `lines` = [{did, paragraph, speaker, before, after}] in chapter order (spoken
 * lines; `before`/`after` the narration between it and the spoken line before/after it in its
 * paragraph, "" or absent for none); `answers` = parseAnswers' Map. → a new Map; a carried answer
 * names its source in `carried_from` ("D12").
 */
export function carry(lines, answers) {
  const out = new Map(answers);
  const byPara = new Map();
  for (const ln of lines) {
    if (!byPara.has(ln.paragraph)) byPara.set(ln.paragraph, []);
    byPara.get(ln.paragraph).push(ln);
  }
  const sweep = (paraLines, way) => {
    const last = new Map(); // speaker → [did, answer]
    paraLines.forEach((ln, i) => {
      if (i > 0 && !carriesAcross(way === "forward" ? ln.before : ln.after, way)) last.clear();
      if (!ln.speaker) return;
      const own = answers.get(ln.did);
      if (own) last.set(ln.speaker, [ln.did, own]);
      else if (!out.has(ln.did) && last.has(ln.speaker) && !(way === "forward" && ownTag(ln.after))) {
        const [from, a] = last.get(ln.speaker);
        out.set(ln.did, { emotion: a.emotion, direction: a.direction, carried_from: `D${from}` });
      }
    });
  };
  for (const paraLines of byPara.values()) {
    sweep(paraLines, "forward");
    sweep([...paraLines].reverse(), "back"); // a speaker's lines before their cue
  }
  return out;
}

/** A tag opening the narration after a line — the line's own ("she added aloud"). */
function ownTag(after) {
  return TAG_VERB.test(splitWs(strip(after || "")).slice(0, TAG_WORDS).join(" "));
}

/**
 * Each spoken segment's narration in its paragraph → Map dialogue_id → `{before, after}`: the
 * narration between it and the spoken segment before it, and after it (to the next one, or the
 * paragraph's end) — what the carry reads.
 */
export function narrationAround(segments) {
  const out = new Map();
  let prev = null; // the last spoken segment of the paragraph so far
  let gap = [];
  let para = null;
  for (const seg of segments) {
    if (seg.paragraph_idx !== para) {
      if (prev !== null) out.get(prev).after = gap.join(" ");
      prev = null;
      gap = [];
      para = seg.paragraph_idx;
    }
    if (seg.kind !== "dialogue") {
      gap.push(seg.text || "");
      continue;
    }
    if (prev !== null) out.get(prev).after = gap.join(" ");
    out.set(seg.dialogue_id, { before: prev === null ? "" : gap.join(" "), after: "" });
    prev = seg.dialogue_id;
    gap = [];
  }
  if (prev !== null) out.get(prev).after = gap.join(" ");
  return out;
}

// ── Asking the model ──────────────────────────────────────────────────────────

/** The model call behind the direction step failed; the message is for the user. */
export class DirectionModelError extends RuntimeError {
  constructor(m, options) {
    super(m, options);
    this.name = "DirectionModelError";
  }
}

const _tooBig = "A paragraph of this chapter is too long for the model to read, even on its own. Use a model with a larger context.";

/**
 * Ask the model how the chapter's spoken lines should be said → `{answers, recipe, action, usage,
 * raw}`: `answers` is the model's own (parseAnswers' Map, before the carry), `usage` the run's
 * tokens, time, model and calls (`pieces`).
 *
 * `segments` are the segmenter's, each spoken one carrying `speaker_name`; `cast` the book's
 * speakers (name, aliases, description) and `earlier` the chapters before as [[title, text], …] —
 * both read by the Frontier recipe only. `recipe` forces one (null = `directionRecipe()`);
 * `overrides` go to the run as a Lab column's do (model, providerId, system, userTemplate, think …);
 * `maxContext` treats the model's context as at most that many tokens.
 *
 * Read in pieces the way Analyze and Discover read a long chapter (pieces.js, `settings.extraction`'s
 * lead-in and answer reserve): the prompt is measured on the local runner (null elsewhere — one
 * call), and a chapter that does not fit is cut into whole paragraphs, each piece keeping the
 * answers for the lines it owns. A refusal as too big, or a reply cut off at the context, halves the
 * piece.
 */
export async function directChapter({ segments, cast = [], earlier = [], recipe = null, settings = null, overrides = {}, maxContext = null }) {
  const use = RECIPES.includes(recipe) ? recipe : self.directionRecipe();
  const action = actionOf(use);
  const ext = settings?.extraction ?? construct(ExtractionSettings, {});
  const paragraphIdx = [...new Set(segments.map((s) => s.paragraph_idx))].sort((a, b) => a - b);
  const nPara = paragraphIdx.length;
  const base = use === "frontier" ? { speakers: formatCast(cast), earlier: formatEarlier(earlier) } : {};
  const segsIn = (lo, hi) => segments.filter((s) => paragraphIdx[lo] <= s.paragraph_idx && s.paragraph_idx < (hi < nPara ? paragraphIdx[hi] : Number.POSITIVE_INFINITY));
  const varsFor = (segs) => ({ ...base, paragraphs: formatLines(segs) });

  let plan = [new Piece(0, 0, nPara)];
  let fit = null;
  let empty = null;
  try {
    fit = await self.measureFeature(action, varsFor(segments), overrides);
    empty = fit != null ? await self.measureFeature(action, varsFor([]), overrides) : null;
  } catch (e) {
    // measuring only sizes pieces; the call itself reports failures
    log.info(`direction: could not measure the prompt (${errText(e)}) - running unmeasured`);
    fit = empty = null;
  }
  if (fit != null && empty != null) {
    const context = Math.min(fit.context, maxContext || fit.context);
    const textTokens = Math.max(fit.prompt_tokens - empty.prompt_tokens, 0);
    const rendered = paragraphIdx.map((_, i) => formatLines(segsIn(i, i + 1)));
    const spoken = paragraphIdx.map((_, i) => segsIn(i, i + 1).filter((s) => s.kind === "dialogue").length);
    const total = rendered.reduce((a, r) => a + cpLen(r), 0) || 1;
    const costs = rendered.map((r, i) => Math.ceil((cpLen(r) * textTokens) / total) + ext.answer_tokens_per_line * spoken[i]);
    const room = context - empty.prompt_tokens;
    if (costs.reduce((a, b) => a + b, 0) > room) {
      const breaks = new Set();
      rendered.forEach((r, i) => {
        if (isBreak(r)) breaks.add(i);
      });
      try {
        plan = planPieces(costs, room, ext.split_lead_in_paragraphs, breaks);
      } catch (e) {
        if (e instanceof ParagraphTooBig) throw new DirectionModelError(_tooBig, { cause: e });
        throw e;
      }
    }
  }

  const t0 = performance.now();
  const usage = { prompt_tokens: 0, completion_tokens: 0, model: "" };
  const answers = new Map();
  const texts = [];
  const queue = [...plan];
  while (queue.length) {
    const pc = queue.shift();
    const segs = segsIn(pc.lead, pc.end);
    const owned = new Set(segsIn(pc.start, pc.end).filter((s) => s.kind === "dialogue").map((s) => s.dialogue_id));
    if (!owned.size) continue;
    let resp = null;
    let cutOff = false;
    let refused = null;
    try {
      resp = await self.runFeature(action, varsFor(segs), overrides);
      cutOff = (resp?.finish_reason || "") === "length";
    } catch (e) {
      // Not configured → the route's 501 with the actionable message.
      if (e instanceof LLMNotConfiguredError) throw e;
      if (!_isOverflow(e)) throw new DirectionModelError(modelFailureMessage(e), { cause: e });
      [cutOff, refused] = [true, e];
    }
    if (cutOff) {
      if (pc.end - pc.start < 2) throw new DirectionModelError(refused ? modelFailureMessage(refused) : _tooBig);
      const mid = Math.floor((pc.start + pc.end) / 2);
      queue.unshift(new Piece(pc.lead, pc.start, mid), new Piece(Math.max(mid - ext.split_lead_in_paragraphs, 0), mid, pc.end));
      log.info(`direction: paragraphs ${pc.start}-${pc.end - 1} did not fit - halved`);
      continue;
    }
    usage.prompt_tokens += Math.trunc(Number(resp?.prompt_tokens || 0));
    usage.completion_tokens += Math.trunc(Number(resp?.completion_tokens || 0));
    usage.model = resp?.model || usage.model;
    const text = resp?.text || "";
    texts.push(text);
    for (const [did, a] of parseAnswers(text)) if (owned.has(did) && !answers.has(did)) answers.set(did, a);
  }
  return {
    answers,
    recipe: use,
    action,
    usage: { ...usage, duration_ms: Math.trunc(performance.now() - t0), pieces: texts.length },
    raw: texts.join("\n\n"),
  };
}

// ── Shaping an answer to the line's model ─────────────────────────────────────

/**
 * What an answer writes on a line whose voice speaks on `model` (the plan's step 6): on a model that
 * takes written direction, the words — and the emotion where the model's choices name it
 * (persona_render.emotionChoices: the nine, or the few its direction file maps); on a tag model, the
 * emotion as the model's own tag (render_core's `value_map` — Chatterbox Turbo's `fear` for
 * fearful; an emotion it has no tag for, nothing); on any other model, or with no model, nothing.
 * "neutral" is never written — it says nothing. → `{direction, emotion}`, each null when nothing.
 */
export function shapeFor(answer, model) {
  const none = { direction: null, emotion: null };
  if (!answer || !model) return none;
  const kind = directedBy(model);
  const emotion = answer.emotion && answer.emotion !== "neutral" ? answer.emotion : "";
  if (kind === WORDS) {
    return { direction: answer.direction || null, emotion: emotion && emotionChoices(model).includes(emotion) ? emotion : null };
  }
  if (kind === TAGS) {
    const map = _emotionTagset(model)?.value_map || {};
    const tag = emotion && Object.hasOwn(map, emotion) ? map[emotion] : "";
    return { direction: null, emotion: tag || null };
  }
  return none;
}

// ── Whose direction a line holds ──────────────────────────────────────────────

/** The metadata key a line's model-written direction is recorded under (§5: which model, which
 * recipe, and what it wrote — so a later pass knows what is the model's and what is yours). */
export const DIRECTION_BY = "direction_by";

/**
 * Is what this line holds the model's — so a new pass may replace it? True when the line's
 * direction and its emotions are exactly what the last pass recorded writing (`direction_by`), or,
 * with no record, when it has neither. Anything else was set by you — on Render's "This line only",
 * by the import, or by changing what the model wrote — and is never overwritten (the rule Analyze
 * keeps for a speaker you set, `source: "corrected"`). `meta` is the line's parsed metadata.
 */
export function modelOwns(direction, meta) {
  const by = isDict(meta?.[DIRECTION_BY]) ? meta[DIRECTION_BY] : null;
  if (strip(direction || "") !== strip(by ? pyStrOf(by.direction ?? "") : "")) return false;
  const now = {};
  const lm = isDict(meta?.line_models) ? meta.line_models : {};
  for (const [m, s] of Object.entries(lm)) if (isDict(s) && typeof s.emotion === "string") now[m] = s.emotion;
  const wrote = by && isDict(by.emotion) ? by.emotion : {};
  const keys = Object.keys(now);
  return keys.length === Object.keys(wrote).length && keys.every((m) => wrote[m] === now[m]);
}
