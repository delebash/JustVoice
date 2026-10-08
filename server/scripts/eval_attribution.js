// SPDX-License-Identifier: MIT
// Score speaker attribution (Studio · Script · Analyze) against an answer key (the port of
// eval_attribution.py, 2026-10-08; the conversion leaves no Python).
//
//     npm run eval:attribution                         # server on 127.0.0.1:8741
//     npm run eval:attribution -- --runs 2 --route direct
//     npm run eval:attribution -- --system draft.txt   # try a prompt, save nothing
//     npm run eval:attribution -- --fixes-from "Bigger Inside"   # with the user's fixes in the prompt
//     npm run eval:attribution -- --sample the-speckled-band     # published prose, a plain-text import
//
// Needs a running JustVoice server (it owns the model and the LIVE prompt rows — AI Settings →
// Features → the speaker_attribution routes). Each chapter goes through POST
// /v1/extraction/analyze-text: the whole production pipeline — segmentation, tag anchors, the
// model call, the confidence floor — writing nothing. The cast is built the way `_resolveCast`
// builds it for Analyze.
//
// The answer key is `samples/<sample>/attribution-truth.json`: the speaker of every [D#]
// dialogue segment, labelled by hand. Per segment the result is
//   right      the right cast member (or "unknown" where the speaker is not cast)
//   WRONG      a different cast member — the dangerous one: it looks finished
//   blank      "unknown" / no speaker where the key names someone — visible, and blocks the
//              render until fixed
// and every result is also broken down by the source that decided it (tag, propagated, llm,
// floored), so a change can be traced to the stage it moved.
//
// Every run also reports Script's flags (`src/extraction/flags.js`, the function the app
// ships): how many WRONG lines sit inside a flag group (caught), how many don't (missed), and
// how many groups hold no wrong line at all (false alarms).
//
// Built 2026-09-28 so attribution changes are measured, not eyeballed.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pyFloatValue } from "@delebash/llm-runner/platform/pyjson";
import { flagGroups, linesFromRows, quoteLeftOpen } from "../src/extraction/flags.js";
import { detectMarks, segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";
import { pyRepr } from "../src/py_compat.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A persona id shaped like the app's (a UUID), stable per name — a readable id would hand
 * the model the name and hide id-copying mistakes. */
function slug(name) {
  const h = createHash("sha1").update(name, "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

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

/** The user's fixes as Analyze sends them (`_resolveCorrections`): a line's text and the
 * persona it belongs to. Built from the answer key of ONE chapter, which the caller then leaves
 * out of the score, so a fix never hands over an answer being tested. Each snippet is the line
 * exactly as a block stores it — the segmenter's dialogue text — because that is what a fix
 * records. */
function buildFixes(book, key, args, chars) {
  const scene = book.scenes.find((s) => s.title === args["fixes-from"]);
  if (!scene || !Object.hasOwn(key.chapters, args["fixes-from"])) {
    throw new Exit(`--fixes-from: no keyed chapter called ${pyRepr(args["fixes-from"])}`);
  }
  const spoken = segmentParagraphs(splitIntoParagraphs(joinText(scene)))
    .filter((s) => s.kind === "dialogue")
    .map((s) => s.text);
  const nameToId = Object.fromEntries(chars.map((c) => [c.name, c.id]));
  const pool = Object.entries(key.chapters[args["fixes-from"]])
    .filter(([d, who]) => Object.hasOwn(nameToId, who) && who !== "Narrator" && Number(d) < spoken.length)
    .map(([d, who]) => [spoken[Number(d)], nameToId[who]]);
  const want = Number.parseInt(args.fixes, 10);
  let picked;
  if (args["fixes-pick"] === "shortest") {
    picked = [...pool].sort((a, b) => a[0].length - b[0].length).slice(0, want);
  } else {
    const step = Math.max(pool.length / Math.max(want, 1), 1);
    picked = Array.from({ length: Math.min(want, pool.length) }, (_, i) => pool[Math.trunc(i * step)]);
  }
  return picked.map(([t, pid]) => ({ text_snippet: t, persona_id: pid }));
}

const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const pct = (a, n) => ((100 * a) / Math.max(n, 1)).toFixed(0);

async function main() {
  const { values: args } = parseArgs({
    options: {
      server: { type: "string", default: "http://127.0.0.1:8741" },
      sample: { type: "string", default: "the-ninth-facet" },
      runs: { type: "string", default: "1" },
      route: { type: "string" }, // force a route (default: Auto): guided | direct
      system: { type: "string" }, // file with a CANDIDATE system prompt (not saved)
      user: { type: "string" }, // file with a CANDIDATE user template (not saved)
      floor: { type: "string" }, // confidence floor for this run
      temperature: { type: "string" },
      think: { type: "boolean" }, // let the model reason before answering
      model: { type: "string" }, // run on this catalog model instead of the preset's (local runner)
      "readable-ids": { type: "boolean" }, // p_name ids instead of UUID-shaped (diagnostic)
      "no-propagate": { type: "boolean" }, // skip the tag-anchor pass
      chapter: { type: "string", multiple: true }, // only these chapter titles
      whole: { type: "boolean" }, // join the keyed chapters into ONE long chapter
      "no-second-look": { type: "boolean" }, // skip Analyze's second look at blank lines
      "max-context": { type: "string" }, // treat the model's context as this many tokens
      show: { type: "string", default: "12" }, // errors to print per chapter
      out: { type: "string" }, // write every row as JSON, for comparing runs
      // send fixes built from this keyed chapter's answers, and leave it out of the score
      "fixes-from": { type: "string" },
      fixes: { type: "string", default: "12" }, // how many fixes (Analyze sends the 12 most recent)
      "fixes-pick": { type: "string", default: "shortest" }, // shortest | spread
    },
  });
  if (args.route !== undefined && !["guided", "direct"].includes(args.route)) throw new Exit("--route: guided or direct");
  if (!["shortest", "spread"].includes(args["fixes-pick"])) throw new Exit("--fixes-pick: shortest or spread");
  const runs = Number.parseInt(args.runs, 10);
  const show = Number.parseInt(args.show, 10);

  const root = path.join(ROOT, "samples", args.sample);
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  // A key may name its book file and the adapter that reads it — a plain-text book goes
  // through book_prose, the path a non-JustWrite import takes.
  const bookFile = key.book || "book.json";
  const book = runAdapter(key.adapter || "justwrite", readFileSync(path.join(root, bookFile)), { filename: bookFile });

  // The cast exactly as _resolveCast shapes it for Analyze. A cast entry is a name, or
  // {"name", "aliases", "notes"} for a book that ships no characters (the key then stands in
  // for what Discover would have added).
  const cast = key.cast.map((c) => (typeof c === "object" && c !== null ? c : { name: c }));
  const castNames = cast.map((c) => c.name);

  const char = (name, aliases, notes) => ({
    id: args["readable-ids"] ? `p_${name.toLowerCase().replaceAll(" ", "_")}` : slug(name),
    name,
    role: null,
    gender: null,
    pronouns: null,
    aliases: [...(aliases || [])],
    description: notes ?? null,
  });
  const chars = [{ id: "p_narrator", name: "Narrator", role: null, gender: null, pronouns: null, aliases: [], description: null }];
  if (book.characters.length) chars.push(...book.characters.filter((c) => castNames.includes(c.name)).map((c) => char(c.name, c.aliases, c.notes)));
  else chars.push(...cast.map((c) => char(c.name, c.aliases, c.notes)));
  const idToName = Object.fromEntries(chars.map((c) => [c.id, c.name]));
  Object.assign(idToName, { narrator: "Narrator", unknown: "unknown" });

  const bodyExtra = {};
  if (args.system) bodyExtra.systemPrompt = readFileSync(args.system, "utf8");
  if (args.user) bodyExtra.userPrompt = readFileSync(args.user, "utf8");
  if (args.think) bodyExtra.think = true;
  if (args.model) {
    bodyExtra.model = args.model;
    bodyExtra.providerId = "local-llamacpp";
  }
  if (args.route !== undefined) bodyExtra.route = args.route;
  if (args.floor !== undefined) bodyExtra.confidence_floor = pyFloatValue(args.floor);
  if (args.temperature !== undefined) bodyExtra.temperature = pyFloatValue(args.temperature);
  if (args["no-propagate"]) bodyExtra.propagate = false;
  if (args["no-second-look"]) bodyExtra.second_look = false;
  if (args["max-context"]) bodyExtra.max_context = Number.parseInt(args["max-context"], 10);
  if (args["fixes-from"]) bodyExtra.corrections = buildFixes(book, key, args, chars);

  const settings = Object.entries(bodyExtra)
    .map(([k, v]) => `${k}=${pyRepr(v).slice(0, 40)}`)
    .join(", ");
  console.log(`Attribution test · ${key.title || book.project.name} · ${args.server} · ${runs} run(s) · ${settings || "live settings"}\n`);
  for (const fix of bodyExtra.corrections || []) {
    console.log(`   fix: “${fix.text_snippet.slice(0, 60)}” -> ${idToName[fix.persona_id] ?? "None"}`);
  }

  let tests = []; // [title, text, truth, alsoOk]
  // The chapters either side, as Analyze sends them for its second look (2026-10-05).
  const allTexts = book.scenes.map(joinText);
  const neighbours = new Map(book.scenes.map((s, i) => [s.title, [i > 0 ? allTexts[i - 1] : null, i + 1 < allTexts.length ? allTexts[i + 1] : null]]));
  for (const scene of book.scenes) {
    if (args.chapter && !args.chapter.includes(scene.title)) continue;
    // a key may cover only some chapters of a long book
    if (!Object.hasOwn(key.chapters, scene.title) || scene.title === args["fixes-from"]) continue;
    tests.push([scene.title, joinText(scene), key.chapters[scene.title], new Set((key.also_ok || {})[scene.title] || [])]);
  }
  if (args.whole) {
    // One long chapter: the keyed chapters joined, their [D#] keys shifted by the dialogue
    // count before them (a key numbers every dialogue segment from 0).
    const text = [];
    const truth = {};
    const alsoOk = new Set();
    let off = 0;
    for (const [, t, tr, ok] of tests) {
      text.push(t);
      for (const [d, v] of Object.entries(tr)) truth[String(Number(d) + off)] = v;
      for (const d of ok) alsoOk.add(String(Number(d) + off));
      off += Object.keys(tr).length;
    }
    tests = [[`whole book (${tests.length} chapters)`, text.join("\n\n"), truth, alsoOk]];
  }

  const grand = new Map();
  const bySource = new Map(); // "source|verdict" → count
  const flagTotal = new Map();
  const dump = [];
  const castIds = new Set(chars.map((c) => c.id));
  for (const [title, text, truth, alsoOk] of tests) {
    for (let run = 0; run < runs; run++) {
      const t0 = Date.now();
      const [before, after] = neighbours.get(title) || [null, null];
      const r = await post(args.server, "/v1/extraction/analyze-text", {
        text,
        characters: chars,
        before_text: before,
        after_text: after,
        ...bodyExtra,
      });
      const dialogue = r.rows.filter((row) => row.kind === "dialogue");
      const marks = detectMarks(text); // the chapter's, as the app reads it
      const openParas = new Set();
      splitIntoParagraphs(text).forEach((p, i) => {
        if (quoteLeftOpen(p, marks)) openParas.add(i);
      });
      const groups = flagGroups(linesFromRows(r.rows, { narratorIds: ["narrator", "p_narrator"] }), castIds, { openParagraphs: openParas });
      const flagsOn = new Map();
      for (const g of groups) for (const lid of g.lines) flagsOn.set(lid, [...(flagsOn.get(lid) || []), g.check]);
      const nKey = Object.keys(truth).length;
      if (dialogue.length !== nKey) console.log(`   ${dialogue.length} dialogue segments, key has ${nKey} — the numbering is off`);
      const c = new Map();
      const errors = [];
      dialogue.forEach((row, i) => {
        const want = truth[String(i)];
        const got = idToName[row.speaker] ?? row.speaker;
        const src = row.source;
        if (want === undefined) return;
        let verdict;
        if (got === want || (got === "unknown" && alsoOk.has(String(i)))) verdict = "right";
        else if ((got === "unknown" || got === "Narrator") && want !== "unknown") verdict = got === "unknown" ? "blank" : "WRONG";
        else verdict = "WRONG";
        bump(c, verdict);
        bump(bySource, `${src}|${verdict}`);
        if (verdict !== "right") {
          const conf = src === "llm" || src === "floored" ? ` ${(row.confidence || 0).toFixed(2)}` : "";
          errors.push(`D${i} ${verdict.padEnd(5)} want ${String(want).padEnd(15)} got ${String(got).padEnd(15)} [${src}${conf}]  “${row.text.slice(0, 60)}”`);
        }
        dump.push({ chapter: title, run, d: i, want, got, source: src, confidence: row.confidence ?? null, verdict, flags: flagsOn.get(`D${i}`) || [] });
      });
      const n = [...c.values()].reduce((a, b) => a + b, 0);
      for (const [k, v] of c) bump(grand, k, v);
      if ((c.get("blank") || 0) > n / 2 && r.raw_llm != null) {
        const rawPath = path.join(os.tmpdir(), `attr_raw_${title.replace(/[^A-Za-z0-9]+/g, "_")}_${run}.txt`);
        writeFileSync(rawPath, r.raw_llm || "", "utf8");
        console.log(`   (mostly blank — raw reply saved to ${rawPath})`);
      }
      const usage = r.usage || {};
      console.log(
        `## ${title}${runs > 1 ? ` run ${run + 1}` : ""}  right ${c.get("right") || 0}/${n}  WRONG ${c.get("WRONG") || 0}  blank ${c.get("blank") || 0}   ` +
          `(${((Date.now() - t0) / 1000).toFixed(0)}s, route ${pyRepr(r.route_used ?? null)}, floor ${pyRepr(r.confidence_floor ?? null)},` +
          ` model ${usage.model ?? "?"}, ${usage.pieces ?? 1} piece(s))`,
      );
      for (const e of errors.slice(0, show)) console.log(`   ${e}`);
      if (errors.length > show) console.log(`   … ${errors.length - show} more`);
      const wrong = new Set(dump.filter((d) => d.chapter === title && d.run === run && d.verdict === "WRONG").map((d) => `D${d.d}`));
      const caught = new Set([...wrong].filter((lid) => flagsOn.has(lid)));
      const idle = groups.filter((g) => !g.lines.some((lid) => wrong.has(lid)));
      const kinds = new Map();
      for (const g of groups) bump(kinds, g.check);
      bump(flagTotal, "groups", groups.length);
      bump(flagTotal, "wrong", wrong.size);
      bump(flagTotal, "caught", caught.size);
      bump(flagTotal, "idle", idle.length);
      const missed = [...wrong].filter((lid) => !caught.has(lid)).sort();
      console.log(
        `   flags: ${groups.length} group(s)` +
          `${kinds.size ? ` (${[...kinds].map(([k, m]) => `${k} ${m}`).join(" · ")})` : ""}` +
          ` · caught ${caught.size} of ${wrong.size} wrong line(s)` +
          `${missed.length ? ` ${missed.join(", ")} missed` : ""}` +
          ` · ${idle.length} group(s) hold no wrong line`,
      );
    }
  }

  const n = [...grand.values()].reduce((a, b) => a + b, 0);
  const g = (k) => grand.get(k) || 0;
  console.log(
    `\nTOTAL right ${g("right")}/${n} (${pct(g("right"), n)}%) · WRONG ${g("WRONG")} (${pct(g("WRONG"), n)}%) · blank ${g("blank")} (${pct(g("blank"), n)}%)`,
  );
  const sources = ["tag", "propagated", "llm", "floored", "second_look"].filter((s) => [...bySource.keys()].some((k) => k.startsWith(`${s}|`)));
  console.log(
    `by source: ${sources
      .map((s) => {
        const total = [...bySource].filter(([k]) => k.startsWith(`${s}|`)).reduce((a, [, v]) => a + v, 0);
        const w = bySource.get(`${s}|WRONG`) || 0;
        return `${s}: ${bySource.get(`${s}|right`) || 0}/${total} right${w ? `, ${w} wrong` : ""}`;
      })
      .join(" · ")}`,
  );
  const f = (k) => flagTotal.get(k) || 0;
  console.log(`flags: ${f("groups")} group(s) · caught ${f("caught")} of ${f("wrong")} wrong line(s) · ${f("idle")} group(s) hold no wrong line`);
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
