// SPDX-License-Identifier: MIT
// audiocpp_dsp — the server's audio math, in the DSP program built from our audio.cpp fork
// (the port of justvoice/audio/dsp_client.py).
//
// Every piece of sample math this server did in numpy, scipy and python-stretch — the effects
// chain, a line's pace, gain and pitch, the joins between a line's pieces, a line's silence
// trim and its fit to a chapter's rate, the analyzer, Kokoro blends — is a request to
// `audiocpp_dsp` (the move off Python, docs/plans/2026-10-07-electron-node-plan.md §3;
// decided 2026-10-07: a separate program "shipped with the app instead of downloaded", with no
// models and no GPU, so it works with nothing installed — cloud voices included). The C++ was
// proven against the Python it replaced, output for output (the fork's `dsp/tests/parity/`).
//
// It starts on first use through the kit's spawn door — a kill-on-close Job Object on
// Windows, so it dies with this server however this server dies; elsewhere
// `JUSTVOICE_SERVER_PID` lets the leftover sweep find it — on a free loopback port, logs to
// `<data>/logs/audiocpp-dsp.log`, and is started again if it died. Where it is, first found
// wins:
//   1. `JUSTVOICE_DSP_EXE` — an explicit path;
//   2. the development build `npm run dev` names (`JUSTVOICE_AUDIOCPP_BUILD`, its bin folder);
//   3. beside a packaged server's executable;
//   4. a source checkout's `../audio.cpp/build/jv-dev/bin` — what `npm run dev` builds.
//
// Every operation is async (an HTTP request). The request's `params` part is Python's
// `json.dumps(params)` text, floats where Python had floats.

import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { Mutex, sleep } from "@delebash/llm-runner/platform/asyncutil";
import { runtime as dataRuntime } from "@delebash/llm-runner/platform/data_paths";
import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as process_ from "@delebash/llm-runner/runner/process";
import * as appState from "../app_state.js";
import * as devBuild from "../engines/audiocpp/dev_build.js";
import * as runtime from "../engines/audiocpp/runtime.js";
import * as paths from "../paths.js";
import * as chunked from "./chunked.js";
import * as self from "./dsp_client.js";
import { asBuf, stripWavHeader, writeWavContainer } from "./wav.js";

const log = getLogger("justvoice.audio.dsp_client");

export const EXE_NAME = process.platform === "win32" ? "audiocpp_dsp.exe" : "audiocpp_dsp";
export const ENV_EXE = "JUSTVOICE_DSP_EXE";

