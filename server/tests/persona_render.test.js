// SPDX-License-Identifier: MIT
// The persona's data and the one resolver (persona redesign P3, 2026-10-03) — the port of
// tests/test_persona_render.py.
//
// A persona is a finished spoken voice: a voice (with its model) plus how it speaks. Its
// delivery is typed — pace, pitch, gain and pauses for every model, and per model its emotion
// or tags, sampling knobs and seed — and ONE resolver (`persona_render.planLine`) turns a
// persona and a line into the request every render path sends.
//
// The pure and resolver tests run on an app state (`useState`, create_app's state half) over the
// real engine manifests; the persona API tests drive the real app (`api()`).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";
import * as voiceModel from "../src/voice_model.js";
import * as exportVoicelines from "../src/export_voicelines.js";
import { construct, PersonaDelivery, PersonaDraft } from "../src/models.js";
import * as personaRender from "../src/persona_render.js";
import * as renderCore from "../src/render_core.js";
import { _applyLeadTags, RenderedLine } from "../src/render_core.js";
import { unwrap } from "./render_helpers.js";

const draft = (kw = {}) => construct(PersonaDraft, kw);
const pd = (v) => construct(PersonaDelivery, v);

let st;
beforeEach(() => {
  st = useState();
});
afterEach(async () => {
  await closeApps();
  endState();
});

/** The whole app (create_app) in place of this file's bare state. */
async function api() {
  endState();
  return (await appClient()).c;
}

// ── What a persona sets for a model ───────────────────────────────────────

test("shared_values_reach_every_model_and_a_models_own_stay_with_it", () => {
  const d = pd({
    speed: 1.05,
    gain_db: -1.0,
    pause_after: 250,
    models: {
      "qwen3-cv": { knobs: { talker_temperature: 0.7 }, emotion: "angry", seed: 42 },
      "chatterbox-turbo": { knobs: { top_k: 500 }, emotion: "fear", register_tag: "dramatic" },
    },
  });
  const persona = draft({ default_delivery: d });
  const [qwen, qtags, qseed] = personaRender.modelSettings(persona, "qwen3-cv");
  expect(unwrap(qwen.speed)).toBe(1.05);
  expect(unwrap(qwen.gain_db)).toBe(-1.0);
  expect(qwen.pause_after).toBe(250);
  expect(unwrap(qwen.engine)).toEqual({ talker_temperature: 0.7 });
  expect(qwen.emotion).toBe("angry");
  expect(qtags).toEqual([]);
  expect(qseed).toBe(42);
  // Turbo's emotion and register are TAGS for the line, not words.
  const [turbo, ttags, tseed] = personaRender.modelSettings(persona, "chatterbox-turbo");
  expect("emotion" in turbo).toBe(false);
  expect(ttags).toEqual(["fear", "dramatic"]);
  expect(tseed).toBeNull();
  expect(unwrap(turbo.engine)).toEqual({ top_k: 500 });
  // A model with no settings of its own gets the shared values only.
  const [kokoro, ktags] = personaRender.modelSettings(persona, "kokoro");
  expect(unwrap(kokoro)).toEqual({ speed: 1.05, gain_db: -1.0, pause_after: 250 });
  expect(ktags).toEqual([]);
});

test("a_value_a_model_would_not_understand_is_refused_by_name", () => {
  const bad = pd({
    models: {
      "qwen3-cv": { knobs: { exaggeration: 0.5, talker_top_k: 500 }, emotion: "fear" },
      kokoro: { register_tag: "dramatic" },
      nonsense: {},
    },
  });
  const problems = personaRender.checkDelivery(bad).join(" | ");
  expect(problems).toContain("has no exaggeration setting");
  expect(problems).toContain("Top k runs 1–100");
  expect(problems).toContain("no emotion called 'fear'"); // Qwen3 takes the app's nine
  expect(problems).toContain("no register called 'dramatic'"); // Kokoro takes no tags
  expect(problems).toContain("nonsense is not a speech model");
});

