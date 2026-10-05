// SPDX-License-Identifier: MIT
//
// The persona mock's data — production minus the plumbing (decided 2026-10-04,
// docs/plans/2026-10-04-persona-voice-making.md §2): no server, no real audio,
// no persistence. Everything the server would answer comes from
// `liveSnapshot.json`, a copy of the app's own answers (capabilities, preset
// voices, model languages, terms, effects); only the user's own things — the
// clones, designs, blends, personas, books — are made up, and they are made
// with real model ids so every label is the one production builds.
//
// One reactive store, shared by the Personas list and the persona's page, so a
// save on one shows on the other. A reload starts it fresh.

import { reactive } from "vue";

import snapshot from "./liveSnapshot.json";

export const capabilities = snapshot.capabilities;
export const emotionValues = snapshot.emotion_values;
export const effectLabels = Object.fromEntries(snapshot.effects.map((e) => [e.type, e.label]));
export const modelLanguages = snapshot.languages;

const DISPLAY = Object.fromEntries(Object.entries(capabilities).map(([id, r]) => [id, r.display_name]));

/** How a model can be directed — the server's own rule (`voice_model.py:143-152`). */
export function directedByOf(model) {
  const r = capabilities[model];
  if (!r) return "sliders";
  if (r.supports_instruct_freeform) return "words";
  if ((r.inline_tags || []).length) return "tags";
  return "sliders";
}

function made(id, { engine, model, source, name, language, gender, ...rest }) {
  return {
    id, engine, model, source, name, language, gender,
    model_name: DISPLAY[model] || model,
    directed_by: directedByOf(model),
    speaks: modelLanguages[model] || [language],
    ...rest,
  };
}

// The user's own voices. A clip's length and noise are what the clone maker
// measured when it was kept.
const MADE_VOICES = [
  made("v_marius", { engine: "chatterbox", model: "chatterbox-turbo", source: "cloned", name: "Marius", language: "en", gender: "male", clip: { seconds: 47, snr: 32 } }),
  made("v_mara", { engine: "chatterbox", model: "chatterbox-turbo", source: "cloned", name: "Mara", language: "en", gender: "female", clip: { seconds: 61, snr: 28 } }),
  made("v_elena", { engine: "voxcpm2", model: "voxcpm2", source: "cloned", name: "Elena", language: "en", gender: "female", clip: { seconds: 38, snr: 30 }, transcript: "I kept the letters. All of them. I never said I'd read them." }),
  made("v_tobias", { engine: "qwen3", model: "qwen3-base", source: "imported", name: "Tobias", language: "en", gender: "male", clip: { seconds: 22, snr: 26 }, transcript: "The ferry was late again, and nobody on the quay looked surprised." }),
  made("v_ines", { engine: "chatterbox", model: "chatterbox-multilingual", source: "cloned", name: "Inês", language: "pt", gender: "female", clip: { seconds: 54, snr: 27 } }),
  made("v_harbor", { engine: "qwen3", model: "qwen3-vd", source: "designed", name: "Harbour-master", language: "en", gender: "male", design_prompt: "A gravel-voiced harbour-master in his seventies, unhurried, a West Country burr." }),
  made("v_pell", { engine: "voxcpm2", model: "voxcpm2", source: "designed", name: "Widow Pell", language: "en", gender: "female", design_prompt: "An old woman, thin and bright-voiced, quick to laugh at her own jokes.", clip: { seconds: 9, snr: 40 } }),
  made("v_dusk", { engine: "kokoro", model: "kokoro", source: "blended", name: "Dusk", language: "en-US", gender: "female", speaks: ["en-US"], blend: "Heart 60 % · Bella 40 %" }),
];

export const BOOKS = [
  { id: "b_ninth", name: "The Ninth Facet", language: "en" },
  { id: "b_emberfall", name: "Emberfall", language: "en" },
];

export const CAPTURES = [
  { id: "c_1", label: "Dictation · 2 Oct, 14:31 · 0:42", clip: { name: "capture-2026-10-02-1431.wav", bytes: 1_344_000, seconds: 42, snr: 21 } },
  { id: "c_2", label: "Dictation · 3 Oct, 09:05 · 1:18", clip: { name: "capture-2026-10-03-0905.wav", bytes: 2_496_000, seconds: 78, snr: 34 } },
];

export const LEXICONS = [
  { id: "lx_ninth", name: "The Ninth Facet names" },
  { id: "lx_emberfall", name: "Emberfall places" },
];

function persona(id, fields) {
  return {
    id, name: "", voice_id: "", language: "", voice_instruct: "", note: "",
    default_delivery: { models: {} }, effects_chain: [], lexicon_id: "",
    ...fields,
  };
}

