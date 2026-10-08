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
import { pinnedHas } from "./audiocpp/release.js";
import { VARIANTS as CHATTERBOX_VARIANTS } from "./chatterbox/manifest.js";

const knob = (v) => construct(KnobSpec, v);
const tags = (v) => construct(InlineTagSet, v);
const detail = (v) => construct(EngineCapabilityDetail, v);

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

function seedKnob() {
  // 0 (or empty) is a new take each time: the request mapping sends a random seed for it —
  // audio.cpp's own "no seed" repeated for Kokoro, Kitten, Turbo and VoxCPM2 (audit §5 D1).
  return knob({
    key: "seed",
    label: "Seed",
    min: 0,
    max: 2_000_000_000,
    step: 1,
    default: 0,
    hint: "The same seed repeats the same take. 0 = a new take each time.",
    advanced: true,
  });
}

/** The talker sampling surface — identical across every Qwen3 checkpoint family (CustomVoice /
 * Base / VoiceDesign share the talker architecture); what differs per family is capability,
 * not knobs. */
function qwenSamplingKnobs() {
  return [
    knob({ key: "talker_temperature", label: "Temperature", min: 0.05, max: 2.0, step: 0.05, default: 0.9, hint: "Sampling variance for the talker model." }),
    knob({ key: "talker_top_k", label: "Top k", min: 1, max: 100, step: 1, default: 50, advanced: true }),
    // Not 0: Qwen3 reads a top-p of 0 as "no filter" (audit §5 D9).
    knob({ key: "talker_top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
    knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.05, default: 1.05, advanced: true }),
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
    knob({ key: "subtalker_top_k", label: "Detail top k", min: 1, max: 100, step: 1, default: 50, advanced: true }),
    knob({ key: "subtalker_top_p", label: "Detail top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
    seedKnob(),
  ];
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

const exaggerationKnob = () =>
  knob({ key: "exaggeration", label: "Exaggeration", min: 0.25, max: 2.0, step: 0.05, default: 0.5, hint: "Expressiveness. 0.3–0.4 = flat narration. >1.0 = dramatic." });
const cfgWeightKnob = () =>
  knob({ key: "cfg_weight", label: "CFG weight", min: 0.0, max: 1.0, step: 0.05, default: 0.5, hint: "Text adherence. Lower = looser pacing; higher = strict." });

// ─── Per-engine capability rows ────────────────────────────────────────

export const CAPABILITY_DETAILS = {
  // ─── Kokoro (audio.cpp kokoro_tts, since the 2026-10-01 switch) ───
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
    knobs: [speedKnob(), seedKnob()],
    inline_tags: [],
    pitch_native_st_range: null,
    pitch_post_process: true, // the server can pitch-shift the output WAV
    speed_native: true,
    notes: ["Pitch shift is post-process (the server shifts the rendered audio).", "The same seed gives the same audio."],
  }),

  // ─── KittenTTS (audio.cpp `kitten_tts`, CPU placement 2026-10-02) ───
  // Speed only: audio.cpp's KittenTTS takes a seed, but the same seed does not repeat the same
  // audio (measured 2026-10-02), so no seed control is offered.
  kitten: detail({
    engine_id: "kitten",
    display_name: "KittenTTS",
    supports_voice_cloning: false,
    knobs: [speedKnob()],
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
    knobs: [seedKnob()],
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
  chatterbox: detail({
    engine_id: "chatterbox",
    display_name: "Chatterbox",
    supports_voice_cloning: true,
    supports_clone_prompt_text: false,
    knobs: [
      temperatureKnob(0.8),
      exaggerationKnob(),
      cfgWeightKnob(),
      // 1.2 is what audio.cpp and upstream (mtl_tts.py, master) use; the knob said 2.0 and
      // sent nothing at its default (audit §5 D3).
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2, advanced: true }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
      ...chatterboxExtraKnobs(),
      seedKnob(),
    ],
    pitch_post_process: true,
  }),

  "chatterbox-multilingual": detail({
    engine_id: "chatterbox-multilingual",
    display_name: "Chatterbox Multilingual",
    supports_voice_cloning: true,
    knobs: [
      temperatureKnob(0.8),
      exaggerationKnob(),
      cfgWeightKnob(),
      // 1.2: audio.cpp's and upstream's (audit §5 D3).
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2, advanced: true }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 1.0, advanced: true }),
      ...chatterboxExtraKnobs(),
      seedKnob(),
    ],
    pitch_post_process: true,
    notes: [
      `${CHATTERBOX_VARIANTS[0].languages.length} languages. For language transfer, set cfg_weight=0 (Resemble docs).`,
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
    knobs: [
      temperatureKnob(0.8),
      knob({ key: "repetition_penalty", label: "Repetition penalty", min: 1.0, max: 4.0, step: 0.1, default: 1.2, advanced: true }),
      knob({ key: "top_p", label: "Top p", min: 0.05, max: 1.0, step: 0.01, default: 0.95, advanced: true }),
      knob({ key: "top_k", label: "Top k", min: 1, max: 2000, step: 1, default: 1000, advanced: true }),
      seedKnob(),
    ],
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
  knobs: [
    knob({ key: "cfg_value", label: "CFG", min: 1.0, max: 5.0, step: 0.1, default: 2.0, hint: "How closely it follows the voice and the text. Higher = stricter." }),
    knob({ key: "inference_timesteps", label: "Inference steps", min: 4, max: 30, step: 1, default: 10, advanced: true, hint: "More steps = finer detail, slower." }),
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
    seedKnob(),
  ],
  inline_tags: [],
  pitch_post_process: true,
  notes: [
    "Clones from a short clip, or designs a voice from a written description.",
    "Written direction reaches a cloned voice too.",
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

/** Capability detail by engine id OR variant id (variant ids first); null when none. */
export function lookup(engineOrVariantId) {
  if (Object.hasOwn(CAPABILITY_DETAILS, engineOrVariantId)) return CAPABILITY_DETAILS[engineOrVariantId];
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