test("pace_is_one_range_on_every_model", () => {
  expect(() => pd({ speed: 2.5 })).toThrow();
  expect(() => pd({ pitch: -13 })).toThrow();
});

// ── One line, planned ─────────────────────────────────────────────────────

test("the_direction_is_composed_most_specific_last", async () => {
  const persona = draft({
    voice_id: "Sohee",
    voice_instruct: "Clipped, world-weary",
    default_delivery: pd({ models: { "qwen3-cv": { emotion: "angry" } } }),
  });
  const plan = await personaRender.planLine(st, persona, { text: "You're late.", direction: "edge of irritation" });
  expect(plan.model).toBe("qwen3-cv");
  expect(plan.delivery.instruct).toBe("Clipped, world-weary. angry. edge of irritation");
});

test("a_kokoro_persona_speaks_its_voices_language_whatever_it_was_set_to", async () => {
  const plan = await personaRender.planLine(st, draft({ voice_id: "af_heart", language: "ja" }), { text: "Hi." });
  expect(plan.language).toBe("en-US");
});

test("a_qwen3_persona_speaks_its_own_choice_and_falls_back_to_the_voice", async () => {
  expect((await personaRender.planLine(st, draft({ voice_id: "Ono_Anna", language: "en" }), { text: "." })).language).toBe("en");
  // A language the model can't speak falls back to the voice's own.
  expect((await personaRender.planLine(st, draft({ voice_id: "Ono_Anna", language: "tlh" }), { text: "." })).language).toBe("ja");
});

test("the_plan_carries_effects_lexicons_and_seed", async () => {
  const persona = draft({
    voice_id: "Sohee",
    lexicon_id: "lex-p",
    effects_chain: [{ type: "gain", params: { gain_db: 1 } }],
    default_delivery: pd({ models: { "qwen3-cv": { seed: 7 } } }),
  });
  let plan = await personaRender.planLine(st, persona, { text: ".", bookLexicon: "lex-book" });
  expect(plan.lexicons).toEqual(["lex-book", "lex-p"]);
  expect(plan.effects).toEqual([{ type: "gain", params: { gain_db: 1 } }]);
  expect(plan.seed).toBe(7);
  // A request's seed wins, and leaves the delivery.
  plan = await personaRender.planLine(st, persona, { text: ".", requestDelivery: { seed: 9, speed: 1.2 } });
  expect(plan.seed).toBe(9);
  expect("seed" in plan.delivery).toBe(false);
  expect(unwrap(plan.delivery.speed)).toBe(1.2);
});

test("a_tag_models_tags_lead_the_line_once", () => {
  const out = _applyLeadTags("The tide turned.", { tags: ["fear", "dramatic", "warm"] }, "chatterbox-turbo");
  expect(out).toBe("[fear] [dramatic] The tide turned.");
  expect(_applyLeadTags("[fear] Run.", { tags: ["fear"] }, "chatterbox-turbo")).toBe("[fear] Run.");
  // A model with no tags adds none.
  expect(_applyLeadTags("Run.", { tags: ["fear"] }, "chatterbox-multilingual")).toBe("Run.");
});

// ── The persona API ───────────────────────────────────────────────────────

