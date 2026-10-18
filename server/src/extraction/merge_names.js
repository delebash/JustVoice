// SPDX-License-Identifier: MIT
// Discover's names across chapters, merged into one list of people — the one-click plan's step 2
// (docs/plans/2026-10-11-one-click-audiobook.md §2, §3, slice 4).
//
// Discover reads a book chapter by chapter, and each chapter's scan (`scene.metadata.discover`)
// writes a person the way that chapter does: the Queen is "Queen of Hearts" in Alice VII and "the
// Queen" in VIII (RESEARCH §10.4). Before speakers are added, those become one person, and the
// people Discover counted no lines for (Time, Elsie, the Duchess) are left out.
//
// Two recipes (§3), picked by the kind of model the step's preset runs — the kit's
// `presetRecipe`, read off the Frontier card's preset as speaker attribution's Auto reads Direct's
// (`pipeline.routeRecipe`):
//
//   local     names that contain one another, a leading article aside ("the Queen" / "Queen of
//             Hearts"), are grouped in code; one short model call then says which names in each
//             group are one person — a heading such as "THE KING AND QUEEN OF HEARTS" shares words
//             with two people and is no one. No group, no call.
//   frontier  the whole book's names, with every chapter's counts, roles and quotes, in one call
//             that says which are one person.
//
// Both answer the same JSON object, and the code never lets a model invent or lose a name: a name
// the answer doesn't place stays a person of its own, a name it places twice counts once, a name
// it makes up is dropped, and (local) a person stays inside one group. Lines are summed from the
// scans, never asked of the model; a person every scan counted 0 lines for is left out, one a
// scan gave no number for is kept.

import { presetRecipe, resolveFeaturePreset } from "@delebash/core/llm";
import { getLogger } from "@delebash/core/platform/log";
import { cpLen, cpSlice, isDict, splitWs, strip } from "@delebash/core/platform/py";
import { isNumber, pyIntOfNumber, pyStrOf } from "@delebash/core/platform/pyjson";
import * as run from "../engines/llm/run.js";
import { bare, isVariantBare, norm } from "./names.js";
import { parse } from "./second_look.js";
import * as self from "./merge_names.js";

const log = getLogger("justvoice.extraction.merge_names");

// The seeded prompt rows (seed_feature_prompts) and their feature card.
export const FEATURE = "speaker_merge";
export const LOCAL_ACTION = "speaker_merge.local";
export const FRONTIER_ACTION = "speaker_merge.frontier";

const ANSWER = `Answer with JSON only:
{"people": [{"name": "<the fullest form of the name, copied from the list>", "names": ["<every name in the list that is this person>"]}]}
List only people with two or more names. A name you leave out stays a person of its own.`;

export const LOCAL_SYSTEM = `You check the cast list of an audiobook. A scan read the book chapter by chapter and wrote down the people each chapter names, and one person is often written differently in different chapters ("the Queen" in one, "Queen of Hearts" in another). Below are groups of found names that share words. For each group, say which of its names are one person.

- Put names together only when they are plainly one person: a shorter and a fuller form of the same name or title.
- Names that share a word but belong to different people stay apart ("the King" and "the Queen").
- A name for several people at once — a heading, or two people joined by "and" — is no one person: leave it on its own.
- When you are not sure, leave the name on its own. A missed match is easy to fix; a wrong one is not.
- Copy every name exactly as it is written in its group, and never join names from different groups.

${ANSWER}`;

export const LOCAL_USER_TEMPLATE = `Groups of names that share words:

{{groups}}

Return only the JSON object.`;

export const FRONTIER_SYSTEM = `You build the cast list of an audiobook. A scan read the book chapter by chapter and wrote down every person each chapter names: how many lines they speak there, who they seem to be, and the quote that names them. One person is often written differently in different chapters ("the Queen" in one, "Queen of Hearts" in another, "her Majesty" in a third). Say which of the found names are one person.

- Names go together when the quotes and roles show they are the same person, whether or not the names share a word.
- Different people stay apart, even when they share a word or a title ("the King" and "the Queen").
- A name for several people at once — a heading, or two people joined by "and" — is no one person: leave it on its own.
- When you are not sure, leave the name on its own. A missed match is easy to fix; a wrong one is not.
- Copy every name exactly as it is written in the list.

${ANSWER}`;

export const FRONTIER_USER_TEMPLATE = `Every name the scan found, in the order the book first names them:

{{names}}

Return only the JSON object.`;

/** The engine door, called through this module so a test can stand in for it. */
export const runFeature = (action, variables, overrides) => run.runFeature(action, variables, overrides);

/** The recipe the merge runs — "frontier" when the Frontier card's preset is Frontier (the kit's
 * `presetRecipe`: the preset's own setting, else its provider's kind), else "local". The same rule
 * as speaker attribution's Auto, which reads Direct's (`pipeline.routeRecipe`). */