/** The DSP program refused a request (`status` 400) or could not be reached (503). */
export class DspError extends RuntimeError {
  constructor(message, status = 503) {
    super(message);
    this.name = "DspError";
    this.status = status;
  }
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The `audiocpp_dsp` this server runs (the header's order). */
export function findExe() {
  const candidates = [];
  if (process.env[ENV_EXE]) candidates.push(path.normalize(process.env[ENV_EXE]));
  const dev = devBuild.current();
  if (dev !== null) candidates.push(path.join(dev.binDir, EXE_NAME));
  if (dataRuntime.frozen) candidates.push(path.join(path.dirname(dataRuntime.executable), EXE_NAME));
  candidates.push(path.resolve(paths.SOURCE_ROOT, "..", "audio.cpp", "build", "jv-dev", "bin", EXE_NAME));
  for (const c of candidates) if (isFile(c)) return c;
  throw new DspError(
    `${EXE_NAME} is not built — \`npm run dev\` builds it with the speech runtime from ` +
      `../audio.cpp (or set ${ENV_EXE}). Looked in: ${candidates.join("; ")}`,
  );
}

function logPath() {
  let root;
  try {
    root = appState.getState().dataDir;
  } catch {
    root = paths.defaultDataDir(); // no app state (a test, a script): the default data folder
  }
  const p = path.join(root, "logs", "audiocpp-dsp.log");
  mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

class Program {
  constructor() {
    this._lock = new Mutex();
    this._proc = null;
    this._job = null;
    this._port = 0;
  }

  async url() {
    return this._lock.run(async () => {
      if (this._proc === null || process_.pollProc(this._proc) !== null) await this._start();
      return `http://127.0.0.1:${this._port}`;
    });
  }

  async _start() {
    if (this._job !== null) {
      process_.closeJob(this._job);
      this._job = null;
    }
    const exe = self.findExe();
    this._port = await runtime._freePort();
    const lp = logPath();
    runtime._rotateLog(lp);
    const env = runtime._childEnv();
    const popen = (argv, opts) => procs.popen(argv, { ...opts, cwd: path.dirname(exe), env });
    [this._proc, this._job] = await process_.spawnChild(popen, [exe, "--port", String(this._port)], lp);
    const deadline = performance.now() / 1000 + runtime.startTimeout();
    while (performance.now() / 1000 < deadline) {
      const rc = process_.pollProc(this._proc);
      if (rc !== null) throw new DspError(`${EXE_NAME} exited with ${rc} on start (log: ${lp})`);
      try {
        const r = await http.fetch(`http://127.0.0.1:${this._port}/health`, { timeoutMs: 2000 });
        await r.arrayBuffer().catch(() => {});
        if (r.status === 200) {
          log.info(`${EXE_NAME} up on :${this._port} (pid ${this._proc.pid}, ${exe})`);
          return;
        }
      } catch {
        /* not up yet */
      }
      await sleep(50);
    }
    await this.stopLocked();
    throw new DspError(`${EXE_NAME} did not answer within ${runtime.startTimeout().toFixed(0)} s (log: ${lp})`);
  }

  async stopLocked() {
    const proc = this._proc;
    this._proc = null;
    if (proc !== null && process_.pollProc(proc) === null) {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      if ((await process_.waitExit(proc, 5)) === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
    if (this._job !== null) {
      process_.closeJob(this._job);
      this._job = null;
    }
  }

  async stop() {
    return this._lock.run(() => this.stopLocked());
  }

  /** Synchronous last resort for process exit (Python's atexit): kill without waiting. */
  killSync() {
    const proc = this._proc;
    if (proc !== null && process_.pollProc(proc) === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

const PROGRAM = new Program();
process.once("exit", () => PROGRAM.killSync());

/** Stop the program (the server's shutdown); the next request starts it again. */
export async function stop() {
  await PROGRAM.stop();
}

const hex6 = () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");

/** A response read whole: `{status, headers, content (Buffer), json()}`. */
async function readResponse(r) {
  const content = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status,
    headers: r.headers,
    content,
    text: () => content.toString("utf8"),
    json: () => JSON.parse(content.toString("utf8")),
  };
}

/**
 * One request; a dead or unreachable program is started again and the request sent once more
 * — it holds no state between requests.
 */
export async function _post(op, params, parts) {
  const paramsText = pyJson(params);
  for (const attempt of [1, 2]) {
    const form = http.multipart([
      { name: "params", filename: "params", contentType: "application/json", data: Buffer.from(paramsText, "utf8") },
      ...parts.map(([name, data]) => ({ name, filename: `${name}-${hex6()}`, contentType: "application/octet-stream", data })),
    ]);
    let r;
    try {
      const base = await PROGRAM.url();
      r = await readResponse(
        await http.fetch(`${base}/v1/dsp/${op}`, {
          method: "POST",
          body: form.body,
          headers: { "content-type": form.contentType },
          timeoutMs: runtime.requestTimeout() * 1000,
        }),
      );
    } catch (e) {
      if (e instanceof DspError) throw e;
      if (attempt === 2) throw new DspError(`${EXE_NAME} did not answer ${op}: ${e?.cause?.message ?? e?.message ?? e}`);
      await PROGRAM.stop();
      continue;
    }
    if (r.status === 200) return r;
    let message;
    try {
      message = r.json().error.message;
      if (message === undefined) throw new Error("no message");
    } catch {
      message = r.text().slice(0, 300);
    }
    throw new DspError(`${op}: ${message}`, r.status === 400 ? 400 : 503);
  }
  throw new Error("unreachable");
}

const wavOf = (pcm, sampleRate, channels) => writeWavContainer(pcm, sampleRate, channels);
const pcmOf = (wav) => Buffer.from(stripWavHeader(wav));
const f = (x) => (x == null ? x : pyFloatValue(x));

// ── a finished line ─────────────────────────────────────────────────────────

/** 16-bit PCM through pace (`stretchFactor`, 2.0 = twice as fast), gain, pitch, then the
 * effects chain — each step only when given, in that order (render_core.shape_line_pcm). */
export async function shape(pcm, sampleRate, channels, { stretchFactor = null, gainDb = 0.0, pitchSemitones = 0.0, effects = null } = {}) {
  if (!(stretchFactor || gainDb || pitchSemitones || (effects && effects.length))) return pcm;
  const params = { stretch_factor: f(stretchFactor), gain_db: f(gainDb), pitch_semitones: f(pitchSemitones), effects: effects || [] };
  return pcmOf((await self._post("shape", params, [["audio", wavOf(pcm, sampleRate, channels)]])).content);
}

/** A WAV (16- or 32-bit PCM) through an effects chain; a 16-bit WAV back. A chain with no
 * usable entry returns the input as it is. */
export async function applyEffects(wav, chain) {
  if (!chain || !chain.length) return wav;
  return (await self._post("shape", { effects: chain }, [["audio", wav]])).content;
}

// ── joins ───────────────────────────────────────────────────────────────────

function joinRule(crossfadeMs) {
  return {
    crossfade_ms: Math.trunc(crossfadeMs),
    pause_ms: chunked.PIECE_JOIN_PAUSE_MS,
    silence_dbfs: pyFloatValue(chunked.PIECE_JOIN_SILENCE_DBFS),
    window_ms: chunked.WINDOW_MS,
  };
}

/** A line's pieces — `[pcm, rate, channels]` each — as one 16-bit PCM, every seam by
 * chunked.PIECE_JOIN_* (the quiet on both sides cut to the piece pause, or a short crossfade). */
export async function join(pieces, crossfadeMs) {
  if (!pieces.length) return Buffer.alloc(0);
  const parts = pieces.map(([pcm, sr, ch]) => ["audio", wavOf(pcm, sr, ch)]);
  return pcmOf((await self._post("join", joinRule(crossfadeMs), parts)).content);
}

/** One piece of a streamed audition: joined onto the `tail` held from the piece before, then
 * split into the 16-bit PCM that goes out now and the tail held for the next seam (opaque
 * float32 bytes; null after the last piece). Returns `[out, tail]`. */
export async function streamJoin(pieceWav, tail, { last, crossfadeMs }) {
  const parts = [["audio", pieceWav], ...(tail && tail.length ? [["tail", tail]] : [])];
  const r = await self._post("stream-join", { ...joinRule(crossfadeMs), last: Boolean(last) }, parts);
  const k = Number.parseInt(r.headers.get("x-out-bytes"), 10);
  return [r.content.subarray(0, k), last ? null : r.content.subarray(k)];
}

// ── a line in a chapter ─────────────────────────────────────────────────────

/** 16-bit PCM with its silent start and end trimmed (when `trimBelowDbfs` is given), then
 * brought to (`toRate`, `toChannels`) — render_core.concat_lines' per-line step. */
export async function fit(pcm, sampleRate, channels, toRate, toChannels, { trimBelowDbfs, trimKeepMs }) {
  if (trimBelowDbfs == null && sampleRate === toRate && channels === toChannels) return pcm;
  const trim = trimBelowDbfs == null ? null : { below_dbfs: f(trimBelowDbfs), keep_ms: trimKeepMs };
  const params = { trim, to_sample_rate: toRate, to_channels: toChannels };
  return pcmOf((await self._post("fit", params, [["audio", wavOf(pcm, sampleRate, channels)]])).content);
}

/** The forced aligner's input (engines/audiocpp/slot.asAudio16kMono): channels averaged,
 * resampled to `sampleRate`, rounded half to even — a WAV back. */
export async function alignerInput(wav, sampleRate) {
  return (await self._post("aligner-input", { sample_rate: Math.trunc(sampleRate) }, [["audio", wav]])).content;
}

// ── the analyzer ────────────────────────────────────────────────────────────

/** peak_dbfs, rms_dbfs (-Infinity for silence), crest_factor_db, silence_ratio, clipping_ratio. */
export async function loudness(wav) {
  const got = (await self._post("analyze", {}, [["audio", wav]])).json();
  return Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v === null ? Number.NEGATIVE_INFINITY : v]));
}

/** sample_rmse, max_sample_delta, pct_identical_samples over the shorter (null for none). */
export async function sampleDiff(wavA, wavB) {
  return (await self._post("compare", {}, [["a", wavA], ["b", wavB]])).json();
}

export async function noiseMargin(wav) {
  return (await self._post("noise-margin", {}, [["audio", wav]])).json().noise_margin_db;
}

// ── Kokoro blends ───────────────────────────────────────────────────────────

/** A list of floats (a stored blend) as little-endian float32 bytes. */
export function f32Bytes(values) {
  const arr = Array.from(values, Number);
  const out = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) out.writeFloatLE(arr[i], i * 4);
  return out;
}

export function f32List(raw) {
  raw = asBuf(raw);
  const out = new Array(Math.floor(raw.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = raw.readFloatLE(i * 4);
  return out;
}

export async function vectorsMean(vectors) {
  return (await self._post("vectors/mean", {}, vectors.map((v) => ["vector", v]))).content;
}

export async function vectorsBlend(vectors, weights, normalize) {
  const params = { weights: weights.map((w) => pyFloatValue(w)), normalize: Boolean(normalize) };
  return (await self._post("vectors/blend", params, vectors.map((v) => ["vector", v]))).content;
}

export async function vectorsRecombine(vectors, segments, features) {
  const params = { segments: segments.map(([i, a, b]) => [i, pyFloatValue(a), pyFloatValue(b)]), features: Math.trunc(features) };
  return (await self._post("vectors/recombine", params, vectors.map((v) => ["vector", v]))).content;
}