test("a_new_persona_takes_its_voices_language_and_refuses_one_it_cant_speak", async () => {
  const c = await api();
  let r = await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee" } });
  expect(r.status, r.text).toBe(201);
  expect(r.json().language).toBe("ko");
  r = await c.post("/v1/personas", { json: { name: "Warm", voice_id: "af_heart", language: "ja" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("can't speak ja");
  r = await c.post("/v1/personas", { json: { name: "Ghost", voice_id: "no-such-voice" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("doesn't exist");
});

test("patch_changes_what_was_sent_and_null_clears", async () => {
  const c = await api();
  const pid = (
    await c.post("/v1/personas", {
      json: { name: "June", voice_id: "Sohee", voice_instruct: "Dry wit", note: "low", default_delivery: { speed: 1.1 } },
    })
  ).json().id;
  let r = await c.patch(`/v1/personas/${pid}`, { json: { voice_instruct: null, note: "  " } });
  expect(r.status, r.text).toBe(200);
  const p = r.json();
  expect(p.voice_instruct).toBeNull();
  expect(p.note).toBeNull();
  // Left out = unchanged.
  expect(p.name).toBe("June");
  expect(p.default_delivery.speed).toBe(1.1);
  r = await c.patch(`/v1/personas/${pid}`, { json: { default_delivery: null } });
  expect(r.json().default_delivery).toEqual({ speed: null, pitch: null, gain_db: null, pause_before: null, pause_after: null, models: {} });
});

test("patch_refuses_a_setting_the_model_does_not_have", async () => {
  const c = await api();
  const pid = (await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee" } })).json().id;
  let r = await c.patch(`/v1/personas/${pid}`, { json: { default_delivery: { models: { "qwen3-cv": { knobs: { cfg_value: 2 } } } } } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("no cfg_value setting");
  r = await c.patch(`/v1/personas/${pid}`, { json: { engine_override: "kokoro" } });
  expect(r.status).toBe(422); // the field is gone, not ignored
});

test("changing_the_voice_keeps_a_language_it_still_speaks", async () => {
  const c = await api();
  const pid = (await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee", language: "en" } })).json().id;
  expect((await c.patch(`/v1/personas/${pid}`, { json: { voice_id: "Ono_Anna" } })).json().language).toBe("en");
  // Kokoro's Heart speaks only American English.
  expect((await c.patch(`/v1/personas/${pid}`, { json: { voice_id: "af_heart" } })).json().language).toBe("en-US");
});

test("merge_moves_the_speakers_and_removes_the_persona", async () => {
  const c = await api();
  const a = (await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee" } })).json().id;
  const b = (await c.post("/v1/personas", { json: { name: "Mara", voice_id: "Ono_Anna" } })).json().id;
  const pid = (await c.post("/v1/projects", { json: { name: "Book", project_type: "audiobook" } })).json().id;
  const sid = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "June", persona_id: a } })).json().id;
  const r = await c.post(`/v1/personas/${a}/merge`, { json: { into: b } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().speakers).toBe(1);
  expect((await c.get(`/v1/personas/${a}`)).status).toBe(404);
  const speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(speakers.find((sp) => sp.id === sid).persona_id).toBe(b);
  expect((await c.post(`/v1/personas/${b}/merge`, { json: { into: b } })).status).toBe(400);
});

// ── Listen ────────────────────────────────────────────────────────────────

/** The render seam, faked: records each renderLine call's options. */
function captureRender() {
  const seen = [];
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (_st, kw) => {
    seen.push(kw);
    return new RenderedLine({ pcm: Buffer.alloc(20), sampleRate: 24000, channels: 1, effectiveDelivery: {} });
  });
  return seen;
}

test("listen_renders_the_unsaved_draft_through_the_resolver", async () => {
  const c = await api();
  const seen = captureRender();
  const r = await c.post("/v1/personas/preview", {
    json: {
      persona: { voice_id: "Sohee", language: "en", voice_instruct: "Dry wit", default_delivery: { speed: 1.2 } },
      text: "You're late.",
      direction: "sharp",
    },
  });
  expect(r.status, r.text).toBe(200);
  expect(r.content.subarray(0, 4).toString("latin1")).toBe("RIFF");
  const kw = seen.at(-1);
  expect(kw.voice).toBe("Sohee");
  expect(kw.language).toBe("en");
  expect(kw.text).toBe("You're late.");
  expect(unwrap(kw.delivery.speed)).toBe(1.2);
  expect(kw.delivery.instruct).toBe("Dry wit. sharp");
});

test("an_empty_line_speaks_the_stock_line_in_the_personas_language", async () => {
  const c = await api();
  const seen = captureRender();
  const pid = (await c.post("/v1/personas", { json: { name: "Mara", voice_id: "Ono_Anna" } })).json().id;
  expect((await c.post("/v1/personas/preview", { json: { persona_id: pid } })).status).toBe(200);
  expect(seen.at(-1).text).toBe(personaRender.STOCK_LINES.ja);
});

test("a_list_play_asks_before_loading_the_model", async () => {
  const c = await api();
  const seen = captureRender();
  vi.spyOn(voiceModel, "isModelLoaded").mockReturnValue(false);
  const pid = (await c.post("/v1/personas", { json: { name: "Warm", voice_id: "af_heart" } })).json().id;
  const r = await c.post("/v1/personas/preview", { json: { persona_id: pid, auto_load: false } });
  expect(r.status).toBe(409);
  expect(r.json().detail).toContain("engine_not_loaded:kokoro");
  expect(seen).toEqual([]);
  vi.spyOn(voiceModel, "isModelLoaded").mockReturnValue(true);
  expect((await c.post("/v1/personas/preview", { json: { persona_id: pid, auto_load: false } })).status).toBe(200);
});

test("a_held_take_takes_a_chain_on_the_same_audio", async () => {
  // The chain editor's A / B: ▶ Dry holds the take, ▶ Wet puts the chain on that audio.
  const c = await api();
  const pcm = Buffer.alloc(4800);
  for (let i = 0; i < 2400; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin(i / 8)), i * 2);
  const seen = [];
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (_st, kw) => {
    seen.push(kw);
    return new RenderedLine({ pcm, sampleRate: 24000, channels: 1, effectiveDelivery: {} });
  });
  const r = await c.post("/v1/personas/preview", {
    json: { persona: { voice_id: "Sohee", language: "en", effects_chain: [] }, text: "You're late.", hold: true },
  });
  expect(r.status, r.text).toBe(200);
  const held = r.json();
  expect(seen.at(-1).effects).toEqual([]);
  expect(held.duration_sec).toBeCloseTo(0.1);
  const dry = Buffer.from(held.wav_b64, "base64");
  expect(dry.subarray(0, 4).toString("latin1")).toBe("RIFF");
  const off = await c.post("/v1/effects/apply", { json: { take_id: held.take_id, chain: [] } });
  expect(Buffer.compare(off.content, dry)).toBe(0);
  const wet = await c.post("/v1/effects/apply", { json: { take_id: held.take_id, chain: [{ type: "gain", params: { gain_db: -12 } }] } });
  expect(wet.status, wet.text).toBe(200);
  expect(wet.content.subarray(0, 4).toString("latin1")).toBe("RIFF");
  expect(wet.content.length).toBe(dry.length);
  expect(Buffer.compare(wet.content, dry)).not.toBe(0);
  expect(seen.length).toBe(1); // one render: Wet is the same take
  const gone = await c.post("/v1/effects/apply", { json: { take_id: "lapsed", chain: [] } });
  expect(gone.status).toBe(404);
});

test("listen_needs_a_voice", async () => {
  const c = await api();
  const r = await c.post("/v1/personas/preview", { json: { persona: { name: "Blank" }, text: "Hi" } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("Pick a voice first");
});

test("a_persona_read_carries_its_voices_model_and_what_it_speaks", async () => {
  // One answer for the Personas list, Cast and the persona's page.
  const c = await api();
  const a = (await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee", language: "en" } })).json();
  expect(a.model).toBe("qwen3-cv");
  expect(a.directed_by).toBe("words");
  expect(a.speaks).toBe("en");
  expect(a.model_name).toContain("CustomVoice");
  const b = (await c.post("/v1/personas", { json: { name: "Warm", voice_id: "af_heart" } })).json().id;
  const listed = Object.fromEntries((await c.get("/v1/personas")).json().personas.map((p) => [p.id, p]));
  expect(listed[b].model).toBe("kokoro");
  expect(listed[b].directed_by).toBe("sliders");
  expect(listed[b].speaks.startsWith("en")).toBe(true);
  const blank = (await c.post("/v1/personas", { json: { name: "Blank" } })).json();
  expect(blank.model).toBeNull();
  expect(blank.speaks).toBeNull();
  expect((await c.patch(`/v1/personas/${a.id}`, { json: { note: "Dry" } })).json().model).toBe("qwen3-cv");
});

test("the_stock_line_is_in_the_asked_language_else_english", async () => {
  const c = await api();
  const r = await c.get("/v1/personas/stock-line?language=ja");
  expect(r.status).toBe(200);
  expect(r.json().text).toBe(personaRender.STOCK_LINES.ja);
  expect((await c.get("/v1/personas/stock-line?language=xx")).json().text).toBe(personaRender.STOCK_LINES.en);
  expect((await c.get("/v1/personas/stock-line")).json().text).toBe(personaRender.STOCK_LINES.en);
});

test("usage_counts_the_lines_that_carry_their_own_direction", async () => {
  // The editor's warning when a new voice's model can't perform written direction: "18 carry a
  // written direction — Chatterbox Turbo won't perform them."
  const c = await api();
  const a = (await c.post("/v1/personas", { json: { name: "June", voice_id: "Sohee" } })).json().id;
  const pid = (await c.post("/v1/projects", { json: { name: "Book", project_type: "audiobook" } })).json().id;
  const sid = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "June", persona_id: a } })).json().id;
  const scene = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;
  for (const [i, direction] of ["sharp", null, "", "whispered"].entries()) {
    const r = await c.post(`/v1/scenes/${scene}/blocks`, { json: { position: i, text: `Line ${i}.`, speaker_id: sid, direction } });
    expect(r.status, r.text).toBe(201);
  }
  await c.post(`/v1/scenes/${scene}/blocks`, { json: { position: 9, text: "Someone else.", direction: "loud" } });
  const r = await c.get(`/v1/personas/${a}/usage-detail`);
  expect(r.status, r.text).toBe(200);
  expect(r.json().total_lines).toBe(4);
  expect(r.json().directed_lines).toBe(2);
});

// ── The book's language ───────────────────────────────────────────────────

test("a_book_keeps_its_language_and_can_clear_it", async () => {
  const c = await api();
  let r = await c.post("/v1/projects", { json: { name: "Book", project_type: "audiobook", language: "ja" } });
  const pid = r.json().id;
  expect(r.json().language).toBe("ja");
  expect((await c.patch(`/v1/projects/${pid}`, { json: { language: "en" } })).json().language).toBe("en");
  r = await c.patch(`/v1/projects/${pid}`, { json: { language: null } });
  expect(r.json().language).toBeNull();
  expect("language" in r.json().metadata).toBe(false);
});

// ── The single-line door uses the same plan ───────────────────────────────

test("a_lines_rerender_carries_the_direction_and_language", async () => {
  const seen = [];
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    seen.push(kw);
    return new RenderedLine({ pcm: Buffer.alloc(20), sampleRate: 24000, channels: 1, effectiveDelivery: {} });
  });
  vi.spyOn(exportVoicelines, "_bookLexiconId").mockReturnValue(null);
  const persona = st.personas.create("June", { voice_id: "Sohee", default_delivery: { speed: 1.1 }, voice_instruct: "Dry wit", language: "en" });
  const block = { id: "b1", scene_id: "s1", text: "You're late.", direction: "sharp" };
  await exportVoicelines._renderBlockProduction(st, { id: persona.id, name: "June" }, block);
  const kw = seen.at(-1);
  expect(kw.language).toBe("en");
  expect(kw.delivery.instruct).toBe("Dry wit. sharp");
  expect(unwrap(kw.delivery.speed)).toBe(1.1);
});
