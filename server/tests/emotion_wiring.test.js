// SPDX-License-Identifier: MIT
// `Delivery.emotion` reaches an engine, and `style_prompt` no longer exists (the port of
// tests/test_emotion_wiring.py).
//
// Emotion was declared, merged, composed and never written by anything. It is also the only
// direction control with a cross-engine meaning: prose can be folded into `instruct` for the
// families that read prose, but a labelled enum can ALSO compile into a token for a family that
// has an emotion vocabulary — Chatterbox Turbo, whose own capability row's emotion set drives
// the compilation here. `style_prompt` went the other way: Qwen has exactly one instruct slot,
// and the standing-vs-this-line axis it reached for is persona-vs-line.
//
// Source-level tests read the JavaScript modules' own text (Python's inspect.getsource).
import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import "./engines_helpers.js";
import { composeInstruct } from "../src/delivery_merge.js";
import { CAPABILITY_DETAILS } from "../src/engines/capability_details.js";
import { construct, Delivery, Emotion, EMOTION_VALUES, EngineCapabilityDetail, modelDump, modelFields } from "../src/models.js";
import { _applyEmotionTag, _emotionTagset, prepareLineText, probeLineCached, renderLine } from "../src/render_core.js";

afterEach(closeApps);

const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

// Chatterbox Turbo's emotion set — the shape `_applyEmotionTag` compiles against.
const TURBO_EMOTION = CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags[0];

// ── composeInstruct — one slot, most specific last ────────────────────

test("hints_join_most_specific_last", () => {
  expect(composeInstruct("weary harbour-master", "angry", "shouting over wind")).toBe("weary harbour-master. angry. shouting over wind");
});

test("a_lone_hint_passes_through_verbatim", () => {
  // Joining one item must not reformat a hand-written instruct — its trailing punctuation is the
  // author's, not ours.
  expect(composeInstruct("Clipped, world-weary noir delivery.")).toBe("Clipped, world-weary noir delivery.");
});

test("blanks_drop_out_rather_than_leaving_empty_clauses", () => {
  expect(composeInstruct(null, "angry", "")).toBe("angry");
  expect(composeInstruct(null, null, null)).toBeNull();
});

test("trailing_punctuation_is_not_doubled_when_joining", () => {
  expect(composeInstruct("weary.", "angry")).toBe("weary. angry");
});

test("both_render_paths_compose_with_the_same_function", () => {
  // The chapter path composed and the one-off path did not, so the same persona sounded
  // different depending on which button was pressed. One resolver composes for a persona
  // (2026-10-03): the chapter render, the single line and Generate-with-a-persona all call it —
  // the first two through line_takes.planBlock (Slice 4) — and Generate composes the same way
  // for a bare voice.
  expect(src("persona_render.js")).toContain("composeInstruct");
  expect(src("line_takes.js")).toContain("planLine(");
  expect(src("api/render_chapter_api.js")).toContain("planBlock(");
  expect(src("export_voicelines.js")).toContain("planBlock(");
  expect(src("api/generate_api.js")).toContain("planLine(");
  expect(src("api/generate_api.js")).toContain("composeInstruct");
});

// ── The tag compilation ────────────────────────────────────────────────

test("a_mapped_emotion_is_prefixed_as_this_engines_token", () => {
  expect(_applyEmotionTag("You're late.", { emotion: "angry" }, TURBO_EMOTION)).toBe("[angry] You're late.");
});

test("the_map_translates_rather_than_passing_the_enum_through", () => {
  // Our value is `fearful`; Turbo's token is `[fear]`.
  expect(_applyEmotionTag("Who's there?", { emotion: "fearful" }, TURBO_EMOTION)).toBe("[fear] Who's there?");
  expect(_applyEmotionTag("Quiet.", { emotion: "whispered" }, TURBO_EMOTION)).toBe("[whispering] Quiet.");
});

test("neutral_is_expressible_by_adding_nothing", () => {
  expect("neutral" in TURBO_EMOTION.value_map).toBe(true);
  expect(_applyEmotionTag("A line.", { emotion: "neutral" }, TURBO_EMOTION)).toBe("A line.");
});

