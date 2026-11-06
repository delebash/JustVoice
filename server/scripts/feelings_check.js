// SPDX-License-Identifier: MIT
// REVERTED 2026-11-05 — the four feelings failed their rule (RESEARCH §10.38), so the prompt this
// script expects is gone and it stops at its check; it stays as the record of how they were measured.
//
// The check for "More feelings than nine", item 4 (TASKS; RESEARCH §10.38): the app's direction step
// on Alice VII–X twice on the same input — once with the prompt as it was before 2026-11-05 (the nine,
// no manner rule; `--system` override) and once with the live row (thirteen feelings, a manner is not
// a feeling) — and each line's label both ways. Writes nothing in the app: its Lab routes, in the
// order a book runs — discover-speakers (who is in the chapter), analyze-text (who says each line),
// direction-text twice. Reuses round 8's cast and speakers for IX and X.
//
//     node server/scripts/feelings_check.js --out data/feelings-check
//
// Needs a running JustVoice (127.0.0.1:17494) with its language model. Writes `<out>/direction.json`
// (both answers for every spoken line) and prints, per group of cue words §10.38 counts, the labels
// each prompt gave, then every line whose label differs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LOCAL_SYSTEM } from "../src/extraction/direction.js";
import { EMOTION_VALUES } from "../src/models.js";
import { runAdapter } from "../src/imports/index.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "http://127.0.0.1:17494" },
    out: { type: "string", default: path.join("data", "feelings-check") },
    chapters: { type: "string", default: "VII,VIII,IX,X" },
  },
});
const SERVER = args.server.replace(/\/+$/, "");
const OUT = path.resolve(ROOT, args.out);

// The prompt before 2026-11-05: today's with the emotion bullet as it was.
// The live prompt's bullet. (A first version also said "A manner is not a feeling: … get "" and
// their words"; on chapter IX it marked 127 of 135 spoken lines — RESEARCH §10.38 — and was dropped.)
const NEW_BULLET = `  - "emotion": the nearest of ${EMOTION_VALUES.join(", ")} — or "" when none of
    them fits the cue;`;
const OLD_BULLET = `  - "emotion": the nearest of neutral, happy, sad, angry, fearful, whispered,
    shouted, sarcastic, contemptuous — or "" when none of them fits the cue;`;
if (LOCAL_SYSTEM.split(NEW_BULLET).length !== 2) throw new Error("the live prompt's emotion bullet isn't the one this check knows");
const OLD_SYSTEM = LOCAL_SYSTEM.replace(NEW_BULLET, OLD_BULLET);

async function post(route, body) {
  const r = await fetch(SERVER + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1800 * 1000),
  });
  if (!r.ok) throw new Error(`${route} -> ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.json();
}

const root = path.join(ROOT, "server", "samples", "alice-in-wonderland");
const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
const book = runAdapter(key.adapter, readFileSync(path.join(root, key.book)), { filename: key.book });
const round8 = path.join(ROOT, "data", "round8", "direction.json");
const prior = existsSync(round8) ? JSON.parse(readFileSync(round8, "utf8")).chapters : {};

mkdirSync(OUT, { recursive: true });
const dumpPath = path.join(OUT, "direction.json");
const dump = existsSync(dumpPath) ? JSON.parse(readFileSync(dumpPath, "utf8")) : { chapters: {} };
const save = () => writeFileSync(dumpPath, `${JSON.stringify(dump, null, 2)}\n`);

for (const numeral of args.chapters.split(",")) {
  const scene = book.scenes.find((s) => s.title.startsWith(`CHAPTER ${numeral}.`));
  if (!scene) throw new Error(`the book has no CHAPTER ${numeral}`);
  const text = scene.lines.filter((l) => l.text).map((l) => l.text).join("\n\n");
  const ch = (dump.chapters[scene.title] ??= {});
  const t0 = Date.now();
  ch.cast ??= prior[scene.title]?.cast;
  ch.speakers ??= prior[scene.title]?.speakers;
  if (!ch.cast) {
    const found = await post("/v1/extraction/discover-speakers", { text });
    ch.cast = found.candidates.map((cand) => ({ id: cand.name, name: cand.name, aliases: cand.aliases ?? [] }));
    save();
  }
  if (!ch.speakers) {
    const analyzed = await post("/v1/extraction/analyze-text", { text, characters: ch.cast });
    const spoken = analyzed.rows.filter((r) => r.kind === "dialogue");
    ch.speakers = Object.fromEntries(spoken.map((r, d) => [String(d), r.speaker]).filter(([, who]) => who && !["unknown", "narrator"].includes(who)));
    save();
  }
  const request = { text, speakers: ch.speakers, characters: ch.cast };
  if (!ch.before) {
    ch.before = (await post("/v1/extraction/direction-text", { ...request, systemPrompt: OLD_SYSTEM })).lines;
    save();
  }
  if (!ch.after) {
    // The code's prompt sent explicitly: a running server may hold its prompt row from before a change.
    ch.after = (await post("/v1/extraction/direction-text", { ...request, systemPrompt: LOCAL_SYSTEM })).lines;
    save();
  }
  console.log(`${scene.title}: ${ch.before.length} lines directed before, ${ch.after.length} after, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// §10.38's groups of cue words, and the label each prompt gave them (carried lines left out).
const GROUPS = {
  thinking: /thinking to herself|^thought|to herself|after thinking|thoughtfully|saying to herself/i,
  timid: /timid|cautious|ventured|meekly/i,
  polite: /polite|humbl|gently|pleaded/i,
  surprise: /surpris|wonder|curiosity|confused/i,
  sleepy: /sleep|yawn/i,
  hurried: /hast|hurr|panted/i,
  firm: /decided|severe|severity|solemn/i,
  eager: /eager|triumph|encourag|earnest/i,
  relief: /relief|glad/i,
};
const tally = (lines) => {
  const out = {};
  for (const l of lines) {
    if (l.carried_from || !l.direction) continue;
    for (const [g, re] of Object.entries(GROUPS)) {
      if (!re.test(l.direction)) continue;
      const t = (out[g] ??= {});
      const e = l.emotion || "none";
      t[e] = (t[e] || 0) + 1;
      break;
    }
  }
  return out;
};
const all = (arm) => Object.values(dump.chapters).flatMap((ch) => ch[arm] || []);
const before = tally(all("before"));
const after = tally(all("after"));
for (const g of Object.keys(GROUPS)) console.log(`${g.padEnd(9)} before ${JSON.stringify(before[g] || {})}  after ${JSON.stringify(after[g] || {})}`);
console.log("\nEvery line whose label differs (before → after, the after's words):");
for (const [title, ch] of Object.entries(dump.chapters)) {
  const was = new Map((ch.before || []).map((l) => [l.id, l]));
  const now = new Map((ch.after || []).map((l) => [l.id, l]));
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id);
    const b = now.get(id);
    if ((a?.emotion || "") === (b?.emotion || "")) continue;
    console.log(`  ${title.slice(8, 13)} ${id}: ${a?.emotion || "—"} → ${b?.emotion || "—"} | ${b?.direction ?? a?.direction ?? ""}`);
  }
}
