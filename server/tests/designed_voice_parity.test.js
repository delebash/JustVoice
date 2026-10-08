// SPDX-License-Identifier: MIT
// Designed voices reach an engine — frozen as a clone, or dynamic as prose (the port of
// tests/test_designed_voice_parity.py).
//
// **A — the save discarded the audio**: the Designer's preview is the one artifact that pins a
// designed identity; VoiceDesign re-invents the speaker on every call. **J — the description
// reached nothing**: a saved designed voice contributed nothing to a render. **E — a mixed cast
// failed per line**: since 2026-10-03 every voice names its model (voice_model.js) and the
// chapter renders model by model. **C**: the paralinguistic-tag flag Qwen3 never earned.
//
// The app state is `useState` (create_app's state half); Python's seed_workspace() is not needed
// by what those tests read. The three preview-save tests drive the real app (`saveClient`, the
// whole app with its seed, as Python's fixture).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { endState, useState } from "./engines_helpers.js";
import * as vp from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import * as release from "../src/engines/audiocpp/release.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import { strip as stripTags } from "../src/inline_tags.js";
import { utcNow } from "../src/models.js";
import { voiceDesignInstruct, voiceDesignInstructForId, voiceSynthFields } from "../src/render_core.js";
import { modelKey, modelOfVariant, voiceModel } from "../src/voice_model.js";

const SR = 24000;
const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

function wav(seconds = 0.25) {
  const n = Math.trunc(SR * seconds);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(9000 * Math.sin((2 * Math.PI * 220 * i) / SR)), 2 * i);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

let st;
beforeEach(() => {
  st = useState();
});
afterEach(async () => {
  await closeApps();
  endState();
});

/** The whole app (create_app + seed_workspace) in place of this file's bare state. */
async function saveClient() {
  endState();
  return (await appClient(undefined, { seed: true })).c;
}

function store(state, kw = {}) {
  const now = utcNow();
  return state.voices.create({
    id: "",
    engine: "qwen3",
    source: "designed",
    name: "Harbourmaster",
    language: "en-US",
    created_at: now,
    updated_at: now,
    ...kw,
  });
}

// ── A — the freeze bridge ──────────────────────────────────────────────

/** Put a rendered designed candidate in the preview LRU and return its id. Goes in directly
 * rather than through POST /v1/voices/preview because that door needs a loaded engine to
 * render; what is under test is what `save` does with audio it already has. */
function seedDesignedPreview(audio, payloadExtra = {}) {
  const payload = {
    engine: "qwen3",
    source: "designed",
    prompt: "a gravel-voiced harbour-master in his seventies, unhurried",
    preview_text: "The tide turns at four, and not a minute later.",
    language: "en-US",
    ...payloadExtra,
  };
  const previewId = "prv_test_designed";
  vp.cfg._PREVIEW_LRU.set(previewId, new vp._PreviewEntry("designed", payload, audio));
  return previewId;
}

test("saving_a_designed_preview_freezes_its_clip", async () => {
  // The audio the Designer just rendered becomes the voice's ref.wav.
  const c = await saveClient();
  const previewId = seedDesignedPreview(wav());
  const r = await c.post(`/v1/voices/preview/${previewId}/save`, { json: { name: "Harbourmaster" } });
  expect(r.status, r.text).toBe(200);
  const voiceId = r.json().voice_id;
  const ref = getState().voices.refWavPath(voiceId);
  expect(readFileSync(ref).equals(wav())).toBe(true);
});

test("a_frozen_designed_voice_keeps_the_line_its_clip_speaks", async () => {
  // `transcript` is what makes the clip an ICL clone source, and for a designed voice that text
  // is `preview_text`, not the clone field.
  const c = await saveClient();
  const previewId = seedDesignedPreview(wav());
  const r = await c.post(`/v1/voices/preview/${previewId}/save`, { json: { name: "Harbourmaster" } });
  const rec = getState().voices.get(r.json().voice_id);
  expect(rec.transcript).toBe("The tide turns at four, and not a minute later.");
  // The description survives too — export requires it, the table shows it, and it is the
  // provenance of a voice with no recording behind it.
  expect(rec.design_prompt.startsWith("a gravel-voiced harbour-master")).toBe(true);
});

test("a_frozen_designed_voice_renders_as_a_clone", async () => {
  // Clip wins: once frozen, the identity comes from the audio.
  const c = await saveClient();
  const previewId = seedDesignedPreview(wav());
  const r = await c.post(`/v1/voices/preview/${previewId}/save`, { json: { name: "Harbourmaster" } });
  const state = getState();
  const rec = state.voices.get(r.json().voice_id);
  const fields = voiceSynthFields(state, rec);
  expect(fields.audio_prompt_path.endsWith("ref.wav")).toBe(true);
  expect(fields.ref_text).toBe("The tide turns at four, and not a minute later.");
  // …and its description must NOT also be spoken as direction.
  expect(voiceDesignInstruct(state, rec)).toBeNull();
});

// ── J — the clip-less half stays dynamic ───────────────────────────────

test("a_clipless_designed_voice_contributes_its_description", () => {
  const rec = store(st, { design_prompt: "a gravel-voiced harbour-master, unhurried" });
  expect(voiceDesignInstruct(st, rec)).toBe("a gravel-voiced harbour-master, unhurried");
  expect(voiceDesignInstructForId(st, rec.id)).toBe("a gravel-voiced harbour-master, unhurried");
  // It has no clip, so it contributes no synth inputs at all.
  expect(voiceSynthFields(st, rec)).toEqual({});
});

