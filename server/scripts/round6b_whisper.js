// SPDX-License-Identifier: MIT
// Round 6b's whisper test (TASKS "Round 6b", step 4): VoxCPM2 whispers in a whispered voice at
// speaking volume (RESEARCH §10.29), so its whispered takes are turned down with the line's own
// gain (`delivery.gain_db` → dsp `shape`) and heard where a book plays them — between the
// chapter's neighbouring lines, joined with the app's pauses (`render_core.concatLines`) and
// mastered with the app's ACX preset (`mastering.masterToWav`). Each stretch at 0, −6 and −12 dB;
// the whisper's level against its neighbours is measured before and after mastering with the
// app's analyzer (dsp `analyze`'s RMS, what the app's ACX check reads).
//
//     node server/scripts/round6b_whisper.js            # the app on 127.0.0.1:17494
//     node server/scripts/round6b_whisper.js --narrator <voice id> --gains=-12,-18 --out data/round7/whisper
//
// The neighbours are read in the narrator's voice (`--narrator`; by default round 5's, which was
// Alice's child voice, RESEARCH §10.31), seed 7; the whispers are round 5's page takes (the scorers'
// pick of three). Writes `<out>/<line>-<gain>dB.wav` (mastered) and `results.json`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import * as dsp from "../src/audio/dsp_client.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { segmentParagraphs, splitIntoParagraphs } from "../src/extraction/segmentation.js";
import { runAdapter } from "../src/imports/index.js";
import { masterToWav } from "../src/mastering.js";
import { concatLines, RenderedLine, TRIM_BELOW_DBFS, TRIM_KEEP_MS } from "../src/render_core.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SERVER = "http://127.0.0.1:17494";
const { values: args } = parseArgs({
  options: {
    out: { type: "string", default: path.join("data", "round6b", "whisper") },
    // Round 6b's: "Alice", VoxCPM2 — a child's voice, not a narrator's (RESEARCH §10.31).
    narrator: { type: "string", default: "voice_57b65ae89e7c419988809f0bba684851" },
    gains: { type: "string", default: "0,-6,-12" },
  },
});
const OUT = path.resolve(ROOT, args.out);
const NARRATOR = args.narrator;
const GAINS = args.gains.split(",").map(Number);
// Chapter VIII's whispered lines: the take, and the segments around it (offsets from the line).
const STRETCHES = [
  { line: "8-48", d: 48, take: "data/round5/voxcpm2-r5/8-48-told-8.wav", around: [-1, 1, 2] },
  { line: "8-67", d: 67, take: "data/round5/voxcpm2-r5/8-67-told-8.wav", around: [-1, 1, 2, 3] },
];

function chapterSegments() {
  const root = path.join(ROOT, "server", "samples", "alice-in-wonderland");
  const key = JSON.parse(readFileSync(path.join(root, "attribution-truth.json"), "utf8"));
  const book = runAdapter(key.adapter, readFileSync(path.join(root, key.book)), { filename: key.book });
  const scene = book.scenes.find((s) => s.title === Object.keys(key.cues)[1]);
  const text = scene.lines.filter((l) => l.text).map((l) => l.text).join("\n\n");
  let d = -1;
  return segmentParagraphs(splitIntoParagraphs(text)).map((s) => ({ ...s, d: s.kind === "dialogue" ? ++d : null }));
}

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

