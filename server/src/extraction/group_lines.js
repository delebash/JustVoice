// SPDX-License-Identifier: MIT
// Lines with no single speaker — the one-click plan's answer 7 (docs/plans/2026-10-11-one-click-
// audiobook.md §4, §11 Q7, slice 4): "the AI gives a group line to one member of the group the
// text names ("they" = the Hatter and the March Hare → one of them), or to the narrator when it's
// unclear, and flags it."
//
// Render refuses a line with no speaker, and Analyze leaves a line several people say at once with
// none: on Alice VII–VIII gemma answered "unknown" for all five ("No room!" they cried out; "Then
// the Dormouse shall!" they both cried; the Hatter and the March Hare went "Sh! sh!"; the soldiers
// shouted in reply — RESEARCH §10.4). So after Analyze, each spoken line still with no speaker gets
// one question, shaped as the second look's (the line marked ⟦…⟧ in the text around it, the cast
// with who each one is): who in the cast says it — one person or several — and which one of them
// reads it. The line goes to that one; with no one the text makes clear, to the narrator. Either
// way it is marked to check ("group" in Script's flags, with everyone the answer named).
//
// One recipe for both kinds of model: §3 names none for this step, and each question is one line
// with the text around it, small for any model.
//
// Analyze does not always leave such a line blank: on 2026-10-16 gemma named one of the two for
// four of the five (RESEARCH §10.23), and the step, asking only blank lines, flagged one. So a line
// Analyze gave a speaker is asked too when the narration right beside it says several people speak
// it (`severalSpeak`); the answer marks it only when it names several.

import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { B, cpSlice, errText, strip, strRepr } from "@delebash/llm-runner/platform/py";
import { pyStrOf } from "@delebash/llm-runner/platform/pyjson";
import * as run from "../engines/llm/run.js";
import { _buildNameRegex } from "./anchors.js";
import * as self from "./group_lines.js";
import { around, parse } from "./second_look.js";

const log = getLogger("justvoice.extraction.group_lines");

// The seeded prompt row (seed_feature_prompts) and its feature card.
export const ACTION = "speaker_group";

export const SYSTEM =
  "You decide who reads ONE line of dialogue in an audiobook. The line has no single speaker yet: " +
  "often several people say it at once (\"they cried out\", \"they both cried\", \"the Hatter and " +
  'the March Hare went"), and only one voice can read it. The line is marked ⟦like this⟧ in the ' +
  'text around it. In "group", put the id of every cast member the text says speaks the line — ' +
  "one person or several. Leave it empty when the text doesn't make clear who speaks it, or when " +
  'no one who speaks it is in the cast. In "speaker", put the one id from "group" whose voice ' +
  'should read the line, or "unknown" when "group" is empty. Use only ids from the cast list — a ' +
  "wrong name is worse than none. Answer with JSON only: " +
  '{"reason": "<one sentence>", "group": ["<cast id>", ...], "speaker": "<a cast id from group, or unknown>"}';

export const USER_TEMPLATE = `Cast:
{{cast}}

The text around the line:
{{chapter}}

Who says the marked line ⟦{{line}}⟧? Return only the JSON object.`;

// The narration beside a line saying several people speak it: a plural word — "they cried out",
// "they both cried", "together", "in chorus". English, as the "said X" rule's verbs (anchors.js).
// Not "all": "but all he said was" and "looked all round" come before one speaker's line.
const SEVERAL = new RegExp(`${B}(?:they|both|together|everyone|everybody|chorus|unison)${B}`, "iu");
// How far into the narration the words are read: its first words when it follows the line, its
// last when it comes before — where a speech tag sits (anchors.js). On Alice VII, 6 words keep
// "and went on so long that they had to pinch it" off the Dormouse's song before it.
const NEAR_WORDS = 6;

/**
 * A test for the narration right beside a line (in its own paragraph) → `(narration, side)` is
 * true when it says several people speak the line: a plural word, or two of `characters` (the
 * cast, `{name, aliases}`) joined by "and" ("the Hatter and the March Hare went"), within its
 * first words when `side` is "after" (it follows the line), its last when "before". It only picks
 * the lines to ask about; the answer decides whether the line is several people's.
 */
export function severalSpeak(characters) {
  const name = _buildNameRegex(characters).source;
  const pair = new RegExp(`${name}\\s+and\\s+(?:the\\s+)?${name}`, "iu");
  return (narration, side) => {
    const words = strip(narration).split(/\s+/u);
    const near = (side === "after" ? words.slice(0, NEAR_WORDS) : words.slice(-NEAR_WORDS)).join(" ");
    return SEVERAL.test(near) || pair.test(near);
  };
}

/** The engine door, called through this module so a test can stand in for it. */
export const runFeature = (action, variables, overrides) => run.runFeature(action, variables, overrides);

/**
 * The answer as the line's outcome → `{speaker, group}`. `group` is the cast members the answer
 * named (real ids, each once); `speaker` is the one it chose when that is one
 * of them, else the first of them — and the narrator (`narratorId`, null when the book has none)
 * when it named no one. `resolve(raw)` maps a model's answer to a real cast id, "narrator" or
 * "unknown".
 */
export function decide(answer, resolve, narratorId) {
  const group = [];
  for (const raw of Array.isArray(answer?.group) ? answer.group : []) {
    const id = resolve(raw);
    if (id && id !== "unknown" && id !== "narrator" && !group.includes(id)) group.push(id);
  }
  if (!group.length) return { speaker: narratorId, group };
  const pick = resolve(answer?.speaker ?? null);
  return { speaker: group.includes(pick) ? pick : group[0], group };
}

/**
 * Ask about one line → `{speaker, group, model}`, or null when the call failed (the line stays as
 * it was; no model configured at all throws). `row` needs `paragraph_idx` and `text`;
 * `paragraphs` are the chapter's; `castText` is `second_look.castLines` of the prompt cast;
 * `words` the text either side (`settings.extraction.second_look_words`). `usage` gathers the
 * tokens.
 */
export async function askLine(row, paragraphs, { castText, resolve, narratorId, words, usage }) {
  const variables = { cast: castText, chapter: around(paragraphs, row.paragraph_idx, row.text, words), line: strip(row.text) };
  let resp;
  try {
    resp = await self.runFeature(ACTION, variables);
  } catch (e) {
    // No model at all stops the step; any other failure is this line's alone.
    if (e instanceof LLMNotConfiguredError) throw e;
    log.warning(`group line failed on ${strRepr(cpSlice(row.text, 0, 60))}: ${errText(e)}`);
    return null;
  }
  usage.prompt_tokens += Math.trunc(Number(resp?.prompt_tokens || 0));
  usage.completion_tokens += Math.trunc(Number(resp?.completion_tokens || 0));
  usage.model = resp?.model || usage.model;
  const text = resp != null && "text" in Object(resp) ? resp.text : pyStrOf(resp);
  return { ...decide(parse(text || ""), resolve, narratorId), model: resp?.model || "" };
}
