// SPDX-License-Identifier: MIT
// The server side of the persona page's voice makers (decided 2026-10-04,
// docs/plans/2026-10-04-persona-voice-making.md §3) — the port of
// tests/test_persona_voice_makers.py.
//
// A persona makes its own voice: Clone, Design and Blend open on the persona's page, and a
// voice not kept yet is heard *as this persona* through the same planning and text preparation
// a chapter line gets.
//
// Not ported here: the candidate preview, keep, clip-check, design and clone tests — they drive
// api/personas_api.js, api/voice_preview_api.js and api/voices_api.js: test.todo. The planning
// of an unsaved design is this module's.
import { afterEach, beforeEach, expect, test } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { construct, PersonaDraft } from "../src/models.js";
import * as personaRender from "../src/persona_render.js";
import * as voiceModel from "../src/voice_model.js";

let st;
beforeEach(() => {
  st = useState();
});
afterEach(() => endState());

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

test.todo("an_unsaved_voice_is_heard_as_the_persona_and_its_take_is_held — waits for api/personas_api.js + api/voice_preview_api.js");
test.todo("an_unsaved_voice_without_its_material_is_refused — waits for api/personas_api.js");

// ── Keeping a design's take on another model ──────────────────────────────

test.todo("a_designs_take_is_kept_on_another_clone_model_and_stays_a_design — waits for api/voice_preview_api.js");
test.todo("only_a_design_moves_and_only_onto_a_model_that_clones — waits for api/voice_preview_api.js");

// ── The clip check ────────────────────────────────────────────────────────

test.todo("the_clip_check_measures_length_and_how_far_speech_stands_above_noise — waits for api/voices_api.js");
test.todo("the_clip_check_wants_a_wav — waits for api/voices_api.js");

// ── A designed voice sends its description ────────────────────────────────

test.todo("a_designed_voice_sends_its_description_and_a_clone_none — waits for api/voices_api.js");