const pcmOf = (wav) => {
  const [fmt, offset, size] = parseWavHeader(wav);
  return { pcm: wav.subarray(offset, offset + size), sampleRate: fmt.sampleRate, channels: fmt.channels };
};
const rms = async (pcm, sampleRate, channels) => {
  const got = await dsp.loudness(writeWavContainer(pcm, sampleRate, channels));
  return Math.round(got.rms_dbfs * 10) / 10;
};
// A part of a WAV's PCM by seconds.
const slice = (a, from, to) => {
  const frame = a.channels * 2;
  return a.pcm.subarray(Math.floor(from * a.sampleRate) * frame, Math.floor(to * a.sampleRate) * frame);
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const settings = await call("/v1/settings");
  const { pause_between_lines_ms: between, pause_within_paragraph_ms: within } = settings.generation;
  const segs = chapterSegments();
  const results = [];
  for (const st of STRETCHES) {
    const at = segs.findIndex((s) => s.d === st.d);
    const order = [...st.around.filter((o) => o < 0), 0, ...st.around.filter((o) => o > 0)].map((o) => at + o);
    const parts = [];
    for (const i of order) {
      const s = segs[i];
      let audio;
      if (i === at) audio = pcmOf(readFileSync(path.join(ROOT, st.take)));
      else {
        const file = path.join(OUT, `${st.line}-around-${i}.wav`);
        if (!existsSync(file)) writeFileSync(file, await call("/v1/generate", { method: "POST", body: { voice: NARRATOR, text: s.text, language: "en", seed: 7, cache: false }, raw: true }));
        audio = pcmOf(readFileSync(file));
      }
      parts.push({ i, text: s.text, paragraph: s.paragraph_idx, whisper: i === at, ...audio });
    }
    // The app's pause after each part: within a paragraph, or between lines.
    const pauses = parts.map((p, k) => (k + 1 < parts.length && parts[k + 1].paragraph === p.paragraph ? within : between));
    for (const gain of GAINS) {
      const lines = [];
      const spans = [];
      let t = 0;
      for (const [k, p] of parts.entries()) {
        const pcm = p.whisper && gain ? await dsp.shape(p.pcm, p.sampleRate, p.channels, { gainDb: gain }) : p.pcm;
        lines.push(new RenderedLine({ pcm, sampleRate: p.sampleRate, channels: p.channels, effectiveDelivery: { pause_after: pauses[k] } }));
        // Where this part lands in the join: its trimmed length at the join's rate.
        const sr = Math.max(...parts.map((x) => x.sampleRate));
        const ch = Math.max(...parts.map((x) => x.channels));
        const fitted = await dsp.fit(pcm, p.sampleRate, p.channels, sr, ch, { trimBelowDbfs: TRIM_BELOW_DBFS, trimKeepMs: TRIM_KEEP_MS });
        const len = fitted.length / (2 * ch) / sr;
        spans.push({ whisper: p.whisper, from: t, to: t + len, pcm: fitted, sr, ch });
        t += len + pauses[k] / 1000;
      }
      const joined = await concatLines(lines, between);
      const mastered = await masterToWav(joined.pcm, joined.sampleRate, joined.channels, { presetName: "acx", presets: settings.mastering });
      const file = path.join(OUT, `${st.line}-${gain}dB.wav`);
      writeFileSync(file, mastered);
      const m = pcmOf(mastered);
      const head = settings.mastering.acx.head_silence_secs;
      const row = { line: st.line, gain_db: gain, file: path.relative(ROOT, file), before: {}, after: {} };
      const neighbours = spans.filter((s) => !s.whisper);
      const w = spans.find((s) => s.whisper);
      row.before.whisper = await rms(w.pcm, w.sr, w.ch);
      row.before.neighbours = await rms(Buffer.concat(neighbours.map((s) => s.pcm)), w.sr, w.ch);
      row.after.whisper = await rms(slice(m, head + w.from, head + w.to), m.sampleRate, m.channels);
      row.after.neighbours = await rms(Buffer.concat(neighbours.map((s) => slice(m, head + s.from, head + s.to))), m.sampleRate, m.channels);
      row.before.gap = Math.round((row.before.whisper - row.before.neighbours) * 10) / 10;
      row.after.gap = Math.round((row.after.whisper - row.after.neighbours) * 10) / 10;
      results.push(row);
      console.log(`${st.line} ${gain} dB: whisper − neighbours ${row.before.gap} dB RMS before mastering, ${row.after.gap} dB after`);
    }
    results.push({ line: st.line, parts: parts.map((p) => ({ i: p.i, whisper: p.whisper, text: p.text })) });
  }
  writeFileSync(path.join(OUT, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
}

// The dsp client keeps its helper process open, so the script ends itself.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
