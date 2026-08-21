# SPDX-License-Identifier: MIT
"""Per-engine capability details — drives the Generate UI's knob + tag gating.

This is the hand-authored interim data for task #89 (engine capability
manifests). The data here is STATIC — pulled from upstream model cards
(HuggingFace), authoritative-source verification, and line-level audits
of each adapter's `synth()` function. See
`memory/reference_engine_capability_surface.md` for the sourcing trail.

Long-term goal: each engine's `manifest.py` declares its own KNOBS /
INLINE_TAGS / VARIANT_CAPABILITIES, and this central dict goes away.
Until then, keep this file authoritative — UI gating relies on it.

Per-variant entries (chatterbox-turbo, chatterbox-multilingual) exist
because the same engine family has materially different supported
parameters across model variants. Looking up a variant id falls back
to its base engine id; consumers should try the variant id first.
"""

from __future__ import annotations

from ..models import EngineCapabilityDetail, InlineTagSet, KnobSpec, TrainingSpec


# Shared knob definitions — reused across engines that accept the same
# control. Capability details below compose these with engine-specific
# defaults / ranges where they diverge from the shared shape.

def _temperature_knob(default: float = 0.8, advanced: bool = False) -> KnobSpec:
    return KnobSpec(
        key="temperature", label="Temperature",
        min=0.05, max=2.0, step=0.05, default=default,
        hint="Sampling variance. Lower = stable + robotic; higher = creative + wild.",
        advanced=advanced,
    )


def _speed_knob(default: float = 1.0) -> KnobSpec:
    return KnobSpec(
        key="speed", label="Speed",
        min=0.5, max=3.0, step=0.05, default=default, unit="×",
        hint="Reading pace multiplier.",
    )


def _seed_knob() -> KnobSpec:
    return KnobSpec(
        key="seed", label="Seed",
        min=0, max=2_000_000_000, step=1, default=0,
        hint="Lock deterministic generation. 0 = random.",
        advanced=True,
    )


def _qwen_sampling_knobs() -> list[KnobSpec]:
    """The talker sampling surface — identical across every Qwen3 checkpoint
    family (CustomVoice / Base / VoiceDesign share the talker architecture);
    what differs per family is capability, not knobs."""
    return [
        KnobSpec(
            key="talker_temperature", label="Temperature",
            min=0.05, max=2.0, step=0.05, default=0.9,
            hint="Sampling variance for the talker model.",
        ),
        KnobSpec(
            key="talker_top_k", label="Top k",
            min=1, max=100, step=1, default=50, advanced=True,
        ),
        KnobSpec(
            key="talker_top_p", label="Top p",
            min=0.0, max=1.0, step=0.01, default=1.0, advanced=True,
        ),
        KnobSpec(
            key="repetition_penalty", label="Repetition penalty",
            min=1.0, max=4.0, step=0.05, default=1.05, advanced=True,
        ),
        _seed_knob(),
    ]


# ─── Per-engine capability rows ────────────────────────────────────────

