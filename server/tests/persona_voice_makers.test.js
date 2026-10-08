// SPDX-License-Identifier: MIT
// The server side of the persona page's voice makers (decided 2026-10-04,
// docs/plans/2026-10-04-persona-voice-making.md §3) — the port of
// tests/test_persona_voice_makers.py.
//
// A persona makes its own voice: Clone, Design and Blend open on the persona's page, and a
// voice not kept yet is heard *as this persona* through the same planning and text preparation
// a chapter line gets.
//
// The planning test runs on this module's state (`useState`); the candidate preview, keep,
// clip-check, design and clone tests drive the real app (`client`, create_app as Python's
// fixture). Python's numpy noise (default_rng(7)) is a seeded Gaussian here — another draw of
// the same noise, which the clip check's thresholds are wide enough for.
import { existsSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";
import * as vp from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import { construct, PersonaDraft } from "../src/models.js";
import * as personaRender from "../src/persona_render.js";
import * as voiceModel from "../src/voice_model.js";
import { tmpPath } from "./helpers.js";

let st;
beforeEach(() => {
  st = useState();
});
afterEach(async () => {
  await closeApps();
  endState();
});

/** The whole app (create_app) in place of this file's bare state. The candidate clips go to a
 * temp folder of the test's own. */
async function client() {
  endState();
  const tmp = tmpPath();
  vi.stubEnv("TEMP", tmp);
  vi.stubEnv("TMP", tmp);
  vi.stubEnv("TMPDIR", tmp);
  return (await appClient()).c;
}

function toneWav(seconds = 1.0, amplitude = 0.2, sampleRate = 24000) {
  const n = Math.trunc(seconds * sampleRate);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * amplitude * 32767), 2 * i);
  return writeWavContainer(pcm, sampleRate, 1);
}

/** The largest absolute sample of a WAV. */
function peak(wav) {
  const [, offset, size] = parseWavHeader(wav);
  let m = 0;
  for (let i = offset; i + 1 < offset + size; i += 2) m = Math.max(m, Math.abs(wav.readInt16LE(i)));
  return m;
}

// ── Planning an unsaved voice ─────────────────────────────────────────────

test("an_unsaved_design_is_planned_with_its_description_first", async () => {
  const vm = voiceModel.describe(st, "qwen3", "qwen3-vd", "en");
  const plan = await personaRender.planLine(st, construct(PersonaDraft, { voice_instruct: "Slow, unbothered.", language: "en" }), {
    text: ".",
    candidate: new personaRender.Candidate(vm, "A gravel-voiced harbour-master", "en"),
  });
  expect(plan.voice).toBeNull();
  expect(plan.model).toBe("qwen3-vd");
  expect(plan.delivery.instruct).toBe("A gravel-voiced harbour-master. Slow, unbothered");
  expect(plan.language).toBe("en");
});

// ── Hearing it as the persona ─────────────────────────────────────────────

test("an_unsaved_voice_is_heard_as_the_persona_and_its_take_is_held", async () => {
  const c = await client();
  const raw = toneWav();
  const heard = [];
  vi.spyOn(vp, "synthCandidate").mockImplementation(async (_body, _engine, kw) => {
    heard.push(kw);
    return [raw, 24000, 1];
  });
  const r = await c.post("/v1/personas/preview-candidate", {
    json: {
      persona: { language: "en", voice_instruct: "Slow, unbothered.", effects_chain: [{ type: "gain", params: { gain_db: 6 } }] },
      candidate: { engine: "qwen3", model: "qwen3-vd", source: "designed", prompt: "A gravel-voiced harbour-master", language: "en" },
      text: "Mind the rope.",
    },
  });
  expect(r.status, r.text).toBe(200);
  const body = r.json();

  // The model was sent the line as a chapter would send it, in the persona's words.
  const sent = heard.at(-1);
  expect(sent.text).toBe("Mind the rope.");
  expect(sent.language).toBe("en");
  expect(sent.delivery.instruct).toBe("A gravel-voiced harbour-master. Slow, unbothered");

  // The take is held as the model spoke it — that is what Keep saves …
  const entry = await vp._getPreview(body.preview_id);
  expect(entry).not.toBeNull();
  expect(entry.wavBytes.equals(raw)).toBe(true);
  expect(entry.payload.preview_text).toBe("Mind the rope.");
  expect(entry.payload.prompt).toBeTruthy();

  // … and what plays is that take shaped by the persona (here, +6 dB).
  expect(peak(Buffer.from(body.wav_b64, "base64"))).toBeGreaterThan(peak(raw) * 1.5);
});

test("an_unsaved_voice_without_its_material_is_refused", async () => {
  const c = await client();
  const r = await c.post("/v1/personas/preview-candidate", {
    json: { persona: { language: "en" }, candidate: { engine: "qwen3", model: "qwen3-vd", source: "designed" } },
  });
  expect(r.status).toBe(400);
  expect(r.text).toContain("prompt");
});

