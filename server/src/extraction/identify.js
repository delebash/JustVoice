// SPDX-License-Identifier: MIT
// Speaker identification — "who exists in this text?" (the port of
// justvoice/extraction/identify.py).
//
// Distinct from attribution ("who speaks THIS line?") per CONCEPTS.md §3/§13: identification
// runs rarely (once per chapter/import), proposes NEW characters as a review list, and never
// commits anything itself. The client shows the candidates in Discover; promotion to speakers
// is an explicit user action.
//
// The LLM output contract is a JSON array:
//     [{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11,
//       "evidence": "Tom Harlan kept the ledger"}, ...]
// `evidence` is the quote that names the character, so a proposal can be judged without
// opening the chapter. Parsing is defensive: code fences stripped, non-dict entries dropped,
// names deduped case-insensitively against the known cast AND each other.

import { getLogger } from "@delebash/llm-runner/platform/log";
import { PY_WS, RuntimeError, strip, truthy } from "@delebash/llm-runner/platform/py";
import { errText } from "@delebash/llm-runner/llm/base";
import * as run from "../engines/llm/run.js";
import { ExtractionSettings, construct } from "../models.js";
import { cpLen, cpSlice, isDict, isNumber, jsonLoads, pyIntOfNumber, pyStrOf, splitlines } from "../py_compat.js";
import { ParagraphTooBig, Piece, planPieces } from "./pieces.js";
import { resolveMarks, segmentParagraphs, splitIntoParagraphs } from "./segmentation.js";

const log = getLogger("justvoice.extraction.identify");

// The SHIPPED DEFAULT for the `speaker_attribution.identify` feature row — it seeds a new
// database once. What runs is the live row in AI Settings → Features. Its history (each
// revision measured with eval:discover on Gemma 4 26B) is in identify.py; the conclusions:
// named characters only, speaking or not, each with the quote that names them (2026-09-27);
// never a named object, a known character's nicknames and description honoured (fixes B + 2);
// "Leave out every known character" — naming the narrator made the model drop a first-person
// book's narrator and its hero (2026-09-29); since the speakers/personas split the library is
// voices, not people, so no library list rides (26/28 with or without it).
export const IDENTIFY_SYSTEM = `You are a casting assistant for an audiobook producer.

You will receive a passage of manuscript text and the list of characters already in the cast. List every CHARACTER the passage names who is NOT in that list, whether or not they speak in this passage. Who speaks which line is decided later; your only job is to find the people.

A character is a person, or a creature that could talk. They count only when the text gives them a proper name ("Edith", "Tom Harlan") or a title the text uses as their name ("the harbour-master", "Captain Hale"). Never list a named object, weapon, tool, ship, building, place or organisation, however it is described — a sword with a name is not a character. Never make up a label from how someone speaks or how they are addressed: "child", "the elder", "a voice", "the speaker", "someone" are not characters. If a line of dialogue is never tied to a name, propose no one for it.

Each known character may list other names they go by and a one-line description. Leave out every known character, however the text refers to them: a first name, a surname, a nickname, or a name from their description ("Answers to Ode" means "Ode" is that person). Compare names ignoring case.

For each character give:
- name: exactly as the text writes it
- role_hint: a few words on who they are, taken from the text only
- approx_lines: how many lines of dialogue they speak in this passage, 0 if none
- evidence: the shortest exact quote from the passage that names them

Return ONLY a JSON array, no commentary:
[{"name": str, "role_hint": str, "approx_lines": int, "evidence": str}, ...]
Return [] if there is no one new.`;

/** One proposal. Its fields keep their Python (wire) names. */
export class SpeakerCandidate {
  constructor({ name, role_hint = null, approx_lines = null, evidence = null }) {
    this.name = name;
    this.role_hint = role_hint;
    this.approx_lines = approx_lines;
    this.evidence = evidence;
  }
}

const FENCE = new RegExp(`\`\`\`(?:json)?[${PY_WS}]*([\\s\\S]*?)\`\`\``, "u");

function _stripCodeFences(text) {
  const m = FENCE.exec(text);
  return m ? m[1] : text;
}

