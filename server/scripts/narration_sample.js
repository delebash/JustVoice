// SPDX-License-Identifier: MIT
// A narration sample: the same 10 narration passages of Alice VII (the one-click test book) read by
// one voice on its own model and on each other model named (a copy of it), seed 7, no direction —
// round 5's narration sample (RESEARCH §10.29), here with the voice named.
//
//     node server/scripts/narration_sample.js --voice <a voice on VoxCPM2> --out data/round7/narration
//     node server/scripts/narration_sample.js --voice <…> --out data/round8/narration \
//       --engines breeze_tts:breeze_tts-q8,fish_drama3:<variant> --opening 300
//
// Needs a running JustVoice (127.0.0.1:17494). The passages are the book's first 10 narration lines
// of at least 25 words. A copy is made once per model (`POST /v1/voices/{id}/copy`) and reused by
// name. `--opening <words>` adds the chapter's opening narration as the book plays it: its narration
// lines in order, each rendered on its own, until that many words, joined with the app's pause
// between lines (`render_core.concatLines`) — how a long stretch holds up (TASKS "Round 7's answers
// acted on", 1). Writes `<out>/<engine>/<n>.wav`, `<out>/<engine>/opening.wav` and
// `<out>/manifest.json`; a take already on disk is kept.
// Round 5 ran this from the session's scratchpad with Alice's voice — a child's, not a narrator's
// (RESEARCH §10.31); this one takes the narrator's voice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { concatLines, RenderedLine } from "../src/render_core.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { values: args } = parseArgs({
  options: {
    server: { type: "string", default: "http://127.0.0.1:17494" },
    voice: { type: "string" },
    out: { type: "string" },
    book: { type: "string", default: "Alice VII (one-click test)" },
    engines: { type: "string", default: "voxcpm2:voxcpm2-q8,breeze_tts:breeze_tts-q8" },
    opening: { type: "string" },
  },
});
if (!args.voice || !args.out) throw new Error("--voice and --out are needed");
const SERVER = args.server.replace(/\/+$/, "");
const OUT = path.resolve(ROOT, args.out);
const ENGINES = args.engines.split(",").map((e) => e.split(":"));
const OPENING_WORDS = args.opening ? Number(args.opening) : 0;
// A copy's name: "<voice> · narration (<label>)" — round 7's Breeze copy kept its name.
const LABEL = { breeze_tts: "Breeze", fish_drama3: "Drama 3", voxcpm2: "VoxCPM2" };

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

const words = (t) => t.split(/\s+/).filter(Boolean).length;
const { projects } = await call("/v1/projects");
const project = projects.find((p) => p.name === args.book);
if (!project) throw new Error(`no project called ${args.book}`);
const scenes = await call(`/v1/projects/${project.id}/scenes`);
const script = await call(`/v1/scenes/${scenes[0].id}/script`);
const narration = script.lines.filter((l) => !l.spoken).map((l) => l.text);
const passages = narration.filter((t) => words(t) >= 25).slice(0, 10);
const opening = [];
for (const t of narration) {
  if (opening.reduce((n, x) => n + words(x), 0) >= OPENING_WORDS) break;
  opening.push(t);
}
const { voices } = await call("/v1/voices");
const source = voices.find((v) => v.id === args.voice);
if (!source) throw new Error(`no voice ${args.voice}`);
const { engines: rows } = await call("/v1/engines/capabilities");
const rowFor = (engine, variant) => Object.keys(rows).find((id) => id === engine || variant.startsWith(`${id}-`));
async function voiceOn(engine, variant) {
  if (source.engine === engine) return source.id;
  const name = `${source.name} · narration (${LABEL[engine] ?? engine})`;
  const have = voices.find((v) => v.name === name);
  return (have ?? (await call(`/v1/voices/${source.id}/copy`, { method: "POST", body: { model: rowFor(engine, variant), name } }))).id;
}
const { generation } = await call("/v1/settings");

mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { voice: source.id, passages, takes: [] };
if (OPENING_WORDS) manifest.opening = opening;
const render = async (voice, text) => call("/v1/generate", { method: "POST", body: { voice, text, language: "en", seed: 7, cache: false }, raw: true });
for (const [engine, variant] of ENGINES) {
  const voice = await voiceOn(engine, variant);
  await call(`/v1/engines/${engine}/load`, { method: "POST", body: { model_variant: variant } });
  const dir = path.join(OUT, engine);
  mkdirSync(dir, { recursive: true });
  for (const [i, text] of passages.entries()) {
    const wav = path.join(dir, `${i + 1}.wav`);
    if (existsSync(wav)) continue;
    const t0 = Date.now();
    writeFileSync(wav, await render(voice, text));
    manifest.takes.push({ engine, voice, i: i + 1, render_s: (Date.now() - t0) / 1000, chars: text.length });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(engine, i + 1, ((Date.now() - t0) / 1000).toFixed(1), "s");
  }
  const openingWav = path.join(dir, "opening.wav");
  if (OPENING_WORDS && !existsSync(openingWav)) {
    const t0 = Date.now();
    const lines = [];
    for (const text of opening) {
      const wav = await render(voice, text);
      const [fmt, offset, size] = parseWavHeader(wav);
      lines.push(new RenderedLine({ pcm: wav.subarray(offset, offset + size), sampleRate: fmt.sampleRate, channels: fmt.channels, effectiveDelivery: {} }));
    }
    const joined = await concatLines(lines, generation.pause_between_lines_ms);
    writeFileSync(openingWav, writeWavContainer(joined.pcm, joined.sampleRate, joined.channels));
    manifest.takes.push({ engine, voice, i: "opening", render_s: (Date.now() - t0) / 1000, chars: opening.join(" ").length });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(engine, "opening", ((Date.now() - t0) / 1000).toFixed(1), "s");
  }
}
console.log("done");
