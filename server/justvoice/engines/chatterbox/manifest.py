# SPDX-License-Identifier: MIT
"""Manifest for Chatterbox Multilingual — voice cloning, run by the audio.cpp runtime.

Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) Chatterbox is one
GGUF file served by audio.cpp: no venv, no torch, no MPS patch. Measured on an RTX 2070
SUPER: 2.08× real time against 0.92× for the PyTorch engine it replaces, at 3.2 GB of
VRAM instead of 5.4.

Clone-only: every Chatterbox voice is a reference clip the user brings. Exaggeration and
CFG are set per line (verified 2026-10-01 — no model reload).

Turbo and Nano come back with gap 1 (docs/plans/2026-10-03-gap-1-turbo-cloning.md): our
audio.cpp clones on Turbo from a file we convert from Resemble's own checkpoint, published at
TURBO_REPO / NANO_REPO. Their rows wait in PENDING_VARIANTS until the pinned runtime has
`turbo_clone` (v0.9.0-jv.3). Not yet back: Hebrew, Japanese, Russian and Chinese (audio.cpp's
Chatterbox speaks 19 of the model's 23 languages — gap 7). Resemble's PerTh watermark is not
applied by audio.cpp (user, 2026-10-01: "dont care about watermark").
"""

from ..audiocpp.release import model_source, pinned_has, sixteen_bit

ID = "chatterbox"
NAME = "Chatterbox"

SUPPORTED_OSES = ["windows", "linux", "macos"]

# audio.cpp's core Chatterbox languages (model_specs/chatterbox.json, v0.9.0).
_LANGS = ["ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms", "nl",
          "no", "pl", "pt", "sv", "sw", "tr"]
# Gap 7 (docs/plans/2026-10-03-gap-7-more-languages.md): Hebrew, Russian and Chinese in our
# audio.cpp; Japanese too, with the optional Japanese dictionary.
if pinned_has("chatterbox_he_ru_zh"):
    _LANGS = sorted([*_LANGS, "he", "ru", "zh"])
if pinned_has("japanese"):
    _LANGS = sorted([*_LANGS, "ja"])

DESCRIPTION = (
    f"Resemble AI's open-source cloning TTS. Multilingual: 500M parameters, {len(_LANGS)} languages, "
    "zero-shot voice cloning, per-line exaggeration / CFG / temperature. Runs in the "
    "audio.cpp speech runtime."
)
LICENSE = "MIT"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    # Turbo's 19 inline tags; the tag filter reads the rendering variant's row, so
    # Multilingual keeps none (gap 1).
    "paralinguistic_tags": pinned_has("turbo_clone"),
    "phoneme_override": False,
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}


VARIANTS = [
    {
        "id": "chatterbox-multilingual-v2-q8",
        "name": f"Chatterbox Multilingual ({len(_LANGS)} languages)",
        "description": "Zero-shot cloning from a reference clip, with exaggeration and CFG "
                       "per line. 8-bit weights.",
        "languages": list(_LANGS),
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 88,
        "weights_license": "MIT",
        "sources": [model_source("Chatterbox-GGUF/chatterbox-q8_0.gguf", 2_088_393_668)],
        "audiocpp": {"family": "chatterbox", "task": "clon", "file": "Chatterbox-GGUF/chatterbox-q8_0.gguf"},
    },
]
# The 16-bit file at the same pinned commit (gap 9; audio.cpp ships Chatterbox as f16, not
# bf16); the 8-bit row stays the default.
VARIANTS.append(sixteen_bit(VARIANTS[0], "Chatterbox-GGUF/chatterbox-f16.gguf", 3_744_360_386,
                            dtype="f16"))

# Turbo and Nano (gap 1): English, clone-only, Turbo's 19 inline tags. Converted by us from
# Resemble's checkpoints with the voice encoder and speech tokenizer kept (our audio.cpp's
# tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py) — q8_0 and f16, f16 as
# audio.cpp ships core Chatterbox. A clip must be longer than 5 seconds.
TURBO_REPO = "delebash/chatterbox-turbo-GGUF"
TURBO_REVISION = "db9317b6f796c4d11112ee845a6189328e25fb15"   # q8_0 + f16, 2026-10-03
NANO_REPO = "delebash/chatterbox-nano-GGUF"
NANO_REVISION = "e707626a9bb9d3cbb035abfaacb82616c4c3d2e7"    # q8_0 + f16, 2026-10-03


def _turbo_row(id_, name, description, quality, repo, revision, file, size):
    return {
        "id": id_,
        "name": name,
        "description": description,
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": quality,
        "weights_license": "MIT",
        "sources": [model_source(file, size, repo=repo, revision=revision)],
        "audiocpp": {"family": "chatterbox_turbo", "task": "tts", "file": file},
    }


_TURBO = _turbo_row(
    "chatterbox-turbo-q8", "Chatterbox Turbo (350M, English)",
    "Streamlined English-only variant. Native paralinguistic tags ([cough], [laugh], [chuckle] "
    "and 16 more). Lower latency; no exaggeration/CFG knobs. Clones from a clip longer than "
    "5 seconds. 8-bit weights.",
    82, TURBO_REPO, TURBO_REVISION, "chatterbox-turbo-q8_0.gguf", 880_908_100)
_NANO = _turbo_row(
    "chatterbox-nano-q8", "Chatterbox Nano (110M, English)",
    "Turbo's architecture at 110M parameters — same 19 inline tags, aimed at CPU and low-VRAM "
    "boxes. Clones from a clip longer than 5 seconds. 8-bit weights.",
    78, NANO_REPO, NANO_REVISION, "chatterbox-nano-q8_0.gguf", 616_250_532)

# Written and published, waiting for the pinned runtime to clone on Turbo; the capability rows
# (`chatterbox-turbo`, `chatterbox-nano`) and the knob-wiring test already read them.
PENDING_VARIANTS = [
    _TURBO,
    sixteen_bit(_TURBO, "chatterbox-turbo-f16.gguf", 1_391_709_474, dtype="f16",
                source=model_source("chatterbox-turbo-f16.gguf", 1_391_709_474, repo=TURBO_REPO,
                                    revision=TURBO_REVISION)),
    _NANO,
    sixteen_bit(_NANO, "chatterbox-nano-f16.gguf", 894_652_290, dtype="f16",
                source=model_source("chatterbox-nano-f16.gguf", 894_652_290, repo=NANO_REPO,
                                    revision=NANO_REVISION)),
]
if pinned_has("turbo_clone"):
    VARIANTS.extend(PENDING_VARIANTS)
    PENDING_VARIANTS = []

DEFAULT_VARIANT_ID = "chatterbox-multilingual-v2-q8"

# Clone-only — the voices are the user's own clips, stored host-side.
STATIC_VOICES = []
