// SPDX-License-Identifier: MIT
// Extraction lab — ground-truth corpus + accuracy scoring (the port of
// justvoice/labs/extraction/run.py; the labs packages' own __init__ files hold only their
// docstrings: JustVoice's quality-evaluation labs, each sub-package independent and runnable).
//
// Usage:
//   node scripts/node24.js server/src/labs/extraction/run.js                  # every passage, auto route
//   node scripts/node24.js server/src/labs/extraction/run.js --route guided   # force a route
//   node scripts/node24.js server/src/labs/extraction/run.js --corpus austen_persuasion
//
// Writes a markdown report to labs/extraction/reports/latest-<route>.md with per-passage
// block-accuracy, per-character F1, and a source breakdown (anchor / propagated / llm / floored
// / second look). Requires a registered LLM provider — without one every passage reports its
// LLM call as failed. The corpus lives next to this module as JSON files under corpus/.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyRound, pySorted } from "@delebash/llm-runner/platform/py";
import { pyFloat } from "@delebash/llm-runner/platform/pyjson";
import { pyFixed } from "../../py_compat.js";

const logger = getLogger("justvoice.labs.extraction.run");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = path.join(HERE, "corpus");
export const REPORTS_DIR = path.join(HERE, "reports");

/** Every corpus case (or the one with this slug), in file-name order. */
export function loadCorpus(slug = null) {
  const files = pySorted(readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json")));
  const cases = [];
  for (const f of files) {
    const c = JSON.parse(readFileSync(path.join(CORPUS_DIR, f), "utf8"));
    if (slug === null || c.slug === slug) cases.push(c);
  }
  return cases;
}

/**
 * Compare AttributionRow output to ground truth. Walks rows in order, indexing only the
 * dialogue rows (narration is automatic). Compares row.speaker to groundTruth[i].speaker.
 * (Python built the per-character table from a set, so its row order changed run to run; here
 * it is the order the characters first appear.)
 */
export function scoreCase(rows, groundTruth) {
  const dialogueRows = rows.filter((r) => r.kind === "dialogue");
  const gt = pySorted(groundTruth, (g) => g.dialogue_id);
  const n = Math.min(dialogueRows.length, gt.length);
  let correct = 0;
  const bySource = {};
  const tp = new Map();
  const fp = new Map();
  const fn = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let i = 0; i < n; i++) {
    const row = dialogueRows[i];
    const expected = gt[i].speaker;
    const got = row.speaker;
    bySource[row.source] = (bySource[row.source] || 0) + 1;
    if (got === expected) {
      correct += 1;
      bump(tp, expected);
    } else {
      bump(fp, got);
      bump(fn, expected);
    }
  }
  const accuracy = n ? correct / n : 0.0;

  const f1PerChar = {};
  for (const charId of new Set([...tp.keys(), ...fn.keys()])) {
    const t = tp.get(charId) || 0;
    const p = fp.get(charId) || 0;
    const f = fn.get(charId) || 0;
    const precision = t + p ? t / (t + p) : 0.0;
    const recall = t + f ? t / (t + f) : 0.0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0.0;
    f1PerChar[charId] = { precision: pyRound(precision, 3), recall: pyRound(recall, 3), f1: pyRound(f1, 3) };
  }

  return { dialogue_count: n, correct, accuracy: pyRound(accuracy, 3), by_source: bySource, per_character_f1: f1PerChar };
}

/** Run one passage through the real pipeline (the app state over the default data folder). */
export async function runPassage(c, routeOverride) {
  const { getState, setState, AppState } = await import("../../app_state.js");
  const { analyzeScene } = await import("../../extraction/index.js");
  const { defaultDataDir } = await import("../../paths.js");

  try {
    getState();
  } catch {
    setState(new AppState(defaultDataDir()));
  }
  const settings = getState().settings.get();

  let rows;
  let llmOk;
  try {
    rows = await analyzeScene({
      settings,
      request: { text: c.text, characters: c.characters, corrections: [], route: routeOverride, propagate: true, use_floor: true },
    });
    llmOk = true;
  } catch (e) {
    rows = [];
    llmOk = false;
    logger.warning(`passage ${c.slug}: LLM call failed: ${e?.message ?? e}`);
  }

  const scored = scoreCase(rows, c.ground_truth);
  return { ...scored, llm_ok: llmOk, title: c.title, slug: c.slug, genre: c.genre };
}

export function formatReport(results, routeLabel) {
  const lines = [
    "# Extraction lab report",
    "",
    `- Route: \`${routeLabel}\``,
    `- Passages: ${results.length}`,
    "",
    "## Per-passage accuracy",
    "",
    "| Passage | Genre | Dialogue | Correct | Accuracy | tag | propagated | llm | floored | second look | LLM OK |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const s = r.by_source;
    lines.push(
      `| ${r.title} | ${r.genre} | ${r.dialogue_count} | ${r.correct} | ${pyFixed(r.accuracy * 100, 1)}% | ${s.tag || 0} | ${s.propagated || 0} | ` +
        `${s.llm || 0} | ${s.floored || 0} | ${s.second_look || 0} | ${r.llm_ok ? "✓" : "✗"} |`,
    );
  }
  const avg = results.reduce((a, r) => a + r.accuracy, 0) / Math.max(1, results.length);
  lines.push("", `## Aggregate accuracy: ${pyFixed(avg * 100, 1)}%`, "", "## Per-character F1", "");
  for (const r of results) {
    if (!Object.keys(r.per_character_f1).length) continue;
    lines.push(`### ${r.title}`, "", "| Character | Precision | Recall | F1 |", "|---|---|---|---|");
    for (const [charId, scores] of Object.entries(r.per_character_f1)) {
      // Python prints the rounded scores as floats ("1.0").
      lines.push(`| \`${charId}\` | ${pyFloat(scores.precision)} | ${pyFloat(scores.recall)} | ${pyFloat(scores.f1)} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { route: { type: "string" }, corpus: { type: "string" } } });
  if (values.route !== undefined && !["guided", "direct"].includes(values.route)) {
    process.stderr.write(`argument --route: invalid choice: '${values.route}' (choose from 'guided', 'direct')\n`);
    return 2;
  }
  const cases = loadCorpus(values.corpus ?? null);
  if (!cases.length) {
    process.stderr.write(`No corpus matches ${values.corpus === undefined ? "None" : `'${values.corpus}'`}\n`);
    return 1;
  }

  process.stderr.write(`Running ${cases.length} passage(s)…\n`);
  const results = [];
  for (const c of cases) results.push(await runPassage(c, values.route ?? null));

  const report = formatReport(results, values.route || "auto");
  mkdirSync(REPORTS_DIR, { recursive: true });
  // A deterministic name, so successive runs can be diffed by overwriting the same file.
  const outPath = path.join(REPORTS_DIR, `latest-${values.route || "auto"}.md`);
  writeFileSync(outPath, report, "utf8");
  process.stderr.write(`Report -> ${outPath}\n`);
  process.stdout.write(`${report}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
