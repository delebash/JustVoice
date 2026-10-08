// SPDX-License-Identifier: MIT
// The persona's data and the one resolver (persona redesign P3, 2026-10-03) — the port of
// tests/test_persona_render.py.
//
// A persona is a finished spoken voice: a voice (with its model) plus how it speaks. Its
// delivery is typed — pace, pitch, gain and pauses for every model, and per model its emotion
// or tags, sampling knobs and seed — and ONE resolver (`persona_render.planLine`) turns a
// persona and a line into the request every render path sends.
//
// Not ported here: the persona API tests (POST/PATCH /v1/personas, merge, preview, usage,
// stock-line, the book's language) — they wait for api/personas_api.js / api/projects_api.js:
// test.todo. The pure and resolver tests run on an app state (`useState`, create_app's state
// half) over the real engine manifests.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
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
afterEach(() => endState());

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

test.todo("a_new_persona_takes_its_voices_language_and_refuses_one_it_cant_speak — waits for api/personas_api.js");
test.todo("patch_changes_what_was_sent_and_null_clears — waits for api/personas_api.js");
test.todo("patch_refuses_a_setting_the_model_does_not_have — waits for api/personas_api.js");
test.todo("changing_the_voice_keeps_a_language_it_still_speaks — waits for api/personas_api.js");
test.todo("merge_moves_the_speakers_and_removes_the_persona — waits for api/personas_api.js + api/speakers_api.js");

// ── Listen ────────────────────────────────────────────────────────────────

test.todo("listen_renders_the_unsaved_draft_through_the_resolver — waits for api/personas_api.js");
test.todo("an_empty_line_speaks_the_stock_line_in_the_personas_language — waits for api/personas_api.js");
test.todo("a_list_play_asks_before_loading_the_model — waits for api/personas_api.js");
test.todo("listen_needs_a_voice — waits for api/personas_api.js");
test.todo("a_persona_read_carries_its_voices_model_and_what_it_speaks — waits for api/personas_api.js");
test.todo("the_stock_line_is_in_the_asked_language_else_english — waits for api/personas_api.js");
test.todo("usage_counts_the_lines_that_carry_their_own_direction — waits for api/personas_api.js + api/projects_api.js");

// ── The book's language ───────────────────────────────────────────────────

test.todo("a_book_keeps_its_language_and_can_clear_it — waits for api/projects_api.js");

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