test("only_designed_voices_contribute_a_description", () => {
  const cloned = store(st, { source: "cloned", design_prompt: "ignored" });
  expect(voiceDesignInstruct(st, cloned)).toBeNull();
  expect(voiceDesignInstructForId(st, "no-such-voice")).toBeNull();
  expect(voiceDesignInstructForId(st, null)).toBeNull();
  expect(voiceDesignInstruct(st, null)).toBeNull();
});

test("an_empty_description_is_not_an_instruct", () => {
  expect(voiceDesignInstruct(st, store(st, { design_prompt: "   " }))).toBeNull();
  expect(voiceDesignInstruct(st, store(st, { design_prompt: null }))).toBeNull();
});

test("both_render_doors_put_the_description_first", () => {
  // Most specific LAST: the description is identity, so it leads — ahead of the persona's
  // standing instruction, the emotion and the line's own direction. Source-level. Every persona
  // line is planned by the one resolver (2026-10-03); the chapter door calls it through
  // line_takes.planBlock, and its compose call leads with the description.
  expect(src("api/render_chapter_api.js")).toContain("planBlock(");
  expect(src("line_takes.js")).toContain("planLine(");
  const resolver = src("persona_render.js");
  const composed = resolver.split("composed = composeInstruct(")[1];
  // The description leads — a saved voice's, or an unsaved design's on the persona page.
  expect(composed.trimStart().startsWith("design,")).toBe(true);
  expect(resolver).toContain("design = renderCore.voiceDesignInstructForId(state, voiceId)");
  expect(resolver).toContain("design = candidate.designPrompt");

  // Generate's two doors (managed and in-process) both lead with the voice's description.
  const generate = src("api/generate_api.js");
  expect(generate.split("_voiceDesignInstruct(req.voice)").length - 1).toBe(2);
  for (const chunk of generate.split("composed = composeInstruct(").slice(1)) {
    expect(chunk.trimStart().startsWith("_voiceDesignInstruct(req.voice)")).toBe(true);
  }
});

// ── E — every voice names its model ────────────────────────────────────

test("each_voice_names_the_model_it_needs", async () => {
  const designed = store(st, { design_prompt: "a harbour-master" });
  expect((await voiceModel(st, designed.id)).model).toBe("qwen3-vd");
  const cloned = store(st, { source: "cloned", name: "Marius" });
  st.voices.writeRefWav(cloned.id, wav());
  expect((await voiceModel(st, cloned.id)).model).toBe("qwen3-base");
  // A designed voice becomes a Base voice the moment it is frozen — clip wins over anything
  // stored.
  const frozen = store(st, { design_prompt: "a harbour-master", name: "Frozen", model: "qwen3-vd" });
  st.voices.writeRefWav(frozen.id, wav());
  expect((await voiceModel(st, frozen.id)).model).toBe("qwen3-base");
});

test("a_preset_speaks_on_its_own_model", async () => {
  expect((await voiceModel(st, "Sohee")).model).toBe("qwen3-cv");
  const kokoro = store(st, { engine: "kokoro", source: "blended", name: "Mix" });
  expect((await voiceModel(st, kokoro.id)).model).toBe("kokoro");
});

test("a_mixed_cast_groups_by_model_instead_of_refusing", async () => {
  // The scheduler's key is the model, so a chapter with a designed voice, a clone and a Qwen3
  // speaker renders each model's lines together — one swap per model.
  const designed = store(st, { design_prompt: "a harbour-master", name: "Designed" });
  const cloned = store(st, { source: "cloned", name: "Marius" });
  st.voices.writeRefWav(cloned.id, wav());
  const keys = new Set();
  for (const v of [designed.id, cloned.id, "Sohee"]) keys.add(await modelKey(st, v));
  expect(keys).toEqual(new Set(["qwen3:qwen3-vd", "qwen3:qwen3-base", "qwen3:qwen3-cv"]));
});

test("the_mlx_variants_resolve_to_the_same_families", () => {
  // `qwen3-vd-1.7b-mlx` is the VoiceDesign family like its twin — the suffix must not read as
  // a fourth checkpoint that matches nothing.
  expect(modelOfVariant("qwen3-vd-1.7b-mlx")).toBe("qwen3-vd");
  expect(modelOfVariant("qwen3-base-0.6b-q8")).toBe("qwen3-base");
  expect(modelOfVariant("chatterbox-turbo-f16")).toBe("chatterbox-turbo");
});

// ── C — Qwen3 has no tag vocabulary ────────────────────────────────────

test("only_chatterbox_claims_paralinguistic_tags_and_only_turbo_keeps_them", () => {
  // The engine flag is the fallback for an engine with no capability row; true on an engine
  // that cannot read tags puts `[laugh]` into the text, read aloud. Chatterbox claims them once
  // the pinned runtime clones on Turbo — and a voice's own model row still decides.
  for (const [engineId, m] of discoverEngines()) {
    const claims = m.capabilities.paralinguistic_tags ?? false;
    expect(claims, engineId).toBe(engineId === "chatterbox" && release.pinnedHas("turbo_clone"));
  }
  expect(lookup("chatterbox-multilingual").inline_tags.length).toBe(0);
  expect(lookup("chatterbox-turbo").inline_tags.reduce((n, t) => n + t.tags.length, 0)).toBe(19);
});

test("stripping_removes_markup_qwen_would_have_spoken", () => {
  expect(stripTags("Well [laugh] that settles it [pause:0.5s].")).not.toContain("[");
});

