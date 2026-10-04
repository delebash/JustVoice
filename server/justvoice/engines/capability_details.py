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

from ..models import EngineCapabilityDetail, InlineTagSet, KnobSpec
from .audiocpp.release import pinned_has
from .chatterbox.manifest import VARIANTS as _CHATTERBOX_VARIANTS


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
    # 0 (or empty) is a new take each time: the request mapping sends a random seed for it —
    # audio.cpp's own "no seed" repeated for Kokoro, Kitten, Turbo and VoxCPM2 (audit §5 D1).
    return KnobSpec(
        key="seed", label="Seed",
        min=0, max=2_000_000_000, step=1, default=0,
        hint="The same seed repeats the same take. 0 = a new take each time.",
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
            # Not 0: Qwen3 reads a top-p of 0 as "no filter" (audit §5 D9).
            key="talker_top_p", label="Top p",
            min=0.05, max=1.0, step=0.01, default=1.0, advanced=True,
        ),
        KnobSpec(
            key="repetition_penalty", label="Repetition penalty",
            min=1.0, max=4.0, step=0.05, default=1.05, advanced=True,
        ),
        # The sub-talker fills in each frame's finer audio codes after the talker picks the
        # first; audio.cpp samples it with its own three settings, defaults from the model's
        # generation_config.json (../audio.cpp/include/engine/models/qwen3_tts/types.h).
        KnobSpec(
            key="subtalker_temperature", label="Detail temperature",
            min=0.05, max=2.0, step=0.05, default=0.9, advanced=True,
            hint="Sampling variance for the finer audio detail (the sub-talker).",
        ),
        KnobSpec(
            key="subtalker_top_k", label="Detail top k",
            min=1, max=100, step=1, default=50, advanced=True,
        ),
        KnobSpec(
            key="subtalker_top_p", label="Detail top p",
            min=0.05, max=1.0, step=0.01, default=1.0, advanced=True,
        ),
        _seed_knob(),
    ]


def _chatterbox_extra_knobs() -> list[KnobSpec]:
    """Two more settings audio.cpp's Chatterbox reads per request
    (../audio.cpp/src/models/chatterbox/session.cpp, defaults in tts.h) — the app offered
    neither and said it had no min-p (audit 2026-10-04 §7)."""
    return [
        KnobSpec(
            key="min_p", label="Min p", min=0.0, max=0.5, step=0.01, default=0.05,
            advanced=True,
            hint="Drops sounds less likely than this share of the likeliest. 0 = off.",
        ),
        KnobSpec(
            key="s3gen_cfg_rate", label="Decoder CFG", min=0.0, max=1.5, step=0.05,
            default=0.7, advanced=True,
            hint="How closely the audio decoder holds to the cloned voice.",
        ),
    ]


# ─── Per-engine capability rows ────────────────────────────────────────

