// SPDX-License-Identifier: MIT
// The render layer's real-render parity check (wave C of step 5), checks (c) and (d). Python's
// render layer and this port each work on their own COPY of JustVoice's dev data root (the
// database copied; the speech models through a junction to the real speech cache, read only;
// a fresh empty render cache and take folder in each copy). `compare-render.py prep` adds two
// small books from The Keystone's real lines — "Parity Game" (game voicelines: three lines, one
// over Kokoro's 240-character piece size) and "Parity Audio" (an audiobook mastered to ACX: two
// chapters of two lines) — spoken by the real Kokoro personas, each given a Kokoro seed (Kokoro
// draws noise; a random seed is another take). Then each side, against the same installed
// runtime (Python's source-tree runtime; the JS data root's `engines-runtime` is a junction to
// it):
//
//   (c) renders the game book's lines through a render job (the scheduler, the take rows, the
//       audio files, the render cache), exports its voice lines, renders the audio book's first
//       chapter through render_scene_to_wav (joined, mastered to ACX by ffmpeg);
//   (d) assembles the whole audio book into an M4B (ffmpeg), and masters one take with every
//       preset (MP3 with tags, and WAV) — the ffmpeg argv of each recorded (Python's through a
//       spy on procs.run; the JS's from the command builders the same calls run:
//       mastering._masterCommand, and muxM4b's `run` seam).
//
// Everything is compared: the job's answer and rows (ids aside), each take's WAV bytes, the
// render-cache files, the voice-line zip's entries, the chapter WAV, the M4B, every master, the
// argv (temp paths aside). Before anything starts it checks nothing listens on JustVoice's
// ports and no runtime runs — it refuses to run beside the app; afterwards it checks no runtime
// process is left and reports graphics memory before and after.
//
//   node scripts/node24.mjs server/scripts/compare-render-real.mjs [--keep]   (JV_PYTHON overrides)

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, compare, DEV_DATA, dataCopy, fingerprint, python, tempRoot } from "./compare-render-lib.mjs";

const procs = await import("@delebash/llm-runner/platform/procs");
async function vramMb() {
  const r = await procs.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader"], { timeout: 20 });
  return String(r.stdout).trim();
}
async function runtimeProcesses() {
  const r = await procs.run(["tasklist", "/FO", "CSV", "/NH"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /audiocpp_server|audiocpp_dsp|audio-server|llama-server/i.test(l));
}
async function listening() {
  const r = await procs.run(["netstat", "-ano", "-p", "TCP"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /:(17494|17495|8742|1430|1431)\s/.test(l) && /LISTENING/.test(l));
}

// ── the guard: never beside the user's app ───────────────────────────────────
const busy = [...(await listening()), ...(await runtimeProcesses())];
if (busy.length) {
  console.log(`SKIPPED — JustVoice (or a runtime) is running:\n  ${busy.join("\n  ")}`);
  process.exit(2);
}
const vramBefore = await vramMb();
console.log(`graphics memory before: ${vramBefore}`);
const before = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));

const dir = tempRoot("jv-compare-render-real-");
const base = dataCopy(dir, "base", { links: [] });
const idsText = (await python(["prep", base])).trim();
writeFileSync(join(dir, "ids.json"), idsText);
const ids = JSON.parse(idsText);
const pyData = dataCopy(dir, "py-data", { from: base, copy: ["voices"] });
const jsData = dataCopy(dir, "js-data", { from: base, copy: ["voices"], runtime: true });
const pyOut = join(dir, "py-out");
const jsOut = join(dir, "js-out");

// ── Python ──────────────────────────────────────────────────────────────────────
await python(["real", pyData, pyOut, join(dir, "ids.json")], 1800);
await new Promise((res) => setTimeout(res, 1500));
const leftPy = await runtimeProcesses();
console.log(`python: ${readFileSync(join(pyOut, "times.json"), "utf8")}; after: ${leftPy.length ? leftPy.join(" | ") : "no runtime process left"}; graphics memory ${await vramMb()}`);

