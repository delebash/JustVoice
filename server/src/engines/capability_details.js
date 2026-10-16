// SPDX-License-Identifier: MIT
// Per-engine capability details — drives the knob + tag gating (the persona page). The port of
// justvoice/engines/capability_details.py.
//
// Hand-authored interim data for task #89 (engine capability manifests): STATIC, pulled from
// upstream model cards, authoritative-source verification and line-level audits of each
// adapter. Long-term each engine's manifest declares its own KNOBS / INLINE_TAGS /
// VARIANT_CAPABILITIES and this central table goes away; until then it is authoritative — UI
// gating relies on it.
//
// Per-variant entries (qwen3-cv / qwen3-base / qwen3-vd, chatterbox-multilingual) exist
// because the same engine family has materially different parameters or capabilities across
// model variants. Looking up a variant id falls back to its base engine id; consumers try the
// variant id first. Rows are `EngineCapabilityDetail` wire objects (snake_case, declaration
// order, defaults filled).

import { construct, EngineCapabilityDetail, InlineTagSet, KnobSpec } from "../models.js";
import {
  audiocppEnds,
  currentOptionName,
  directionEmotions,
  generatedEngines,
  generatedModels,
  listsOptions,
  modelName,
  requestOptionsOf,
  settingsOf,
} from "./audiocpp/generated.js";
import { pinnedHas } from "./audiocpp/release.js";

const knob = (v) => construct(KnobSpec, v);
const tags = (v) => construct(InlineTagSet, v);
const detail = (v) => construct(EngineCapabilityDetail, v);

// The seven engines described by our own files keep their settings under the app's names, which
// their own requests read (slot.js); the spec option each of those names is, where it differs.
const SPEC_NAME = {
  cfg_weight: "guidance_scale",
  talker_temperature: "temperature",
  talker_top_k: "top_k",
  talker_top_p: "top_p",
  cfg_value: "guidance_scale",
  inference_timesteps: "num_inference_steps",
};
// The app's floors: every temperature and top-p from 0.05, in the knobs and the request mapping
// (Qwen3 refuses a temperature of 0, Chatterbox divides by it, Turbo reads it as 1.0, and Qwen3
// reads a top-p of 0 as no filter — audit §5 D4, D9; RESEARCH §1.2), and VoxCPM2's tries from 1,
// the least its request sends (slot.js).
const FLOOR = {
  temperature: 0.05,
  talker_temperature: 0.05,
  subtalker_temperature: 0.05,
  top_p: 0.05,
  talker_top_p: 0.05,
  subtalker_top_p: 0.05,
  retry_badcase_max_times: 1,
};

/**
 * One of the seven's settings at audio.cpp's range where it is wider (decided 2026-10-15, TASKS
 * "Slice 3's six questions" 4: "the seven engines' knobs wider than audio.cpp's, or ranged where it
 * gives none: slice 4, never narrowed below a saved value"): each end audio.cpp's — its control
 * list's, else its spec's (generated.audiocppEnds) — where it reaches further, and open where
 * audio.cpp gives none; ours where audio.cpp's stops short of it, since a persona may have saved a
 * value there (RESEARCH §1.2 lists them); and never below the app's floors (`FLOOR`). A number
 * with an open end is a number box, as audio.cpp's own UI shows one (the plan's E2).
 */
function atAudiocppRange(family, k) {
  if (k.key === "seed") return k;
  const { min, max } = audiocppEnds(family, currentOptionName(family, SPEC_NAME[k.key] ?? k.key));
  const floor = FLOOR[k.key] ?? null;
  let lo = min === null ? null : Math.min(k.min ?? min, min);
  if (floor !== null) lo = Math.max(lo ?? floor, floor);
  const hi = max === null || k.max === null ? null : Math.max(k.max, max);
  return knob({ ...k, min: lo, max: hi, box: lo === null || hi === null ? true : k.box });
}
const atAudiocppRanges = (family, knobs) => knobs.map((k) => atAudiocppRange(family, k));

// Shared knob definitions — reused across engines that accept the same control.