CAPABILITY_DETAILS: dict[str, EngineCapabilityDetail] = {

    # ─── Kokoro (kokoro-onnx + StyleTTS2, deterministic) ───────────────
    "kokoro": EngineCapabilityDetail(
        engine_id="kokoro",
        display_name="Kokoro",
        supports_voice_cloning=False,
        supports_phoneme_input=True,  # upstream `is_phonemes` bypass
        # A Kokoro voice is a (510, 1, 256) float32 style array, and
        # kokoro-onnx's create() takes a raw array — so blends are plain
        # elementwise weighted averages, auditioned instantly (2026-08-19).
        supports_voice_blending=True,
        knobs=[_speed_knob()],
        inline_tags=[],
        pitch_native_st_range=None,
        pitch_post_process=True,  # the server can pitch-shift the output WAV
        notes=[
            "Deterministic — no temperature or seed. Same input → same output.",
            "Pitch shift only available via post-process (the server shifts the rendered audio).",
            "Advanced: IPA phoneme override available — bypasses text parser.",
            "Blending: 2–5 Kokoro voices, weight each, hear it instantly — the "
            "result is a normal Kokoro voice forever after.",
        ],
    ),

    # ─── Chatterbox base (full parameter surface) ─────────────────────
    "chatterbox": EngineCapabilityDetail(
        engine_id="chatterbox",
        display_name="Chatterbox",
        supports_voice_cloning=True,
        supports_clone_prompt_text=False,
        knobs=[
            _temperature_knob(default=0.8),
            KnobSpec(
                key="exaggeration", label="Exaggeration",
                min=0.25, max=2.0, step=0.05, default=0.5,
                hint="Expressiveness. 0.3–0.4 = flat narration. >1.0 = dramatic.",
            ),
            KnobSpec(
                key="cfg_weight", label="CFG weight",
                min=0.0, max=1.0, step=0.05, default=0.5,
                hint="Text adherence. Lower = looser pacing; higher = strict.",
            ),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=2.0,
                advanced=True,
            ),
            KnobSpec(
                key="min_p", label="Min p", min=0.0, max=1.0, step=0.01,
                default=0.05, advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_post_process=True,
    ),

    # ─── Chatterbox-Turbo (REDUCED — exaggeration/cfg/min_p DISABLED) ─
    "chatterbox-turbo": EngineCapabilityDetail(
        engine_id="chatterbox-turbo",
        display_name="Chatterbox Turbo",
        supports_voice_cloning=True,
        # LoRA fine-tuning on the t3 transformer, adapted from
        # gokhaneraslan/chatterbox-finetuning (Apache-2.0), whose author
        # reports stable results training Turbo this way. A trained voice
        # keeps the 19 inline tags. NOT YET HEARD here - see the note.
        supports_training=True,
        # gokhaneraslan's config.py defaults, read from its source
        # 2026-08-19: is_lora r=128 alpha=256, lr 1e-4 (the LoRA branch),
        # epochs 10, accum 1. TURBO'S TARGET MODULES ARE ITS OWN
        # (`turbo_lora_target_modules`) - c_attn/c_proj/c_fc are GPT-2
        # style names, and the llama-style q_proj/k_proj set the other
        # chatterbox variants use would match NOTHING in this checkpoint:
        # PEFT would attach zero adapters and the run would train nothing
        # while reporting a falling loss from `modules_to_save` alone.
        # batch_size 1 x grad_accum 32 preserves their EFFECTIVE batch of
        # 32 (they run batch 32 x accum 1 through a padding collator; our
        # loop steps one sample at a time, so accumulation has to carry
        # it). Getting this wrong is not cosmetic - a 4x smaller effective
        # batch is a different training run.
        # Precision None = the trainer's own dtype choice, not stated
        # upstream and not asserted here.
        training_defaults=TrainingSpec(
            epochs=10,
            learning_rate=1e-4,
            batch_size=1,
            grad_accum=32,
            lora_rank=128,
            lora_alpha=256,
            precision=None,
            target_modules=["c_attn", "c_proj", "c_fc", "spkr_enc"],
        ),
        # 2026-08-17 — introspected: ChatterboxTurboTTS.generate(text,
        #   repetition_penalty=1.2, min_p=0.0, top_p=0.95, audio_prompt_path=None,
        #   exaggeration=0.0, cfg_weight=0.0, temperature=0.8, top_k=1000,
        #   norm_loudness=True)
        # repetition_penalty's default here said 2.0 (the Multilingual value);
        # Turbo's is 1.2, which is also what the adapter passes. top_k/top_p
        # were hardcoded in the adapter and unreachable — now declared.
        knobs=[
            _temperature_knob(default=0.8),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=1.2, advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.0, max=1.0, step=0.01,
                default=0.95, advanced=True,
            ),
            KnobSpec(
                key="top_k", label="Top k", min=1, max=2000, step=1,
                default=1000, advanced=True,
            ),
            _seed_knob(),
        ],
        # 2026-08-17 — the full set, read from the checkpoint's own
        # `added_tokens.json` (huggingface.co/ResembleAI/chatterbox-turbo).
        # NINETEEN tokens hold reserved ids 50257–50275; this file declared
        # four of them, so fifteen were unreachable from any UI. Split into
        # three categories because they are not one kind of thing: a state the
        # line is spoken IN, a register it is read AS, and a sound made AT a
        # point in the text.
        #
        # Upstream's model card names only [cough] [laugh] [chuckle] and says
        # "and more", so the other sixteen are DECLARED BUT UNRENDERED here —
        # deliberate special tokens with reserved ids, not yet verified by ear.
        inline_tags=[
            InlineTagSet(
                category="emotion",
                label="Emotion",
                tags=[
                    "angry", "fear", "happy", "sarcastic", "surprised",
                    "crying", "whispering",
                ],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="The state the line is spoken in. Place at the start of "
                     "the line unless you want the shift mid-sentence.",
                # Turbo is the only shipped engine that can take `Delivery.
                # emotion` as anything but prose, which makes this map the
                # whole reason the enum is cross-engine at all.
                #
                # `neutral` maps to the empty string: expressible, emits no
                # tag. Absent keys are NOT expressible here and the UI says so
                # instead of substituting a near-neighbour — `shouted` and
                # `contemptuous` have no token at all, and `[crying]` is a
                # behaviour rather than `sad`'s state, so mapping sad onto it
                # would put sobbing into a quietly sad line.
                value_map={
                    "neutral": "",
                    "happy": "happy",
                    "angry": "angry",
                    "fearful": "fear",
                    "whispered": "whispering",
                    "sarcastic": "sarcastic",
                },
            ),
            InlineTagSet(
                category="register",
                label="Register",
                tags=["narration", "dramatic", "advertisement"],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="How the passage is read overall, rather than what the "
                     "speaker feels.",
            ),
            InlineTagSet(
                category="paralinguistic",
                label="Non-verbal",
                tags=[
                    "cough", "laugh", "chuckle", "sigh", "gasp", "groan",
                    "sniff", "clear throat", "shush",
                ],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="Insert at the moment in the text where you want the sound.",
            ),
        ],
        pitch_post_process=True,
        notes=[
            "Turbo accepts exaggeration / cfg_weight / min_p but defaults them "
            "to 0.0 — off — to maintain speed (Resemble AI / ollieollie). We "
            "leave them at the upstream default and hide the sliders.",
            "The 19 inline tags are unique to Turbo — Multilingual shares the "
            "engine but not the tokenizer, and reads them as words.",
            "[surprised] and [crying] have no Delivery.emotion equivalent; "
            "type them inline. [shouted] and [contemptuous] have no token.",
            "Training on this engine is new and nobody has listened to a "
            "voice it produced yet. The recipe follows a working upstream "
            "one, but expect to judge the first result by ear.",
        ],
    ),

    # ─── Chatterbox-Multilingual (EXTENDED surface, 23 languages) ─────
    "chatterbox-multilingual": EngineCapabilityDetail(
        engine_id="chatterbox-multilingual",
        display_name="Chatterbox Multilingual",
        supports_voice_cloning=True,
        knobs=[
            _temperature_knob(default=0.8),
            KnobSpec(
                key="exaggeration", label="Exaggeration",
                min=0.25, max=2.0, step=0.05, default=0.5,
            ),
            KnobSpec(
                key="cfg_weight", label="CFG weight",
                min=0.0, max=1.0, step=0.05, default=0.5,
            ),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=2.0, advanced=True,
            ),
            KnobSpec(
                key="min_p", label="Min p", min=0.0, max=1.0, step=0.01,
                default=0.05, advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.0, max=1.0, step=0.01,
                default=1.0, advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_post_process=True,
        notes=["23 languages. For language transfer, set cfg_weight=0 (Resemble docs)."],
    ),

    # ─── Qwen3-TTS ────────────────────────────────────────────────────
    # Four rows: the engine-level row is the FALLBACK (the union across
    # checkpoint families — kept so an unrecognised variant id degrades to
    # something rather than nothing), and three family rows carry the truth
    # the union hides. `lookup()` walks suffixes, so `qwen3-cv-1.7b` and
    # `qwen3-cv-0.6b` both land on "qwen3-cv" — one row per family, not per
    # size. Added 2026-08-19: the engine-level union told a CustomVoice
    # persona it could clone (the tracked variant-aware-verdict item).
    "qwen3": EngineCapabilityDetail(
        engine_id="qwen3",
        display_name="Qwen3-TTS",
        # Union across families — prefer the qwen3-cv / qwen3-base /
        # qwen3-vd rows, which consumers reach via the variant id.
        supports_voice_cloning=True,
        supports_voice_design=True,
        supports_instruct_freeform=True,
        supports_training=True,
        knobs=_qwen_sampling_knobs(),
        pitch_post_process=True,
        notes=[
            "Instruct field is the primary control — describe voice in plain "
            "English (\"young, sarcastic\", \"stadium announcement\", \"angry whisper\").",
        ],
    ),

    "qwen3-cv": EngineCapabilityDetail(
        engine_id="qwen3-cv",
        display_name="Qwen3-TTS CustomVoice",
        # 9 preset speakers + instruct. CANNOT clone — the model card is
        # explicit, and the adapter refuses a reference clip on this family.
        supports_voice_cloning=False,
        supports_voice_design=False,
        supports_instruct_freeform=True,
        knobs=_qwen_sampling_knobs(),
        pitch_post_process=True,
        notes=[
            "Instruct field is the primary control — describe delivery in "
            "plain English.",
            "No cloning on this checkpoint — the Base family clones.",
        ],
    ),

    "qwen3-base": EngineCapabilityDetail(
        engine_id="qwen3-base",
        display_name="Qwen3-TTS Base",
        # Clone-only: 3–10 s reference clip, no preset speakers, and the
        # checkpoint drops instruct silently. Passing the clip's exact
        # transcript (`ref_text`) raises clone quality — the upstream
        # generate_voice_clone signature takes it.
        supports_voice_cloning=True,
        supports_clone_prompt_text=True,
        # Upstream's own demo exposes this as "Use x-vector only (no
        # reference text needed, but lower quality)".
        supports_xvector_only=True,
        supports_voice_design=False,
        supports_instruct_freeform=False,
        # LoRA fine-tuning lands on this family (talker q/k/v/o projections;
        # the Alexandria-verified loop). A trained voice renders through
        # Base + adapter + x-vector prompt and DOES take instruct.
        supports_training=True,
        # Alexandria's train_lora.py defaults, read from its source
        # 2026-08-19 (r=32 α=128 dropout .05, AdamW lr 5e-6, batch 1 ×
        # accum 8, bf16 on CUDA). Epochs: its README recommends 15–30 for
        # voice identity (the script's own default of 50 is its ceiling,
        # with best-loss checkpointing doing the real stopping).
        training_defaults=TrainingSpec(
            epochs=20,
            learning_rate=5e-6,
            batch_size=1,
            grad_accum=8,
            lora_rank=32,
            lora_alpha=128,
            precision="bf16",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        ),
        knobs=_qwen_sampling_knobs(),
        pitch_post_process=True,
        notes=[
            "Clone-only checkpoint: no preset speakers, and written direction "
            "is dropped silently — train a LoRA to get identity + direction.",
            "Pass the reference clip's exact transcript for a better clone.",
        ],
    ),

    "qwen3-vd": EngineCapabilityDetail(
        engine_id="qwen3-vd",
        display_name="Qwen3-TTS VoiceDesign",
        # A voice from a prose description (1.7B only — upstream ships no
        # 0.6B VoiceDesign). The description rides the instruct slot into
        # generate_voice_design; a line's own direction appends to it.
        supports_voice_cloning=False,
        supports_voice_design=True,
        supports_instruct_freeform=True,
        knobs=_qwen_sampling_knobs(),
        pitch_post_process=True,
        notes=[
            "Describe the voice in plain English — \"gravel-voiced "
            "harbour-master, 70s\" — and the model invents it. No reference "
            "audio.",
            "1.7B only; there is no 0.6B VoiceDesign checkpoint.",
        ],
    ),

    # ─── TADA (flow-matching multilingual clone) ──────────────────────
    "tada": EngineCapabilityDetail(
        engine_id="tada",
        display_name="TADA",
        supports_voice_cloning=True,
        supports_clone_prompt_text=True,
        # 2026-08-17 audit: `steps` / `noise_temperature` / `faithfulness`
        # were declared here but `tada/engine.py` calls
        # `generate_from_text_and_prompt(text=, prompt=, language=)` and
        # reads NO delivery field at all — three sliders that moved nothing.
        # Removed rather than left decorative. Re-add each one only with the
        # adapter change that passes it, verified against the installed
        # package's signature (TADA is not in the shared venv, so it could
        # not be introspected here).
        knobs=[
            _seed_knob(),
        ],
        pitch_post_process=True,
        notes=[
            "Autoregressive — can't be abruptly cut mid-sentence (model "
            "will insert unnatural pauses to fill 1:1 token rhythm).",
            "Pass the ref audio's exact transcript for higher clone quality.",
            "No per-render knobs: the adapter's generate call takes text, "
            "prompt and language only. Seed still applies (torch.manual_seed).",
        ],
    ),

    # ─── LuxTTS (k2-fsa ZipVoice — has NATIVE PITCH via T-shift) ──────
    "luxtts": EngineCapabilityDetail(
        engine_id="luxtts",
        display_name="LuxTTS",
        supports_voice_cloning=True,
        # 2026-08-17 audit — introspected against the installed package:
        #   LuxTTS.generate_speech(text, encode_dict, num_steps=4,
        #       guidance_scale=3.0, t_shift=0.5, speed=1.0, return_smooth=False)
        #   LuxTTS.encode_prompt(prompt_audio, duration=5, rms=0.001)
        # Corrections made: `num_inference_steps` never matched the adapter's
        # `num_steps`, so steps were permanently 4; `max_ref_length` and
        # `volume` are real but belong to encode_prompt (`duration` / `rms`),
        # not to generate_speech — which is why neither reached anything.
        # Hints below are the fork's own words (github.com/ysharma3501/LuxTTS).
        knobs=[
            _speed_knob(),
            # NOT pitch. The fork's README calls t_shift a "sampling param,
            # higher can sound better but worse WER"; k2-fsa/ZipVoice defines
            # it as "shift t to smaller ones if t_shift < 1.0" — the
            # flow-matching timestep schedule, domain (0, 1.0], default 0.5.
            # It was declared here as semitone pitch over -6..+6 default 0.0,
            # out of domain in both directions, and meaning "no shift" where
            # the model wants 0.5.
            KnobSpec(
                key="t_shift", label="Timestep shift",
                min=0.1, max=1.0, step=0.05, default=0.5,
                hint="Sampling schedule. Higher can sound better but raises "
                     "pronunciation errors; lower is safer. Not a pitch control.",
                advanced=True,
            ),
            KnobSpec(
                key="num_steps", label="Inference steps",
                min=2, max=16, step=1, default=4,
                hint="Higher sounds better but takes longer — 3–4 is the "
                     "efficiency sweet spot.",
                advanced=True,
            ),
            KnobSpec(
                key="guidance_scale", label="Guidance scale (CFG)",
                min=0.0, max=10.0, step=0.5, default=3.0,
                hint="Higher = stricter clone match.",
                advanced=True,
            ),
            KnobSpec(
                key="max_ref_length", label="Max ref length",
                min=2.0, max=60.0, step=0.5, default=5.0, unit="s",
                hint="How much of the reference clip is encoded. Lower is "
                     "faster; set it above your clip's length to encode all of "
                     "it, which avoids truncation artifacts.",
                advanced=True,
            ),
            KnobSpec(
                key="rms", label="Reference loudness",
                min=0.001, max=0.1, step=0.001, default=0.001,
                hint="Normalisation target for the reference clip — higher is "
                     "louder. Around 0.01 is the fork's suggestion.",
                advanced=True,
            ),
            KnobSpec(
                key="return_smooth", label="Smoothing", min=0, max=1, step=1,
                default=0,
                hint="Set to 1 if the output sounds metallic — smoother, but "
                     "less clean.",
                advanced=True,
            ),
            _seed_knob(),
        ],
        # No native pitch. The previous `pitch_native_st_range=[-6, 6]` rested
        # on t_shift being a transposer, which it is not.
        pitch_post_process=True,
        notes=[
            "English-only. ZipVoice base.",
            "T-shift is a sampling-schedule parameter, not pitch — pitch here "
            "is post-process, same as every other engine.",
        ],
    ),

    # ─── MOSS-TTSD (multi-speaker dialogue) ───────────────────────────
    "moss-tts": EngineCapabilityDetail(
        engine_id="moss-tts",
        display_name="MOSS-TTSD",
        supports_voice_cloning=True,
        supports_multi_speaker=True,
        knobs=[
            # 2026-08-17 audit: declared against `moss_tts/engine.py:111-115`,
            # which is the full set the adapter forwards. `silence_duration`
            # was declared but never read — removed. These four were read but
            # never declared, so no UI could reach them — now visible.
            _temperature_knob(default=1.1),
            KnobSpec(
                key="top_p", label="Top-p", min=0.0, max=1.0, step=0.01,
                default=0.9, advanced=True,
            ),
            KnobSpec(
                key="top_k", label="Top-k", min=1, max=200, step=1,
                default=50, advanced=True,
            ),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.05, default=1.1, advanced=True,
            ),
            KnobSpec(
                key="max_new_tokens", label="Max length", min=500, max=24000,
                step=500, default=12000, unit="tok",
                hint="Caps generated audio length — roughly 12.5 tokens per second.",
                advanced=True,
            ),
            _seed_knob(),
        ],
        inline_tags=[
            InlineTagSet(
                category="speaker", label="Speaker tag",
                tags=["S1", "S2", "S3"],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="Place before each speaker's line.",
            ),
            InlineTagSet(
                category="pause", label="Pause",
                tags=["pause 0.5s", "pause 1.0s", "pause 1.5s", "pause 2.0s"],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="Force exact silence gaps between sentences.",
            ),
        ],
        pitch_post_process=True,
        notes=[
            "Fundamentally multi-speaker. Provide a speaker_prompts map per [Sx] tag.",
            "UNVERIFIED UPSTREAM: these five knobs mirror what "
            "moss_tts/engine.py forwards into MossTTSDPipeline.generate(), but "
            "moss_ttsd is not in the shared venv so the pipeline's real "
            "signature could not be introspected. They are standard sampling "
            "names for an LLM-based TTS and the adapter splats them, so an "
            "unaccepted key would raise at synth. Confirm against the package "
            "before relying on the ranges.",
        ],
    ),

}


