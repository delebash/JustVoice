// SPDX-License-Identifier: MIT
// Audiobook assembly — per-scene renders → ACX QC report / M4B export (the port of
// justvoice/export_audiobook.py).
//
// Assembly reuses the production render path (render_chapter's scene resolution +
// render_core), so the export sounds exactly like the Studio Render tab's output.
//
// Testability seams:
//   - `assembleProject(state, projectId, {renderSceneFn})` — tests inject a fake renderer
//     returning synthetic WAVs.
//   - `muxM4b(…, {run})` isolates the ffmpeg invocation; tests stub `run` and assert the argv
//     + FFMETADATA chapter file. ffmpeg starts through the kit's procs door only.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getLogger } from "@delebash/llm-runner/platform/log";
import * as procs from "@delebash/llm-runner/platform/procs";
import { pyRound, RuntimeError, ValueError } from "@delebash/llm-runner/platform/py";
import * as hardware from "@delebash/llm-runner/runner/hardware";
import * as renderChapterApi from "./api/render_chapter_api.js";
import { analyze } from "./audio/analyzer.js";
import { parseWavHeader } from "./audio/wav.js";
import * as session from "./database/session.js";
import { Scene } from "./database/models.js";
import { ApiError } from "./errors.js";

export const log = getLogger("justvoice.export_audiobook");

// ACX technical bounds (https://help.acx.com — submission requirements).
export const ACX_RMS_MIN_DB = -23.0;
export const ACX_RMS_MAX_DB = -18.0;
export const ACX_PEAK_MAX_DB = -3.0;

/** One assembled chapter. */
export class ChapterAudio {
  constructor({ sceneId, title, wav, durationS }) {
    this.sceneId = sceneId;
    this.title = title;
    this.wav = wav;
    this.durationS = durationS;
  }
}

/** One chapter's ACX verdict. */
export class ChapterQC {
  constructor({ sceneId, title, durationS, rmsDbfs, peakDbfs, rmsOk, peakOk }) {
    this.sceneId = sceneId;
    this.title = title;
    this.durationS = durationS;
    this.rmsDbfs = rmsDbfs;
    this.peakDbfs = peakDbfs;
    this.rmsOk = rmsOk;
    this.peakOk = peakOk;
  }

  get ok() {
    return this.rmsOk && this.peakOk;
  }
}

/** A WAV's length in seconds (Python's `wave`: frames / rate). */
export function _wavDurationS(wav) {
  const [fmt] = parseWavHeader(wav);
  return fmt.sampleCount / (fmt.sampleRate || 1);
}

/** The project's scenes, in order (rows). */
export function projectScenes(projectId) {
  return session.getDb().all(`select * from ${Scene} where project_id = ? order by position`, [projectId], Scene);
}

/**
 * Render every scene of the project to a mastered WAV, in order (async) → ChapterAudio[].
 * `renderSceneToWav` applies the project's mastering target in the WAV domain, so these
 * chapters are what the .m4b ships and what ACX QC measures.
 *
 * `renderSceneFn(state, sceneId) → WAV bytes` defaults to the production chapter render; tests
 * inject synthetic WAVs.
 *
 * `skipUnrenderable` is for ACX QC and nothing else. Export must keep the default (false): a
 * scene that refuses has to abort the book, because shipping an .m4b silently missing a
 * chapter is the failure the refusal exists to prevent. QC only MEASURES, and a book
 * mid-production always has chapters that aren't cast yet. The caller that skips is
 * responsible for reporting what it skipped.
 *
 * `progress(i, n, scene)` is told before each chapter renders (the export job's "Chapter 2 of
 * 4", 2026-10-07); throwing from it stops the assembly there.
 */
export async function assembleProject(state, projectId, { renderSceneFn = null, skipUnrenderable = false, progress = null } = {}) {
  const render = renderSceneFn ?? ((st, sceneId) => renderChapterApi.renderSceneToWav(st, sceneId));
  const out = [];
  const scenes = projectScenes(projectId);
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (progress != null) await progress(i, scenes.length, scene);
    let wav;
    try {
      wav = await render(state, scene.id);
    } catch (e) {
      if (!(e instanceof ApiError) || !skipUnrenderable) throw e;
      continue;
    }
    out.push(
      new ChapterAudio({
        sceneId: scene.id,
        title: scene.title || `Chapter ${scene.position + 1}`,
        wav,
        durationS: _wavDurationS(wav),
      }),
    );
  }
  return out;
}

