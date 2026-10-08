// SPDX-License-Identifier: MIT
// A line's own settings for its model — emotion, a tag model's register, the model's own knobs
// (decided 2026-10-06: Render works like the persona page) — the port of
// tests/test_line_model_settings.py.
//
// Pins: the line keeps them per model, merged the hatch's way (a value sets, null clears, a key
// left out is kept); the render reads the line's over the persona's, in the model's own
// vocabulary (words or a tag); "" is none on the line; a setting makes the line stale.
//
// The two tests that went through the line's endpoints use the shim in render_helpers.js (the
// routes are the API wave's; see line_takes.test.js).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { LINE_MODELS, mergeOverride } from "../src/line_takes.js";
import { modelSettings } from "../src/persona_render.js";
import * as renderCore from "../src/render_core.js";
import { lineInputsKey, RenderedLine } from "../src/render_core.js";
import { book, lines, patchLineOverride, renderBlock, states, unwrap } from "./render_helpers.js";

const persona = (models) => ({ default_delivery: { models } });

/** A knob's value wherever nestEngineKeys put it. */
function find(d, key) {
  if (d && key in d) return unwrap(d[key]);
  for (const v of Object.values(d || {})) {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const found = find(v, key);
      if (found != null) return found;
    }
  }
  return null;
}

// ── Merging ──────────────────────────────────────────────────────────────

test("models_merge_like_the_hatch", () => {
  let meta = mergeOverride({}, { models: { chatterbox: { knobs: { exaggeration: 0.8 }, emotion: "sad" } } });
  meta = mergeOverride(meta, { models: { chatterbox: { knobs: { cfg_weight: 0.3 } } } });
  expect(unwrap(meta[LINE_MODELS])).toEqual({ chatterbox: { knobs: { exaggeration: 0.8, cfg_weight: 0.3 }, emotion: "sad" } });
  meta = mergeOverride(meta, { models: { chatterbox: { knobs: { exaggeration: null }, emotion: null } } });
  expect(unwrap(meta[LINE_MODELS])).toEqual({ chatterbox: { knobs: { cfg_weight: 0.3 } } });
  meta = mergeOverride(meta, { models: { chatterbox: null } });
  expect(LINE_MODELS in meta).toBe(false);
  meta = mergeOverride({ speed: 1.2 }, { models: { kokoro: { emotion: "" } } });
  expect(mergeOverride(meta, { models: null })).toEqual({ speed: 1.2 });
});

test("a_bad_setting_is_refused", () => {
  for (const bad of [{ chatterbox: { knobs: { exaggeration: "loud" } } }, { chatterbox: { volume: 2 } }, "x"]) {
    expect(() => mergeOverride({}, { models: bad }), JSON.stringify(bad)).toThrow();
  }
});

// ── The render reads the line's over the persona's ───────────────────────

test("a_words_models_emotion_and_knobs", () => {
  const p = persona({ "qwen3-base": { emotion: "happy", knobs: { talker_temperature: 0.7 } } });
  let [d, tags] = modelSettings(p, "qwen3-base");
  expect(d.emotion).toBe("happy");
  expect(find(d, "talker_temperature")).toBe(0.7);
  [d] = modelSettings(p, "qwen3-base", { emotion: "sad", knobs: { talker_temperature: 0.4 } });
  expect(d.emotion).toBe("sad");
  expect(find(d, "talker_temperature")).toBe(0.4);
  [d] = modelSettings(p, "qwen3-base", { emotion: "" });
  expect("emotion" in d).toBe(false);
  expect(tags).toEqual([]);
});

test("a_tag_models_emotion_and_register_are_tags", () => {
  const p = persona({ "chatterbox-turbo": { emotion: "laugh", register_tag: "narration" } });
  let [, tags] = modelSettings(p, "chatterbox-turbo");
  expect([...tags].sort()).toEqual(["laugh", "narration"]);
  let d;
  [d, tags] = modelSettings(p, "chatterbox-turbo", { emotion: "sigh", register_tag: "" });
  expect(tags).toEqual(["sigh"]);
  expect("emotion" in d).toBe(false);
});

// ── Through the line's own endpoint ──────────────────────────────────────

let st;
let calls;
beforeEach(() => {
  st = useState();
  calls = [];
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    calls.push(kw);
    const key = await lineInputsKey(s, kw.voice, kw.text, kw);
    return new RenderedLine({ pcm: Buffer.alloc(200), sampleRate: 16000, channels: 1, effectiveDelivery: { ...(kw.delivery || {}) }, inputsKey: key || "", seed: kw.seed ?? null });
  });
});
afterEach(() => endState());

test("another_models_line_settings_never_reach_this_model", async () => {
  const b = book(st, ["One."]);
  patchLineOverride(b.blocks[0], { models: { chatterbox: { knobs: { exaggeration: 1.5 } } } });
  await renderBlock(st, b.blocks[0]);
  expect(find(calls.at(-1).delivery || {}, "exaggeration")).toBeNull(); // the persona is on Kokoro
});

test("a_line_setting_is_shown_and_makes_the_line_stale", async () => {
  const b = book(st, ["One."]);
  const [b0] = b.blocks;
  await renderBlock(st, b0);
  expect(await states(st, b.sid)).toEqual(["rendered"]);
  patchLineOverride(b0, { models: { kokoro: { emotion: "sad" } } });
  expect((await lines(st, b.sid)).lines[0].override).toEqual({ models: { kokoro: { emotion: "sad" } } });
  expect(await states(st, b.sid)).toEqual(["stale"]);
  patchLineOverride(b0, { models: null });
  expect(await states(st, b.sid)).toEqual(["rendered"]);
  expect(() => patchLineOverride(b0, { models: { kokoro: { top_k: 1 } } })).toThrow(); // the route's 400
});