// ── Keeping a design's take on another model ──────────────────────────────

const held = async (source, payload) => (await vp.storeCandidate(source, payload, toneWav()))[0];

test("a_designs_take_is_kept_on_another_clone_model_and_stays_a_design", async () => {
  const c = await client();
  const pid = await held("designed", { engine: "qwen3", model: "qwen3-vd", prompt: "A harbour-master", preview_text: "Mind the rope.", language: "en" });
  const r = await c.post(`/v1/voices/preview/${pid}/save`, { json: { name: "Harbour-master", model: "voxcpm2" } });
  expect(r.status, r.text).toBe(200);
  const vid = r.json().voice_id;

  const rec = getState().voices.get(vid);
  expect([rec.engine, rec.model, rec.source]).toEqual(["voxcpm2", "voxcpm2", "designed"]);
  expect(rec.design_prompt).toBe("A harbour-master");
  expect(rec.transcript).toBe("Mind the rope.");
  expect(existsSync(getState().voices.refWavPath(vid))).toBe(true);

  const dto = (await c.get(`/v1/voices/${vid}`)).json();
  expect(dto.model).toBe("voxcpm2");
  expect(dto.directed_by).toBe("words");
  expect(dto.design_prompt).toBe("A harbour-master");
});

test("only_a_design_moves_and_only_onto_a_model_that_clones", async () => {
  const c = await client();
  const clip = toneWav().toString("base64");
  const cloned = await held("cloned", { engine: "chatterbox", model: "chatterbox-turbo", ref_wav_b64: clip, language: "en" });
  let r = await c.post(`/v1/voices/preview/${cloned}/save`, { json: { name: "Marius", model: "voxcpm2" } });
  expect(r.status).toBe(400);
  expect(r.text).toContain("design");

  const designed = await held("designed", { engine: "qwen3", model: "qwen3-vd", prompt: "A voice", language: "en" });
  r = await c.post(`/v1/voices/preview/${designed}/save`, { json: { name: "Nope", model: "kokoro" } });
  expect(r.status).toBe(400);
  expect(r.text).toContain("clip");
});

// ── The clip check ────────────────────────────────────────────────────────

/** A seeded Gaussian draw (mulberry32 + Box–Muller) standing in for numpy's default_rng(7). */
function gaussian(seed) {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

/** Bursts of 'speech' (a loud tone) over a room of steady noise, as base64 WAV. */
function speechAndRoom(noise, seconds = 3.0, sampleRate = 16000) {
  const normal = gaussian(7);
  const n = Math.trunc(seconds * sampleRate);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const talking = Math.sin(2 * Math.PI * 2.0 * t) > 0.2 ? 1 : 0;
    const speech = Math.sin(2 * Math.PI * 180 * t) * 0.3 * 32767 * talking;
    const v = Math.max(-32767, Math.min(32767, normal() * noise + speech));
    pcm.writeInt16LE(Math.trunc(v), 2 * i);
  }
  return writeWavContainer(pcm, sampleRate, 1).toString("base64");
}

test("the_clip_check_measures_length_and_how_far_speech_stands_above_noise", async () => {
  const c = await client();
  const clean = (await c.post("/v1/voices/clip-check", { json: { wav_b64: speechAndRoom(8) } })).json();
  expect(clean.seconds).toBe(3.0);
  expect(clean.noise_margin_db).toBeGreaterThan(40);

  const noisy = (await c.post("/v1/voices/clip-check", { json: { wav_b64: speechAndRoom(3000) } })).json();
  expect(noisy.noise_margin_db).toBeLessThan(25);
});

test("the_clip_check_wants_a_wav", async () => {
  const c = await client();
  const r = await c.post("/v1/voices/clip-check", { json: { wav_b64: Buffer.from("ID3 not a wav").toString("base64") } });
  expect(r.status).toBe(400);
});

// ── A designed voice sends its description ────────────────────────────────

test("a_designed_voice_sends_its_description_and_a_clone_none", async () => {
  const c = await client();
  const designed = await c.post("/v1/voices/design", {
    json: { engine: "qwen3", model: "qwen3-vd", name: "Old Crow", prompt: "A dry, cracked old voice", language: "en" },
  });
  expect(designed.status, designed.text).toBe(201);
  expect(designed.json().design_prompt).toBe("A dry, cracked old voice");

  const cloned = await c.post("/v1/voices/clone", {
    json: { engine: "chatterbox", model: "chatterbox-multilingual", name: "Marius", ref_wav_b64: toneWav().toString("base64"), language: "en" },
  });
  expect(cloned.status, cloned.text).toBe(201);
  expect(cloned.json().design_prompt).toBeNull();
});
