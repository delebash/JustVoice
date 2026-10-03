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

Per-variant entries (qwen3-cv / qwen3-base / qwen3-vd, chatterbox-multilingual)
exist because the same engine family has materially different supported
parameters or capabilities across model variants. Looking up a variant id falls back
to its base engine id; consumers should try the variant id first.
"""

from __future__ import annotations

from ..models import EngineCapabilityDetail, KnobSpec


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

    # ─── Kokoro (audio.cpp kokoro_tts, since the 2026-10-01 switch) ───
    "kokoro": EngineCapabilityDetail(
        engine_id="kokoro",
        display_name="Kokoro",
        supports_voice_cloning=False,
        # Per-word IPA from lexicons and blended voices return with the switch
        # plan's gaps (docs/plans/2026-10-01-audiocpp-switch.md §5, gaps 2–3):
        # audio.cpp takes neither a voice vector nor a text+IPA splice yet.
        supports_phoneme_input=False,
        supports_voice_blending=False,
        # audio.cpp's Kokoro takes a decoder-noise seed — the same seed repeats
        # the same audio (measured 2026-10-01); the old onnx path could not.
        knobs=[_speed_knob(), _seed_knob()],
        inline_tags=[],
        pitch_native_st_range=None,
        pitch_post_process=True,  # the server can pitch-shift the output WAV
        speed_native=True,
        notes=[
            "Pitch shift is post-process (the server shifts the rendered audio).",
            "The same seed gives the same audio.",
        ],
    ),

    # ─── KittenTTS (audio.cpp `kitten_tts`, CPU placement 2026-10-02) ───
    # Speed only: audio.cpp's KittenTTS takes a seed, but the same seed does not repeat
    # the same audio (measured 2026-10-02), so no seed control is offered.
    "kitten": EngineCapabilityDetail(
        engine_id="kitten",
        display_name="KittenTTS",
        supports_voice_cloning=False,
        knobs=[_speed_knob()],
        inline_tags=[],
        pitch_native_st_range=None,
        pitch_post_process=True,
        speed_native=True,
        notes=[
            "Eight English preset voices, made for the CPU.",
            "The same seed does not repeat the same audio.",
        ],
    ),

    # ─── Pocket TTS (audio.cpp `pocket_tts`, CPU placement 2026-10-02) ──
    # Clones from the clip alone (no transcript input) and speaks 20 presets; audio.cpp
    # takes no other request options for it. The same seed repeats the same audio
    # (measured 2026-10-02). Cloning waits on Kyutai's terms (manifest TERMS).
    "pocket": EngineCapabilityDetail(
        engine_id="pocket",
        display_name="Pocket TTS",
        supports_voice_cloning=True,
        supports_clone_prompt_text=False,
        knobs=[_seed_knob()],
        inline_tags=[],
        pitch_native_st_range=None,
        pitch_post_process=True,
        notes=[
            "Clones from a short clip, fast enough on the CPU.",
            "One model per language — load the model for the language you are rendering.",
            "Cloning asks you to accept Kyutai's terms once.",
        ],
    ),

    # ─── Chatterbox (audio.cpp `chatterbox`, since the 2026-10-01 switch) ─
    # The engine-level row is the fallback; the Multilingual row below is what
    # every shipped variant resolves to. audio.cpp's Chatterbox takes
    # temperature, exaggeration, CFG (its `guidance_scale`), repetition penalty
    # and top-p per request — no min-p, which the PyTorch engine had. Turbo,
    # Nano and their 19 inline tags return with Turbo cloning
    # (docs/plans/2026-10-01-audiocpp-switch.md §5, gap 1).
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
                key="top_p", label="Top p", min=0.0, max=1.0, step=0.01,
                default=1.0, advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_post_process=True,
    ),

    "chatterbox-multilingual": EngineCapabilityDetail(
        engine_id="chatterbox-multilingual",
        display_name="Chatterbox Multilingual",
        supports_voice_cloning=True,
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
                min=1.0, max=4.0, step=0.1, default=2.0, advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.0, max=1.0, step=0.01,
                default=1.0, advanced=True,
            ),
            _seed_knob(),
        ],
        pitch_post_process=True,
        notes=["19 languages. For language transfer, set cfg_weight=0 (Resemble docs).",
               "The same seed gives the same audio."],
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
        knobs=_qwen_sampling_knobs(),
        pitch_post_process=True,
        notes=[
            "Clone-only checkpoint: no preset speakers, and written direction "
            "is dropped silently.",
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

}


def lookup(engine_or_variant_id: str) -> EngineCapabilityDetail | None:
    """Look up capability detail by engine id OR variant id.

    Variant ids (`chatterbox-multilingual`, `qwen3-cv`) take precedence.
    Falls back to base engine id when no variant entry exists.
    """
    if engine_or_variant_id in CAPABILITY_DETAILS:
        return CAPABILITY_DETAILS[engine_or_variant_id]
    # Walk the "-" suffixes off one at a time, most specific first. Manifest
    # variant ids carry a version/precision tail the capability map does not,
    # so "chatterbox-multilingual-v2-q8" has to reach "chatterbox-multilingual"
    # and "qwen3-base-1.7b-q8" has to reach "qwen3-base" before either falls
    # through to its engine row.
    # `GenerateView.vue:lookupCapability` already walked suffixes; this is
    # the same rule, server-side.
    probe = engine_or_variant_id
    while "-" in probe:
        probe = probe.rsplit("-", 1)[0]
        if probe in CAPABILITY_DETAILS:
            return CAPABILITY_DETAILS[probe]
    return None
