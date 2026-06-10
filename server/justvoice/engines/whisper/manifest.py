# SPDX-License-Identifier: GPL-3.0-or-later
"""Manifest for the Whisper STT engine plugin.

The dictation pipeline's speech-to-text stage. KIND="stt" gives it its
own loaded-engine slot, so loading Whisper never evicts the active TTS
engine. Runs in the shared venv (torch comes from shared setup); model
weights download into the HF cache on first load.

Sizes follow the upstream OpenAI naming. "base" is the recommended
starting point (74 MB, CPU-realtime); "turbo" (large-v3-turbo) is the
accuracy pick on GPU boxes.
"""

ID = "whisper"
NAME = "Whisper STT"
KIND = "stt"
ISOLATION = "shared"
SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "OpenAI Whisper speech-to-text via transformers. Powers dictation "
    "captures + clone-sample transcripts. Variants: base / small / medium "
    "/ large / turbo (large-v3-turbo)."
)
LICENSE = "MIT"
WEIGHTS_LICENSE = "Apache-2.0"  # openai/whisper-* HF model cards

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": False,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
    "phoneme_override": False,
}

REQUIREMENTS = {
    "disk_space_mb": 1500,   # large/turbo; base is ~74 MB
    "vram_min_mb": 0,        # CPU works for base/small
    "gpu_runtimes": ["cuda", "mps", "cpu"],
}

# Shared-venv pip deps. torch/torchaudio come from the shared setup's
# torch step; transformers runs the model; librosa+soundfile decode and
# resample whatever audio format the capture pipeline hands over.
INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {"kind": "pip", "packages": ["transformers>=4.44", "librosa>=0.10", "soundfile>=0.12"]},
]

MODELS = [
    {"hf_repo": "openai/whisper-base", "size_mb": 74},
]

DEFAULT_VARIANT_ID = "base"

STATIC_VOICES = []