def lookup(engine_or_variant_id: str) -> EngineCapabilityDetail | None:
    """Look up capability detail by engine id OR variant id.

    Variant ids (`chatterbox-turbo`, `chatterbox-multilingual`) take
    precedence. Falls back to base engine id when no variant entry exists.
    """
    if engine_or_variant_id in CAPABILITY_DETAILS:
        return CAPABILITY_DETAILS[engine_or_variant_id]
    # Walk the "-" suffixes off one at a time, most specific first. Manifest
    # variant ids carry a version tail the capability map does not, so
    # "chatterbox-turbo-v1" has to reach "chatterbox-turbo" before it falls
    # through to "chatterbox". The previous `split("-")[0]` jumped straight
    # to the base engine, serving Multilingual's exaggeration / cfg_weight /
    # min_p for a Turbo load and hiding Turbo's paralinguistic tags.
    # `GenerateView.vue:lookupCapability` already walked suffixes; this is
    # the same rule, server-side.
    probe = engine_or_variant_id
    while "-" in probe:
        probe = probe.rsplit("-", 1)[0]
        if probe in CAPABILITY_DETAILS:
            return CAPABILITY_DETAILS[probe]
    return None


# MOSS names its variant family differently from the engine itself, so
# stripping suffixes never reaches its row and the endpoint 404s:
#
#   moss-ttsd-v0 → "moss-ttsd" → "moss"   but the engine id is "moss-tts"
#
# `GenerateView.lookupCapability` never hit this because it is handed the
# engine id as an explicit second candidate; `lookup()` only ever gets one
# string, so the alias has to live in the data. Renaming the variant instead
# would invalidate every already-downloaded model directory, which is keyed by
# variant id — a multi-GB re-download to fix a lookup.
#
# Dia had the same shape (`dia2-1b` → `dia2` vs engine id `dia`) until the
# engine was dropped on 2026-08-17.
#
# `test_engine_knob_wiring.py::test_every_manifest_variant_resolves_to_a_row`
# fails if a new variant is added whose id cannot reach its engine's row.
CAPABILITY_DETAILS["moss-ttsd"] = CAPABILITY_DETAILS["moss-tts"]

