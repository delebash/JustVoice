// SPDX-License-Identifier: MIT
// Voices for the cast and the narrator — the one-click run's step 5 (the one-click plan's slice 3,
// 2026-10-16): the descriptions in both recipes, design → freeze → persona → cast, the rest matched
// from the library, and Smart-assign's matches cast on the server.
//
// The language model is `run.runFeature` (as every AI test fakes it) and the speech model
// `voice_preview_api.synthCandidate` (as the persona makers' tests fake it); everything between
// them is the real app.
import { existsSync } from "node:fs";
import { resolveFeaturePreset } from "@delebash/llm-runner/llm";
import * as llmStores from "@delebash/llm-runner/llm/stores";
import { afterEach, expect, test, vi } from "vitest";
import * as vp from "../src/api/voice_preview_api.js";
import { getState } from "../src/app_state.js";
import { writeWavContainer } from "../src/audio/wav.js";
import { ACTIONS, BOOK_VOICES_PROMPTS } from "../src/book_voices/prompts.js";
import { auditionLine, bookChapters, bookManuscript, speakerPassages } from "../src/book_voices/text.js";
import { Block, Scene, Speaker, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as run from "../src/engines/llm/run.js";
import { FEATURE_CATALOG, PREFER_LOCAL_FEATURES } from "../src/feature_catalog.js";
import { construct, Settings } from "../src/models.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import { DEFAULT_FEATURE_PRESETS, DEFAULT_TEST_SAMPLES } from "../src/seed_presets.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

function toneWav(seconds = 0.5, sampleRate = 24000) {
  const n = Math.trunc(seconds * sampleRate);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 6000), 2 * i);
  return writeWavContainer(pcm, sampleRate, 1);
}

/** The model's answer, as the kit's LLMResponse carries it. */
const answer = (obj, model = "gemma-test") => ({ text: JSON.stringify(obj), prompt_tokens: 100, completion_tokens: 20, model });

// The Hatter's 30-word line is the one an audition should speak: calm and nearest 25 words.
const HATTER_CALM =
  "Now, if you only kept on good terms with him, he'd do almost anything you liked with the clock, and it would run as smoothly as you could wish.";

/**
 * A book: one chapter of eight paragraphs. Alice 4 lines, the Hatter 4, the Dormouse 2 (below N),
 * a narrator with the narration. → {c, pid, ids: {alice, hatter, dormouse, narrator}, sceneId}.
 */
async function book({ language = "en", seed = true } = {}) {
  const { c } = await appClient(undefined, { seed });
  const r = await c.post("/v1/projects", { json: { name: "Wonderland", project_type: "audiobook", language } });
  expect(r.status, r.text).toBe(201);
  const pid = r.json().id;
  const add = async (name, description = null) => (await c.post(`/v1/projects/${pid}/speakers`, { json: { name, description } })).json().id;
  const ids = {
    alice: await add("Alice", "A curious girl of seven."),
    hatter: await add("Hatter", "Keeps tea-time forever."),
    dormouse: await add("Dormouse"),
  };
  expect((await c.post(`/v1/projects/${pid}/narrator`)).status).toBe(201);
  ids.narrator = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.find((s) => s.role_label === "narrator").id;

  const h = session.getDb();
  const sceneId = uuid();
  h.insert(Scene, { id: sceneId, project_id: pid, title: "A Mad Tea-Party", position: 0 });
  const lines = [
    // [paragraph, speaker, source, text]
    [0, "narrator", "narration", "There was a table set out under a tree in front of the house, and the March Hare and the Hatter were having tea at it."],
    [1, "hatter", "tag", "“Your hair wants cutting!”"],
    [1, "narrator", "narration", "said the Hatter. He had been looking at Alice for some time with great curiosity."],
    [2, "alice", "tag", "“You should learn not to make personal remarks,”"],
    [2, "narrator", "narration", "Alice said with some severity;"],
    [2, "alice", "tag", "“it's very rude.”"],
    [3, "hatter", "model", `“${HATTER_CALM}”`],
    [4, "alice", "model", "“I believe I can guess that.”"],
    [5, "dormouse", "model", "“I wasn't asleep,”"],
    [5, "narrator", "narration", "he said in a hoarse, feeble voice."],
    [6, "hatter", "model", "“No, I give it up!”"],
    [6, "alice", "model", "“What's the answer?”"],
    [7, "hatter", "model", "“I haven't the slightest idea.”"],
    [7, "dormouse", "model", "“Twinkle, twinkle.”"],
  ];
  lines.forEach(([paragraph, who, source, text], position) => {
    h.insert(Block, {
      id: uuid(),
      scene_id: sceneId,
      position,
      text,
      speaker_id: ids[who],
      source,
      metadata_json: JSON.stringify({ paragraph_idx: paragraph }),
    });
  });
  return { c, pid, ids, sceneId };
}