CAPABILITY_DETAILS: dict[str, EngineCapabilityDetail] = {

    # ─── Kokoro (audio.cpp kokoro_tts, since the 2026-10-01 switch) ───
    "kokoro": EngineCapabilityDetail(
        engine_id="kokoro",
        display_name="Kokoro",
        supports_voice_cloning=False,
        # A lexicon's IPA (gap 3) rides our audio.cpp's inline "[word](/phonemes/)" —
        # offered once the pinned build has it; render_core also checks the INSTALLED one.
        supports_phoneme_input=pinned_has("inline_ipa"),
        # Blends (gap 2) need our audio.cpp's `voice_pack` option — offered once the
        # pinned build has it (release.pinned_has), so the flag flips with the pin.
        supports_voice_blending=pinned_has("voice_pack"),
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
    # temperature, exaggeration, CFG (its `guidance_scale`), repetition penalty,
    # top-p, min-p and the decoder's CFG rate per request. Turbo and Nano have rows
    # of their own below (gap 1).
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
                # 1.2 is what audio.cpp and upstream (mtl_tts.py, master) use; the knob
                # said 2.0 and sent nothing at its default (audit §5 D3).
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=1.2,
                advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.05, max=1.0, step=0.01,
                default=1.0, advanced=True,
            ),
            *_chatterbox_extra_knobs(),
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
                # 1.2: audio.cpp's and upstream's (audit §5 D3).
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=1.2, advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.05, max=1.0, step=0.01,
                default=1.0, advanced=True,
            ),
            *_chatterbox_extra_knobs(),
            _seed_knob(),
        ],
        pitch_post_process=True,
        notes=[f"{len(_CHATTERBOX_VARIANTS[0]['languages'])} languages. For language transfer, "
               "set cfg_weight=0 (Resemble docs).",
               "The same seed gives the same audio."],
    ),

    # ─── Chatterbox Turbo (and Nano, below) — back with gap 1 ─────────
    # docs/plans/2026-10-03-gap-1-turbo-cloning.md. Our audio.cpp clones on
    # Turbo from a file we convert from Resemble's own checkpoint. The row is
    # the pre-switch one (git 1c7398d^) minus training (gap 5). Turbo takes
    # temperature, top-p, top-k and repetition penalty per request;
    # exaggeration / CFG / min-p do nothing on Turbo (upstream ignores them
    # with a warning), so they are not offered.
    "chatterbox-turbo": EngineCapabilityDetail(
        engine_id="chatterbox-turbo",
        display_name="Chatterbox Turbo",
        supports_voice_cloning=True,
        supports_clone_prompt_text=False,
        knobs=[
            _temperature_knob(default=0.8),
            KnobSpec(
                key="repetition_penalty", label="Repetition penalty",
                min=1.0, max=4.0, step=0.1, default=1.2, advanced=True,
            ),
            KnobSpec(
                key="top_p", label="Top p", min=0.05, max=1.0, step=0.01,
                default=0.95, advanced=True,
            ),
            KnobSpec(
                key="top_k", label="Top k", min=1, max=2000, step=1,
                default=1000, advanced=True,
            ),
            _seed_knob(),
        ],
        # The checkpoint's own added_tokens.json: nineteen reserved tokens,
        # ids 50257–50275, in three kinds — a state the line is spoken IN, a
        # register it is read AS, and a sound made AT a point in the text.
        # Upstream's model card names only [cough] [laugh] [chuckle] and says
        # "and more"; the other sixteen are declared from the reserved ids.
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
                # `Delivery.emotion` compiles to these tokens. `neutral` maps
                # to the empty string: expressible, emits no tag. Absent keys
                # are not expressible here — `shouted` and `contemptuous` have
                # no token, and `[crying]` is a behaviour rather than `sad`'s
                # state, so sad is not mapped onto it.
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
            "English only. Clones from a reference clip longer than 5 seconds.",
            "The 19 inline tags are Turbo's own — Multilingual shares the engine "
            "but not the tokenizer, and reads them as words.",
            "[surprised] and [crying] have no Delivery.emotion equivalent; "
            "type them inline. [shouted] and [contemptuous] have no token.",
            "The same seed gives the same audio.",
        ],
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


CAPABILITY_DETAILS["voxcpm2"] = EngineCapabilityDetail(
    # ─── VoxCPM2 (audio.cpp `voxcpm2`, gap 9, 2026-10-02) ──────────────
    # Clones from a clip and designs from a description; written direction reaches both as
    # the parenthesised prefix. The clip's transcript reaches the model from our build
    # v0.9.0-jv.1 on (manifest docstring), so the transcript field follows the pin.
    engine_id="voxcpm2",
    display_name="VoxCPM2",
    supports_voice_cloning=True,
    supports_clone_prompt_text=pinned_has("voxcpm2_transcript"),
    supports_voice_design=True,
    supports_instruct_freeform=True,
    knobs=[
        KnobSpec(
            key="cfg_value", label="CFG",
            min=1.0, max=5.0, step=0.1, default=2.0,
            hint="How closely it follows the voice and the text. Higher = stricter.",
        ),
        KnobSpec(
            key="inference_timesteps", label="Inference steps",
            min=4, max=30, step=1, default=10, advanced=True,
            hint="More steps = finer detail, slower.",
        ),
        # A take that runs far longer than its text — a "runaway" — is cut and made again
        # (../audio.cpp/src/models/voxcpm2/generator.cpp; defaults in types.h, audit §7).
        KnobSpec(
            key="retry_badcase_max_times", label="Tries on a runaway",
            min=1, max=10, step=1, default=3, advanced=True,
            hint="A take that runs too long for its text is made again, up to this many "
                 "tries in all.",
        ),
        KnobSpec(
            key="retry_badcase_ratio_threshold", label="Runaway limit",
            min=2.0, max=12.0, step=0.5, default=6.0, advanced=True,
            hint="How long a take may run for its text before it is cut and tried again. "
                 "Lower cuts sooner; too low cuts real speech.",
        ),
        _seed_knob(),
    ],
    inline_tags=[],
    pitch_post_process=True,
    notes=[
        "Clones from a short clip, or designs a voice from a written description.",
        "Written direction reaches a cloned voice too.",
        "48 kHz output.",
    ],
)


# Nano is Turbo's architecture at 110M parameters with the same tag vocabulary
# (both repos' added_tokens.json compared byte for byte 2026-08-19) and the same
# generate surface. A copy with its own name, not an alias — the alias put a
# second "Chatterbox Turbo" in every picker (2026-08-20).
CAPABILITY_DETAILS["chatterbox-nano"] = CAPABILITY_DETAILS["chatterbox-turbo"].model_copy(
    update={"engine_id": "chatterbox-nano", "display_name": "Chatterbox Nano"})


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