function temperatureKnob(def = 0.8, advanced = false) {
  return knob({
    key: "temperature",
    label: "Temperature",
    min: 0.05,
    max: 2.0,
    step: 0.05,
    default: def,
    hint: "Sampling variance. Lower = stable + robotic; higher = creative + wild.",
    advanced,
  });
}

function speedKnob(def = 1.0) {
  return knob({ key: "speed", label: "Speed", min: 0.5, max: 3.0, step: 0.05, default: def, unit: "×", hint: "Reading pace multiplier." });
}

function seedKnob(family = null) {
  // 0 (or empty) is a new take each time: the request mapping sends a random seed for it —
  // audio.cpp's own "no seed" repeated for Kokoro, Kitten, Turbo and VoxCPM2 (audit §5 D1).
  // Its top is the spec's where it gives one (4,294,967,295 at v0.9.2), else 2,000,000,000
  // (decided 2026-10-15, TASKS "Slice 3's six questions" 3).
  return knob({
    key: "seed",
    label: "Seed",
    min: 0,
    max: (family ? requestOptionsOf(family).get("seed")?.max : null) ?? 2_000_000_000,
    step: 1,
    default: 0,
    hint: "The same seed repeats the same take. 0 = a new take each time.",
    advanced: true,
  });
}

/** The talker sampling surface — identical across every Qwen3 checkpoint family (CustomVoice /
 * Base / VoiceDesign share the talker architecture); what differs per family is capability,
 * not knobs. */
