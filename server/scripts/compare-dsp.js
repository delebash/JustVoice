// SPDX-License-Identifier: MIT
// audio/dsp_client's parity check (wave B of step 5): the same operations, on the same input
// files, through Python's dsp_client and this port, against the same audiocpp_dsp — the dev
// build `npm run dev` builds (../audio.cpp/build/jv-dev/bin; JUSTVOICE_DSP_EXE overrides).
// Every byte result must be identical, every number equal: a line's gain, pace and pitch,
// effects chains (whole-number floats and ints both), joins, a streamed audition's seams,
// fits (trim, resample, channels), the aligner's input, the analyzer, Kokoro vector math.
//
//   node scripts/node24.js server/scripts/compare-dsp.js      (JV_PYTHON overrides)

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const REPO = resolve(SERVER, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const DSP = process.env.JUSTVOICE_DSP_EXE || resolve(REPO, "..", "audio.cpp", "build", "jv-dev", "bin", process.platform === "win32" ? "audiocpp_dsp.exe" : "audiocpp_dsp");

const dir = mkdtempSync(join(tmpdir(), "jv-compare-dsp-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");
process.env.JUSTVOICE_DATA_DIR = join(dir, "data");
process.env.JUSTVOICE_DSP_EXE = DSP;
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;

const { pyJsonParse } = await import("../src/models.js");
const { writeWavContainer } = await import("../src/audio/wav.js");
const dsp = await import("../src/audio/dsp_client.js");
const { analyze, compare, noiseMarginDb } = await import("../src/audio/analyzer.js");

// ── inputs: deterministic signals ───────────────────────────────────────────────
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 2 ** 32;
};
function tone(rate, seconds, channels, { freq = 220, amp = 0.3, noise = 0.01, lead = 0, tail = 0 } = {}) {
  const n = Math.floor(rate * seconds);
  const lz = Math.floor(rate * lead);
  const tz = Math.floor(rate * tail);
  const total = lz + n + tz;
  const b = Buffer.alloc(total * channels * 2);
  for (let i = 0; i < total; i++) {
    const on = i >= lz && i < lz + n;
    for (let c = 0; c < channels; c++) {
      const v = on ? amp * Math.sin((2 * Math.PI * freq * (c + 1) * i) / rate) + noise * (rand() * 2 - 1) : 0;
      b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), (i * channels + c) * 2);
    }
  }
  return b;
}
function vector(rows) {
  const b = Buffer.alloc(rows * 256 * 4);
  for (let i = 0; i < rows * 256; i++) b.writeFloatLE(rand() * 2 - 1, i * 4);
  return b;
}
const IN = join(dir, "in");
mkdirSync(IN, { recursive: true });
const inputs = {
  "p24.pcm": tone(24000, 1.5, 1),
  "p44s.pcm": tone(44100, 1.0, 2, { freq: 330 }),
  "p24pad.pcm": tone(24000, 1.0, 1, { lead: 0.265, tail: 0.715, noise: 0 }),
  "p24pad2.pcm": tone(24000, 0.6, 1, { lead: 0.265, tail: 0.715, noise: 0, freq: 180 }),
  "p24short.pcm": tone(24000, 0.5, 1, { tail: 0.06, noise: 0 }),
  "p24short2.pcm": tone(24000, 0.5, 1, { lead: 0.04, noise: 0, freq: 300 }),
  "v1.f32": vector(3),
  "v2.f32": vector(3),
  "v3.f32": vector(3),
};
inputs["w24.wav"] = writeWavContainer(inputs["p24.pcm"], 24000, 1);
inputs["w44s.wav"] = writeWavContainer(inputs["p44s.pcm"], 44100, 2);
inputs["w24b.wav"] = writeWavContainer(tone(24000, 1.5, 1, { freq: 230 }), 24000, 1);
inputs["wsil.wav"] = writeWavContainer(Buffer.alloc(24000 * 2), 24000, 1);
for (const k of ["p24pad", "p24pad2", "p24short", "p24short2"]) inputs[`${k}.wav`] = writeWavContainer(inputs[`${k}.pcm`], 24000, 1);
for (const [k, v] of Object.entries(inputs)) writeFileSync(join(IN, k), v);

