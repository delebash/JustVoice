# SPDX-License-Identifier: MIT
"""Manifest for Qwen3-TTS — run by the audio.cpp runtime.

Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) each Qwen3
checkpoint is one GGUF file served by audio.cpp: no venv, no torch, no MLX arm — the same
files run on CUDA, Vulkan, Metal and CPU. Measured on an RTX 2070 SUPER: 2.0× real time
against 0.26× for the PyTorch engine it replaces.

Three checkpoint families, and they are not interchangeable (model cards, re-verified
2026-08-15):

- CustomVoice — 9 preset speakers + the `instruct` field for tone, emotion and prosody.
  It CANNOT clone.
- Base — clones from a reference clip (+ its transcript, when we have it). No preset
  speakers; written direction is dropped.
- VoiceDesign — a voice invented from a prose description; 1.7B only.

Every checkpoint speaks the same 10 languages, and audio.cpp takes them by NAME
("English"), not code — `engines/audiocpp/slot.py` maps ours.

CustomVoice 0.6B is our own conversion (switch plan §5, gap 4): audio.cpp's model repo
publishes CustomVoice at 1.7B only, so the official checkpoint was converted with the runtime's
`audiocpp_gguf` and published at `CV_06_REPO` — the command, the tensor split and the checks are
in docs/plans/2026-10-02-gap-4-customvoice-0.6b.md and that repo's README.
"""

from ..audiocpp.release import model_source

ID = "qwen3"
NAME = "Qwen3-TTS"
DESCRIPTION = (
    "Alibaba's open-weight TTS, 10 languages. CustomVoice — 9 preset speakers you can "
    "direct in plain words; Base — clones a voice from a short clip; VoiceDesign — a "
    "voice from a written description. Runs in the audio.cpp speech runtime."
)
LICENSE = "Apache-2.0"
SUPPORTED_OSES = ["windows", "linux", "macos"]

CAPABILITIES = {
    "preset_voices": True,
    # The union across variants: Base clones, CustomVoice does not. The per-variant
    # `voice_cloning` flag below is the one the catalog filter reads.
    "voice_cloning": True,
    "voice_design": True,
    "instruct_field": True,
    # No tag vocabulary — Qwen takes direction as prose, in `instruct`.
    "paralinguistic_tags": False,
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}

_LANGS = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"]


def _variant(vid, name, path, size, quality, presets, description, *, task="tts",
             cloning=False, design=False, source=None):
    return {
        "id": vid, "name": name, "description": description,
        "languages": list(_LANGS), "voice_cloning": cloning, "voice_design": design,
        "preset_voices": presets, "quality": quality, "weights_license": "Apache-2.0",
        "sources": [source or model_source(path, size)],
        "audiocpp": {"family": "qwen3_tts", "task": task, "file": path, "clone": cloning},
    }


# Our conversion of Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice @ 85e237c (gap 4), pinned by commit.
CV_06_REPO = "delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF"
CV_06_REVISION = "030089f09bdd8e77b275b7ed7e503e2f24749922"
_CV_06_FILE = "qwen3-tts-12hz-0.6b-customvoice-q8_0.gguf"
_CV_06_SIZE = 1_710_423_328


VARIANTS = [
    _variant("qwen3-cv-1.7b-q8", "Qwen3-TTS CustomVoice 1.7B",
             "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf",
             2_817_044_064, 92, 9,
             "9 preset speakers you can direct in plain words. No cloning — Base clones."),
    _variant("qwen3-cv-0.6b-q8", "Qwen3-TTS CustomVoice 0.6B",
             _CV_06_FILE, _CV_06_SIZE, 80, 9,
             "The same 9 directable speakers in a smaller, lighter model. No cloning — Base "
             "clones. Converted by JustVoice from Qwen's checkpoint.",
             source=model_source(_CV_06_FILE, _CV_06_SIZE, repo=CV_06_REPO,
                                 revision=CV_06_REVISION)),
    _variant("qwen3-base-1.7b-q8", "Qwen3-TTS Base 1.7B (cloning)",
             "Qwen3-TTS-12Hz-1.7B-Base-GGUF/qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf",
             2_695_175_104, 90, 0,
             "Clones a voice from a 3–10 second clip; no preset speakers; written "
             "direction is dropped.", cloning=True),
    _variant("qwen3-base-0.6b-q8", "Qwen3-TTS Base 0.6B (cloning)",
             "Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf",
             1_991_211_136, 78, 0,
             "The lighter cloning checkpoint.", cloning=True),
    _variant("qwen3-vd-1.7b-q8", "Qwen3-TTS VoiceDesign 1.7B",
             "Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF/qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf",
             2_816_988_960, 90, 0,
             "Invents a voice from a written description — no reference audio. Powers "
             "Design from words.", task="vdes", design=True),
]

# Plain Load (no variant picked) loads CustomVoice 1.7B.
DEFAULT_VARIANT_ID = "qwen3-cv-1.7b-q8"

# CustomVoice's preset speakers — shown before the engine is loaded.
STATIC_VOICES = [
    {"id": "Vivian", "name": "Vivian", "language": "zh", "gender": "female"},
    {"id": "Serena", "name": "Serena", "language": "zh", "gender": "female"},
    {"id": "Uncle_Fu", "name": "Uncle Fu", "language": "zh", "gender": "male"},
    {"id": "Dylan", "name": "Dylan", "language": "zh", "gender": "male"},
    {"id": "Eric", "name": "Eric", "language": "zh", "gender": "male"},
    {"id": "Ryan", "name": "Ryan", "language": "en", "gender": "male"},
    {"id": "Aiden", "name": "Aiden", "language": "en", "gender": "male"},
    {"id": "Ono_Anna", "name": "Ono Anna", "language": "ja", "gender": "female"},
    {"id": "Sohee", "name": "Sohee", "language": "ko", "gender": "female"},
]