// `advanced`, on the seven engines described by our own files as on the rest: a setting audio.cpp's
// own screen shows (its control list, webui/configs/model_params.json) stays in view, one it
// doesn't folds under Advanced (decided 2026-10-15, TASKS "Slice 3's six questions" 1;
// generated.inControlList).
// At audio.cpp's ranges: the detail temperature a number box from the app's 0.05 (the spec gives
// it no top; was 0.05–2); the repetition penalty's 1–2 stops short of ours (1–4), kept.
function qwenSamplingKnobs() {
  return atAudiocppRanges("qwen3_tts", [
    knob({ key: "talker_temperature", label: "Temperature", min: 0.05, max: 2.0, step: 0.05, default: 0.9, hint: "Sampling variance for the talker model." }),
    // audio.cpp's range (the narrowings review, F9 — was 1–100): its control list's number box
    // from 0 with no top (webui/configs/model_params.json qwen3_tts `top_k`).
    knob({ key: "talker_top_k", label: "Top k", min: 0, max: null, step: 1, box: true, default: 50 }),
    // Not 0: Qwen3 reads a top-p of 0 as "no filter" (audit §5 D9).
    knob({ key: "talker_top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0 }),
    knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.05, default: 1.05 }),
    // The sub-talker fills in each frame's finer audio codes after the talker picks the first;
    // audio.cpp samples it with its own three settings, defaults from the model's
    // generation_config.json (../audio.cpp/include/engine/models/qwen3_tts/types.h).
    knob({
      key: "subtalker_temperature",
      label: "Detail temperature",
      min: 0.05,
      max: 2.0,
      step: 0.05,
      default: 0.9,
      advanced: true,
      hint: "Sampling variance for the finer audio detail (the sub-talker).",
    }),
    // The spec's range, from 0 with no top (model_specs/qwen3_tts.json `subtalker_top_k`; F9).
    knob({ key: "subtalker_top_k", label: "Detail top k", min: 0, max: null, step: 1, box: true, default: 50, advanced: true }),
    knob({ key: "subtalker_top_p", label: "Detail top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
    seedKnob("qwen3_tts"),
  ]);
}

/** Two more settings audio.cpp's Chatterbox reads per request (../audio.cpp/src/models/
 * chatterbox/session.cpp, defaults in tts.h) — the app offered neither and said it had no
 * min-p (audit 2026-10-04 §7). */
function chatterboxExtraKnobs() {
  return [
    knob({ key: "min_p", label: "Min p", min: 0.0, max: 0.5, step: 0.01, default: 0.05, advanced: true, hint: "Drops sounds less likely than this share of the likeliest. 0 = off." }),
    knob({ key: "s3gen_cfg_rate", label: "Decoder CFG", min: 0.0, max: 1.5, step: 0.05, default: 0.7, advanced: true, hint: "How closely the audio decoder holds to the cloned voice." }),
  ];
}

// 0–2, audio.cpp's control list's (model_params.json chatterbox `exaggeration`; F9 — was 0.25).
const exaggerationKnob = () =>
  knob({ key: "exaggeration", label: "Exaggeration", min: 0, max: 2.0, step: 0.05, default: 0.5, hint: "Expressiveness. 0.3–0.4 = flat narration. >1.0 = dramatic." });
const cfgWeightKnob = () =>
  knob({ key: "cfg_weight", label: "CFG weight", min: 0.0, max: 1.0, step: 0.05, default: 0.5, hint: "Text adherence. Lower = looser pacing; higher = strict." });

// ─── Per-engine capability rows ────────────────────────────────────────

export const CAPABILITY_DETAILS = {
  // ─── Kokoro (audio.cpp kokoro_tts, since the 2026-10-01 switch) ───
  // Speed: audio.cpp's 0.5–2 stops short of ours (0.5–3); ours kept.
  kokoro: detail({
    engine_id: "kokoro",
    display_name: "Kokoro",
    supports_voice_cloning: false,
    // A lexicon's IPA (gap 3) rides our audio.cpp's inline "[word](/phonemes/)" — offered once
    // the pinned build has it; render_core also checks the INSTALLED one.
    supports_phoneme_input: pinnedHas("inline_ipa"),
    // Blends (gap 2) need our audio.cpp's `voice_pack` option — offered once the pinned build
    // has it (release.pinnedHas), so the flag flips with the pin.
    supports_voice_blending: pinnedHas("voice_pack"),
    // audio.cpp's Kokoro takes a decoder-noise seed — the same seed repeats the same audio
    // (measured 2026-10-01).
    knobs: atAudiocppRanges("kokoro_tts", [speedKnob(), seedKnob("kokoro_tts")]),
    inline_tags: [],
    pitch_native_st_range: null,
    pitch_post_process: true, // the server can pitch-shift the output WAV
    speed_native: true,
    notes: ["Pitch shift is post-process (the server shifts the rendered audio).", "The same seed gives the same audio."],
  }),

  // ─── KittenTTS (audio.cpp `kitten_tts`, CPU placement 2026-10-02) ───
  // Speed only: audio.cpp's KittenTTS takes a seed, but the same seed does not repeat the same
  // audio (measured 2026-10-02), so no seed control is offered. Speed from audio.cpp's 0.01 (was
  // 0.5); its top, 2, stops short of ours (3), kept.
  kitten: detail({
    engine_id: "kitten",
    display_name: "KittenTTS",
    supports_voice_cloning: false,
    knobs: atAudiocppRanges("kitten_tts", [speedKnob()]),
    inline_tags: [],
    pitch_native_st_range: null,
    pitch_post_process: true,
    speed_native: true,
    notes: ["Eight English preset voices, made for the CPU.", "The same seed does not repeat the same audio."],
  }),

  // ─── Pocket TTS (audio.cpp `pocket_tts`, CPU placement 2026-10-02) ──
  // Clones from the clip alone (no transcript input) and speaks 20 presets; audio.cpp takes no
  // other request options for it. The same seed repeats the same audio (measured 2026-10-02).
  // Cloning waits on Kyutai's terms (manifest TERMS).
  pocket: detail({
    engine_id: "pocket",
    display_name: "Pocket TTS",
    supports_voice_cloning: true,
    supports_clone_prompt_text: false,
    knobs: [seedKnob("pocket_tts")],
    inline_tags: [],
    pitch_native_st_range: null,
    pitch_post_process: true,
    notes: [
      "Clones from a short clip, fast enough on the CPU.",
      "One model per language — load the model for the language you are rendering.",
      "Cloning asks you to accept Kyutai's terms once.",
    ],
  }),

  // ─── Chatterbox (audio.cpp `chatterbox`, since the 2026-10-01 switch) ─
  // The engine-level row is the fallback; the Multilingual row below is what every shipped
  // variant resolves to. Turbo and Nano have rows of their own below (gap 1).
  // At audio.cpp's ranges (atAudiocppRanges): top-p, min-p and the decoder CFG are number boxes —
  // audio.cpp gives them none (were 0.05–1, 0–0.5, 0–1.5; top-p still from the app's 0.05); its
  // repetition penalty, 1–2, stops short of ours (1–4), kept.
  chatterbox: detail({
    engine_id: "chatterbox",
    display_name: "Chatterbox",
    supports_voice_cloning: true,
    supports_clone_prompt_text: false,
    knobs: atAudiocppRanges("chatterbox", [
      temperatureKnob(0.8),
      exaggerationKnob(),
      cfgWeightKnob(),
      // 1.2 is what audio.cpp and upstream (mtl_tts.py, master) use; the knob said 2.0 and
      // sent nothing at its default (audit §5 D3).
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2 }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
      ...chatterboxExtraKnobs(),
      seedKnob("chatterbox"),
    ]),
    pitch_post_process: true,
  }),

  "chatterbox-multilingual": detail({
    engine_id: "chatterbox-multilingual",
    display_name: "Chatterbox Multilingual",
    supports_voice_cloning: true,
    knobs: atAudiocppRanges("chatterbox", [
      temperatureKnob(0.8),
      exaggerationKnob(),
      cfgWeightKnob(),
      // 1.2: audio.cpp's and upstream's (audit §5 D3).
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2 }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
      ...chatterboxExtraKnobs(),
      seedKnob("chatterbox"),
    ]),
    pitch_post_process: true,
    notes: [
      `${generatedEngines().get("chatterbox").VARIANTS[0].languages.length} languages. For language transfer, set cfg_weight=0 (Resemble docs).`,
      "The same seed gives the same audio.",
    ],
  }),

  // ─── Chatterbox Turbo (and Nano, below) — back with gap 1 ─────────
  // docs/plans/2026-10-03-gap-1-turbo-cloning.md. Turbo takes temperature, top-p, top-k and
  // repetition penalty per request; exaggeration / CFG / min-p do nothing on Turbo (upstream
  // ignores them with a warning), so they are not offered.
  "chatterbox-turbo": detail({
    engine_id: "chatterbox-turbo",
    display_name: "Chatterbox Turbo",
    supports_voice_cloning: true,
    supports_clone_prompt_text: false,
    // audio.cpp's own screen shows none of Turbo's settings: all of them fold. At audio.cpp's
    // ranges: its spec gives temperature, repetition penalty and top-p none — number boxes (were
    // 0.05–2, 1–4, 0.05–1), temperature and top-p from the app's 0.05.
    knobs: atAudiocppRanges("chatterbox_turbo", [
      temperatureKnob(0.8, true),
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2, advanced: true }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 0.95, advanced: true }),
      // The spec's range, from 0 with no top (model_specs/chatterbox_turbo.json `top_k`; F9 — was
      // 1–2000).
      knob({ key: "top_k", label: "Top k", min: 0, max: null, step: 1, box: true, default: 1000, advanced: true }),
      seedKnob("chatterbox_turbo"),
    ]),
    // The checkpoint's own added_tokens.json: nineteen reserved tokens, ids 50257–50275, in
    // three kinds — a state the line is spoken IN, a register it is read AS, and a sound made
    // AT a point in the text. Upstream's model card names only [cough] [laugh] [chuckle] and
    // says "and more"; the other sixteen are declared from the reserved ids.
    inline_tags: [
      tags({
        category: "emotion",
        label: "Emotion",
        tags: ["angry", "fear", "happy", "sarcastic", "surprised", "crying", "whispering"],
        syntax: "[{value}]",
        placement: "inline_anywhere",
        hint: "The state the line is spoken in. Place at the start of the line unless you want the shift mid-sentence.",
        // `Delivery.emotion` compiles to these tokens. `neutral` maps to the empty string:
        // expressible, emits no tag. Absent keys are not expressible here — `shouted` and
        // `contemptuous` have no token, and `[crying]` is a behaviour rather than `sad`'s
        // state, so sad is not mapped onto it.
        value_map: { neutral: "", happy: "happy", angry: "angry", fearful: "fear", whispered: "whispering", sarcastic: "sarcastic" },
      }),
      tags({
        category: "register",
        label: "Register",
        tags: ["narration", "dramatic", "advertisement"],
        syntax: "[{value}]",
        placement: "inline_anywhere",
        hint: "How the passage is read overall, rather than what the speaker feels.",
      }),
      tags({
        category: "paralinguistic",
        label: "Non-verbal",
        tags: ["cough", "laugh", "chuckle", "sigh", "gasp", "groan", "sniff", "clear throat", "shush"],
        syntax: "[{value}]",
        placement: "inline_anywhere",
        hint: "Insert at the moment in the text where you want the sound.",
      }),
    ],
    pitch_post_process: true,
    notes: [
      "English only. Clones from a reference clip longer than 5 seconds.",
      "The 19 inline tags are Turbo's own — Multilingual shares the engine but not the tokenizer, and reads them as words.",
      "[surprised] and [crying] have no Delivery.emotion equivalent; type them inline. [shouted] and [contemptuous] have no token.",
      "The same seed gives the same audio.",
    ],
  }),

  // ─── Qwen3-TTS ────────────────────────────────────────────────────
  // Four rows: the engine-level row is the FALLBACK (the union across checkpoint families —
  // kept so an unrecognised variant id degrades to something rather than nothing), and three
  // family rows carry the truth the union hides. `lookup()` walks suffixes, so `qwen3-cv-1.7b`
  // and `qwen3-cv-0.6b` both land on "qwen3-cv" — one row per family, not per size.
  qwen3: detail({
    engine_id: "qwen3",
    display_name: "Qwen3-TTS",
    // Union across families — prefer the qwen3-cv / qwen3-base / qwen3-vd rows, which
    // consumers reach via the variant id.
    supports_voice_cloning: true,
    supports_voice_design: true,
    supports_instruct_freeform: true,
    knobs: qwenSamplingKnobs(),
    pitch_post_process: true,
    notes: [
      'Instruct field is the primary control — describe voice in plain English ("young, sarcastic", "stadium announcement", "angry whisper").',
    ],
  }),

  "qwen3-cv": detail({
    engine_id: "qwen3-cv",
    display_name: "Qwen3-TTS CustomVoice",
    // 9 preset speakers + instruct. CANNOT clone — the model card is explicit, and the adapter
    // refuses a reference clip on this family.
    supports_voice_cloning: false,
    supports_voice_design: false,
    supports_instruct_freeform: true,
    knobs: qwenSamplingKnobs(),
    pitch_post_process: true,
    notes: ["Instruct field is the primary control — describe delivery in plain English.", "No cloning on this checkpoint — the Base family clones."],
  }),

  "qwen3-base": detail({
    engine_id: "qwen3-base",
    display_name: "Qwen3-TTS Base",
    // Clone-only: 3–10 s reference clip, no preset speakers, and the checkpoint drops instruct
    // silently. Passing the clip's exact transcript (`ref_text`) raises clone quality.
    supports_voice_cloning: true,
    supports_clone_prompt_text: true,
    // Upstream's own demo exposes this as "Use x-vector only (no reference text needed, but
    // lower quality)".
    supports_xvector_only: true,
    supports_voice_design: false,
    supports_instruct_freeform: false,
    knobs: qwenSamplingKnobs(),
    pitch_post_process: true,
    notes: [
      "Clone-only checkpoint: no preset speakers, and written direction is dropped silently.",
      "Pass the reference clip's exact transcript for a better clone.",
    ],
  }),

  "qwen3-vd": detail({
    engine_id: "qwen3-vd",
    display_name: "Qwen3-TTS VoiceDesign",
    // A voice from a prose description (1.7B only — upstream ships no 0.6B VoiceDesign). The
    // description rides the instruct slot; a line's own direction appends to it.
    supports_voice_cloning: false,
    supports_voice_design: true,
    supports_instruct_freeform: true,
    knobs: qwenSamplingKnobs(),
    pitch_post_process: true,
    notes: [
      'Describe the voice in plain English — "gravel-voiced harbour-master, 70s" — and the model invents it. No reference audio.',
      "1.7B only; there is no 0.6B VoiceDesign checkpoint.",
    ],
  }),
};

