// SPDX-License-Identifier: MIT
// Round 4's screening table (docs/plans/2026-10-16-test-kit-and-round-4.md §3, step 3): the test
// kit's scores for every arm, side by side — how much telling a line its emotion moves the take
// (emotion2vec+'s probability of the asked emotion, told minus not told, with the kit's paired
// bootstrap interval; loudness for shouted and whispered lines), how often a told take is heard
// as the asked emotion, the read-back, the speaker against the voice's clip, quality, and speed.
//
//     npm run round4:report -- data/round4/score-a/out data/round4/score-b/out
//
// Reads each folder's summary.json and scores.csv (tools/take-check), and the round's manifest
// for the render times (the kit's manifest.json beside the first folder when there is one, as
// round 5's `data/round5/score/`; round 4's otherwise). Prints a Markdown table and writes
// round4-report.json beside the first folder. Built 2026-10-16.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CLASS = { contemptuous: "disgusted" }; // the kit's nearest emotion2vec+ class
const CLASSED = new Set(["happy", "sad", "angry", "fearful", "contemptuous"]);

function csv(file) {
  const [head, ...rows] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  // The kit writes no quoted commas in the columns read here; the heard text is last-but-one and
  // may hold commas, so it is never read.
  return rows.map((r) => {
    const c = r.split(",");
    return Object.fromEntries(cols.map((k, i) => [k, c[i]]));
  });
}

const num = (v) => (v === undefined || v === "" ? null : Number(v));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(d));
const ci = (r, d = 2) => (r ? `${f(r.mean_diff, d)}${r.ci_low !== null && r.ci_low !== undefined ? ` [${f(r.ci_low, d)}, ${f(r.ci_high, d)}]` : ""}` : "—");

const dirs = process.argv.slice(2).map((d) => path.resolve(ROOT, d));
if (!dirs.length) {
  console.error("usage: npm run round4:report -- <kit out folder> [<another> …]");
  process.exit(2);
}
const beside = path.join(dirs[0] ?? "", "..", "manifest.json");
const manifest = JSON.parse(readFileSync(existsSync(beside) ? beside : path.join(ROOT, "data", "round4", "manifest.json"), "utf8"));
const renderS = new Map();
for (const t of manifest.takes) {
  if (t.error) continue;
  if (!renderS.has(t.model)) renderS.set(t.model, []);
  renderS.get(t.model).push(t.render_s);
}

const arms = [];
for (const dir of dirs) {
  const summary = JSON.parse(readFileSync(path.join(dir, "summary.json"), "utf8"));
  const rows = existsSync(path.join(dir, "scores.csv")) ? csv(path.join(dir, "scores.csv")) : [];
  for (const [model, s] of Object.entries(summary)) {
    const mine = rows.filter((r) => r.model === model);
    const told = mine.filter((r) => r.told === "True" || r.told === "true");
    const plain = mine.filter((r) => !(r.told === "True" || r.told === "true"));
    // Heard as the asked emotion: emotion2vec+'s top class is the line's emotion (its nearest class).
    const lineEmotion = new Map(told.map((r) => [r.line, r.emotion_asked]));
    const hit = (r) => {
      const e = lineEmotion.get(r.line);
      return e && CLASSED.has(e) ? (r.emotion_top === (CLASS[e] ?? e) ? 1 : 0) : null;
    };
    const hitsTold = told.map(hit).filter((x) => x !== null);
    const hitsPlain = plain.map(hit).filter((x) => x !== null);
    const wers = told.map((r) => num(r.wer)).filter((x) => x !== null);
    const tmu = s.told_minus_untold || {};
    arms.push({
      model,
      takes: s.counts?.takes ?? mine.length,
      emotion_gain: tmu.emotion_asked_prob?.all ?? null,
      emotion_gain_by: tmu.emotion_asked_prob?.by_emotion_asked ?? {},
      heard_told: mean(hitsTold),
      heard_plain: mean(hitsPlain),
      shouted_lufs: tmu.loudness_lufs?.by_emotion_asked?.shouted ?? null,
      whispered_lufs: tmu.loudness_lufs?.by_emotion_asked?.whispered ?? null,
      wer_told: s.scores?.wer?.told?.mean ?? null,
      broken_told: wers.length ? wers.filter((w) => w > 0.25).length / wers.length : null,
      spk_told: s.scores?.spk_similarity?.told?.mean ?? null,
      spk_plain: s.scores?.spk_similarity?.untold?.mean ?? null,
      utmos_told: s.scores?.utmosv2?.told?.mean ?? null,
      render_median_s: median(renderS.get(model) || []),
    });
  }
}
arms.sort((a, b) => (b.emotion_gain?.mean_diff ?? -1) - (a.emotion_gain?.mean_diff ?? -1));

const lines = [
  "| Arm | Emotion gain, told − plain [95% CI] | Heard as asked: told · plain | Shouted Δ LUFS | Whispered Δ LUFS | Read-back WER (told) · > 0.25 | Speaker sim: told · plain | UTMOSv2 (told) | Render s (median) |",
  "|---|---|---|---|---|---|---|---|---|",
  ...arms.map((a) =>
    `| ${a.model} | ${ci(a.emotion_gain)} | ${f(a.heard_told)} · ${f(a.heard_plain)} | ${ci(a.shouted_lufs, 1)} | ${ci(a.whispered_lufs, 1)} | ${f(a.wer_told, 3)} · ${f(a.broken_told)} | ${f(a.spk_told)} · ${f(a.spk_plain)} | ${f(a.utmos_told)} | ${f(a.render_median_s, 1)} |`,
  ),
  "",
  "Emotion gain by emotion (told − plain probability of the asked emotion):",
  "",
  "| Arm | sad | angry | fearful | happy | contemptuous |",
  "|---|---|---|---|---|---|",
  ...arms.map((a) => `| ${a.model} | ${["sad", "angry", "fearful", "happy", "contemptuous"].map((e) => ci(a.emotion_gain_by[e])).join(" | ")} |`),
];
console.log(lines.join("\n"));
writeFileSync(path.join(dirs[0], "round4-report.json"), `${JSON.stringify(arms, null, 2)}\n`);
