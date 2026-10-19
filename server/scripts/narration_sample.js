// SPDX-License-Identifier: MIT
// A narration sample: the same 10 narration passages of Alice VII (the one-click test book) read by
// one voice on VoxCPM2 (the voice itself) and on BreezeTTS 2 (its copy), seed 7, no direction —
// round 5's narration sample (RESEARCH §10.29), here with the voice named.
//
//     node server/scripts/narration_sample.js --voice <a voice on VoxCPM2> --out data/round7/narration
//
// Needs a running JustVoice (127.0.0.1:17494). The passages are the book's first 10 narration lines
// of at least 25 words. The Breeze copy is made once (`POST /v1/voices/{id}/copy`) and reused by
// name. Writes `<out>/<engine>/<n>.wav` and `<out>/manifest.json`; a take already on disk is kept.
// Round 5 ran this from the session's scratchpad with Alice's voice — a child's, not a narrator's
// (RESEARCH §10.31); this one takes the narrator's voice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "http://127.0.0.1:17494" },
    voice: { type: "string" },
    out: { type: "string" },
    book: { type: "string", default: "Alice VII (one-click test)" },
  },
});
if (!args.voice || !args.out) throw new Error("--voice and --out are needed");
const SERVER = args.server.replace(/\/+$/, "");
const OUT = path.resolve(ROOT, args.out);

async function call(route, { method = "GET", body, raw = false } = {}) {
  const r = await fetch(SERVER + route, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(900 * 1000),
  });
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

const { projects } = await call("/v1/projects");
const project = projects.find((p) => p.name === args.book);
if (!project) throw new Error(`no project called ${args.book}`);
const scenes = await call(`/v1/projects/${project.id}/scenes`);
const script = await call(`/v1/scenes/${scenes[0].id}/script`);
const passages = script.lines
  .filter((l) => !l.spoken && l.text.split(/\s+/).length >= 25)
  .slice(0, 10)
  .map((l) => l.text);
const { voices } = await call("/v1/voices");
const source = voices.find((v) => v.id === args.voice);
if (!source) throw new Error(`no voice ${args.voice}`);
const { engines: rows } = await call("/v1/engines/capabilities");
const breezeRow = Object.keys(rows).find((id) => id === "breeze_tts" || "breeze_tts-q8".startsWith(`${id}-`));
const name = `${source.name} · narration (Breeze)`;
const copy = voices.find((v) => v.name === name) ?? (await call(`/v1/voices/${source.id}/copy`, { method: "POST", body: { model: breezeRow, name } }));

mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { voice: source.id, copy: copy.id, passages, takes: [] };
for (const [engine, variant, voice] of [
  ["voxcpm2", "voxcpm2-q8", source.id],
  ["breeze_tts", "breeze_tts-q8", copy.id],
]) {
  await call(`/v1/engines/${engine}/load`, { method: "POST", body: { model_variant: variant } });
  const dir = path.join(OUT, engine);
  mkdirSync(dir, { recursive: true });
  for (const [i, text] of passages.entries()) {
    const wav = path.join(dir, `${i + 1}.wav`);
    if (existsSync(wav)) continue;
    const t0 = Date.now();
    writeFileSync(wav, await call("/v1/generate", { method: "POST", body: { voice, text, language: "en", seed: 7, cache: false }, raw: true }));
    manifest.takes.push({ engine, i: i + 1, render_s: (Date.now() - t0) / 1000, chars: text.length });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(engine, i + 1, ((Date.now() - t0) / 1000).toFixed(1), "s");
  }
}
console.log("done");
