"""Manifest for LuxTTS (ZipVoice).

Voicebox installs LuxTTS via:
- Custom find-links for piper-phonemize (no PyPI wheels)
- git+ for LinaCodec (uv-only source, pip can't resolve)
- git+ for Zipvoice itself

ZipVoice is also published on PyPI as `zipvoice`, but voicebox uses the
git fork at ysharma3501/LuxTTS for some specific fixes. We default to
the git path for compatibility with their adapter code.
"""

ID = "luxtts"
NAME = "LuxTTS"
DESCRIPTION = (
    "ZipVoice-based zero-shot voice cloning. ~1 GB VRAM, 48 kHz output, 150× realtime on "
    "CPU. Lightweight alternative to the Chatterbox/Qwen3 tier."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
}

REQUIREMENTS = {
    "disk_space_mb": 1200,
    "vram_min_mb": 1024,
    "gpu_runtimes": ["cuda", "cpu", "mps"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {
        "kind": "pip",
        "packages": [
            "soundfile>=0.12",
            "librosa>=0.10",
            "numpy>=1.24,<2.0",
            "huggingface_hub>=0.20",
        ],
    },
    # piper-phonemize ships no PyPI wheels — voicebox uses k2-fsa's find-links index.
    {
        "kind": "pip-find-links",
        "url": "https://k2-fsa.github.io/icefall/piper_phonemize.html",
        "packages": ["piper-phonemize"],
    },
    # LinaCodec is git-only.
    {"kind": "pip-git", "url": "https://github.com/ysharma3501/LinaCodec.git"},
    # ZipVoice via voicebox's mirror.
    {"kind": "pip-git", "url": "https://github.com/ysharma3501/LuxTTS.git"},
]

MODELS = [
    {"hf_repo": "YatharthS/LuxTTS", "size_mb": 1100},
]

STATIC_VOICES = []