// ── The feature, its rows and its settings ────────────────────────────────

test("the_feature_its_three_rows_and_its_settings_are_seeded", async () => {
  expect(FEATURE_CATALOG.find((f) => f.key === "book_voices")?.label).toBe("Voices from the book");
  // It reads the book's text, like attribution: the built-in engine first.
  expect(PREFER_LOCAL_FEATURES.has("book_voices")).toBe(true);
  for (const key of Object.values(ACTIONS)) {
    expect(DEFAULT_FEATURE_PROMPTS[key]).toBe(BOOK_VOICES_PROMPTS[key]);
    expect(DEFAULT_FEATURE_PROMPTS[key].json_mode).toBe(true);
    expect(DEFAULT_FEATURE_PRESETS[key]).toBe("p_extract");
    expect(DEFAULT_TEST_SAMPLES.some((s) => s.actions.includes(key))).toBe(true);
  }
  // The decided defaults: N = 3 over the whole book (Q1), the clone model VoxCPM2 (Q2).
  const s = construct(Settings, {}).book_voices;
  expect([s.min_lines, s.design_model, s.clone_model]).toEqual([3, "qwen3-vd", "voxcpm2"]);

  const { c } = await appClient(undefined, { seed: true });
  const rows = Object.fromEntries((await c.get("/v1/ai/prompts")).json().prompts.map((p) => [p.key, p]));
  expect(rows[ACTIONS.speaker].userTemplate).toContain("{{passages}}");
  expect(rows[ACTIONS.narrator].userTemplate).toContain("{{opening}}");
  expect(rows[ACTIONS.cast].userTemplate).toContain("{{manuscript}}");
  // A setting is changed like any other.
  const r = await c.patch("/v1/settings", { json: { book_voices: { min_lines: 5 } } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().settings.book_voices.min_lines).toBe(5);
  expect(r.json().settings.book_voices.clone_model).toBe("voxcpm2");
});

// ── What the steps read of the book ───────────────────────────────────────

test("a_speakers_reading_is_their_paragraphs_with_their_own_lines_marked", async () => {
  const { ids, pid } = await book();
  const chapters = bookChapters(session.getDb(), pid);
  expect(chapters[0].paragraphs.length).toBe(8);
  const passages = speakerPassages(chapters, ids.alice, 2000);
  expect(passages.split("\n\n")).toEqual([
    "⟦“You should learn not to make personal remarks,”⟧ Alice said with some severity; ⟦“it's very rude.”⟧",
    "⟦“I believe I can guess that.”⟧",
    "“No, I give it up!” ⟦“What's the answer?”⟧",
  ]);
  // The budget keeps whole paragraphs, the first always.
  expect(speakerPassages(chapters, ids.alice, 5).split("\n\n").length).toBe(1);

  // The frontier book: every spoken line after its speaker's name.
  const nameOf = new Map([
    [ids.alice, "Alice"],
    [ids.hatter, "Hatter"],
    [ids.dormouse, "Dormouse"],
    [ids.narrator, "Narrator"],
  ]);
  const manuscript = bookManuscript(chapters, nameOf);
  expect(manuscript.startsWith("## A Mad Tea-Party\n\nThere was a table")).toBe(true);
  expect(manuscript).toContain("[Hatter] “Your hair wants cutting!” said the Hatter.");
  expect(manuscript).not.toContain("[Narrator]");
});

test("an_audition_speaks_the_speakers_calm_line_nearest_the_length", async () => {
  const { ids, pid } = await book();
  const chapters = bookChapters(session.getDb(), pid);
  // Marks off; the "!" lines passed over.
  expect(auditionLine(chapters, ids.hatter, 25)).toBe(HATTER_CALM);
  // The narrator's: a narration line.
  expect(auditionLine(chapters, ids.narrator, 25)).toMatch(/^There was a table/);
  // No line of at least half the length → null (the step speaks a stock line).
  expect(auditionLine(chapters, ids.dormouse, 25)).toBeNull();
});

// ── Step 1: the descriptions ──────────────────────────────────────────────

test("local_recipe_one_call_per_main_speaker_and_one_for_the_narrator", async () => {
  const { c, pid, ids } = await book();
  const calls = [];
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables) => {
    calls.push([action, variables]);
    if (action === ACTIONS.narrator) return answer({ gender: "female", description: "Female, forties, warm and even." });
    const who = variables.speaker.includes('name="Hatter"') ? "Hatter" : "Alice";
    return answer({ gender: who === "Alice" ? "female" : "male", description: `${who}: calm at rest.` });
  });
  const r = await c.post(`/v1/projects/${pid}/book-voices/describe`, { json: {} });
  expect(r.status, r.text).toBe(200);
  const out = r.json();
  expect(out.recipe).toBe("local");
  // Alice and the Hatter have 4 lines (N = 3); the Dormouse 2 — matched from the library later.
  expect(calls.map(([a]) => a)).toEqual([ACTIONS.speaker, ACTIONS.speaker, ACTIONS.narrator]);
  const hatterCall = calls.find(([, v]) => v.speaker?.includes('name="Hatter"'))[1];
  expect(hatterCall.book).toBe("Wonderland");
  expect(hatterCall.speaker).toContain('description="Keeps tea-time forever."');
  expect(hatterCall.passages).toContain("⟦“Your hair wants cutting!”⟧ said the Hatter.");
  expect(calls.at(-1)[1].opening.startsWith("There was a table")).toBe(true);
  expect(out.descriptions.map((d) => [d.name, d.gender, d.narrator, d.model, d.recipe])).toEqual([
    ["Alice", "female", false, "gemma-test", "local"],
    ["Hatter", "male", false, "gemma-test", "local"],
    ["Narrator", "female", true, "gemma-test", "local"],
  ]);
  expect(out.descriptions.find((d) => d.speaker_id === ids.hatter).description).toBe("Hatter: calm at rest.");
  expect(out.usage).toMatchObject({ prompt_tokens: 300, completion_tokens: 60, model: "gemma-test", pieces: 3 });
});

