// SPDX-License-Identifier: MIT
// Round 8's lines (TASKS "Round 7's answers acted on", 3): spoken lines from chapters no round has
// used, each told two ways by the app's own direction step on the same input — the live prompt (the
// cue words the app writes today) and round 7's delivery-note prompt (`--system`). Writes nothing in
// the app: its Lab routes, in the order a book runs — discover-speakers (who is in the chapter),
// analyze-text (who says each line), direction-text twice.
//
//     node server/scripts/round8_lines.js --system data/round8/note_system.txt --out data/round8
//
// Needs a running JustVoice (127.0.0.1:17494) with its language model. Picks `--count` lines the live
// prompt directed (the book gives a cue) whose two answers differ in words, spread over the
// emotions the live prompt named, in book order within each. Writes `<out>/direction.json` (both
// answers for every spoken line, and the pick) and `<out>/lines-cue.json` / `<out>/lines-note.json`
// for `round4:render --lines-file` (the same lines and emotion; only the words differ).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAdapter } from "../src/imports/index.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "http://127.0.0.1:17494" },
    system: { type: "string" },
    out: { type: "string", default: path.join("data", "round8") },
    chapters: { type: "string", default: "IX,X" },
    count: { type: "string", default: "30" },
  },
});
if (!args.system) throw new Error("--system <the note prompt> is needed");
const SERVER = args.server.replace(/\/+$/, "");
const OUT = path.resolve(ROOT, args.out);
const COUNT = Number(args.count);
const NOTE_SYSTEM = readFileSync(path.resolve(ROOT, args.system), "utf8");

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

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const romanValue = (s) => [...s].reduce((n, ch, i, a) => (ROMAN[ch] < (ROMAN[a[i + 1]] ?? 0) ? n - ROMAN[ch] : n + ROMAN[ch]), 0);
const words = (t) => t.split(/\s+/).filter(Boolean).length;
const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

const root = path.join(ROOT, "server", "samples", "alice-in-wonderland");
const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
const book = runAdapter(key.adapter, readFileSync(path.join(root, key.book)), { filename: key.book });

mkdirSync(OUT, { recursive: true });
const dumpPath = path.join(OUT, "direction.json");
const dump = existsSync(dumpPath) ? JSON.parse(readFileSync(dumpPath, "utf8")) : { chapters: {} };
const save = () => writeFileSync(dumpPath, `${JSON.stringify(dump, null, 2)}\n`);

for (const numeral of args.chapters.split(",")) {
  const scene = book.scenes.find((s) => s.title.startsWith(`CHAPTER ${numeral}.`));
  if (!scene) throw new Error(`the book has no CHAPTER ${numeral}`);
  if (dump.chapters[scene.title]?.note) continue;
  const text = scene.lines.filter((l) => l.text).map((l) => l.text).join("\n\n");
  const ch = (dump.chapters[scene.title] ??= { n: romanValue(numeral) });
  const t0 = Date.now();
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
  if (!ch.cue) {
    ch.cue = (await post("/v1/extraction/direction-text", request)).lines;
    save();
  }
  ch.note = (await post("/v1/extraction/direction-text", { ...request, systemPrompt: NOTE_SYSTEM })).lines;
  save();
  console.log(`${scene.title}: ${ch.cast.length} people, ${ch.cue.length} lines directed, ${ch.note.length} given a note, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// The candidates: lines the live prompt directed, with a note in other words.
const candidates = [];
for (const ch of Object.values(dump.chapters)) {
  const notes = new Map(ch.note.map((l) => [l.id, l]));
  for (const cue of ch.cue) {
    const note = notes.get(cue.id);
    if (!cue.direction || !note?.direction || same(cue.direction, note.direction) || words(cue.text) < 3) continue;
    candidates.push({ line: `${ch.n}-${cue.id.slice(1)}`, text: cue.text, speaker: cue.speaker, emotion: cue.emotion || note.emotion || "neutral", cue: cue.direction, note: note.direction });
  }
}
// Spread over the emotions: one from each in turn, book order within each.
const byEmotion = new Map();
for (const c of candidates) byEmotion.set(c.emotion, [...(byEmotion.get(c.emotion) ?? []), c]);
const picked = [];
while (picked.length < COUNT && [...byEmotion.values()].some((q) => q.length)) {
  for (const q of byEmotion.values()) if (q.length && picked.length < COUNT) picked.push(q.shift());
}
const order = (l) => l.line.split("-").map(Number);
picked.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);
dump.picked = picked;
save();
const asLines = (words) => picked.map((p) => ({ line: p.line, text: p.text, emotion: p.emotion, cue: p.cue, direction: words(p) }));
writeFileSync(path.join(OUT, "lines-cue.json"), `${JSON.stringify(asLines((p) => p.cue), null, 2)}\n`);
writeFileSync(path.join(OUT, "lines-note.json"), `${JSON.stringify(asLines((p) => p.note), null, 2)}\n`);
console.log(`${candidates.length} candidates; picked ${picked.length}: ${[...new Set(picked.map((p) => p.emotion))].map((e) => `${e} ${picked.filter((p) => p.emotion === e).length}`).join(", ")}`);
