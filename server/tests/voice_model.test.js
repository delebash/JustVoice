// SPDX-License-Identifier: MIT
// A voice knows its model (persona redesign P1, 2026-10-03) — the port of
// tests/test_voice_model.py.
//
// Until this, a voice stored only its engine: a Chatterbox Turbo clone and a Multilingual clone
// were the same voice to the app, and tags, knobs and the render followed whichever model
// happened to be loaded. Now every voice names the model that speaks it — one server answer
// (`voice_model.js`) for the Voices table, the persona editor, Cast and the render.
//
// Not ported here: the eleven tests that go through /v1/voices (the voice list, clone, design,
// copy) — they wait for api/voices_api.js: test.todo. What those routes read of this module is
// also compared against Python on a copy of the real data (scripts/compare-render.*).
import { expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as manager from "../src/engines/manager.js";
import { discoverEngines } from "../src/engines/manager.js";
import * as vmod from "../src/voice_model.js";

// ── Every voice ships what speaks it ──────────────────────────────────────

test.todo("a_qwen3_speaker_is_directed_in_words_and_speaks_many_languages — waits for api/voices_api.js");
test.todo("a_kokoro_voice_speaks_only_its_own_language — waits for api/voices_api.js");
test.todo("a_clone_stores_the_model_it_was_made_for — waits for api/voices_api.js");
test.todo("a_clone_without_a_model_gets_the_engines_default_cloning_model — waits for api/voices_api.js");
test.todo("a_model_that_cannot_do_it_is_refused_by_name — waits for api/voices_api.js");
test.todo("a_designed_voice_without_its_clip_is_voicedesign_and_with_it_base — waits for api/voices_api.js");

// ── Copy to another model ─────────────────────────────────────────────────

test.todo("copying_a_clip_to_another_model_makes_a_second_voice — waits for api/voices_api.js");
test.todo("qwen3_base_needs_the_clips_words_or_skip_the_words — waits for api/voices_api.js");
test.todo("a_model_that_cannot_clone_is_refused — waits for api/voices_api.js");
test.todo("a_voice_with_no_clip_cannot_be_copied — waits for api/voices_api.js");
test.todo("turbo_and_nano_need_a_clip_longer_than_five_seconds — waits for api/voices_api.js");

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
