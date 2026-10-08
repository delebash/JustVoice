// SPDX-License-Identifier: MIT
// Audiobook export — QC math, FFMETADATA chapters, m4b mux argv, endpoints (the port of
// tests/test_export_audiobook.py).
//
// The endpoint tests run on the real app (create_app), the book imported by POST
// /v1/projects/import?source=justwrite. The chapter render (`renderSceneToWav`), ffmpeg's
// presence (`haveFfmpeg`) and ffmpeg itself (the kit's `procs.run`) are stubbed as Python stubbed
// them; the whole-book warm (`synth_scheduler.warmLines`) is stubbed in every endpoint test —
// Python stubbed it in the two job tests and left it real in the rest, where a cast book's warm
// could reach a speech model.
import { writeFileSync } from "node:fs";
import { sleep } from "@delebash/llm-runner/platform/asyncutil";
import * as procs from "@delebash/llm-runner/platform/procs";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { ZipReader } from "@delebash/llm-runner/platform/zip";
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import "./engines_helpers.js";
import { m4bAuthor } from "../src/api/projects_api.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as exportAudiobook from "../src/export_audiobook.js";
import { buildFfmetadata, ChapterAudio, muxM4b, qcReport } from "../src/export_audiobook.js";
import * as synthScheduler from "../src/synth_scheduler.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

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

/** A real JustWrite book.json imported — see jw_fixtures.js (Python's `_seed`). */
async function seed(c) {
  const payload = bookJson({
    premise: "by Tamsin Vale",
    chapters: [
      ["ch1", "One", [scene("scn1", "Hello.")]],
      ["ch2", "Two", [scene("scn2", "There.")]],
    ],
  });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: payload });
  expect(r.status, r.text).toBe(200);
  return r.json().project_id;
}

/** Give every block a speaker played by a persona that has a voice, so the project is genuinely
 * render-ready. Imported prose names no speakers at all, and QC reports that as not-ready now
 * rather than measuring around it. */
async function castEverything(c, pid) {
  let r = await c.post("/v1/personas", { json: { name: "Reader", voice_id: "af_heart" } });
  expect([200, 201], r.text).toContain(r.status);
  const personaId = r.json().id;
  r = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Reader", persona_id: personaId } });
  expect(r.status, r.text).toBe(201);
  const speakerId = r.json().id;
  for (const sc of (await c.get(`/v1/projects/${pid}/scenes`)).json()) {
    for (const b of (await c.get(`/v1/scenes/${sc.id}/blocks`)).json()) {
      await c.patch(`/v1/blocks/${b.id}`, { json: { speaker_id: speakerId } });
    }
  }
}

/** The app, with the whole-book warm stubbed (see the header). */
async function app() {
  const { c } = await appClient();
  vi.spyOn(synthScheduler, "warmLines").mockResolvedValue(undefined);
  return c;
}

/** ffmpeg, faked: writes `bytes` where it was told to write the book. */
const fakeFfmpeg = (bytes) =>
  vi.spyOn(procs, "run").mockImplementation(async (argv) => {
    writeFileSync(argv.at(-1), bytes);
    return { returncode: 0, stderr: "" };
  });

test("qc_endpoint_with_stubbed_renderer", async () => {
  const c = await app();
  const pid = await seed(c);
  await castEverything(c, pid);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => wav(10 ** (-17.0 / 20), 1.0));
  const r = await c.get(`/v1/projects/${pid}/qc`);
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.all_ok).toBe(true);
  expect(body.chapters.map((x) => x.title)).toEqual(["One", "Two"]);
  expect(body.limits.rms_min_db).toBe(-23.0);
  expect(body.chapters.every((x) => x.note === null)).toBe(true);
});

test("qc_reports_unready_chapters_instead_of_failing", async () => {
  // QC MEASURES — it has to survive a book mid-production. The render refusal on unplaced lines
  // (Script-tab restore, decision 5) is right for the M4B export and wrong here: applying it
  // unchanged 400'd the whole run, leaving you unable to check the chapters that ARE finished.
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => wav(10 ** (-17.0 / 20), 1.0));
  const r = await c.get(`/v1/projects/${pid}/qc`);
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.all_ok).toBe(false);
  // Every chapter still reported, each saying WHY, none claiming a pass.
  expect(body.chapters.map((x) => x.title)).toEqual(["One", "Two"]);
  expect(body.chapters.every((x) => x.note && !x.ok)).toBe(true);
  expect(body.chapters[0].note).toContain("no speaker");
});