// ─── VoxCPM2 (audio.cpp `voxcpm2`, gap 9, 2026-10-02) ──────────────
// Clones from a clip and designs from a description; written direction reaches both as the
// parenthesised prefix. The clip's transcript reaches the model from our build v0.9.0-jv.1 on
// (manifest header), so the transcript field follows the pin.
CAPABILITY_DETAILS.voxcpm2 = detail({
  engine_id: "voxcpm2",
  display_name: "VoxCPM2",
  supports_voice_cloning: true,
  supports_clone_prompt_text: pinnedHas("voxcpm2_transcript"),
  supports_voice_design: true,
  supports_instruct_freeform: true,
  // The runaway settings at audio.cpp's ranges: its spec gives them none — number boxes, the tries
  // from 1, what the request sends (were 1–10 and 2–12).
  knobs: atAudiocppRanges("voxcpm2", [
    // audio.cpp's control list's ranges (model_params.json voxcpm2: `guidance_scale` 0–5, and
    // `num_inference_steps` a number box from 1 with no top; F9 — were 1–5 and 4–30).
    knob({ key: "cfg_value", label: "CFG", min: 0, max: 5.0, step: 0.1, default: 2.0, hint: "How closely it follows the voice and the text. Higher = stricter." }),
    knob({ key: "inference_timesteps", label: "Inference steps", min: 1, max: null, step: 1, box: true, default: 10, hint: "More steps = finer detail, slower." }),
    // A take that runs far longer than its text — a "runaway" — is cut and made again
    // (../audio.cpp/src/models/voxcpm2/generator.cpp; defaults in types.h, audit §7).
    knob({
      key: "retry_badcase_max_times",
      label: "Tries on a runaway",
      min: 1,
      max: 10,
      step: 1,
      default: 3,
      advanced: true,
      hint: "A take that runs too long for its text is made again, up to this many tries in all.",
    }),
    knob({
      key: "retry_badcase_ratio_threshold",
      label: "Runaway limit",
      min: 2.0,
      max: 12.0,
      step: 0.5,
      default: 6.0,
      advanced: true,
      hint: "How long a take may run for its text before it is cut and tried again. Lower cuts sooner; too low cuts real speech.",
    }),
    seedKnob("voxcpm2"),
  ]),
  inline_tags: [],
  pitch_post_process: true,
  notes: [
    "Clones from a short clip, or designs a voice from a written description.",
    // Its authors: "When Hi-Fi mode is enabled, the control instruction is ignored" — Hi-Fi is
    // the clip with its words, so a directed line sends the clip alone (decided 2026-10-11).
    "Written direction reaches a cloned voice: a line with direction is spoken from the clip alone, without the clip's words.",
    "48 kHz output.",
  ],
});

