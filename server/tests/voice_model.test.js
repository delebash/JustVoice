// SPDX-License-Identifier: MIT
// A voice knows its model (persona redesign P1, 2026-10-03) — the port of
// tests/test_voice_model.py.
//
// Until this, a voice stored only its engine: a Chatterbox Turbo clone and a Multilingual clone
// were the same voice to the app, and tags, knobs and the render followed whichever model
// happened to be loaded. Now every voice names the model that speaks it — one server answer
// (`voice_model.js`) for the Voices table, the persona editor, Cast and the render.
//
// The voice list, clone, design and copy go through the real app (`appClient`).
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import { getState } from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines } from "../src/engines/manager.js";
import * as vmod from "../src/voice_model.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(closeApps);

const SR = 24000;

/** A 220 Hz tone, `seconds` long, as a 16-bit mono WAV. */
function wav(seconds) {
  const n = Math.trunc(SR * seconds);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(8000 * Math.sin((2 * Math.PI * 220 * i) / SR)), 2 * i);
  return writeWavContainer(pcm, SR, 1);
}

const b64 = (buf) => buf.toString("base64");

async function voices(c) {
  const r = await c.get("/v1/voices");
  expect(r.status, r.text).toBe(200);
  return Object.fromEntries(r.json().voices.map((v) => [v.id, v]));
}

// ── Every voice ships what speaks it ──────────────────────────────────────

test("a_qwen3_speaker_is_directed_in_words_and_speaks_many_languages", async () => {
  const { c } = await appClient();
  const sohee = (await voices(c)).Sohee;
  expect(sohee.model).toBe("qwen3-cv");
  expect(sohee.directed_by).toBe("words");
  expect(sohee.speaks).toContain("ko");
  expect(sohee.speaks).toContain("en");
  expect(sohee.speaks.length).toBeGreaterThan(1);
  expect(sohee.model_name).toContain("CustomVoice");
});

test("a_kokoro_voice_speaks_only_its_own_language", async () => {
  const { c } = await appClient();
  const heart = (await voices(c)).af_heart;
  expect(heart.model).toBe("kokoro");
  expect(heart.directed_by).toBe("sliders");
  expect(heart.speaks).toEqual([heart.language]);
});

test("a_clone_stores_the_model_it_was_made_for", async () => {
  const { c } = await appClient();
  const r = await c.post("/v1/voices/clone", {
    json: { engine: "chatterbox", model: "chatterbox-multilingual", name: "Marius", ref_wav_b64: b64(wav(6)), language: "en" },
  });
  expect(r.status, r.text).toBe(201);
  const v = r.json();
  expect(v.model).toBe("chatterbox-multilingual");
  expect(v.directed_by).toBe("sliders");
  expect(v.speaks.length).toBeGreaterThan(1);
  expect(getState().voices.get(v.id).model).toBe("chatterbox-multilingual");
});

test("a_clone_without_a_model_gets_the_engines_default_cloning_model", async () => {
  const { c } = await appClient();
  const r = await c.post("/v1/voices/clone", {
    json: { engine: "qwen3", name: "Mara", transcript: "Hello there.", ref_wav_b64: b64(wav(4)) },
  });
  expect(r.status, r.text).toBe(201);
  // CustomVoice is Qwen3's default model but cannot clone; Base can.
  expect(r.json().model).toBe("qwen3-base");
});