// ── the operations (floats written as Python reads them: "1.0" is a float) ─────────
const SPEC_TEXT = `[
 {"op": "shape", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1, "gain_db": -6.0}},
 {"op": "shape", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1, "stretch_factor": 1.25}},
 {"op": "shape", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1, "stretch_factor": 0.8, "gain_db": 2.5}},
 {"op": "shape", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1, "pitch_semitones": 2.0}},
 {"op": "shape", "args": {"pcm": "p44s.pcm", "rate": 44100, "channels": 2, "effects": [{"type": "reverb", "params": {"room_size": 0.6, "wet_level": 0.3}}, {"type": "gain", "params": {"gain_db": 3}}]}},
 {"op": "shape", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1}},
 {"op": "apply_effects", "args": {"wav": "w24.wav", "chain": [{"type": "eq_low", "params": {"cutoff_frequency_hz": 200.0, "gain_db": 4.0, "q": 0.7}}, {"type": "eq_mid", "params": {"cutoff_frequency_hz": 1000.0, "gain_db": -3.0, "q": 1.0}}, {"type": "eq_high", "params": {"cutoff_frequency_hz": 6000.0, "gain_db": 2.0, "q": 0.7}}, {"type": "compressor", "params": {"threshold_db": -18.0, "ratio": 3.0, "attack_ms": 5.0, "release_ms": 80.0}}]}},
 {"op": "apply_effects", "args": {"wav": "w24.wav", "chain": [{"type": "chorus", "params": {"rate_hz": 1.0, "depth": 0.25, "centre_delay_ms": 7.0, "feedback": 0.0, "mix": 0.5}}, {"type": "delay", "params": {"delay_seconds": 0.25, "feedback": 0.4, "mix": 0.5}}, {"type": "distortion", "params": {"drive_db": 12.0}}, {"type": "highpass", "params": {"cutoff_frequency_hz": 120.0}}, {"type": "lowpass", "params": {"cutoff_frequency_hz": 5000}}]}},
 {"op": "apply_effects", "args": {"wav": "w44s.wav", "chain": [{"type": "gain", "params": {"gain_db": 12.0}, "enabled": false}, {"type": "gain", "params": {"gain_db": "loud"}}, {"type": "flux_capacitor", "params": {}}, {"type": "pitch_shift", "params": {"semitones": -3.0}}]}},
 {"op": "apply_effects", "args": {"wav": "w24.wav", "chain": []}},
 {"op": "join", "args": {"pieces": [["p24pad.pcm", 24000, 1], ["p24pad2.pcm", 24000, 1], ["p24pad.pcm", 24000, 1]], "crossfade_ms": 50}},
 {"op": "join", "args": {"pieces": [["p24short.pcm", 24000, 1], ["p24short2.pcm", 24000, 1]], "crossfade_ms": 50}},
 {"op": "join", "args": {"pieces": [["p24.pcm", 24000, 1], ["p24.pcm", 24000, 1]], "crossfade_ms": 20}},
 {"op": "stream_join", "args": {"pieces": ["p24pad.wav", "p24pad2.wav", "p24pad.wav"], "crossfade_ms": 50}},
 {"op": "fit", "args": {"pcm": "p24pad.pcm", "rate": 24000, "channels": 1, "to_rate": 44100, "to_channels": 2, "trim_below_dbfs": -50.0, "trim_keep_ms": 100}},
 {"op": "fit", "args": {"pcm": "p44s.pcm", "rate": 44100, "channels": 2, "to_rate": 24000, "to_channels": 1, "trim_keep_ms": 0}},
 {"op": "fit", "args": {"pcm": "p24.pcm", "rate": 24000, "channels": 1, "to_rate": 24000, "to_channels": 1, "trim_keep_ms": 0}},
 {"op": "aligner_input", "args": {"wav": "w44s.wav", "rate": 16000}},
 {"op": "aligner_input", "args": {"wav": "w24.wav", "rate": 16000}},
 {"op": "loudness", "args": {"wav": "w24.wav"}},
 {"op": "loudness", "args": {"wav": "wsil.wav"}},
 {"op": "sample_diff", "args": {"a": "w24.wav", "b": "w24b.wav"}},
 {"op": "noise_margin", "args": {"wav": "w24.wav"}},
 {"op": "noise_margin_db", "args": {"pcm": "p24pad.pcm", "rate": 24000, "channels": 1}},
 {"op": "vectors_mean", "args": {"vectors": ["v1.f32", "v2.f32", "v3.f32"]}},
 {"op": "vectors_blend", "args": {"vectors": ["v1.f32", "v2.f32"], "weights": [0.3, 0.7], "normalize": true}},
 {"op": "vectors_blend", "args": {"vectors": ["v1.f32", "v2.f32", "v3.f32"], "weights": [2, 1, -1], "normalize": false}},
 {"op": "vectors_recombine", "args": {"vectors": ["v1.f32", "v2.f32"], "segments": [[0, 0.0, 0.5], [1, 0.5, 1.0]], "features": 256}},
 {"op": "f32_roundtrip", "args": {"vector": "v3.f32"}},
 {"op": "analyze", "args": {"wav": "w44s.wav"}},
 {"op": "compare", "args": {"a": "w24.wav", "b": "w24b.wav"}}
]`;
writeFileSync(join(dir, "spec.json"), SPEC_TEXT);
const spec = pyJsonParse(SPEC_TEXT);

const procs = await import("@delebash/llm-runner/platform/procs");
const r = await procs.run([PY, join(HERE, "compare-dsp.py"), dir], {
  cwd: SERVER,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  timeout: 600,
});
if (r.returncode !== 0) throw new Error(`compare-dsp.py failed:\n${r.stderr}`);

