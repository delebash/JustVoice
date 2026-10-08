// SPDX-License-Identifier: MIT
// Audiobook export — QC math, FFMETADATA chapters, m4b mux argv (the port of
// tests/test_export_audiobook.py).
//
// Not ported here: the endpoint tests (QC, export_m4b, the export jobs, the chapter-audio zip,
// m4b_author) — they wait for api/projects_api.js / api/export_jobs_api.js and the JustWrite
// import: test.todo.
import { writeFileSync } from "node:fs";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { buildFfmetadata, ChapterAudio, muxM4b, qcReport } from "../src/export_audiobook.js";

/** Mono 16-bit sine at the given linear amplitude (0..1). */
function wav(amplitude, seconds = 1.0, rate = 16000) {
  const n = Math.trunc(rate * seconds);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(amplitude * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 2 * i);
  return writeWavContainer(pcm, rate, 1);
}

const ch = (title, amp, dur = 1.0) => new ChapterAudio({ sceneId: `s_${title}`, title, wav: wav(amp, dur), durationS: dur });

// ── QC ───────────────────────────────────────────────────────────────

test("qc_flags_hot_and_quiet_chapters", async () => {
  // sine RMS = amp/√2 → dBFS = 20log10(amp) - 3.01
  const good = ch("Good", 10 ** (-17.0 / 20)); // RMS ≈ -20 dB, peak -17 → ok
  const hot = ch("Hot", 0.9); // peak ≈ -0.9 dB → peak fail
  const quiet = ch("Quiet", 10 ** (-30.0 / 20)); // RMS ≈ -33 dB → rms fail
  const rep = await qcReport([good, hot, quiet]);
  expect(rep.map((c) => c.ok)).toEqual([true, false, false]);
  expect(rep[1].peakOk).toBe(false);
  expect(rep[1].rmsOk).toBe(false); // 0.9 amp RMS ≈ -3.9 dB (too hot)
  expect(rep[2].rmsOk).toBe(false);
  expect(rep[2].peakOk).toBe(true);
});

// ── chapter metadata ────────────────────────────────────────────────

test("ffmetadata_cumulative_chapter_marks", () => {
  const md = buildFfmetadata([ch("One", 0.1, 2.0), ch("Two", 0.1, 3.5)], "The Ninth Facet", "Tamsin Vale");
  expect(md.startsWith(";FFMETADATA1")).toBe(true);
  expect(md).toContain("title=The Ninth Facet");
  expect(md).toContain("artist=Tamsin Vale");
  expect(md).toContain("START=0\nEND=2000\ntitle=One");
  expect(md).toContain("START=2000\nEND=5500\ntitle=Two");
});

// ── mux argv (ffmpeg stubbed) ───────────────────────────────────────

test("mux_m4b_builds_one_ffmpeg_call", async () => {
  const calls = {};
  const fakeRun = async (argv) => {
    calls.argv = argv;
    // produce the output file ffmpeg would have written
    writeFileSync(argv.at(-1), "m4b-bytes");
    return { returncode: 0, stderr: "" };
  };
  const out = await muxM4b([ch("One", 0.1)], "The Ninth Facet", null, { run: fakeRun });
  expect(out.toString()).toBe("m4b-bytes");
  const argv = calls.argv;
  expect(argv[0]).toBe("ffmpeg");
  expect(argv).toContain("-f");
  expect(argv).toContain("ipod");
  expect(argv).toContain("concat");
  expect(argv.some((a) => String(a).endsWith("chapters.txt"))).toBe(true);
});

test("mux_m4b_raises_on_ffmpeg_failure", async () => {
  const fakeRun = async () => ({ returncode: 1, stderr: "boom" });
  await expect(muxM4b([ch("One", 0.1)], "X", null, { run: fakeRun })).rejects.toThrow(RuntimeError);
  await expect(muxM4b([ch("One", 0.1)], "X", null, { run: fakeRun })).rejects.toThrow(/boom/);
});

// ── endpoints ────────────────────────────────────────────────────────

test.todo("qc_endpoint_with_stubbed_renderer — waits for api/projects_api.js + imports");
test.todo("qc_reports_unready_chapters_instead_of_failing — waits for api/projects_api.js + imports");
test.todo("export_m4b_503_without_ffmpeg — waits for api/projects_api.js + imports");
test.todo("export_m4b_with_stubbed_ffmpeg — waits for api/projects_api.js + imports");
test.todo("m4b_author_prefers_the_author_field — waits for api/projects_api.js");
test.todo("the_export_job_reports_each_chapter_then_hands_over_the_file — waits for api/export_jobs_api.js + imports");
test.todo("the_export_job_says_when_ffmpeg_is_missing — waits for api/export_jobs_api.js + imports");
test.todo("the_chapter_audio_export_holds_each_chapter_and_its_master — waits for api/export_jobs_api.js + imports");