test("a_model_that_cannot_do_it_is_refused_by_name", async () => {
  const { c } = await appClient();
  let r = await c.post("/v1/voices/clone", { json: { engine: "qwen3", model: "qwen3-cv", name: "X", ref_wav_b64: b64(wav(4)) } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("can't clone");
  r = await c.post("/v1/voices/clone", { json: { engine: "qwen3", model: "kokoro", name: "X", ref_wav_b64: b64(wav(4)) } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("not a qwen3 model");
});

test("a_designed_voice_without_its_clip_is_voicedesign_and_with_it_base", async () => {
  const { c } = await appClient();
  const r = await c.post("/v1/voices/design", { json: { engine: "qwen3", name: "Harbourmaster", prompt: "a gravel-voiced harbour-master" } });
  expect(r.status, r.text).toBe(201);
  const v = r.json();
  expect(v.model).toBe("qwen3-vd");
  expect(v.directed_by).toBe("words");
  // Clip wins: freeze its preview and it speaks on Base, directed by nothing.
  getState().voices.writeRefWav(v.id, wav(3));
  const again = (await voices(c))[v.id];
  expect(again.model).toBe("qwen3-base");
  expect(again.directed_by).toBe("sliders");
});

// ── Copy to another model ─────────────────────────────────────────────────

async function clone(c, seconds = 6.0, extra = {}) {
  const body = { engine: "chatterbox", model: "chatterbox-multilingual", name: "Marius", ref_wav_b64: b64(wav(seconds)), language: "en", ...extra };
  const r = await c.post("/v1/voices/clone", { json: body });
  expect(r.status, r.text).toBe(201);
  return r.json();
}

test("copying_a_clip_to_another_model_makes_a_second_voice", async () => {
  const { c } = await appClient();
  const src = await clone(c);
  const r = await c.post(`/v1/voices/${src.id}/copy`, { json: { model: "qwen3-base", xvector_only: true } });
  expect(r.status, r.text).toBe(201);
  const copy = r.json();
  expect(copy.id).not.toBe(src.id);
  expect(copy.engine).toBe("qwen3");
  expect(copy.model).toBe("qwen3-base");
  expect(copy.name).toBe("Marius (Qwen3-TTS Base)");
  const st = getState();
  expect(readFileSync(st.voices.refWavPath(copy.id)).equals(readFileSync(st.voices.refWavPath(src.id)))).toBe(true);
  expect(st.voices.get(copy.id).xvector_only).toBe(true);
});

test("qwen3_base_needs_the_clips_words_or_skip_the_words", async () => {
  const { c } = await appClient();
  const src = await clone(c);
  let r = await c.post(`/v1/voices/${src.id}/copy`, { json: { model: "qwen3-base" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("Skip the words");
  r = await c.post(`/v1/voices/${src.id}/copy`, { json: { model: "qwen3-base", transcript: "The tide turned below the floorboards." } });
  expect(r.status, r.text).toBe(201);
});

test("a_model_that_cannot_clone_is_refused", async () => {
  const { c } = await appClient();
  const src = await clone(c);
  const r = await c.post(`/v1/voices/${src.id}/copy`, { json: { model: "qwen3-cv" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("can't clone");
});

test("a_voice_with_no_clip_cannot_be_copied", async () => {
  const { c } = await appClient();
  let r = await c.post("/v1/voices/design", { json: { engine: "qwen3", name: "Wren", prompt: "a bright young voice" } });
  r = await c.post(`/v1/voices/${r.json().id}/copy`, { json: { model: "voxcpm2" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("no clip");
});

test("turbo_and_nano_need_a_clip_longer_than_five_seconds", async () => {
  // Turbo isn't in the pinned runtime yet, so its catalog row is put in.
  const { c } = await appClient();
  const real = vmod.modelsOfEngine;
  vi.spyOn(vmod, "modelsOfEngine").mockImplementation((e) => [...real(e), ...(e === "chatterbox" ? ["chatterbox-turbo"] : [])]);
  const src = await clone(c, 4.0);
  const r = await c.post(`/v1/voices/${src.id}/copy`, { json: { model: "chatterbox-turbo" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("longer than 5 seconds");
  expect(r.json().detail).toContain("4.0 s");
});

// ── The variant a render loads ────────────────────────────────────────────

test("the_variant_follows_the_model_and_keeps_the_size", () => {
  const engines = discoverEngines();
  const mgr = {
    currentFor: () => null,
    currentVariantId: () => null,
    resolvedDefaultVariant: () => "qwen3-cv-0.6b-q8",
    manifests: () => engines,
    getManifest: (e) => engines.get(e) ?? null,
  };
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  vi.spyOn(vmod, "_onDisk").mockImplementation((e, v) => ["qwen3-base-1.7b-q8", "qwen3-base-0.6b-q8"].includes(v));
  // The user's 0.6B default is CustomVoice; a Base voice gets Base 0.6B.
  expect(vmod.variantForModel("qwen3", "qwen3-base")).toBe("qwen3-base-0.6b-q8");
  // Nothing of the family on disk: the same pick among its catalog rows, and the load fetches
  // the file.
  vi.spyOn(vmod, "_onDisk").mockReturnValue(false);
  expect(vmod.variantForModel("qwen3", "qwen3-vd").startsWith("qwen3-vd-")).toBe(true);
});

test("pocket_picks_its_model_by_language", () => {
  vi.spyOn(vmod, "_onDisk").mockReturnValue(true);
  expect(vmod.variantForModel("pocket", "pocket", "de-DE").startsWith("pocket-de-")).toBe(true);
  expect(() => vmod.variantForModel("pocket", "pocket", "ja")).toThrow(vmod.ModelUnavailable);
});

test("a_load_is_noted_while_it_runs", async () => {
  // Render's loading words (2026-10-07): `loadingNow` names the model a line is loading and
  // for how long, and nothing outside a load.
  expect(vmod.loadingNow()).toBeNull();
  await vmod._notingLoad("kokoro", "kokoro-82m", async () => {
    const now = vmod.loadingNow();
    expect(Boolean(now.model)).toBe(true);
    expect(now.seconds).toBeGreaterThanOrEqual(0);
  });
  expect(vmod.loadingNow()).toBeNull();
});
