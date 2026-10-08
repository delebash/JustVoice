// SPDX-License-Identifier: MIT
// Render truth — what a chapter render actually produces (2026-08-15) — the port of
// tests/test_render_truth.py.
//
// Three claims the app made and did not keep, pinned so they cannot come undone:
// 1. **Effects apply.** Chapter renders, the M4B export and every take made from them were dry.
// 2. **The chain is part of the cache key.** Editing a chain served the old audio back.
// 3. **Mastering happens.** ACX QC measured raw TTS output and printed a verdict on it.
//
// The endpoint tests run through the app, the book imported by POST
// /v1/projects/import?source=justwrite. The QC test stubs the chapter render as Python did
// (`renderSceneToWav`) and also its whole-book warm (`synth_scheduler.warmLines`, which Python
// left real over a book with nothing to warm), so no test can reach a speech model.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import "./engines_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import { effectsChainHash } from "../src/audio/effects.js";
import * as session from "../src/database/session.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as mastering from "../src/mastering.js";
import { resolveMasterTarget } from "../src/mastering.js";
import { construct, Persona, utcNow } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import { probeLineCached, RenderedLine, renderLine } from "../src/render_core.js";
import * as synthScheduler from "../src/synth_scheduler.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { tmpDb } from "./helpers.js";
import { bookJson, scene as jwScene } from "./jw_fixtures.js";
import { FakeCache, FakeManager, fakeManifest, pcmOf, renderState, useManager } from "./render_helpers.js";

const GAIN_UP = [{ type: "gain", params: { gain_db: 6.0 } }];
const GAIN_DOWN = [{ type: "gain", params: { gain_db: -6.0 } }];

// ── the render_line harness (same shape as test_render_managed_bridge) ──

let fakeMgr;
const useFakeMgr = () => {
  // A steady non-zero signal, so a gain effect visibly moves it.
  fakeMgr = useManager(
    new FakeManager({ "mock-tts": fakeManifest("mock-tts", { staticVoices: [{ id: "mv_1", name: "MV" }] }) }, { pcm: pcmOf(400, 0x1000) }),
  );
};

// ── 1. effects apply to a rendered line ────────────────────────────────

test("effects_chain_changes_the_audio", async () => {
  useFakeMgr();
  const st = renderState({ cache: new FakeCache() });
  const dry = await renderLine(st, { voice: "mv_1", text: "Hi", cacheScope: "s" });
  const wet = await renderLine(st, { voice: "mv_1", text: "Hi", effects: GAIN_UP, cacheScope: "s" });
  expect(dry.pcm.length).toBe(wet.pcm.length); // an effect must not change line length
  expect(dry.pcm.equals(wet.pcm)).toBe(false); // the gain effect never reached the audio
  // Both are real renders, cached under different keys.
  expect(fakeMgr.synths.length).toBe(2);
});

test("chain_is_part_of_the_cache_key", async () => {
  useFakeMgr();
  const st = renderState({ cache: new FakeCache() });
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: GAIN_UP, cacheScope: "s" });
  expect(fakeMgr.synths.length).toBe(1);
  // Same chain → hit.
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: GAIN_UP, cacheScope: "s" });
  expect(fakeMgr.synths.length).toBe(1);
  // Edited chain → miss (this is what "editing a chain re-renders" means).
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: GAIN_DOWN, cacheScope: "s" });
  expect(fakeMgr.synths.length).toBe(2);
  // Chain removed → miss again, and the dry audio is its own entry.
  await renderLine(st, { voice: "mv_1", text: "Hi", cacheScope: "s" });
  expect(fakeMgr.synths.length).toBe(3);
});

test("probe_mirrors_the_effects_key", async () => {
  // The Render tab's "N of M lines unchanged" banner probes keys without rendering. If it
  // ignored the chain it would promise cache hits that the render then misses.
  useFakeMgr();
  const st = renderState({ cache: new FakeCache() });
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: GAIN_UP, cacheScope: "s" });
  expect(await probeLineCached(st, "mv_1", "Hi", { effects: GAIN_UP, cacheScope: "s" })).toBe(true);
  expect(await probeLineCached(st, "mv_1", "Hi", { effects: GAIN_DOWN, cacheScope: "s" })).toBe(false);
  expect(await probeLineCached(st, "mv_1", "Hi", { cacheScope: "s" })).toBe(false);
});

test("empty_chain_hashes_like_no_chain", async () => {
  // [] and null must share an entry, or every dry line would cache twice.
  useFakeMgr();
  const st = renderState({ cache: new FakeCache() });
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: [], cacheScope: "s" });
  await renderLine(st, { voice: "mv_1", text: "Hi", effects: null, cacheScope: "s" });
  expect(fakeMgr.synths.length).toBe(1);
  expect(effectsChainHash([])).toBe(effectsChainHash(null));
});