/**
 * Every renderLine call assembleProject will make, as options — the whole-book warm set (§7b
 * P2-3 of the 2026-08-08 plan: the grouping unit is the full workload, not one scene). Async.
 * Mirrors assembleProject's two modes: the default (export) resolves strict and returns [] the
 * moment ANY scene refuses — the export aborts on that scene, so warming past it would render
 * audio it never reaches. `skipUnrenderable` (ACX QC) resolves lenient and skips scenes that
 * throw, exactly like the measuring assembly it warms for.
 */
export async function collectProjectLineKwargs(state, projectId, { skipUnrenderable = false } = {}) {
  const out = [];
  for (const sc of projectScenes(projectId)) {
    let lines;
    try {
      lines = await renderChapterApi._resolveSceneToLines(sc.id, state, { strict: !skipUnrenderable });
    } catch {
      if (skipUnrenderable) continue;
      return [];
    }
    for (const line of lines) {
      out.push({
        voice: line.voice,
        text: line.text,
        language: line.language,
        delivery: renderChapterApi._deliveryOf(line),
        seed: line.seed,
        lexicons: renderChapterApi._lexiconsFor(line),
        effects: line.effects,
        cacheScope: `scene:${sc.id}`,
        useCache: true,
      });
    }
  }
  return out;
}

/** ACX technical checks per chapter — RMS window + peak ceiling (async). Noise floor needs a
 * room-tone span the synth pipeline doesn't have a locator for yet. */
export async function qcReport(chapters) {
  const report = [];
  for (const ch of chapters) {
    const a = await analyze(ch.wav);
    const rms = a.loudness.rms_dbfs;
    const peak = a.loudness.peak_dbfs;
    report.push(
      new ChapterQC({
        sceneId: ch.sceneId,
        title: ch.title,
        durationS: pyRound(ch.durationS, 2),
        rmsDbfs: pyRound(rms, 2),
        peakDbfs: pyRound(peak, 2),
        rmsOk: ACX_RMS_MIN_DB <= rms && rms <= ACX_RMS_MAX_DB,
        peakOk: peak <= ACX_PEAK_MAX_DB,
      }),
    );
  }
  return report;
}

/** FFMETADATA1 document with millisecond chapter markers. */
export function buildFfmetadata(chapters, bookTitle, author) {
  const lines = [";FFMETADATA1", `title=${bookTitle}`];
  if (author) lines.push(`artist=${author}`);
  let t = 0;
  for (const ch of chapters) {
    const start = Math.trunc(t * 1000);
    t += ch.durationS;
    const end = Math.trunc(t * 1000);
    lines.push("", "[CHAPTER]", "TIMEBASE=1/1000", `START=${start}`, `END=${end}`, `title=${ch.title}`);
  }
  return `${lines.join("\n")}\n`;
}

export function haveFfmpeg() {
  return hardware.which("ffmpeg") !== null;
}

/**
 * Concat chapter WAVs → AAC in an .m4b container with chapter marks (async). One ffmpeg
 * invocation: the WAV inputs go through the concat demuxer, the FFMETADATA file supplies
 * chapters, `-f ipod` is the m4b/m4a mux. `run(argv)` → `{returncode, stderr}` is the test
 * seam (default: the kit's `procs.run`, looked up at call time so a spy applies).
 */
export async function muxM4b(chapters, bookTitle, author, { run = null } = {}) {
  if (!chapters.length) throw new ValueError("nothing to export — no rendered chapters");
  const runner = run ?? ((argv) => procs.run(argv));
  const tdir = mkdtempSync(path.join(tmpdir(), "jv-m4b-"));
  try {
    const concatLines = [];
    chapters.forEach((ch, i) => {
      const p = path.join(tdir, `ch${String(i).padStart(3, "0")}.wav`);
      writeFileSync(p, ch.wav);
      concatLines.push(`file '${p}'`);
    });
    writeFileSync(path.join(tdir, "concat.txt"), `${concatLines.join("\n")}\n`, "utf8");
    writeFileSync(path.join(tdir, "chapters.txt"), buildFfmetadata(chapters, bookTitle, author), "utf8");
    const out = path.join(tdir, "book.m4b");
    const argv = [
      "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", path.join(tdir, "concat.txt"),
      "-i", path.join(tdir, "chapters.txt"),
      "-map_metadata", "1",
      "-c:a", "aac", "-b:a", "128k",
      "-f", "ipod", out,
    ];
    const proc = await runner(argv);
    if (proc.returncode !== 0) throw new RuntimeError(procs.failed("ffmpeg", proc.returncode, proc.stderr ?? ""));
    return readFileSync(out);
  } finally {
    rmSync(tdir, { recursive: true, force: true });
  }
}
