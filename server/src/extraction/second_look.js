// SPDX-License-Identifier: MIT
// Analyze's second look at the spoken lines it leaves with no speaker (the port of
// justvoice/extraction/second_look.py).
//
// Decided 2026-10-05 — TASKS "Analyze takes a second look at lines it leaves with no speaker,
// and offers to add who it finds"; the design and blast radius are
// docs/plans/2026-10-05-second-look-build.md, the test it rests on
// docs/plans/2026-10-05-second-look-test.md (30 lines, 30 right, 0 wrong).
//
// The main call reads one chapter, so a speaker who is unseen in it stays unknown even when
// the next chapter names them (The Ninth Facet's voice in the dark, Bigger Inside's last line,
// is Ode — revealed in The Same Hour). After the main call, each spoken line left with no
// speaker gets ONE more call: the line marked in the text around it, the end of the chapter
// before and the start of the chapter after. A cast member it names is saved marked to check
// (source "second_look" — Script's "Found in a nearby chapter" mark). A speaker the text names
// who is not in the cast is kept on the row (`not_in_cast`) so Script can offer to add them.
// Only blank lines are asked about, so a chapter with none costs nothing; a failed call leaves
// its line as it was.
//
// On Analyze's stream (decided 2026-10-06): each call streams its tokens on to the strip as the
// main call's do, the strip counts the lines ("second look · 2 of 6 lines"), the calls' tokens
// join the run's usage, and a cancel stops the look before its next line — the stream then
// saves the chapter as it stood (extraction_api).

import { errText, head } from "@delebash/llm-runner/llm/base";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyRound, splitWs, strip, truthy, ValueError } from "@delebash/llm-runner/platform/py";
import * as run from "../engines/llm/run.js";
import { cpSlice, isDict, jsonLoads, pyFloatOf, pyStrOf, strRepr } from "../py_compat.js";
import * as self from "./second_look.js";

const log = getLogger("justvoice.extraction.second_look");

// The seeded prompt row (seed_feature_prompts) and its feature card.
export const ACTION = "speaker_second_look";

export const SYSTEM =
  "You attribute ONE line of dialogue in a novel to the person who speaks it. " +
  "The line is marked ⟦like this⟧ in the text around it. You also get the end of the " +
  "chapter before and the start of the chapter after — a speaker who is unseen or unnamed " +
  "here may be revealed there. Name a cast member only when the text makes it clear who " +
  "speaks the marked line. If the speaker is not in the cast, or the text never makes it " +
  'clear, answer "unknown" — a wrong name is worse than unknown. When the text does name ' +
  'who speaks it but they are not in the cast, put that name in "not_in_cast"; otherwise ' +
  "leave it empty. Answer with JSON only: " +
  '{"reason": "<one sentence>", "speaker": "<a cast id, or unknown>", ' +
  '"confidence": <0 to 1>, "not_in_cast": "<a name, or empty>"}';

export const USER_TEMPLATE = `Cast:
{{cast}}

The end of the chapter before:
{{before}}

The text around the line:
{{chapter}}

The start of the chapter after:
{{after}}

Who speaks the marked line ⟦{{line}}⟧? Return only the JSON object.`;

/** The engine door, called through this module so a test can stand in for it (Python's tests
 * patch `second_look.run_feature` / `stream_feature`). */
export const runFeature = (action, variables, overrides) => run.runFeature(action, variables, overrides);
export const streamFeature = (action, variables, overrides) => run.streamFeature(action, variables, overrides);

/**
 * The cast as the second look reads it: id, name, other names AND who they are. The main
 * call's list (`prompts.formatCharacters`) leaves the description out; the second look needs it
 * — "Answers to Ode." is the only link from Odeline Marran to the "Ode" the next chapter names
 * (live 2026-10-05: without it the voice in the dark stayed blank).
 */
export function castLines(characters) {
  const out = [];
  for (const c of characters) {
    const bits = [`id="${pyStrOf(c.id)}"`, `name="${pyStrOf(c.name)}"`];
    if (truthy(c.pronouns)) bits.push(`pronouns="${pyStrOf(c.pronouns)}"`);
    if (truthy(c.aliases)) bits.push(`also called="${c.aliases.join(", ")}"`);
    const who = splitWs(pyStrOf(truthy(c.description) ? c.description : "")).join(" ");
    if (who) bits.push(`who="${cpSlice(who, 0, 200)}"`);
    out.push(`- ${bits.join(", ")}`);
  }
  return out.join("\n");
}