export function mergeRecipe() {
  return presetRecipe(resolveFeaturePreset(FRONTIER_ACTION, FEATURE)) === "frontier" ? "frontier" : "local";
}

/**
 * Every name the scans found, once each (compared as `names.norm` compares names), in the order
 * the book first names them: `{name, key, role_hint, lines, chapters: [{id, title, lines}],
 * evidence, evidence_found}`. `lines` is the sum of the scans' counts, null when no scan gave a
 * number. `scans` is `[{id, title, candidates}]` in book order — a chapter's saved Discover
 * candidates.
 */
export function collectFound(scans) {
  const byKey = new Map();
  for (const scan of scans || []) {
    for (const c of scan.candidates || []) {
      if (!isDict(c)) continue;
      const name = strip(pyStrOf(c.name ?? ""));
      const key = norm(name);
      if (!key) continue;
      let f = byKey.get(key);
      if (!f) {
        f = { name, key, role_hint: null, lines: null, chapters: [], evidence: null, evidence_found: null };
        byKey.set(key, f);
      }
      const n = isNumber(c.approx_lines) ? pyIntOfNumber(c.approx_lines) : null;
      if (n !== null) f.lines = (f.lines ?? 0) + n;
      const at = f.chapters.find((ch) => ch.id === scan.id);
      if (at) at.lines = n === null ? at.lines : (at.lines ?? 0) + n;
      else f.chapters.push({ id: scan.id, title: scan.title || "", lines: n });
      if (!f.role_hint && c.role_hint) f.role_hint = strip(pyStrOf(c.role_hint)) || null;
      // The first chapter's quote that names them — Discover's "first appearance".
      if (!f.evidence && c.evidence) {
        f.evidence = strip(pyStrOf(c.evidence)) || null;
        f.evidence_found = typeof c.evidence_found === "boolean" ? c.evidence_found : null;
      }
    }
  }
  return [...byKey.values()];
}

/**
 * The local recipe's groups: names joined when one is the other with whole words added, a
 * leading article aside (`names.isVariantBare`), and every name joined to such a name in turn —
 * index lists, each of two or more names, in book order. A name that shares words with two
 * people ("THE KING AND QUEEN OF HEARTS") pulls them into one group; the model's answer splits it.
 */
