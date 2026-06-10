# SPDX-License-Identifier: GPL-3.0-or-later
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

from ..models import EngineCapabilityDetail, InlineTagSet, KnobSpec


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


# ─── Per-engine capability rows ────────────────────────────────────────

CAPABILITY_DETAILS: dict[str, EngineCapabilityDetail] = {

    # ─── Kokoro (sherpa-onnx + StyleTTS2, deterministic) ───────────────
    "kokoro": EngineCapabilityDetail(
        engine_id="kokoro",
        display_name="Kokoro",
        supports_voice_cloning=False,
        supports_phoneme_input=True,  # upstream `input_phonemes` / `in_ps`
        knobs=[_speed_knob()],
        inline_tags=[],
        pitch_native_st_range=None,
        pitch_post_process=True,  # we can pedalboard the output WAV
        notes=[
            "Deterministic — no temperature or seed. Same input → same output.",
            "Pitch shift only available via post-process (server applies pedalboard).",
            "Advanced: IPA phoneme override available — bypasses text parser.",
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
        knobs=[
            _temperature_knob(default=0.8),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=2.0, advanced=True,
            ),
            _seed_knob(),
        ],
        inline_tags=[
            InlineTagSet(
                category="paralinguistic",
                label="Paralinguistic (Turbo-only)",
                tags=["cough", "laugh", "chuckle", "sigh"],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="Insert at the moment in the text where you want the sound.",
            ),
        ],
        pitch_post_process=True,
        notes=[
            "Turbo intentionally omits exaggeration / cfg_weight / min_p "
            "to maintain speed (Resemble AI / ollieollie). Sliders for those are hidden.",
            "Paralinguistic tags [cough] [laugh] [chuckle] [sigh] are unique to Turbo.",
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

    # ─── Qwen3-TTS (freeform instruct + sampling knobs) ───────────────
    "qwen3": EngineCapabilityDetail(
        engine_id="qwen3",
        display_name="Qwen3-TTS",
        supports_voice_cloning=True,
        supports_voice_design=True,
        supports_instruct_freeform=True,
        supports_style_prompt=True,
        knobs=[
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
        ],
        pitch_post_process=True,
        notes=[
            "Instruct field is the primary control — describe voice in plain "
            "English (\"young, sarcastic\", \"stadium announcement\", \"angry whisper\").",
        ],
    ),

    # ─── TADA (flow-matching multilingual clone) ──────────────────────
    "tada": EngineCapabilityDetail(
        engine_id="tada",
        display_name="TADA",
        supports_voice_cloning=True,
        supports_clone_prompt_text=True,
        knobs=[
            KnobSpec(
                key="steps", label="Flow steps",
                min=4, max=32, step=1, default=10,
                hint="Refinement passes. 10 = fast + good. 20 = slower.",
                advanced=True,
            ),
            KnobSpec(
                key="noise_temperature", label="Noise temperature (kσ)",
                min=0.0, max=2.0, step=0.05, default=0.7,
                hint="Pitch + emotion variance.",
                advanced=True,
            ),
            KnobSpec(
                key="faithfulness", label="Speaker faithfulness",
                min=0.0, max=1.0, step=0.05, default=0.7,
                hint="Higher = stricter clone match.",
                advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_post_process=True,
        notes=[
            "Autoregressive — can't be abruptly cut mid-sentence (model "
            "will insert unnatural pauses to fill 1:1 token rhythm).",
            "Pass the ref audio's exact transcript for higher clone quality.",
        ],
    ),

    # ─── LuxTTS (k2-fsa ZipVoice — has NATIVE PITCH via T-shift) ──────
    "luxtts": EngineCapabilityDetail(
        engine_id="luxtts",
        display_name="LuxTTS",
        supports_voice_cloning=True,
        knobs=[
            _speed_knob(),
            KnobSpec(
                key="t_shift", label="Pitch shift (T-shift)",
                min=-6.0, max=6.0, step=0.25, default=0.0, unit="st",
                hint="Native pitch control — only engine with continuous pitch.",
            ),
            KnobSpec(
                key="volume", label="Volume",
                min=0.0, max=2.0, step=0.05, default=1.0,
                advanced=True,
            ),
            KnobSpec(
                key="num_inference_steps", label="Inference steps",
                min=2, max=16, step=1, default=4,
                hint="Distilled — 4 keeps 150× realtime.",
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
                min=2.0, max=15.0, step=0.5, default=5.0, unit="s",
                advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_native_st_range=[-6, 6],  # T-shift is native
        pitch_post_process=False,  # native exists, no need
        notes=["English-only. ZipVoice base. Only engine with continuous native pitch."],
    ),

    # ─── Dia (Nari Labs — dialogue + paralinguistic-in-parens) ────────
    "dia": EngineCapabilityDetail(
        engine_id="dia",
        display_name="Dia",
        supports_voice_cloning=True,
        supports_clone_prompt_text=True,
        knobs=[
            KnobSpec(
                key="speed_factor", label="Speed",
                min=0.5, max=2.0, step=0.05, default=1.0, unit="×",
                hint="Long text (>20s) auto-accelerates — keep chunks short.",
            ),
            _temperature_knob(default=0.7),
            KnobSpec(
                key="cfg_scale", label="CFG scale",
                min=0.0, max=10.0, step=0.5, default=3.0,
            ),
            KnobSpec(
                key="top_p", label="Top p",
                min=0.0, max=1.0, step=0.01, default=1.0, advanced=True,
            ),
            KnobSpec(
                key="top_k", label="Top k",
                min=1, max=200, step=1, default=50, advanced=True,
            ),
            _seed_knob(),
        ],
        inline_tags=[
            InlineTagSet(
                category="speaker", label="Speaker turn",
                tags=["S1", "S2"],
                syntax="[{value}]",
                placement="inline_anywhere",
                hint="Place at the START of each conversational line. Alternate S1/S2.",
            ),
            InlineTagSet(
                category="paralinguistic", label="Non-verbal",
                tags=["laughs", "sighs", "clears throat", "singing", "screams"],
                syntax="({value})",
                placement="inline_anywhere",
                hint="Insert at the moment in the text.",
            ),
        ],
        pitch_post_process=True,
    ),

    # ─── MOSS-TTSD (multi-speaker dialogue) ───────────────────────────
    "moss-tts": EngineCapabilityDetail(
        engine_id="moss-tts",
        display_name="MOSS-TTSD",
        supports_voice_cloning=True,
        supports_multi_speaker=True,
        knobs=[
            _temperature_knob(default=1.1),
            KnobSpec(
                key="silence_duration", label="Silence padding",
                min=0.0, max=1.0, step=0.05, default=0.1, unit="s",
                hint="Pads between ref clip end and generated audio. Tweak up if ref-audio bleed.",
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
        notes=["Fundamentally multi-speaker. Provide a speaker_prompts map per [Sx] tag."],
    ),

}


def lookup(engine_or_variant_id: str) -> EngineCapabilityDetail | None:
    """Look up capability detail by engine id OR variant id.

    Variant ids (`chatterbox-turbo`, `chatterbox-multilingual`) take
    precedence. Falls back to base engine id when no variant entry exists.
    """
    if engine_or_variant_id in CAPABILITY_DETAILS:
        return CAPABILITY_DETAILS[engine_or_variant_id]
    # Heuristic fallback: strip "-turbo" / "-multilingual" / etc. and retry.
    base = engine_or_variant_id.split("-")[0]
    return CAPABILITY_DETAILS.get(base)