// Nano is Turbo's architecture at 110M parameters with the same tag vocabulary (both repos'
// added_tokens.json compared byte for byte 2026-08-19) and the same generate surface. A copy
// with its own name, not an alias — the alias put a second "Chatterbox Turbo" in every picker
// (2026-08-20). (pydantic's model_copy is shallow: the knobs and tags are shared.)
CAPABILITY_DETAILS["chatterbox-nano"] = {
  ...CAPABILITY_DETAILS["chatterbox-turbo"],
  engine_id: "chatterbox-nano",
  display_name: "Chatterbox Nano",
};

// A model of the seven engines described by our own files that has no row of its own takes the row
// of the model its notes name (`like`): audio.cpp's own Turbo package, Turbo's settings and tags,
// under audio.cpp's name — copying no voice (its package has no voice encoder), so it says only
// "English only." of Turbo's first note.
for (const mod of generatedEngines().values()) {
  if (!mod.GENERATED) continue;
  for (const v of [...mod.VARIANTS, ...(mod.PENDING_VARIANTS || [])]) {
    const id = v.audiocpp.model;
    if (Object.hasOwn(CAPABILITY_DETAILS, id)) continue;
    if (!v.like || !Object.hasOwn(CAPABILITY_DETAILS, v.like)) continue;
    const like = CAPABILITY_DETAILS[v.like];
    CAPABILITY_DETAILS[id] = {
      ...like,
      engine_id: id,
      display_name: v.name,
      supports_voice_cloning: v.voice_cloning,
      notes: like.notes.map((n, i) => (i === 0 && !v.voice_cloning ? n.replace(/\s*Clones from .*$/, "") : n)),
    };
  }
}