// ── the JS side ─────────────────────────────────────────────────────────────────
const OUT = join(dir, "js");
mkdirSync(OUT, { recursive: true });
const inp = (n) => readFileSync(join(IN, n));
const num = (v) => (v == null ? v : Number(v));
const noInf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === Number.NEGATIVE_INFINITY ? null : v]));
for (const [i, op] of spec.entries()) {
  const a = op.args;
  let res;
  switch (op.op) {
    case "shape":
      res = await dsp.shape(inp(a.pcm), a.rate, a.channels, {
        stretchFactor: a.stretch_factor ?? null,
        gainDb: a.gain_db ?? 0.0,
        pitchSemitones: a.pitch_semitones ?? 0.0,
        effects: a.effects ?? null,
      });
      break;
    case "apply_effects":
      res = await dsp.applyEffects(inp(a.wav), a.chain);
      break;
    case "join":
      res = await dsp.join(a.pieces.map(([p, rt, c]) => [inp(p), rt, c]), a.crossfade_ms);
      break;
    case "stream_join": {
      const outs = [];
      let tail = null;
      for (const [k, name] of a.pieces.entries()) {
        let piece;
        [piece, tail] = await dsp.streamJoin(inp(name), tail, { last: k === a.pieces.length - 1, crossfadeMs: a.crossfade_ms });
        outs.push(piece);
        if (tail !== null) outs.push(tail);
      }
      res = Buffer.concat(outs);
      break;
    }
    case "fit":
      res = await dsp.fit(inp(a.pcm), a.rate, a.channels, a.to_rate, a.to_channels, {
        trimBelowDbfs: num(a.trim_below_dbfs) ?? null,
        trimKeepMs: a.trim_keep_ms,
      });
      break;
    case "aligner_input":
      res = await dsp.alignerInput(inp(a.wav), a.rate);
      break;
    case "loudness":
      res = noInf(await dsp.loudness(inp(a.wav)));
      break;
    case "sample_diff":
      res = await dsp.sampleDiff(inp(a.a), inp(a.b));
      break;
    case "noise_margin":
      res = await dsp.noiseMargin(inp(a.wav));
      break;
    case "noise_margin_db":
      res = await noiseMarginDb(inp(a.pcm), a.rate, a.channels);
      break;
    case "vectors_mean":
      res = await dsp.vectorsMean(a.vectors.map(inp));
      break;
    case "vectors_blend":
      res = await dsp.vectorsBlend(a.vectors.map(inp), a.weights.map(Number), a.normalize);
      break;
    case "vectors_recombine":
      res = await dsp.vectorsRecombine(a.vectors.map(inp), a.segments.map(([i2, x, y]) => [i2, Number(x), Number(y)]), a.features);
      break;
    case "f32_roundtrip":
      res = dsp.f32Bytes(dsp.f32List(inp(a.vector)));
      break;
    case "analyze":
      res = await analyze(inp(a.wav));
      res.loudness = noInf(res.loudness);
      break;
    case "compare":
      res = await compare(inp(a.a), inp(a.b));
      for (const side of ["a", "b"]) res[side].loudness = noInf(res[side].loudness);
      break;
    default:
      throw new Error(`unknown op ${op.op}`);
  }
  if (Buffer.isBuffer(res) || res instanceof Uint8Array) writeFileSync(join(OUT, `${i}.bin`), res);
  else writeFileSync(join(OUT, `${i}.json`), JSON.stringify(res));
}
await dsp.stop();

// ── compare ─────────────────────────────────────────────────────────────────────
const pyFiles = readdirSync(join(dir, "py")).sort();
const jsFiles = readdirSync(OUT).sort();
let bad = 0;
let bytes = 0;
if (pyFiles.join() !== jsFiles.join()) {
  console.log(`  DIFF result files: python ${pyFiles} | js ${jsFiles}`);
  bad += 1;
}
for (const f of pyFiles) {
  const i = Number.parseInt(f, 10);
  const pa = readFileSync(join(dir, "py", f));
  let jb;
  try {
    jb = readFileSync(join(OUT, f));
  } catch {
    continue;
  }
  const label = `${i} ${spec[i].op}`;
  if (f.endsWith(".bin")) {
    bytes += pa.length;
    if (!pa.equals(jb)) {
      bad += 1;
      console.log(`  DIFF ${label}: ${pa.length} vs ${jb.length} bytes`);
    } else console.log(`  same ${label}: ${pa.length} bytes`);
  } else {
    const x = JSON.parse(pa.toString("utf8"));
    const y = JSON.parse(jb.toString("utf8"));
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      bad += 1;
      console.log(`  DIFF ${label}: python ${JSON.stringify(x)} | js ${JSON.stringify(y)}`);
    } else console.log(`  same ${label}: ${JSON.stringify(x).slice(0, 100)}`);
  }
}
console.log(`${pyFiles.length} operations, ${bytes} bytes of audio/vectors compared — ${bad ? `${bad} difference(s)` : "0 differences"} (${dir}; ${DSP})`);
process.exit(bad ? 1 : 0);