const PERSONAS = [
  persona("p_june", {
    name: "June", voice_id: "Sohee", language: "en",
    voice_instruct: "Clipped, world-weary. Dry wit. Boston accent under stress.",
    note: "Tired but sharp; warm only with Marius.",
    default_delivery: { speed: 1.05, gain_db: -1, models: {} },
    effects_chain: [{ type: "reverb", params: {} }, { type: "eq_low", params: {} }],
    lexicon_id: "lx_ninth",
  }),
  persona("p_marius", {
    name: "Marius", voice_id: "v_marius", language: "en",
    note: "Low, patient, a little amused at everything.",
    default_delivery: { speed: 0.95, gain_db: 3, models: { "chatterbox-turbo": { emotion: "sarcastic" } } },
  }),
  persona("p_narrator", {
    name: "Narrator (warm)", voice_id: "af_heart", language: "en-US",
    note: "Even, unhurried storyteller.",
    default_delivery: { speed: 1, gain_db: -2, models: {} },
    effects_chain: [{ type: "eq_mid", params: {} }],
  }),
  persona("p_mara_young", {
    name: "Mara (young)", voice_id: "Ono_Anna", language: "ja",
    note: "Bright, quick, all questions.",
    default_delivery: { speed: 1.12, pitch: 2, models: {} },
  }),
  persona("p_mara_old", {
    name: "Mara (old)", voice_id: "v_mara", language: "en",
    default_delivery: { speed: 0.92, pitch: -3, models: { "chatterbox-turbo": { register_tag: "narration" } } },
    effects_chain: [{ type: "reverb", params: {} }],
  }),
  persona("p_dockhand", {
    name: "Gruff dockhand", voice_id: "am_fenrir", language: "en-US",
    default_delivery: { speed: 0.94, pitch: -2, models: {} },
  }),
  persona("p_harbour", {
    name: "Harbour-master", voice_id: "v_harbor", language: "en",
    voice_instruct: "Slow, unbothered.",
  }),
  persona("p_elena", {
    name: "Elena", voice_id: "v_elena", language: "en",
    voice_instruct: "Quiet, precise, a little guarded.",
    note: "Says less than she knows.",
  }),
  persona("p_tom", {
    name: "Old Tom", voice_id: "v_tom", language: "en",
    default_delivery: { speed: 0.9, models: {} },
  }),
  persona("p_street", {
    name: "Street kid", voice_id: "bf_lily", language: "en-GB",
    note: "Quick and cheerful; gone before you finish the sentence.",
    default_delivery: { speed: 1.1, models: {} },
  }),
  persona("p_radio", {
    name: "Radio announcer", voice_id: "kitten_hugo", language: "en-US",
    default_delivery: { speed: 1.08, gain_db: 2, models: {} },
  }),
];

// {persona id: [{project_id, project_name, speaker_id, speaker_name, lines, directed}]}
const USAGE = {
  p_june: [{ project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_cael", speaker_name: "Cael Ferren", lines: 25, directed: 7 }],
  p_marius: [{ project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_iven", speaker_name: "Iven Sarraz", lines: 32, directed: 0 }],
  p_dockhand: [{ project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_brick", speaker_name: "Brick Halvorn", lines: 16, directed: 0 }],
  p_narrator: [
    { project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_narr1", speaker_name: "Narrator", lines: 126, directed: 0 },
    { project_id: "b_emberfall", project_name: "Emberfall", speaker_id: "s_narr2", speaker_name: "Narrator", lines: 180, directed: 0 },
  ],
  p_mara_young: [{ project_id: "b_emberfall", project_name: "Emberfall", speaker_id: "s_mara_y", speaker_name: "Mara (young)", lines: 37, directed: 9 }],
  p_mara_old: [
    { project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_haldane", speaker_name: "Haldane Threll", lines: 6, directed: 0 },
    { project_id: "b_emberfall", project_name: "Emberfall", speaker_id: "s_mara", speaker_name: "Mara", lines: 52, directed: 0 },
  ],
  p_elena: [
    { project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_odeline", speaker_name: "Odeline Marran", lines: 27, directed: 4 },
    { project_id: "b_emberfall", project_name: "Emberfall", speaker_id: "s_elena", speaker_name: "Elena", lines: 29, directed: 11 },
  ],
  p_street: [{ project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_nettle", speaker_name: "Nettle", lines: 19, directed: 0 }],
  p_tom: [{ project_id: "b_ninth", project_name: "The Ninth Facet", speaker_id: "s_auberon", speaker_name: "Auberon Vasht", lines: 2, directed: 0 }],
};

/** Which models are loaded or installed on this mock machine. */
export const modelStatus = reactive({
  kokoro: "loaded",
  "chatterbox-nano": "not installed",
});
export function statusOf(model) {
  return modelStatus[model] || "not loaded";
}

/** Engine terms (Kyutai's, for Pocket's cloning) — real text, not accepted. */
export const terms = snapshot.terms;
export const termsAccepted = reactive({ pocket: false });

export const store = reactive({
  voices: [...snapshot.presets, ...MADE_VOICES],
  personas: PERSONAS.map((p) => JSON.parse(JSON.stringify(p))),
  usage: JSON.parse(JSON.stringify(USAGE)),
});

let seq = 0;
export function newId(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

/** A kept voice — saved to the library the moment Keep is pressed (decided B). */
export function keepVoice(fields) {
  const v = made(newId("v"), fields);
  store.voices.push(v);
  return v;
}

/** A persona's facts as the server reads them (`PersonaView`): its voice's model. */
export function personaView(p) {
  const v = store.voices.find((x) => x.id === p.voice_id);
  return {
    ...p,
    model: v?.model || "",
    model_name: v?.model_name || "",
    directed_by: v?.directed_by || "",
    speaks: v ? (v.speaks.length === 1 ? v.speaks[0] : p.language || v.language) : "",
  };
}

// ── Pretend audio ──────────────────────────────────────────────────────
// A mock renders nothing, but its player should behave like the real one:
// a short silent WAV with a real length.
export function silentWav(seconds = 4) {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = new ArrayBuffer(44 + n);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  str(36, "data"); dv.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: "audio/wav" });
}

/** How long a render takes here — long enough to see the busy state. */
export const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));