test("frontier_recipe_one_call_for_the_whole_cast_with_the_whole_book", async () => {
  const { c, pid, ids } = await book();
  const calls = [];
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables) => {
    calls.push([action, variables]);
    // Keyed by id as asked — and the narrator by name, which is read too.
    return answer(
      { [ids.alice]: { gender: "female", description: "Girl, seven." }, [ids.hatter]: "Male, eccentric.", Narrator: { description: "Warm reader." } },
      "claude-opus-5-5",
    );
  });
  const out = (await c.post(`/v1/projects/${pid}/book-voices/describe`, { json: { recipe: "frontier" } })).json();
  expect(calls.length).toBe(1);
  const [action, variables] = calls[0];
  expect(action).toBe(ACTIONS.cast);
  expect(variables.speakers.split("\n").length).toBe(3);
  expect(variables.speakers).toContain('role="narrator"');
  expect(variables.manuscript).toContain("[Alice] “it's very rude.”");
  expect(out.descriptions.map((d) => [d.name, d.description, d.recipe, d.model])).toEqual([
    ["Alice", "Girl, seven.", "frontier", "claude-opus-5-5"],
    ["Hatter", "Male, eccentric.", "frontier", "claude-opus-5-5"],
    ["Narrator", "Warm reader.", "frontier", "claude-opus-5-5"],
  ]);
});