// ── this port ───────────────────────────────────────────────────────────────────
const llmDb = await import("@delebash/llm-runner/llm/db");
const session = await import("../src/database/session.js");
const { AppState, setState } = await import("../src/app_state.js");
const runtime = await import("../src/engines/audiocpp/runtime.js");
const manager = await import("../src/engines/manager.js");
const renderJobs = await import("../src/render_jobs.js");
const mastering = await import("../src/mastering.js");
const { renderSceneToWav } = await import("../src/api/render_chapter_api.js");
const { parseWavHeader } = await import("../src/audio/wav.js");
const { assembleProject, muxM4b } = await import("../src/export_audiobook.js");
const { exportVoicelines } = await import("../src/export_voicelines.js");
const { mediaFile } = await import("../src/media_paths.js");
const dspClient = await import("../src/audio/dsp_client.js");

session.initDb(jsData);
llmDb.configureStorage(session.cfg.handle);
const st = new AppState(jsData);
setState(st);
await runtime.ensureHardware();
mkdirSync(join(jsOut, "gen"), { recursive: true });
mkdirSync(join(jsOut, "master"), { recursive: true });
const h = session.cfg.handle;
const argvs = {};
const times = {};
const marks = (n) => Array(n).fill("?").join(", ");
/** The ffmpeg argv a master/masterToWav call runs (mastering._masterCommand). */
const masterArgv = (channels, opts) => mastering._masterCommand(channels, { ...opts, inPath: "<in>", outPath: "<out>" })[0];
try {
  let t0 = performance.now();
  const game = ids.game;
  const job = renderJobs.createJob(game.project, "blocks", game.blocks);
  renderJobs.startJob(job.id);
  let s;
  for (;;) {
    s = renderJobs.jobStatus(job.id, { includeBlocks: true });
    if (["completed", "failed", "cancelled"].includes(s.status)) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  times.job = Math.round((performance.now() - t0) / 100) / 10;
  const gens = h.all(`select * from generations where block_id in (${marks(game.blocks.length)})`, game.blocks, "generations");
  const genIds = new Set(gens.map((g) => g.id));
  const cols = ["block_id", "persona_id", "profile_id", "project_id", "chapter_id", "text", "language", "engine", "model", "seed", "instruct",
    "duration_sec", "status", "ok_status", "error", "source", "effects_chain", "cache_key"];
  const byKey = (k) => (a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0);
  const rows = {
    generations: gens.map((g) => Object.fromEntries(cols.map((c) => [c, g[c]]))).sort(byKey((r) => r.block_id)),
    takes: h
      .all(`select * from takes where block_id in (${marks(game.blocks.length)})`, game.blocks, "takes")
      .map((t) => [t.block_id, t.is_default, t.label, t.source_take_id, genIds.has(t.generation_id)])
      .sort(byKey((r) => `${r[0]}|${r[4] ? 1 : 0}`)),
    job_blocks: h
      .all("select * from render_job_blocks where job_id = ?", [job.id], "render_job_blocks")
      .map((r) => [r.block_id, r.status, genIds.has(r.generation_id), r.attempts])
      .sort(byKey((r) => r[0])),
  };
  for (const g of gens) writeFileSync(join(jsOut, "gen", `${g.block_id}.wav`), readFileSync(mediaFile(g.audio_path)));
  const first = gens.reduce((a, b) => (game.blocks.indexOf(b.block_id) < game.blocks.indexOf(a.block_id) ? b : a));
  const firstTake = readFileSync(mediaFile(first.audio_path));
  delete s.id;
  for (const b of s.blocks || []) b.generation_id = genIds.has(b.generation_id);
  writeFileSync(join(jsOut, "job.json"), JSON.stringify({ status: s, rows }, null, 1));
  writeFileSync(join(jsOut, "voicelines.zip"), await exportVoicelines(st, game.project));
  argvs.voicelines = [];

  t0 = performance.now();
  const audio = ids.audio;
  const acx = st.settings.get().mastering;
  const chapterWav = await renderSceneToWav(st, audio.scenes[0]);
  writeFileSync(join(jsOut, "chapter.wav"), chapterWav);
  const chapters = await assembleProject(st, audio.project);
  const m4bSeen = {};
  const book = await muxM4b(chapters, "Parity Audio", "Tamsin Vale", {
    run: async (argv) => {
      m4bSeen.argv = argv;
      const tdir = join(argv[argv.indexOf("-i") + 1], "..");
      m4bSeen.concat = readFileSync(join(tdir, "concat.txt"), "utf8");
      m4bSeen.chapters = readFileSync(join(tdir, "chapters.txt"), "utf8");
      return procs.run(argv);
    },
  });
  writeFileSync(join(jsOut, "book.m4b"), book);
  times.audio = Math.round((performance.now() - t0) / 100) / 10;
  // The chapter renders mastered the joined lines (the rendering rate, mono) to ACX.
  argvs.chapter = [masterArgv(1, { presetName: "acx", presets: acx, outFormat: "wav" })];
  argvs.assemble = [masterArgv(1, { presetName: "acx", presets: acx, outFormat: "wav" }), masterArgv(1, { presetName: "acx", presets: acx, outFormat: "wav" })];
  argvs.m4b = [m4bSeen.argv];
  argvs.concat = m4bSeen.concat;
  argvs.chapters = m4bSeen.chapters;

  const [fmt, off, size] = parseWavHeader(firstTake);
  const pcm = firstTake.subarray(off, off + size);
  for (const preset of ["acx", "inaudio", "podcast", "youtube"]) {
    const tags = { title: "The Ninth Facet", author: "Tamsin Vale", book: "Facets" };
    writeFileSync(join(jsOut, "master", `${preset}.mp3`), await mastering.master(pcm, fmt.sampleRate, fmt.channels, { presetName: preset, presets: acx, ...tags }));
    argvs[preset] = [masterArgv(fmt.channels, { presetName: preset, presets: acx, ...tags })];
    writeFileSync(join(jsOut, "master", `${preset}.wav`), await mastering.masterToWav(pcm, fmt.sampleRate, fmt.channels, { presetName: preset, presets: acx }));
    argvs[`${preset}_wav`] = [masterArgv(fmt.channels, { presetName: preset, presets: acx, outFormat: "wav" })];
  }
} finally {
  await manager.shutdownManager();
  await dspClient.stop(); // the DSP program (joins, fits) holds its log in the copy
  session.closeDb();
}
writeFileSync(join(jsOut, "argv.json"), JSON.stringify(argvs, null, 1));
await new Promise((res) => setTimeout(res, 1500));
const leftJs = await runtimeProcesses();
console.log(`js: ${JSON.stringify(times)}; after: ${leftJs.length ? leftJs.join(" | ") : "no runtime process left"}; graphics memory ${await vramMb()}`);

// ── compare ─────────────────────────────────────────────────────────────────────
const results = [];
const same = (what, a, b) => {
  const ok = Buffer.isBuffer(a) ? a.equals(b) : a === b;
  results.push([ok, what, Buffer.isBuffer(a) ? `${a.length} | ${b.length} bytes` : ""]);
  return ok;
};
const pyJob = JSON.parse(readFileSync(join(pyOut, "job.json"), "utf8"));
const jsJob = JSON.parse(readFileSync(join(jsOut, "job.json"), "utf8"));
const jobDiffs = compare(pyJob, jsJob);
results.push([!jobDiffs.length, `job answer + generation / take / job-block rows (${pyJob.rows.generations.length} generations)`, jobDiffs.slice(0, 5).join("; ")]);
for (const f of readdirSync(join(pyOut, "gen"))) same(`take audio ${f}`, readFileSync(join(pyOut, "gen", f)), readFileSync(join(jsOut, "gen", f)));

// the render caches: every file, by name and bytes
const tree = (root) => {
  const out = new Map();
  const walk = (p) => {
    if (!existsSync(p)) return;
    for (const e of readdirSync(p)) {
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else out.set(relative(root, q).replaceAll("\\", "/"), readFileSync(q));
    }
  };
  walk(root);
  return out;
};
const pyCache = tree(join(pyData, "cache"));
const jsCache = tree(join(jsData, "cache"));
same(`render-cache file names (${pyCache.size})`, [...pyCache.keys()].sort().join("\n"), [...jsCache.keys()].sort().join("\n"));
let cacheBytes = true;
for (const [k, v] of pyCache) if (!jsCache.get(k)?.equals(v)) cacheBytes = false;
results.push([cacheBytes, `render-cache file bytes (${pyCache.size} files)`, ""]);

// the voice-line zips: entries and their bytes (the archives' own bytes carry times)
const { ZipReader } = await import("@delebash/llm-runner/platform/zip");
const pz = ZipReader.fromBuffer(readFileSync(join(pyOut, "voicelines.zip")));
const jz = ZipReader.fromBuffer(readFileSync(join(jsOut, "voicelines.zip")));
same("voice-line zip entries", pz.names().join("\n"), jz.names().join("\n"));
for (const n of pz.names()) same(`voice-line zip ${n}`, pz.read(n), jz.read(n));

same("chapter WAV (render_scene_to_wav, ACX)", readFileSync(join(pyOut, "chapter.wav")), readFileSync(join(jsOut, "chapter.wav")));
same("M4B (assemble_project + mux_m4b)", readFileSync(join(pyOut, "book.m4b")), readFileSync(join(jsOut, "book.m4b")));
for (const f of readdirSync(join(pyOut, "master"))) same(`master ${f}`, readFileSync(join(pyOut, "master", f)), readFileSync(join(jsOut, "master", f)));

// the argv: temp paths aside
const pyArgv = JSON.parse(readFileSync(join(pyOut, "argv.json"), "utf8"));
const jsArgv = JSON.parse(readFileSync(join(jsOut, "argv.json"), "utf8"));
const normMaster = (argv) => argv.map((a, i) => (argv[i - 1] === "-i" ? "<in>" : i === argv.length - 1 ? "<out>" : a));
const tmpOf = (argv) => join(argv[argv.indexOf("-i") + 1], "..");
for (const k of Object.keys(pyArgv)) {
  if (k === "concat" || k === "chapters") continue;
  if (k === "m4b") {
    const norm = (argv) => argv.map((a) => a.replaceAll(tmpOf(argv), "<tmp>"));
    same(`argv m4b ${JSON.stringify(norm(pyArgv.m4b[0]))}`, JSON.stringify(norm(pyArgv.m4b[0])), JSON.stringify(norm(jsArgv.m4b[0])));
    continue;
  }
  same(`argv ${k} (${pyArgv[k].length} call(s))`, JSON.stringify(pyArgv[k].map(normMaster)), JSON.stringify(jsArgv[k].map(normMaster)));
}
same("m4b chapters.txt (FFMETADATA)", pyArgv.chapters, jsArgv.chapters);
const pyTmp = tmpOf(pyArgv.m4b[0]);
const jsTmp = tmpOf(jsArgv.m4b[0]);
same("m4b concat.txt (temp folder aside)", pyArgv.concat.replaceAll(pyTmp, "<tmp>"), jsArgv.concat.replaceAll(jsTmp, "<tmp>"));

for (const [ok, what, note] of results) console.log(`  ${ok ? "same" : "DIFF"}  ${what}${note ? `  (${note})` : ""}`);
const bad = results.filter(([ok]) => !ok).length;
console.log(bad ? `${bad} difference(s) of ${results.length}` : `0 differences in ${results.length} comparisons`);
console.log(`argv sample (acx mp3): ${JSON.stringify(normMaster(pyArgv.acx[0]))}`);

const after = Object.fromEntries(["cache", "generations", "speech-cache"].map((d) => [d, fingerprint(join(DEV_DATA, d))]));
console.log(`real cache / generations / speech-cache unchanged: ${JSON.stringify(before) === JSON.stringify(after)}`);
console.log(`graphics memory before ${vramBefore}, after ${await vramMb()}; runtime processes left: ${(await runtimeProcesses()).length}`);
if (process.argv.includes("--keep")) console.log(`kept ${dir}`);
else cleanup(dir);
process.exit(bad ? 1 : 0);