# Nano is Turbo's architecture with the SAME tag vocabulary (both repos'
# added_tokens.json compared byte-for-byte 2026-08-19) and the same
# generate surface. A copy with its OWN name, not an alias — the alias
# put a second "Chatterbox Turbo" in every picker (2026-08-20).
CAPABILITY_DETAILS["chatterbox-nano"] = CAPABILITY_DETAILS[
    "chatterbox-turbo"
].model_copy(update={"display_name": "Chatterbox Nano"})

# The MLX Base rows (macOS, 2026-08-19) are the torch Base row MINUS
# training: LoRA training runs the PyTorch trainer (train_lora.py,
# Windows/Linux) and MLX LoRA inference is not wired, so offering Train on
# a Mac would collect a dataset it cannot use. Suffix-walking
# "qwen3-base-1.7b-mlx" lands on "qwen3-base" (training=True) — these
# full-id rows pre-empt the walk.
_QWEN_BASE_MLX = CAPABILITY_DETAILS["qwen3-base"].model_copy(update={
    "supports_training": False,
    "training_defaults": None,
    "notes": [
        "Clone-only checkpoint: no preset speakers, and written direction "
        "is dropped silently.",
        "Pass the reference clip's exact transcript for a better clone.",
        "Training a voice needs the PyTorch Base checkpoint (Windows/"
        "Linux) — MLX LoRA inference is not wired.",
    ],
})
# Distinct display names per row — sharing the parent's name put three
# identical "Qwen3-TTS Base" entries in the model picker (2026-08-20).
CAPABILITY_DETAILS["qwen3-base-1.7b-mlx"] = _QWEN_BASE_MLX.model_copy(
    update={"display_name": "Qwen3-TTS Base 1.7B (MLX)"}
)
CAPABILITY_DETAILS["qwen3-base-0.6b-mlx"] = _QWEN_BASE_MLX.model_copy(
    update={"display_name": "Qwen3-TTS Base 0.6B (MLX)"}
)