export function containmentGroups(found) {
  const parent = found.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      if (isVariantBare(found[i].name, found[j].name)) {
        const [a, b] = [root(i), root(j)];
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const groups = new Map();
  found.forEach((_, i) => {
    const r = root(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}

const linesWord = (n) => (n === null || n === undefined ? "lines not counted" : n === 1 ? "1 line" : `${n} lines`);

/** One found name as the model reads it: the name, each chapter with its count, who they seem to
 * be and the quote that names them. */
function describe(f) {
  const where = f.chapters.map((ch) => `${ch.title || "a chapter"}: ${linesWord(ch.lines)}`).join("; ");
  let out = `- "${f.name}" — ${where}`;
  if (f.role_hint) out += ` — who: ${f.role_hint}`;
  if (f.evidence) out += ` — "${cpLen(f.evidence) > 160 ? `${cpSlice(f.evidence, 0, 157)}…` : f.evidence}"`;
  return out;
}

/** The local recipe's `{{groups}}`. */
export function formatGroups(found, groups) {
  return groups.map((g, n) => [`Group ${n + 1}:`, ...g.map((i) => describe(found[i]))].join("\n")).join("\n\n");
}

/** The frontier recipe's `{{names}}`. */
export function formatNames(found) {
  return found.map(describe).join("\n");
}

/** The reply's people → `[{name, names}]`, an unreadable entry dropped — or null when the reply
 * holds no `people` list at all. */
export function parsePeople(text) {
  const ans = parse(text || "");
  if (!Array.isArray(ans.people)) return null;
  const out = [];
  for (const p of ans.people) {
    if (!isDict(p) || !Array.isArray(p.names)) continue;
    out.push({ name: strip(pyStrOf(p.name ?? "")), names: p.names.map((n) => strip(pyStrOf(n ?? ""))).filter((n) => n) });
  }
  return out;
}

/**
 * Which found names are one person, from the model's people → index lists covering every found
 * name exactly once, in book order, each with the name the model chose (or null). `groupOf[i]`,
 * when given (local), is name i's group: a person keeps only the names in its first name's group.
 * A name the answer places twice keeps its first place; a name it doesn't place is a person alone;
 * a name that isn't in the list is dropped.
 */
export function applyPeople(found, people, groupOf = null) {
  const at = new Map(found.map((f, i) => [f.key, i]));
  const placed = new Set();
  const persons = [];
  for (const p of people) {
    const idx = [];
    for (const n of p.names) {
      const i = at.get(norm(n));
      if (i === undefined || placed.has(i) || idx.includes(i)) continue;
      if (groupOf && idx.length && groupOf[i] !== groupOf[idx[0]]) continue;
      if (groupOf && groupOf[i] === undefined) continue;
      idx.push(i);
    }
    if (idx.length < 2) continue;
    for (const i of idx) placed.add(i);
    const chosen = at.get(norm(p.name));
    persons.push({ idx: idx.sort((a, b) => a - b), chosen: chosen !== undefined && idx.includes(chosen) ? chosen : null });
  }
  found.forEach((_, i) => {
    if (!placed.has(i)) persons.push({ idx: [i], chosen: null });
  });
  return persons.sort((a, b) => a.idx[0] - b.idx[0]);
}

/** The name a person goes by when the model chose none: the most words once a leading article is
 * dropped ("Queen of Hearts" over "the Queen"), then the one without the article ("March Hare"
 * over "the March Hare"), then the first the book wrote. */
export function fullestName(names) {
  const words = (n) => splitWs(bare(n)).length;
  return [...names].sort((a, b) => words(b) - words(a) || cpLen(a) - cpLen(b))[0];
}

/** One person, as Discover's ＋ Add takes it (name, description, aliases) and with what the scans
 * say: the chapters in book order, the first quote, and the lines summed — null when a scan gave
 * no number and the rest add up to 0, so only a person every scan counted 0 for reads 0. */
export function personOf(found, { idx, chosen }) {
  const fs = idx.map((i) => found[i]);
  const all = fs.map((f) => f.name);
  const name = chosen !== null ? found[chosen].name : fullestName(all);
  const counts = fs.flatMap((f) => f.chapters.map((ch) => ch.lines));
  const known = counts.filter((n) => n !== null);
  const sum = known.reduce((a, n) => a + n, 0);
  const chapters = [];
  for (const f of fs) for (const ch of f.chapters) if (!chapters.includes(ch.id)) chapters.push(ch.id);
  const first = fs.find((f) => f.evidence) || null;
  return {
    name,
    aliases: all.filter((n) => n !== name),
    description: fs.find((f) => f.role_hint)?.role_hint ?? null,
    lines: !known.length || (sum === 0 && known.length < counts.length) ? null : sum,
    chapters,
    evidence: first?.evidence ?? null,
    evidence_found: first?.evidence_found ?? null,
  };
}

/**
 * The scans' names merged into people → `{people, left_out}`: `people` most lines first (book
 * order among equals), `left_out` those every scan counted 0 lines for. `recipe` is "local" or
 * "frontier". `runFn(action, variables)` is the model seam (tests stand in for it); `rawOut.usage`
 * receives the call's usage — none when no call ran.
 */
export async function mergeBook(found, { recipe = "local", runFn = null, rawOut = null } = {}) {
  const call = runFn || ((action, variables) => self.runFeature(action, variables));
  let persons;
  let ask = null;
  let groupOf = null;
  if (recipe === "frontier") {
    if (found.length > 1) ask = [FRONTIER_ACTION, { names: formatNames(found) }];
  } else {
    const groups = containmentGroups(found);
    groupOf = {};
    groups.forEach((g, n) => {
      for (const i of g) groupOf[i] = n;
    });
    if (groups.length) ask = [LOCAL_ACTION, { groups: formatGroups(found, groups) }];
  }
  if (ask === null) persons = applyPeople(found, []);
  else {
    const t0 = performance.now();
    const resp = await call(...ask);
    const text = resp != null && "text" in Object(resp) ? resp.text : pyStrOf(resp);
    const people = parsePeople(text);
    if (people === null) log.warning(`merge: unreadable reply, every name kept on its own: ${cpSlice(text || "", 0, 200)}`);
    persons = applyPeople(found, people || [], groupOf);
    if (rawOut !== null) {
      rawOut.usage = {
        prompt_tokens: Math.trunc(Number(resp?.prompt_tokens || 0)),
        completion_tokens: Math.trunc(Number(resp?.completion_tokens || 0)),
        model: resp?.model || "",
        duration_ms: Math.trunc(performance.now() - t0),
        pieces: 1,
      };
    }
  }
  const all = persons.map((p) => ({ ...personOf(found, p), _first: p.idx[0] }));
  const order = (a, b) => (b.lines ?? 0) - (a.lines ?? 0) || a._first - b._first;
  const out = ({ _first, ...p }) => p;
  return {
    people: all
      .filter((p) => p.lines !== 0)
      .sort(order)
      .map(out),
    left_out: all
      .filter((p) => p.lines === 0)
      .sort((a, b) => a._first - b._first)
      .map(out),
  };
}