test("auto_runs_the_frontier_recipe_when_the_whole_cast_cards_model_is_frontier", async () => {
  const { c, pid } = await book();
  const actions = [];
  vi.spyOn(run, "runFeature").mockImplementation(async (action) => {
    actions.push(action);
    return answer({});
  });
  const preset = resolveFeaturePreset(ACTIONS.cast, "book_voices");
  llmStores.getEnginePresetStore().save({ ...preset, recipe: "frontier" });
  const out = (await c.post(`/v1/projects/${pid}/book-voices/describe`)).json();
  expect(out.recipe).toBe("frontier");
  expect(actions).toEqual([ACTIONS.cast]);
  // A model that answers nothing usable: each one listed, nothing invented.
  expect(out.descriptions).toEqual([]);
  expect(out.failed.map((f) => f.name)).toEqual(["Alice", "Hatter", "Narrator"]);
});

test("a_speaker_already_cast_or_named_for_a_persona_is_not_described", async () => {
  const { c, pid, ids } = await book();
  const mine = (await c.post("/v1/personas", { json: { name: "Mine", voice_id: "af_heart" } })).json().id;
  await c.patch(`/v1/speakers/${ids.alice}`, { json: { persona_id: mine } });
  await c.post("/v1/personas", { json: { name: "Hatter", voice_id: "af_heart" } });
  const spy = vi.spyOn(run, "runFeature").mockImplementation(async () => answer({ description: "Warm." }));
  const out = (await c.post(`/v1/projects/${pid}/book-voices/describe`, { json: {} })).json();
  expect(out.skipped.map((s) => [s.name, s.reason])).toEqual([
    ["Alice", "cast"],
    ["Hatter", "persona_named"],
  ]);
  expect(spy.mock.calls.map(([a]) => a)).toEqual([ACTIONS.narrator]);
});

test("no_language_model_is_a_501", async () => {
  const { c, pid } = await book();
  const { LLMNotConfiguredError } = await import("@delebash/llm-runner/llm");
  vi.spyOn(run, "runFeature").mockRejectedValue(new LLMNotConfiguredError("no LLM provider registered"));
  expect((await c.post(`/v1/projects/${pid}/book-voices/describe`, { json: {} })).status).toBe(501);
});

// ── Step 2: design → freeze → persona → cast ──────────────────────────────

test("each_description_is_designed_once_kept_as_a_voxcpm2_clip_and_made_a_persona", async () => {
  const { c, pid, ids } = await book();
  const raw = toneWav();
  const heard = [];
  vi.spyOn(vp, "synthCandidate").mockImplementation(async (body, _engine, kw) => {
    heard.push([body, kw]);
    return [raw, 24000, 1];
  });
  const descriptions = [
    { speaker_id: ids.hatter, name: "Hatter", gender: "male", description: "Male, middle-aged, sharp and eccentric.", model: "gemma-test" },
    { speaker_id: ids.narrator, name: "Narrator", narrator: true, gender: "female", description: "Female, forties, warm.", model: "gemma-test" },
  ];
  const r = await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions } });
  expect(r.status, r.text).toBe(200);
  const out = r.json();
  expect(out.failed).toEqual([]);
  expect(out.made.map((m) => [m.name, m.cast])).toEqual([
    ["Hatter", true],
    ["Narrator", true],
  ]);

  // Designed on Qwen3 VoiceDesign from its description, speaking the Hatter's own calm line.
  const [body, kw] = heard[0];
  expect([body.engine, body.model, body.source]).toEqual(["qwen3", "qwen3-vd", "designed"]);
  expect(kw.delivery.instruct).toBe("Male, middle-aged, sharp and eccentric.");
  expect(kw.text).toBe(HATTER_CALM);
  expect(kw.language).toBe("en");
  expect(out.made[0].audition).toBe(HATTER_CALM);

  // The audition kept as the clip of a VoxCPM2 voice, its words and description with it.
  const st = getState();
  const voice = st.voices.get(out.made[0].voice_id);
  expect([voice.engine, voice.model, voice.source, voice.name, voice.gender]).toEqual(["voxcpm2", "voxcpm2", "designed", "Hatter", "male"]);
  expect(voice.design_prompt).toBe("Male, middle-aged, sharp and eccentric.");
  expect(voice.transcript).toBe(HATTER_CALM);
  expect(existsSync(st.voices.refWavPath(voice.id))).toBe(true);

  // A persona named for the speaker, its note the description and the model that wrote it; cast.
  const persona = (await c.get(`/v1/personas/${out.made[0].persona_id}`)).json();
  expect(persona.name).toBe("Hatter");
  expect(persona.voice_id).toBe(voice.id);
  expect(persona.note).toBe("Male, middle-aged, sharp and eccentric.\n\nWritten from the book by gemma-test.");
  const speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(speakers.find((s) => s.id === ids.hatter).persona_id).toBe(persona.id);
  expect(speakers.find((s) => s.id === ids.narrator).persona_name).toBe("Narrator");
});