// ─── Every other speech model audio.cpp has (engines/audiocpp/generated.js) ───
// One row per speech model, from its spec (the adoption plan's slice 2): it copies a voice, makes
// one from words, or speaks its built-in voices, as its spec says; it takes the clip's words when
// its spec lists `reference_text` or lists no options at all — the rule the request follows
// (slot.generatedSpeechRequest; the narrowings review, E11); it takes a line's direction only
// when our file for the family says how — else it "can't be directed yet" (`direction_known`
// false; E8) — in its file's own words where it has them (`DIRECTION_NOTE`: IndexTTS, decided
// 2026-10-15), and only the emotions that file maps (`emotions`; E8). Its settings are its
// spec's typed options (generated.settingsOf), and the seed where the spec takes one or lists no
// options at all. A recognition model has no row: it speaks nothing.
for (const m of generatedModels()) {
  if (Object.hasOwn(CAPABILITY_DETAILS, m.modelId)) continue;
  const opts = requestOptionsOf(m.family);
  const direction = m.curated?.DIRECTION ?? null;
  const tested = m.curated?.TESTED ?? null;
  const does = [
    m.clone ? "Clones a voice from a short clip." : null,
    m.design ? "Designs a voice from a written description." : null,
  ].filter(Boolean);
  CAPABILITY_DETAILS[m.modelId] = detail({
    engine_id: m.modelId,
    display_name: modelName(m),
    supports_voice_cloning: m.clone,
    supports_clone_prompt_text: m.clone && (!listsOptions(m.family) || opts.has("reference_text")),
    supports_voice_design: m.design,
    supports_instruct_freeform: Boolean(direction),
    direction_known: Boolean(direction),
    emotions: directionEmotions(direction),
    knobs: [...settingsOf(m).map(knob), ...(!listsOptions(m.family) || opts.has("seed") ? [seedKnob(m.family)] : [])],
    inline_tags: [],
    pitch_post_process: true,
    notes: [
      ...does,
      direction ? (m.curated?.DIRECTION_NOTE ?? "Takes a line's emotion and direction.") : "Can't be directed yet — JustVoice doesn't yet know how this model takes direction.",
      tested ? `Tested by JustVoice: ${tested.note}` : "Not tested by JustVoice yet.",
      `audio.cpp lists it as ${m.fam.status}.`,
    ],
  });
}