const pyGet = (d, k, dflt = null) => (Object.hasOwn(d, k) ? d[k] : dflt);

/** Parse the LLM reply into deduped candidates. Tolerates fences, stray text around the
 * array, and partially-malformed entries. */
export function parseCandidates(raw, knownNames) {
  const text = strip(_stripCodeFences(raw));
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let data;
  try {
    data = jsonLoads(text.slice(start, end + 1));
  } catch (e) {
    if (e?.name !== "JSONDecodeError") throw e;
    log.warning(`identify: unparseable LLM reply: ${cpSlice(raw, 0, 200)}`);
    return [];
  }
  if (!Array.isArray(data)) return [];

  const known = new Set(knownNames.map((n) => strip(n).toLowerCase()));
  for (const k of ["narrator", "unknown", ""]) known.add(k);
  const seen = new Set();
  const out = [];
  for (const item of data) {
    if (!isDict(item)) continue;
    const name = strip(pyStrOf(pyGet(item, "name", "")));
    const key = name.toLowerCase();
    if (!name || known.has(key) || seen.has(key)) continue;
    seen.add(key);
    const approx = pyGet(item, "approx_lines");
    const role = pyGet(item, "role_hint");
    const evidence = pyGet(item, "evidence");
    out.push(
      new SpeakerCandidate({
        name,
        role_hint: truthy(role) ? strip(pyStrOf(role)) || null : null,
        approx_lines: isNumber(approx) ? pyIntOfNumber(approx) : null,
        evidence: truthy(evidence) ? strip(pyStrOf(evidence)) || null : null,
      }),
    );
  }
  return out;
}

/** The first line of a character sheet, trimmed — enough to tell the model who someone is
 * ("Answers to Ode.") without spending the whole sheet. */
function _describe(sheet) {
  const line = strip(sheet || "") ? strip(splitlines(strip(sheet || ""))[0]) : "";
  return cpLen(line) <= 200 ? line : `${cpSlice(line, 0, 197).replace(new RegExp(`[${PY_WS}]+$`, "u"), "")}…`;
}

/**
 * The cast as the model reads it (Discover fix 2, 2026-09-27): each person's other names and a
 * one-line description, not just a bare name — the bare list is what let "Ode" read as a
 * stranger. `known` holds names (the Lab's free-text list) or `{name, aliases, description}`.
 */
export function formatKnown(known) {
  const lines = [];
  for (const k of known || []) {
    if (typeof k === "string") {
      if (strip(k)) lines.push(`- ${strip(k)}`);
      continue;
    }
    const name = strip(k.name || "");
    if (!name) continue;
    let bit = `- ${name}`;
    const aliases = (k.aliases || []).filter((a) => a);
    if (aliases.length) bit += ` (also called: ${aliases.join(", ")})`;
    const desc = _describe(k.description);
    if (desc) bit += ` — ${desc}`;
    lines.push(bit);
  }
  return lines.join("\n") || "- (none)";
}

/** Every name and alias in `known`, for the parser's exact-match drop. */
export function knownLabels(known) {
  const out = [];
  for (const k of known || []) {
    if (typeof k === "string") out.push(k);
    else out.push(k.name || "", ...(k.aliases || []));
  }
  return out.filter((n) => n);
}

const OVERFLOW_WORDS = ["exceed_context_size", "context_length_exceeded", "maximum context length", "prompt is too long"];

/** The provider refused the request as bigger than the model's context. */
function _isOverflow(e) {
  const text = errText(e);
  return OVERFLOW_WORDS.some((w) => text.includes(w));
}

/**
 * Run the identification LLM call through the shared run path. `runFn` is the seam — tests
 * inject a stub; production uses engines/llm/run's runFeature (the
 * `speaker_attribution.identify` template row + its preset) and measureFeature (chapter
 * splitting, 2026-09-28: `settings.extraction` carries its knobs). `rawOut` receives the run's
 * usage (§16 — the responses carry the numbers).
 */