function _tail(text, words) {
  const w = splitWs(text || "");
  return w.length > words ? w.slice(-words).join(" ") : text || "";
}

function _head(text, words) {
  const w = splitWs(text || "");
  return w.length > words ? w.slice(0, words).join(" ") : text || "";
}

/** The paragraph with the line marked ⟦…⟧ (its quote marks may be outside the segment's text,
 * so a second try drops them). */
export function mark(paragraph, line) {
  let s = strip(line || "");
  let i = paragraph.indexOf(s);
  if (i < 0) {
    s = strip(s, "\"'“”‘’ ,.");
    i = s ? paragraph.indexOf(s) : -1;
  }
  if (i < 0) return `${paragraph}\n⟦${strip(line)}⟧`;
  return `${paragraph.slice(0, i)}⟦${s}⟧${paragraph.slice(i + s.length)}`;
}

const wordCount = (p) => splitWs(p).length;

/** The paragraphs around `idx` — about `words` words either side — with the line marked in its
 * own paragraph. */
export function around(paragraphs, idx, line, words) {
  const before = [];
  let n = 0;
  for (const p of paragraphs.slice(0, idx).reverse()) {
    if (n >= words) break;
    before.unshift(p);
    n += wordCount(p);
  }
  const after = [];
  n = 0;
  for (const p of paragraphs.slice(idx + 1)) {
    if (n >= words) break;
    after.push(p);
    n += wordCount(p);
  }
  const here = idx >= 0 && idx < paragraphs.length ? paragraphs[idx] : "";
  return [...before, mark(here, line), ...after].join("\n\n");
}

/** The reply's JSON object (greedy `\{.*\}`, DOTALL), or {} when there is none. */
export function parse(text) {
  const m = /\{[\s\S]*\}/.exec(text || "");
  if (!m) return {};
  let out;
  try {
    out = jsonLoads(m[0]);
  } catch (e) {
    if (e instanceof ValueError) return {};
    throw e;
  }
  return isDict(out) ? out : {};
}

/**
 * Ask once more about each spoken row with no speaker; changes `rows` in place. `resolve(raw)`
 * maps the model's answer to a real cast id or "unknown"; `castNames(name)` says whether a name
 * is a cast member's (a cast member is never offered as someone to add). `skip` = row indices
 * not to ask about (lines the user set — their rows are never written).
 *
 * `onDelta(text)`: when set, each call streams and its text is passed on, as the main call's
 * is; `onThinking(text)` gets a thinking model's reasoning. `onStep(done, total, rows)`: called
 * as the look starts and after each line — points where `rows` is whole, so a caller can keep a
 * copy. `stop()`: asked before each line; true ends the look there. The calls' tokens and time
 * are added to `rawOut.usage` when the main call left one.
 */
export async function secondLook(
  rows,
  paragraphs,
  {
    castText,
    resolve,
    castNames,
    floor,
    useFloor,
    beforeText = null,
    afterText = null,
    cfg,
    skip = new Set(),
    rawOut = null,
    onDelta = null,
    onStep = null,
    stop = null,
    onThinking = null,
  },
) {
  const skipSet = skip instanceof Set ? skip : new Set(skip);
  const asks = [];
  rows.forEach((r, i) => {
    if (r.kind === "dialogue" && r.speaker === "unknown" && !skipSet.has(i)) asks.push(i);
  });
  const report = { asked: asks.length, named: 0, not_in_cast: [], failed: 0, seconds: 0.0 };
  if (rawOut !== null) rawOut.second_look = report;
  if (!asks.length) return;
  const [before, after] = context(beforeText, afterText, cfg);
  const t0 = Date.now() / 1000;
  const usage = (rawOut || {}).usage ?? null;
  if (onStep !== null) onStep(0, asks.length, rows);
  for (let k = 0; k < asks.length; k++) {
    const i = asks[k];
    if (stop !== null && stop()) {
      report.stopped = true;
      break;
    }
    try {
      const got = await lookAt(rows[i], paragraphs, {
        castText,
        before,
        after,
        resolve,
        castNames,
        floor,
        useFloor,
        cfg,
        report,
        usage,
        onDelta,
        onThinking,
      });
      if (got === "none") rows[i].second_look_asked = true;
    } finally {
      if (onStep !== null) onStep(k + 1, asks.length, rows);
    }
  }
  report.seconds = pyRound(Date.now() / 1000 - t0, 1);
  if (isDict(usage)) usage.duration_ms = Math.trunc(Number(usage.duration_ms || 0)) + Math.trunc(report.seconds * 1000);
}

