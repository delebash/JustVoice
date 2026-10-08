// SPDX-License-Identifier: MIT
// Mastering — ffmpeg for the ACX / INaudio / podcast / YouTube presets (the port of
// justvoice/mastering.py).
//
// The orchestration writes the raw WAV to a temp file, builds the right ffmpeg filtergraph for
// the preset, and reads the result. Requires ffmpeg on PATH. ffmpeg starts through the kit's
// procs door only (no console to inherit — RESEARCH §3: without CREATE_NO_WINDOW, under a dead
// console, every chapter's mastering failed with 0xC0000142).
//
// Two doors onto the same filtergraph:
//
// - `master()` returns the preset's DELIVERABLE encoding (every preset encodes MP3 today).
//   This is what an export ships.
// - `masterToWav()` runs the identical processing and returns WAV. This is what a chapter
//   render and the ACX QC measurement use: the loudness work is the part that decides whether a
//   book passes, and doing it in WAV keeps the M4B assembly to ONE lossy generation.
//
// `resolveMasterTarget()` is the single place that decides WHICH preset a render uses. Before
// 2026-08-15 nothing decided: `/v1/render_chapter` only mastered when a caller named a preset,
// Studio never named one, and the Render tab's pill claimed ACX was "applied on render" while
// the bytes were raw TTS output.

import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import { pyInt, RuntimeError, ValueError } from "@delebash/llm-runner/platform/py";
import { pyFloat } from "@delebash/llm-runner/platform/pyjson";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import { writeWavContainer } from "./audio/wav.js";
import * as self from "./mastering.js";

export const log = getLogger("justvoice.mastering");

// The presets `settings.mastering` actually carries.
export const MASTER_PRESET_NAMES = ["acx", "inaudio", "podcast", "youtube"];

// What a project of each kind masters to when nothing more specific is set. Game voicelines
// and custom projects stay RAW on purpose: a game engine wants the unprocessed line to run its
// own bus through, and "custom" means the user has not told us what this is for.
export const KIND_MASTER_DEFAULTS = {
  audiobook: "acx",
  podcast: "podcast",
  game_voicelines: null,
  custom: null,
};

const kindDefault = (projectType) => (Object.hasOwn(KIND_MASTER_DEFAULTS, projectType || "") ? KIND_MASTER_DEFAULTS[projectType] : null);

/** The mastering target a NEW project is created with — its kind's default, written into the
 * project so the setting shows the real target (2026-09-29: the "This kind's default" option
 * died as a duplicate of the target it named). "none" = raw. */
export function kindMaster(projectType) {
  return kindDefault(projectType) || "none";
}

/**
 * Which mastering preset applies, and where the answer came from → `[presetOrNull, source]`.
 * Precedence, most specific first: the request → the project's `mastering_preset` → the
 * project kind's default. `"none"` at any level is a real answer meaning "ship it raw", and
 * stops the search. `source` is one of request / project / kind.
 */
export function resolveMasterTarget({ requested = null, projectMaster = null, projectType = null } = {}) {
  for (const [value, source] of [
    [requested, "request"],
    [projectMaster, "project"],
  ]) {
    if (!value) continue;
    if (value === "none") return [null, source];
    if (MASTER_PRESET_NAMES.includes(value)) return [value, source];
    // "custom" (a real Project.mastering_preset value) and anything else we have no
    // filtergraph for. Raw is the honest outcome — inventing ACX numbers for it would be worse
    // than doing nothing.
    log.warning(`mastering: ${source} names target '${value}', which is not a known preset — rendering raw`);
    return [null, source];
  }
  return [kindDefault(projectType), "kind"];
}

export function haveFfmpeg() {
  return hardware.which("ffmpeg") !== null;
}

/** Apply a mastering preset and return the encoded audio bytes (async). */
export async function master(pcm, sampleRate, channels, { presetName, presets, title = null, author = null, book = null }) {
  return _runMaster(pcm, sampleRate, channels, { presetName, presets, outFormat: null, title, author, book });
}

/** The same preset's processing, WAV out — no codec generation (async). Used by chapter
 * renders (you are auditioning, not shipping) and by ACX QC (the numbers have to describe
 * processed audio, and `analyze()` reads WAV). Metadata tags are deliberately absent: a WAV
 * monitor is not the deliverable that carries a title. */
export async function masterToWav(pcm, sampleRate, channels, { presetName, presets }) {
  return _runMaster(pcm, sampleRate, channels, { presetName, presets, outFormat: "wav" });
}

