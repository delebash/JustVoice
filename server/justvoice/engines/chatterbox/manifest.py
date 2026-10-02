# SPDX-License-Identifier: MIT
"""Manifest for Chatterbox Multilingual — voice cloning, run by the audio.cpp runtime.

Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) Chatterbox is one
GGUF file served by audio.cpp: no venv, no torch, no MPS patch. Measured on an RTX 2070
SUPER: 2.08× real time against 0.92× for the PyTorch engine it replaces, at 3.2 GB of
VRAM instead of 5.4.

Clone-only: every Chatterbox voice is a reference clip the user brings. Exaggeration and
CFG are set per line (verified 2026-10-01 — no model reload).

Not yet back after the switch (plan §5): Turbo and Nano (audio.cpp's Turbo cannot clone
yet — gap 1), and Hebrew, Japanese, Russian and Chinese (audio.cpp's Chatterbox speaks 19
of the model's 23 languages — gap 7). Resemble's PerTh watermark is not applied by
audio.cpp (user, 2026-10-01: "dont care about watermark").
"""

from ..audiocpp.release import model_source

ID = "chatterbox"
NAME = "Chatterbox"

SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Resemble AI's open-source cloning TTS. Multilingual: 500M parameters, 19 languages, "
    "zero-shot voice cloning, per-line exaggeration / CFG / temperature. Runs in the "
    "audio.cpp speech runtime."
)
LICENSE = "MIT"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    # Only Turbo had the tag vocabulary; it returns with Turbo (plan §5, gap 1).
    "paralinguistic_tags": False,
    "phoneme_override": False,
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}

# audio.cpp's core Chatterbox languages (model_specs/chatterbox.json, v0.9.0).
_LANGS = ["ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms", "nl",
          "no", "pl", "pt", "sv", "sw", "tr"]

VARIANTS = [
    {
        "id": "chatterbox-multilingual-v2-q8",
        "name": "Chatterbox Multilingual (19 languages)",
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

DEFAULT_VARIANT_ID = "chatterbox-multilingual-v2-q8"

# Clone-only — the voices are the user's own clips, stored host-side.
STATIC_VOICES = []