/** The end of the chapter before and the start of the chapter after, as the question gives
 * them — shared by Analyze's second look and Script's 🔎 Second look button (2026-10-06). */
export function context(beforeText, afterText, cfg) {
  const before = beforeText ? _tail(beforeText, cfg.second_look_before) : "(none — this is the first chapter)";
  const after = afterText ? _head(afterText, cfg.second_look_after) : "(none — this is the last chapter)";
  return [before, after];
}

function _addUsage(usage, promptTokens, completionTokens) {
  if (isDict(usage)) {
    usage.prompt_tokens = Math.trunc(Number(usage.prompt_tokens || 0)) + Math.trunc(Number(promptTokens || 0));
    usage.completion_tokens = Math.trunc(Number(usage.completion_tokens || 0)) + Math.trunc(Number(completionTokens || 0));
  }
}

/** One question; the reply's text. Streams when `onDelta` is set — the prompt-eval frames are
 * dropped: the strip shows "reading prompt" only before a run's first token (decided
 * 2026-10-06). */
async function _ask(variables, usage, onDelta, onThinking = null) {
  if (onDelta === null) {
    const resp = await self.runFeature(ACTION, variables);
    _addUsage(usage, resp?.prompt_tokens ?? 0, resp?.completion_tokens ?? 0);
    return resp?.text || "";
  }
  const parts = [];
  for await (const delta of await self.streamFeature(ACTION, variables)) {
    if (delta.done) _addUsage(usage, delta.prompt_tokens, delta.completion_tokens);
    else if (delta.reasoning) {
      if (onThinking !== null) onThinking(delta.reasoning);
    } else if (delta.text) {
      parts.push(delta.text);
      onDelta(delta.text);
    }
  }
  return parts.join("");
}

/**
 * Ask about one line and write the answer onto its row — `row` needs paragraph_idx, text,
 * speaker, confidence, source, floored_from and not_in_cast. Analyze's second look and Script's
 * 🔎 Second look button both ask through here, so the question is the same either way. Returns
 * "named", "none" (asked, no one it could name) or "failed" (the call failed — the line stays
 * as it was, not marked asked).
 */
export async function lookAt(
  row,
  paragraphs,
  { castText, before, after, resolve, castNames, floor, useFloor, cfg, report, usage, onDelta = null, onThinking = null },
) {
  const variables = {
    cast: castText,
    before,
    chapter: around(paragraphs, row.paragraph_idx, row.text, cfg.second_look_words),
    after,
    line: strip(row.text),
  };
  let text;
  try {
    text = await _ask(variables, usage, onDelta, onThinking);
  } catch (e) {
    // An extra: a failure leaves the line as it was.
    report.failed += 1;
    log.warning(`second look failed on ${strRepr(head(row.text, 60))}: ${errText(e)}`);
    return "failed";
  }
  const ans = parse(text);
  const who = resolve(Object.hasOwn(ans, "speaker") ? ans.speaker : null);
  let conf;
  try {
    const raw = Object.hasOwn(ans, "confidence") ? ans.confidence : null;
    conf = pyFloatOf(truthy(raw) ? raw : 0);
  } catch (e) {
    if (!(e instanceof TypeError) && !(e instanceof ValueError)) throw e;
    conf = 0.0;
  }
  if (!["unknown", "narrator", null, undefined, ""].includes(who) && !(useFloor && conf < floor)) {
    row.speaker = who;
    row.confidence = conf;
    row.source = "second_look";
    row.floored_from = null;
    row.not_in_cast = null;
    report.named += 1;
    return "named";
  }
  const nic = Object.hasOwn(ans, "not_in_cast") ? ans.not_in_cast : null;
  const name = strip(strip(pyStrOf(truthy(nic) ? nic : "")), "\"'“”");
  if (name && Array.from(name).length <= 60 && !["unknown", "narrator", "none"].includes(name.toLowerCase()) && !castNames(name)) {
    row.not_in_cast = name;
    if (!report.not_in_cast.includes(name)) report.not_in_cast.push(name);
  }
  return "none";
}