// ── 2. scene resolution carries the chain ──────────────────────────────

function persona(pid, { voiceId = "voice-1", effects = null } = {}) {
  const now = utcNow();
  return construct(Persona, {
    id: pid,
    name: `P ${pid}`,
    voice_id: voiceId,
    default_delivery: {},
    effects_chain: effects || [],
    created_at: now,
    updated_at: now,
  });
}

const stateWith = (personas) => ({ personas: { get: (pid) => personas[pid] ?? null } });

let h;
beforeEach(() => {
  h = tmpDb();
  session.cfg.handle = h;
});
afterEach(() => {
  session.cfg.handle = null;
  h.close();
  appState.cfg.state = null;
});

/** speaker_fixtures.speaker_played_by: this book's speaker played by `personaId`. */
function speakerPlayedBy(sceneId, personaId) {
  if (personaId == null) return null;
  const projectId = h.get(Scene, sceneId).project_id;
  const found = h.one(`select id from ${Speaker} where project_id = ? and persona_id = ? limit 1`, [projectId, personaId]);
  if (found) return found.id;
  const id = uuid();
  h.insert(Speaker, { id, project_id: projectId, name: `Speaker ${personaId}`, persona_id: personaId });
  return id;
}

function seedScene({ projectType = "audiobook", mastering: master = null } = {}) {
  h.insert(Project, { id: "proj-1", name: "P", project_type: projectType, mastering_preset: master });
  h.insert(Scene, { id: "scene-1", project_id: "proj-1", position: 0, title: "Ch 1" });
  h.insert(Block, { scene_id: "scene-1", position: 0, text: "A line.", speaker_id: speakerPlayedBy("scene-1", "p1") });
}

test("scene_lines_carry_the_persona_chain", async () => {
  seedScene();
  const lines = await renderChapterApi._resolveSceneToLines("scene-1", stateWith({ p1: persona("p1", { effects: GAIN_UP }) }));
  expect(lines[0].effects).toEqual(GAIN_UP);
});

test("no_chain_leaves_the_line_alone", async () => {
  seedScene();
  const lines = await renderChapterApi._resolveSceneToLines("scene-1", stateWith({ p1: persona("p1") }));
  expect(lines[0].effects).toBeNull();
});

// ── 3. which master target applies ─────────────────────────────────────

test("kind_defaults", () => {
  for (const [kind, expected] of [
    ["audiobook", "acx"],
    ["podcast", "podcast"],
    ["game_voicelines", null],
    ["custom", null],
    ["", null],
  ]) {
    expect(resolveMasterTarget({ projectType: kind }), kind).toEqual([expected, "kind"]);
  }
});

test("precedence_request_beats_project_beats_kind", () => {
  expect(resolveMasterTarget({ requested: "youtube", projectMaster: "inaudio", projectType: "audiobook" })).toEqual(["youtube", "request"]);
  expect(resolveMasterTarget({ projectMaster: "inaudio", projectType: "audiobook" })).toEqual(["inaudio", "project"]);
});

test("none_is_an_answer_not_a_gap", () => {
  // "none" means ship it raw and STOPS the search — otherwise turning mastering off on an
  // audiobook would silently fall through to ACX.
  expect(resolveMasterTarget({ requested: "none", projectType: "audiobook" })).toEqual([null, "request"]);
  expect(resolveMasterTarget({ projectMaster: "none", projectType: "audiobook" })).toEqual([null, "project"]);
});

test("unknown_target_renders_raw", () => {
  // Project.mastering_preset can hold "custom", which has no filtergraph. Raw is the honest
  // outcome; inventing ACX numbers for it is not.
  expect(resolveMasterTarget({ projectMaster: "custom", projectType: "audiobook" })).toEqual([null, "project"]);
});

// ── 4. the scene render + QC actually master ───────────────────────────

const stubRenderLine = () =>
  vi
    .spyOn(renderCore, "renderLine")
    .mockImplementation(async () => new RenderedLine({ pcm: pcmOf(400, 0x1000), sampleRate: 16000, channels: 1, effectiveDelivery: {} }));

function masterState() {
  const presets = {
    acx: {
      loudness_target_lufs: -20.0,
      true_peak_dbfs: -3.5,
      sample_rate: 44100,
      channels: 1,
      format: "mp3",
      bitrate_kbps: 192,
      head_silence_secs: 0.75,
      tail_silence_secs: 2.0,
    },
  };
  return {
    settings: { get: () => ({ mastering: presets, generation: { pause_between_lines_ms: 600 } }) },
    personas: { get: () => persona("p1") },
  };
}

