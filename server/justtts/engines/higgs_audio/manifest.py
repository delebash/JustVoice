"""Manifest for Higgs Audio v3 (Boson AI).

EXPERIMENTAL. Boson AI explicitly says **"don't clone this repository to
use the latest model"** — the v3 model is weights-only on HuggingFace
(bosonai/higgs-audio-v3-tts-4b). Inference happens via HuggingFace
transformers (no separate Boson Python package).

License is non-commercial (see Boson AI's model card). 4 B params — at
the edge of 8 GB VRAM cards; may need fp16 + flash-attn for headroom.
"""

ID = "higgs-audio"
NAME = "Higgs Audio v3"

# Higgs v3 is weights-only via HF transformers. The required transformers
# version may not match chatterbox's pinned 5.2.0, so we isolate. If a
# future Higgs release coexists with the shared venv's transformers we can
# flip this to ISOLATION="shared".
ISOLATION = "venv"
SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Boson AI Higgs Audio v3 — text-audio foundation model. Rich expression control + "
    "wide emotional range. **Non-commercial license** (read Boson AI's model card before "
    "production use). 4 B params, transformer-native via HuggingFace."
)
LICENSE = "Non-commercial (see model card)"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": True,
    "paralinguistic_tags": True,
}

REQUIREMENTS = {
    "disk_space_mb": 8000,
    "vram_min_mb": 10000,
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
]

MODELS = [
    {"hf_repo": "bosonai/higgs-audio-v3-tts-4b", "size_mb": 8000},
]

STATIC_VOICES = []