test("nothing_you_made_is_replaced", async () => {
  const { c, pid, ids } = await book();
  vi.spyOn(vp, "synthCandidate").mockImplementation(async () => [toneWav(), 24000, 1]);
  const mine = (await c.post("/v1/personas", { json: { name: "Mine", voice_id: "af_heart" } })).json().id;
  await c.patch(`/v1/speakers/${ids.alice}`, { json: { persona_id: mine } });
  const hatterPersona = (await c.post("/v1/personas", { json: { name: "Hatter", voice_id: "af_heart" } })).json().id;
  const voicesBefore = getState().voices.list().length;
  const out = (
    await c.post(`/v1/projects/${pid}/book-voices/design`, {
      json: {
        descriptions: [
          { speaker_id: ids.alice, description: "Girl." },
          { speaker_id: ids.hatter, description: "Man." },
        ],
      },
    })
  ).json();
  expect(out.left_alone.map((x) => x.name)).toEqual(["Alice"]);
  expect(out.cast_by_name).toEqual([{ speaker_id: ids.hatter, name: "Hatter", persona_id: hatterPersona }]);
  expect(out.made).toEqual([]);
  expect(getState().voices.list().length).toBe(voicesBefore);
  const speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(speakers.find((s) => s.id === ids.alice).persona_id).toBe(mine);
});

test("a_persona_name_two_personas_share_fails_before_any_voice_is_made", async () => {
  const { c, pid, ids } = await book();
  const synth = vi.spyOn(vp, "synthCandidate").mockImplementation(async () => [toneWav(), 24000, 1]);
  // Two older personas sharing a name (before names were unique): no exact match, no new one.
  getState().personas.create("Hatter");
  getState().personas.create("hatter");
  const out = (await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions: [{ speaker_id: ids.hatter, description: "Man." }] } })).json();
  expect(out.failed.map((f) => f.name)).toEqual(["Hatter"]);
  expect(out.failed[0].error).toContain("already exists");
  expect(synth).not.toHaveBeenCalled();
});

test("a_persona_that_cant_be_made_takes_its_new_voice_with_it", async () => {
  const { c, pid, ids } = await book();
  vi.spyOn(vp, "synthCandidate").mockImplementation(async () => [toneWav(), 24000, 1]);
  const personasApi = await import("../src/api/personas_api.js");
  vi.spyOn(personasApi, "createPersona").mockRejectedValue(new Error("disk full"));
  const before = getState().voices.list().length;
  const out = (await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions: [{ speaker_id: ids.hatter, description: "Man." }] } })).json();
  expect(out.failed).toEqual([{ speaker_id: ids.hatter, name: "Hatter", error: "disk full" }]);
  expect(getState().voices.list().length).toBe(before);
});

test("the_design_step_needs_the_books_language_and_models_that_can", async () => {
  const { c, pid, ids } = await book({ language: "" });
  const descriptions = [{ speaker_id: ids.hatter, description: "Man." }];
  let r = await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions } });
  expect(r.status).toBe(400);
  expect(r.text).toContain("book's language");

  await c.patch(`/v1/projects/${pid}`, { json: { language: "en" } });
  // Kokoro clones nothing; Qwen3 Base clones but drops direction (RESEARCH §10.1).
  for (const clone_model of ["kokoro", "qwen3-base"]) {
    await c.patch("/v1/settings", { json: { book_voices: { clone_model } } });
    r = await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions } });
    expect(r.status, clone_model).toBe(400);
    expect(r.text).toContain("take direction");
  }
  await c.patch("/v1/settings", { json: { book_voices: { clone_model: "voxcpm2", design_model: "voxcpm2" } } });
  vi.spyOn(vp, "synthCandidate").mockImplementation(async () => [toneWav(), 24000, 1]);
  // VoxCPM2 designs too — a setting, not a fixed pair.
  r = await c.post(`/v1/projects/${pid}/book-voices/design`, { json: { descriptions } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().made.length).toBe(1);
});