/** `str(x)` of a float field — Python prints -20.0, not -20. */
const f = (x) => pyFloat(Number(x));

/** `tempfile.NamedTemporaryFile(suffix=…, delete=False)`: a new empty file in the temp folder,
 * its path. */
function namedTemp(suffix) {
  for (;;) {
    const p = path.join(tmpdir(), `tmp${randomBytes(6).toString("hex")}${suffix}`);
    try {
      writeFileSync(p, Buffer.alloc(0), { flag: "wx" });
      return p;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
  }
}

/** The ffmpeg command for a preset — `[argv, format]` — from the two temp paths. Exported for
 * the parity check (scripts/compare-render.*). */
export function _masterCommand(channels, { presetName, presets, outFormat = null, title = null, author = null, book = null, inPath, outPath }) {
  const preset = Object.hasOwn({ acx: 1, inaudio: 1, podcast: 1, youtube: 1 }, presetName) ? presets[presetName] : null;
  if (preset == null) throw new ValueError(`Unknown mastering preset: ${presetName}`);
  // The deliverable encoding is the preset's; callers who want the processing without a codec
  // generation pass outFormat "wav".
  const fmt = outFormat || preset.format;

  // ffmpeg filter chain. `loudnorm` runs LAST of the level stages, so the preset's loudness and
  // true-peak ceiling are what the file ends at. Until 2026-09-29 `dynaudnorm` ran after it and
  // renormalised toward a 0.95 peak: an "acx" chapter came out at -16.8 LUFS with its peak at
  // -0.5 dBFS and failed the app's own ACX QC. In this order the same audio measures
  // -19.9 LUFS / -3.5 dBTP.
  const afChain = [
    "highpass=f=80",
    "dynaudnorm=g=15:p=0.95",
    `loudnorm=I=${f(preset.loudness_target_lufs)}:TP=${f(preset.true_peak_dbfs)}:LRA=${f(preset.loudness_range_lu)}`,
    `aresample=${preset.sample_rate}`,
  ];
  if (channels !== preset.channels) afChain.push(`pan=${preset.channels === 1 ? "mono|c0=0.5*c0+0.5*c1" : "stereo|c0=c0|c1=c0"}`);

  // Pad with head + tail silence per preset
  const headMs = pyInt(Number(preset.head_silence_secs) * 1000);
  afChain.unshift(`adelay=${headMs}|${headMs}`);
  afChain.unshift(`apad=pad_dur=${f(preset.tail_silence_secs)}`);
  const af = afChain.join(",");

  const cmd = ["ffmpeg", "-y", "-i", inPath, "-af", af, "-ac", String(preset.channels), "-ar", String(preset.sample_rate)];
  if (fmt === "mp3") cmd.push("-codec:a", "libmp3lame", "-b:a", `${preset.bitrate_kbps}k`, "-id3v2_version", "4");
  else if (fmt === "m4a") cmd.push("-codec:a", "aac", "-b:a", `${preset.bitrate_kbps}k`);
  else if (fmt === "wav") cmd.push("-codec:a", "pcm_s16le");
  if (title) cmd.push("-metadata", `title=${title}`);
  if (author) cmd.push("-metadata", `artist=${author}`);
  if (book) cmd.push("-metadata", `album=${book}`);
  cmd.push(outPath);
  return [cmd, fmt];
}

async function _runMaster(pcm, sampleRate, channels, { presetName, presets, outFormat, title = null, author = null, book = null }) {
  if (!self.haveFfmpeg()) throw new RuntimeError("ffmpeg not on PATH. Install ffmpeg or set its bundled path before /v1/master.");
  const preset = Object.hasOwn({ acx: 1, inaudio: 1, podcast: 1, youtube: 1 }, presetName) ? presets[presetName] : null;
  if (preset == null) throw new ValueError(`Unknown mastering preset: ${presetName}`);
  const fmt = outFormat || preset.format;

  const inPath = namedTemp(".wav");
  writeFileSync(inPath, writeWavContainer(pcm, sampleRate, channels));
  const outPath = namedTemp(`.${fmt}`);
  const [cmd] = _masterCommand(channels, { presetName, presets, outFormat, title, author, book, inPath, outPath });
  try {
    const result = await procs.run(cmd, { timeout: 600 });
    if (result.returncode !== 0) throw new RuntimeError(procs.failed("ffmpeg", result.returncode, result.stderr));
    return readFileSync(outPath);
  } finally {
    rmSync(inPath, { force: true });
    rmSync(outPath, { force: true });
  }
}