let _recognisers = null;
/** Every speech-recognition model's variant ids. */
function recogniserIds() {
  if (_recognisers === null) {
    _recognisers = new Set([...generatedEngines().values()].filter((m) => m.KIND === "stt").flatMap((m) => m.VARIANTS.map((v) => v.id)));
  }
  return _recognisers;
}

/** Capability detail by engine id OR variant id (variant ids first); null when none. */
export function lookup(engineOrVariantId) {
  if (Object.hasOwn(CAPABILITY_DETAILS, engineOrVariantId)) return CAPABILITY_DETAILS[engineOrVariantId];
  // A recogniser speaks nothing: no row — Qwen3-ASR's "qwen3-asr-1.7b-q8" walked to Qwen3-TTS's
  // "qwen3" (until the adoption plan's slice 4 put it on every recogniser's path).
  if (recogniserIds().has(String(engineOrVariantId))) return null;
  // Walk the "-" suffixes off one at a time, most specific first. Manifest variant ids carry a
  // version/precision tail the capability map does not, so "chatterbox-multilingual-v2-q8"
  // has to reach "chatterbox-multilingual" and "qwen3-base-1.7b-q8" has to reach "qwen3-base"
  // before either falls through to its engine row.
  let probe = String(engineOrVariantId);
  while (probe.includes("-")) {
    probe = probe.slice(0, probe.lastIndexOf("-"));
    if (Object.hasOwn(CAPABILITY_DETAILS, probe)) return CAPABILITY_DETAILS[probe];
  }
  return null;
}