test("scene_render_masters_to_the_project_target", async () => {
  seedScene({ projectType: "audiobook", mastering: "acx" });
  stubRenderLine();
  vi.spyOn(mastering, "haveFfmpeg").mockReturnValue(true);
  const calls = [];
  vi.spyOn(mastering, "masterToWav").mockImplementation(async (pcm, sr, ch, kw) => {
    calls.push(kw.presetName);
    return Buffer.from("MASTERED");
  });
  const st = masterState();
  appState.cfg.state = st;
  const out = await renderChapterApi.renderSceneToWav(st, "scene-1", { strict: false });
  expect(out.toString()).toBe("MASTERED");
  expect(calls).toEqual(["acx"]);
});

test("game_project_renders_raw", async () => {
  // A game engine wants the line, not a loudness-normalised broadcast master — game_voicelines
  // stays raw on purpose.
  seedScene({ projectType: "game_voicelines" });
  stubRenderLine();
  vi.spyOn(mastering, "haveFfmpeg").mockReturnValue(true);
  vi.spyOn(mastering, "masterToWav").mockImplementation(async () => {
    throw new Error("game renders must not be mastered");
  });
  const st = masterState();
  appState.cfg.state = st;
  const out = await renderChapterApi.renderSceneToWav(st, "scene-1", { strict: false });
  expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
});

test("render_survives_a_missing_ffmpeg", async () => {
  // No ffmpeg must not mean no render — an audiobook project would be unable to produce audio
  // at all.
  seedScene({ projectType: "audiobook", mastering: "acx" });
  stubRenderLine();
  vi.spyOn(mastering, "haveFfmpeg").mockReturnValue(false);
  vi.spyOn(mastering, "masterToWav").mockImplementation(async () => {
    throw new Error("must not shell out without ffmpeg");
  });
  const st = masterState();
  appState.cfg.state = st;
  const out = await renderChapterApi.renderSceneToWav(st, "scene-1", { strict: false });
  expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
});

// ── 5. the endpoints report what they did ──────────────────────────────

/** A JustWrite book imported through POST /v1/projects/import?source=justwrite → its project
 * id (Python's `_seed_book`). */
async function seedBook(c) {
  const payload = bookJson({ premise: "by S. K. H.", chapters: [["ch1", "One", [jwScene("scn1", "Hello.")]]] });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: payload });
  expect(r.status, r.text).toBe(200);
  return r.json().project_id;
}

test("master_target_endpoint_reports_the_resolved_preset", async () => {
  const { c } = await appClient();
  try {
    const pid = await seedBook(c);
    const r = await c.get(`/v1/render/master-target?project_id=${pid}`);
    expect(r.status, r.text).toBe(200);
    const body = r.json();
    expect(body.preset).toBe("acx");
    expect(["project", "kind"]).toContain(body.source);
    // The pill's numbers come from settings, not from a template string.
    expect(body.targets.loudness_target_lufs).toBe(-20.0);
    expect(typeof body.ffmpeg).toBe("boolean");
  } finally {
    await closeApps();
  }
});

test("master_target_endpoint_404s_on_an_unknown_project", async () => {
  const { c } = await appClient();
  try {
    expect((await c.get("/v1/render/master-target?project_id=nope")).status).toBe(404);
  } finally {
    await closeApps();
  }
});
test("qc_says_whether_it_measured_a_mastered_render", async () => {
  // An ACX verdict computed over raw TTS output is a wrong answer. When ffmpeg is missing QC
  // still measures — and says the numbers are raw.
  const { c } = await appClient();
  try {
    const pid = await seedBook(c);
    vi.spyOn(synthScheduler, "warmLines").mockResolvedValue(undefined);
    vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => sineWav());
    const ffmpeg = vi.spyOn(mastering, "haveFfmpeg").mockReturnValue(false);
    let body = (await c.get(`/v1/projects/${pid}/qc`)).json();
    expect(body.master_preset).toBe("acx");
    expect(body.mastered).toBe(false);
    expect(body.note).toContain("ffmpeg");

    ffmpeg.mockReturnValue(true);
    body = (await c.get(`/v1/projects/${pid}/qc`)).json();
    expect(body.mastered).toBe(true);
    expect(body.note).toBeNull();
  } finally {
    await closeApps();
  }
});

/** Mono 16-bit sine (Python's `_sine_wav`). */
function sineWav(amplitude = 0.14, seconds = 1.0, rate = 16000) {
  const n = Math.trunc(rate * seconds);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(amplitude * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 2 * i);
  return writeWavContainer(pcm, rate, 1);
}