test("export_m4b_503_without_ffmpeg", async () => {
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(false);
  const r = await c.post(`/v1/projects/${pid}/export_m4b`);
  expect(r.status).toBe(503);
  expect(r.text).toContain("ffmpeg");
});

test("export_m4b_with_stubbed_ffmpeg", async () => {
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => wav(0.1, 0.5));
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(true);
  fakeFfmpeg("M4B!");
  const r = await c.post(`/v1/projects/${pid}/export_m4b`);
  expect(r.status, r.text).toBe(200);
  expect(r.content.toString("latin1")).toBe("M4B!");
  expect(r.headers["content-type"].startsWith("audio/mp4")).toBe(true);
  expect(r.headers["content-disposition"] ?? "").toContain("The_Ninth_Facet.m4b");
});

test("m4b_author_prefers_the_author_field", () => {
  // The Author field on Studio · Overview (metadata.author) is what the M4B `artist` tag
  // carries; a "by …" description is only the fallback.
  const proj = (meta, desc = null) => ({
    name: "B",
    project_type: "audiobook",
    metadata_json: meta !== null ? pyJson(meta) : null,
    description: desc,
  });
  expect(m4bAuthor(proj({ author: "D. Lebash" }, "by Someone Else"))).toBe("D. Lebash");
  expect(m4bAuthor(proj({ author: "  " }, "by Old Way"))).toBe("Old Way");
  expect(m4bAuthor(proj({}, "A novel"))).toBeNull();
  expect(m4bAuthor(proj(null))).toBeNull();
});

/** Poll an export job until it leaves "running" → `[job, steps]`. */
async function follow(c, job) {
  const steps = [];
  for (let i = 0; i < 200; i++) {
    job = (await c.get(`/v1/export_jobs/${job.id}`)).json();
    steps.push(job.step);
    if (job.status !== "running") break;
    await sleep(20);
  }
  return [job, steps];
}

test("the_export_job_reports_each_chapter_then_hands_over_the_file", async () => {
  // 2026-10-07: the M4B export as a job the Export panel follows — chapter by chapter, then the
  // encode — and the finished file fetched once.
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => {
    await sleep(50);
    return wav(0.1, 0.5);
  });
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(true);
  fakeFfmpeg("M4B!");
  const [job, steps] = await follow(c, (await c.post(`/v1/projects/${pid}/export_m4b/start`)).json());
  expect(job.status, JSON.stringify(job)).toBe("done");
  expect([job.done, job.total]).toEqual([3, 3]); // two chapters, then the encode
  expect(steps.some((x) => x.startsWith("Chapter 1 of 2"))).toBe(true);
  const r = await c.get(`/v1/export_jobs/${job.id}/file`);
  expect(r.status).toBe(200);
  expect(r.content.toString("latin1")).toBe("M4B!");
  expect((await c.get(`/v1/export_jobs/${job.id}`)).status).toBe(404); // fetched once
});

test("the_export_job_says_when_ffmpeg_is_missing", async () => {
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(false);
  const r = await c.post(`/v1/projects/${pid}/export_m4b/start`);
  expect(r.status).toBe(503);
  expect(r.text).toContain("ffmpeg");
});

test("the_chapter_audio_export_holds_each_chapter_and_its_master", async () => {
  // 2026-10-07: "⬇ Chapter WAVs (zip)" handed over the project package; now each chapter joined
  // and mastered, as Export's row always said.
  const c = await app();
  const pid = await seed(c);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async (_st, _sceneId, kw = {}) => wav((kw.master ?? true) ? 0.3 : 0.1, 0.5));
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(true);
  const [job] = await follow(c, (await c.post(`/v1/projects/${pid}/export_chapters/start`)).json());
  expect(job.status, JSON.stringify(job)).toBe("done");
  expect(job.filename.endsWith("_chapters.zip")).toBe(true);
  const r = await c.get(`/v1/export_jobs/${job.id}/file`);
  expect(r.status).toBe(200);
  const z = ZipReader.fromBuffer(r.content);
  expect([...z.names()].sort()).toEqual(["chapters/01 One.wav", "chapters/02 Two.wav", "masters/01 One.wav", "masters/02 Two.wav"]);
  expect(z.read("masters/01 One.wav").equals(wav(0.3, 0.5))).toBe(true);
  expect(z.read("chapters/01 One.wav").equals(wav(0.1, 0.5))).toBe(true);
});
