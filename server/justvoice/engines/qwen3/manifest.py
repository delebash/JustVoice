"""Manifest for Qwen3-TTS (CustomVoice variant).

Two paths to install Qwen3-TTS:
- PyPI: `qwen-tts>=0.0.5` (Alibaba's reference package)
- Git: `git+https://github.com/QwenLM/Qwen3-TTS.git` (newer fixes)

Voicebox uses both (PyPI for the stable surface, git for the latest
release-day fixes). We mirror that.

CustomVoice variant has 9 preset speakers (Vivian, Serena, Uncle Fu,
Dylan, Eric, Ryan, Aiden, Ono Anna, Sohee) across zh/en/ja/ko, plus
the `instruct` field for tone/emotion/prosody control.
"""

ID = "qwen3"
NAME = "Qwen3-TTS"
DESCRIPTION = (
    "Alibaba's open-weight TTS. CustomVoice variant — 9 preset speakers across zh/en/ja/ko, "
    "instruct field for natural-language style control, voice cloning. 1.7 B and 0.6 B "
    "checkpoints (we default to 1.7 B; 0.6 B for ~half VRAM)."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": True,
    "voice_cloning": True,
    "voice_design": True,
    "instruct_field": True,
    "paralinguistic_tags": True,
}

REQUIREMENTS = {
    "disk_space_mb": 7000,
    "vram_min_mb": 6000,
    "gpu_runtimes": ["cuda"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {
        "kind": "pip",
        "packages": [
            "transformers>=4.45,<=4.57.6",
            "accelerate>=0.26",
            "huggingface_hub>=0.20",
            "safetensors>=0.4",
            "soundfile>=0.12",
            "librosa>=0.10",
            "numpy>=1.24,<2.0",
        ],
    },
    {"kind": "pip", "packages": ["qwen-tts>=0.0.5"]},
    {"kind": "pip-git", "url": "https://github.com/QwenLM/Qwen3-TTS.git"},
]

MODELS = [
    # All four checkpoints upstream voicebox ships (CustomVoice = presets +
    # instruct; Base = clone-only, drops instruct). The engine's variant map
    # in engine.py mirrors this list one-for-one.
    {"hf_repo": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", "size_mb": 3500},
    {"hf_repo": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "size_mb": 1200},
    {"hf_repo": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "size_mb": 3500},
    {"hf_repo": "Qwen/Qwen3-TTS-12Hz-0.6B-Base", "size_mb": 1200},
]

# Plain Load (no variant picked) loads CustomVoice 1.7B.
DEFAULT_VARIANT_ID = "qwen3-cv-1.7b"

# Preset speakers shipped with Qwen3-TTS CustomVoice. Static so the host
# catalog can show them before the engine is loaded.
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