export async function identifySpeakers(text, knownNames, { settings, runFn = null, rawOut = null, marks = null } = {}) {
  let measureFn = null;
  if (runFn === null) {
    // Called through the namespace, so a test standing in for engines/llm/run's functions is
    // heard (Python's tests patch run_mod.measure_feature / run_feature).
    measureFn = (...a) => run.measureFeature(...a);
    runFn = (...a) => run.runFeature(...a);
  }
  const ext = settings?.extraction ?? construct(ExtractionSettings, {});
  const action = "speaker_attribution.identify";
  const base = { known_speakers: formatKnown(knownNames) };

  // Chapter splitting (2026-09-28): a chapter too long for the model is read in pieces of
  // whole paragraphs, sized with the same cost as Script's (text plus an answer reserve per
  // dialogue line — generous for Discover's short answer). No lead-in: Discover finds names,
  // not turns.
  let paragraphs = splitIntoParagraphs(text);
  if (!paragraphs.length) paragraphs = [text];
  // The project's Speech marks, or the whole text's (one paragraph is too little to read them
  // from) — for counting each paragraph's lines.
  const style = resolveMarks(marks, text);
  let plan = [new Piece(0, 0, paragraphs.length)];
  if (measureFn !== null) {
    let fit;
    let empty;
    try {
      fit = await measureFn(action, { ...base, manuscript: text });
      empty = fit != null ? await measureFn(action, { ...base, manuscript: "" }) : null;
    } catch (e) {
      // measuring only sizes pieces
      log.info(`identify: could not measure the prompt (${errText(e)}) - running unmeasured`);
      fit = empty = null;
    }
    if (fit != null && empty != null) {
      const textTokens = Math.max(fit.prompt_tokens - empty.prompt_tokens, 0);
      const total = paragraphs.reduce((a, q) => a + cpLen(q), 0) || 1;
      const lines = paragraphs.map((q) => segmentParagraphs([q], { marks: style }).filter((g) => g.kind === "dialogue").length);
      // -(-a // b): a ceiling division in integers.
      const costs = paragraphs.map((q, i) => Math.ceil((cpLen(q) * textTokens) / total) + ext.answer_tokens_per_line * lines[i]);
      const room = fit.context - empty.prompt_tokens;
      if (costs.reduce((a, b) => a + b, 0) > room) {
        try {
          plan = planPieces(costs, room, 0);
        } catch (e) {
          if (e instanceof ParagraphTooBig) {
            throw new RuntimeError(
              "A paragraph of this chapter is too long for the model to read, even on its own. Use a model with a larger context.",
              { cause: e },
            );
          }
          throw e;
        }
      }
    }
  }

  const t0 = performance.now() / 1000;
  const usage = { prompt_tokens: 0, completion_tokens: 0, model: "" };
  const found = new Map();
  let calls = 0;
  const queue = [...plan];
  while (queue.length) {
    const pc = queue.shift();
    const piece = paragraphs.slice(pc.start, pc.end).join("\n\n");
    let resp;
    let cutOff;
    try {
      resp = await runFn(action, { ...base, manuscript: piece });
      cutOff = (resp?.finish_reason || "") === "length";
    } catch (e) {
      if (!_isOverflow(e) || pc.end - pc.start < 2) throw e;
      cutOff = true;
    }
    if (cutOff && pc.end - pc.start >= 2) {
      const mid = Math.floor((pc.start + pc.end) / 2);
      queue.unshift(new Piece(pc.start, pc.start, mid), new Piece(mid, mid, pc.end));
      continue;
    }
    calls += 1;
    usage.prompt_tokens += Math.trunc(Number(resp?.prompt_tokens || 0));
    usage.completion_tokens += Math.trunc(Number(resp?.completion_tokens || 0));
    usage.model = resp?.model || usage.model;
    const replyText = resp != null && "text" in Object(resp) ? resp.text : pyStrOf(resp);
    for (const c of parseCandidates(replyText, knownLabels(knownNames))) {
      const key = strip(c.name).toLowerCase();
      if (!found.has(key)) found.set(key, c);
      else if (c.approx_lines) found.get(key).approx_lines = (found.get(key).approx_lines || 0) + c.approx_lines;
    }
  }
  if (rawOut !== null) {
    rawOut.usage = { ...usage, duration_ms: Math.trunc((performance.now() / 1000 - t0) * 1000), pieces: calls };
  }
  return [...found.values()];
}