test("an_unmapped_emotion_emits_nothing_rather_than_a_near_neighbour", () => {
  // Turbo has no token for these. `[crying]` is a behaviour, not `sad`'s state — mapping it
  // would put sobbing into a quietly sad line.
  for (const value of ["sad", "shouted", "contemptuous"]) {
    expect(EMOTION_VALUES).toContain(value);
    expect(value in TURBO_EMOTION.value_map).toBe(false);
    expect(_applyEmotionTag("A line.", { emotion: value }, TURBO_EMOTION)).toBe("A line.");
  }
});

test("no_emotion_and_no_tagset_are_both_no_ops", () => {
  expect(_applyEmotionTag("A line.", {}, TURBO_EMOTION)).toBe("A line.");
  expect(_applyEmotionTag("A line.", { emotion: "angry" }, null)).toBe("A line.");
});

// ── No engine's default variant has an emotion vocabulary ──────────────

test("no_shipped_engine_has_an_emotion_tagset_yet", () => {
  for (const engineId of ["kokoro", "qwen3", "chatterbox"]) expect(_emotionTagset(engineId), engineId).toBeNull();
});

// ── Declaration integrity ──────────────────────────────────────────────

test("every_mapped_tag_is_one_this_engine_actually_declares", () => {
  for (const [capId, detail] of Object.entries(CAPABILITY_DETAILS)) {
    for (const tagset of detail.inline_tags) {
      for (const [enumValue, tag] of Object.entries(tagset.value_map || {})) {
        expect(EMOTION_VALUES, `${capId}: ${enumValue} is not an Emotion`).toContain(enumValue);
        expect(tag === "" || tagset.tags.includes(tag), `${capId}: value_map sends ${enumValue} to '${tag}'`).toBe(true);
      }
    }
  }
});

test("a_value_map_only_ever_hangs_off_an_emotion_set", () => {
  // `Delivery.emotion` is the only field with a cross-engine equivalent; a map on a speaker or
  // pause set would have nothing to translate.
  for (const [capId, detail] of Object.entries(CAPABILITY_DETAILS)) {
    for (const tagset of detail.inline_tags) {
      if (tagset.value_map && Object.keys(tagset.value_map).length) expect(tagset.category, `${capId}/${tagset.category}`).toBe("emotion");
    }
  }
});

test("the_emotion_vocabulary_is_derived_from_the_enum", () => {
  expect(EMOTION_VALUES).toEqual(Emotion.anyOf.map((s) => s.const));
});

test("the_capabilities_endpoint_serves_the_vocabulary", async () => {
  // Served rather than duplicated in the renderer, so the picker cannot offer a value the
  // server would reject.
  const { c } = await appClient();
  const body = (await c.get("/v1/engines/capabilities")).json();
  expect(body.emotion_values).toEqual(EMOTION_VALUES);
});

// ── The probe must keep lying-free parity with the render ──────────────

test("the_cache_probe_applies_every_transform_the_render_does", () => {
  // `probeLineCached` claims to mirror `renderLine`'s key derivation byte-for-byte. A transform
  // added to one and not the other makes the probe report a hit that the render will miss.
  // Since 2026-10-04 both run ONE function, `prepareLineText`, so they can't drift.
  const probe = probeLineCached.toString();
  const render = renderLine.toString();
  expect(probe).toContain("prepareLineText(");
  expect(render).toContain("prepareLineText(");
  const prepare = prepareLineText.toString();
  for (const transform of ["performableText", "_applyLexicons", "_applyLeadTags", "_applyEmotionTag"]) {
    expect(prepare, `${transform} missing from prepareLineText`).toContain(transform);
  }
});

// ── style_prompt is gone from the schema, not merely hidden ────────────

test("delivery_has_no_style_prompt_field", () => {
  const fields = modelFields(Delivery);
  expect(fields).not.toContain("style_prompt");
  expect(fields).toContain("instruct");
  expect(fields).toContain("emotion");
});

test("no_engine_advertises_a_style_prompt", () => {
  expect(modelFields(EngineCapabilityDetail)).not.toContain("supports_style_prompt");
  for (const [capId, detail] of Object.entries(CAPABILITY_DETAILS)) expect("supports_style_prompt" in detail, capId).toBe(false);
});

test("a_style_prompt_in_a_request_is_rejected_not_silently_kept", () => {
  // Unknown keys are dropped; what matters is that nothing downstream can resurrect it from a
  // stored delivery.
  const d = construct(Delivery, { instruct: "weary", style_prompt: "x" });
  expect("style_prompt" in d).toBe(false);
  expect("style_prompt" in modelDump(Delivery, d)).toBe(false);
});