// ── Step 3: the rest, from the library ───────────────────────────────────

test("the_rest_are_matched_from_the_library_and_cast_on_the_server", async () => {
  const { c, pid, ids } = await book();
  const make = async (name, voice_id, note = null) => (await c.post("/v1/personas", { json: { name, voice_id, note } })).json().id;
  const sleepy = await make("Sleepy", "af_heart", "soft, drowsy");
  const french = await make("Brigitte", "ff_siwis", "bright");
  const playing = await make("Mine", "am_adam", "deep");
  await c.patch(`/v1/speakers/${ids.alice}`, { json: { persona_id: playing } });
  const narratorPersona = await make("Narrator", "af_heart");
  const sent = [];
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables) => {
    sent.push([action, variables]);
    return answer({ [ids.dormouse]: sleepy, [ids.hatter]: playing });
  });
  const r = await c.post(`/v1/projects/${pid}/book-voices/match`);
  expect(r.status, r.text).toBe(200);
  const out = r.json();
  // The narrator: exactly a persona's name — cast with it, as every new speaker is.
  expect(out.cast_by_name).toEqual([{ speaker_id: ids.narrator, name: "Narrator", persona_id: narratorPersona }]);
  // The library offered: speaks the book's language, plays no one in this book yet.
  const [action, variables] = sent[0];
  expect(action).toBe("smart_assign");
  expect(variables.personas).toContain('name="Sleepy"');
  expect(variables.personas).not.toContain("Brigitte");
  expect(variables.personas).not.toContain('name="Mine"');
  expect(variables.speakers).toContain('name="Dormouse"');
  expect(variables.speakers).not.toContain('name="Alice"');
  // Only what was offered is cast: the Hatter's match plays Alice already, so it isn't.
  expect(out.assigned).toEqual([{ speaker_id: ids.dormouse, name: "Dormouse", persona_id: sleepy, persona_name: "Sleepy" }]);
  expect(out.unmatched).toEqual([{ speaker_id: ids.hatter, name: "Hatter" }]);
  const h = session.getDb();
  expect(h.get(Speaker, ids.dormouse).persona_id).toBe(sleepy);
  expect(h.get(Speaker, ids.hatter).persona_id).toBeNull();
  expect(french).toBeTruthy();
});

// ── Smart-assign's matches, cast on the server ───────────────────────────

test("smart_assign_casts_its_matches_on_the_server_when_asked", async () => {
  const { c, pid, ids } = await book();
  const a = (await c.post("/v1/personas", { json: { name: "A", voice_id: "af_heart" } })).json().id;
  const b = (await c.post("/v1/personas", { json: { name: "B", voice_id: "af_heart" } })).json().id;
  await c.patch(`/v1/speakers/${ids.narrator}`, { json: { persona_id: b } });
  await c.patch(`/v1/speakers/${ids.hatter}`, { json: { persona_id: b } });
  vi.spyOn(run, "runFeature").mockResolvedValue(answer({ [ids.alice]: a, [ids.hatter]: a, [ids.narrator]: a, nobody: a }));
  const characters = [ids.alice, ids.hatter, ids.narrator].map((id) => ({ id, name: id }));
  const voices = [
    { id: a, name: "A" },
    { id: b, name: "B" },
  ];
  const h = session.getDb();

  // Without `apply` the matches only come back — ＋ New persona's call, matched to voices.
  let r = await c.post("/v1/llm/smart-assign", { json: { characters, voices } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().applied).toEqual({});
  expect(h.get(Speaker, ids.alice).persona_id).toBeNull();

  // Cast's ✨ Smart-assign: cast as it always was (the Hatter re-cast), but never over a
  // narrator's persona.
  r = await c.post("/v1/llm/smart-assign", { json: { characters, voices, apply: true } });
  expect(r.json().applied).toEqual({ [ids.alice]: a, [ids.hatter]: a });
  expect(h.get(Speaker, ids.alice).persona_id).toBe(a);
  expect(h.get(Speaker, ids.hatter).persona_id).toBe(a);
  expect(h.get(Speaker, ids.narrator).persona_id).toBe(b);
  expect(pid).toBeTruthy();
});
