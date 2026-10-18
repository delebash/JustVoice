// SPDX-License-Identifier: MIT
// Score the direction step (the one-click plan's step 6, slice 2) against an answer key's `cues` —
// the measurement RESEARCH §10.5 made by hand on Alice VII, automated (built 2026-10-16).
//
//     npm run eval:direction                                   # server on 127.0.0.1:8741
//     npm run eval:direction -- --chapter "CHAPTER VII. A Mad Tea-Party"
//     npm run eval:direction -- --recipe frontier              # force a recipe
//     npm run eval:direction -- --system draft.txt             # try a prompt, save nothing
//     npm run eval:direction -- --model gemma-4-26b-a4b-qat    # a catalog model on the local runner
//     npm run eval:direction -- --server http://127.0.0.1:17494 --runs 3 --out run.json
//
// Needs a running JustVoice server (it owns the model and the LIVE prompt rows — AI Settings →
// Features → Direction's Local and Frontier cards). Each keyed chapter goes through POST
// /v1/extraction/direction-text: the production step — the cut into lines, the recipe the
// Frontier card's preset picks (or `--recipe`), the prompt, the reading of the reply, the carry —
// writing nothing. Who speaks each line comes from the key's `chapters`, as the hand measurement
// took it (Analyze matched them 240/240, RESEARCH §10.4); the book's earlier chapters go along,
// read by the Frontier recipe only.
//
// Scored per chapter against the key's `cues` (the lines whose text says how they are spoken, and
// the nearest of the nine emotions where the word is a direct match), for the model's own answers
// and again with the carry:
//
//   cue lines caught      cue lines given an emotion or a direction
//   emotions matching     of the cue lines whose key names an emotion, the same emotion
//   no-cue lines marked   lines with no cue given one anyway
//
// and how many lines the carry reached, how many of those have no cue. The baseline (RESEARCH
// §10.5, gemma 26B-A4B, Alice VII, one run): own 44/73 caught, 12/24 matching, 3/77 marked; with
// the carry 64/73, 15/24, 4/77 — slice 2 is accepted at ≥ 88 % caught and ≤ 5 % marked.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pyRepr } from "@delebash/core/platform/pyjson";
import { segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

class Exit extends Error {}

async function post(server, route, body, timeoutS = 1800) {
  const r = await fetch(server + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutS * 1000),
  });
  if (!r.ok) throw new Exit(`${route} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

const joinText = (scene) =>
  scene.lines
    .filter((l) => l.text)
    .map((l) => l.text)
    .join("\n\n");

const pct = (a, n) => `${((100 * a) / Math.max(n, 1)).toFixed(0)}%`;
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const marked = (l) => Boolean((l.emotion && l.emotion !== "neutral") || l.direction);

/** One variant's score: which lines it marks (D# numbers) against the chapter's cues. */
function score(marks, byLine, cues, allIds) {
  const cueIds = Object.keys(cues).map(Number);
  const cueSet = new Set(cueIds);
  const keyed = cueIds.filter((d) => cues[d].emotion);
  return {
    caught: cueIds.filter((d) => marks.has(d)).length,
    cues: cueIds.length,
    matching: keyed.filter((d) => byLine.get(d)?.emotion === cues[d].emotion && marks.has(d)).length,
    keyed: keyed.length,
    falseMarks: allIds.filter((d) => !cueSet.has(d) && marks.has(d)).length,
    noCue: allIds.filter((d) => !cueSet.has(d)).length,
  };
}

const line = (s) =>
  `cue lines caught ${s.caught}/${s.cues} (${pct(s.caught, s.cues)}) · emotions matching ${s.matching}/${s.keyed} (${pct(s.matching, s.keyed)})` +
  ` · no-cue lines marked ${s.falseMarks}/${s.noCue} (${pct(s.falseMarks, s.noCue)})`;

const add = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (a[k] || 0) + b[k]]));

async function main() {
  const { values: args } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:8741" },
      sample: { type: "string", default: "alice-in-wonderland" },
      runs: { type: "string", default: "1" },
      recipe: { type: "string" }, // force a recipe (default: the Frontier card's preset decides)
      system: { type: "string" }, // file with a CANDIDATE system prompt (not saved)
      user: { type: "string" }, // file with a CANDIDATE user template (not saved)
      temperature: { type: "string" },
      think: { type: "boolean" }, // let the model reason before answering
      model: { type: "string" }, // run on this catalog model instead of the preset's (local runner)
      chapter: { type: "string", multiple: true }, // only these chapter titles
      show: { type: "string", default: "12" }, // misses and stray marks to print per chapter
      out: { type: "string" }, // write every keyed line's result as JSON, for comparing runs
    },
  });
  if (args.recipe !== undefined && !["local", "frontier"].includes(args.recipe)) throw new Exit("--recipe: local or frontier");
  const runs = Number.parseInt(args.runs, 10);
  const show = Number.parseInt(args.show, 10);

  const root = path.join(ROOT, "server", "samples", args.sample);
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  if (!key.cues) throw new Exit(`${args.sample}'s answer key has no "cues" — nothing to score direction against`);
  const bookFile = key.book || "book.json";
  const book = runAdapter(key.adapter || "justwrite", readFileSync(path.join(root, bookFile)), { filename: bookFile });
  // Who is who, as the key gives the cast (the Frontier recipe reads it).
  const characters = (key.cast || []).map((c) => (typeof c === "object" && c !== null ? { name: c.name, aliases: c.aliases || [], description: c.notes ?? null } : { name: c }));

  const bodyExtra = {};
  if (args.recipe) bodyExtra.recipe = args.recipe;
  if (args.system) bodyExtra.systemPrompt = readFileSync(args.system, "utf8");
  if (args.user) bodyExtra.userPrompt = readFileSync(args.user, "utf8");
  if (args.temperature !== undefined) bodyExtra.temperature = Number(args.temperature);
  if (args.think) bodyExtra.think = true;
  if (args.model) {
    bodyExtra.model = args.model;
    bodyExtra.providerId = "local-llamacpp";
  }
  const settings = Object.entries(bodyExtra)
    .map(([k, v]) => `${k}=${pyRepr(v).slice(0, 40)}`)
    .join(", ");
  console.log(`Direction test · ${key.title || args.sample} · ${args.server} · ${runs} run(s) · ${settings || "live settings"}\n`);

  const texts = book.scenes.map(joinText);
  let own = {};
  let carried = {};
  let reach = { carried: 0, withoutCue: 0 };
  const dump = [];
  for (const [i, scene] of book.scenes.entries()) {
    const title = scene.title;
    if (args.chapter && !args.chapter.includes(title)) continue;
    if (!Object.hasOwn(key.cues, title) || !Object.hasOwn(key.chapters, title)) continue;
    const text = texts[i];
    const cues = key.cues[title];
    const allIds = Object.keys(key.chapters[title]).map(Number);
    const spoken = segmentParagraphs(splitIntoParagraphs(text)).filter((s) => s.kind === "dialogue").length;
    if (spoken !== allIds.length) console.log(`   ${spoken} spoken lines, key has ${allIds.length} — the numbering is off`);
    const earlier = book.scenes.slice(0, i).map((s, j) => ({ title: s.title || "", text: texts[j] }));
    for (let run = 0; run < runs; run++) {
      const t0 = Date.now();
      const r = await post(args.server, "/v1/extraction/direction-text", {
        text,
        speakers: key.chapters[title],
        characters,
        earlier,
        ...bodyExtra,
      });
      const byLine = new Map(r.lines.map((l) => [Number(l.id.slice(1)), l]));
      const ownMarks = new Set(r.lines.filter((l) => !l.carried_from && marked(l)).map((l) => Number(l.id.slice(1))));
      const allMarks = new Set(r.lines.filter(marked).map((l) => Number(l.id.slice(1))));
      const ownByLine = new Map([...byLine].filter(([, l]) => !l.carried_from));
      const sOwn = score(ownMarks, ownByLine, cues, allIds);
      const sCarry = score(allMarks, byLine, cues, allIds);
      const carriedOnto = r.lines.filter((l) => l.carried_from).map((l) => Number(l.id.slice(1)));
      const reachNow = { carried: carriedOnto.length, withoutCue: carriedOnto.filter((d) => !Object.hasOwn(cues, d)).length };
      own = add(own, sOwn);
      carried = add(carried, sCarry);
      reach = add(reach, reachNow);
      const u = r.usage || {};
      console.log(
        `## ${title}${runs > 1 ? ` run ${run + 1}` : ""}  (${((Date.now() - t0) / 1000).toFixed(0)}s, recipe ${r.recipe}, model ${u.model || "?"},` +
          ` ${grouped(u.prompt_tokens || 0)} in / ${grouped(u.completion_tokens || 0)} out, ${u.pieces ?? 1} call(s))`,
      );
      console.log(`   the model's own  ${line(sOwn)}`);
      console.log(`   with the carry   ${line(sCarry)}`);
      console.log(`   the carry reached ${reachNow.carried} line(s), ${reachNow.withoutCue} without a cue`);
      const spokenText = segmentParagraphs(splitIntoParagraphs(text))
        .filter((s) => s.kind === "dialogue")
        .map((s) => s.text);
      const missed = Object.keys(cues)
        .map(Number)
        .filter((d) => !allMarks.has(d));
      for (const d of missed.slice(0, show)) console.log(`   missed  D${d} “${(spokenText[d] || "").slice(0, 50)}”  (cue: ${cues[d].cue})`);
      if (missed.length > show) console.log(`   … ${missed.length - show} more missed`);
      const stray = allIds.filter((d) => !Object.hasOwn(cues, d) && allMarks.has(d));
      for (const d of stray.slice(0, show)) {
        const l = byLine.get(d);
        console.log(`   marked, no cue  D${d} ${l.emotion || "-"} / ${l.direction || "-"}${l.carried_from ? ` (carried from ${l.carried_from})` : ""}  “${(spokenText[d] || "").slice(0, 50)}”`);
      }
      for (const d of allIds) {
        const l = byLine.get(d);
        dump.push({
          chapter: title,
          run,
          d,
          cue: cues[d]?.cue ?? null,
          key_emotion: cues[d]?.emotion ?? null,
          emotion: l?.emotion ?? null,
          direction: l?.direction ?? null,
          carried_from: l?.carried_from ?? null,
        });
      }
    }
  }
  if (!Object.keys(own).length) throw new Exit("no keyed chapter with cues was run");
  console.log(`\nTOTAL the model's own  ${line(own)}`);
  console.log(`TOTAL with the carry   ${line(carried)}`);
  console.log(`the carry reached ${reach.carried} line(s), ${reach.withoutCue} without a cue`);
  if (args.out) writeFileSync(args.out, JSON.stringify(dump, null, 1), "utf8");
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (!(e instanceof Exit)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
