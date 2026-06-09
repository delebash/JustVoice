"""Manifest for HumeAI TADA.

TADA (Text-Acoustic Dual Alignment) needs a custom DAC shim — the model
imports `dac.nn.layers.Snake1d` from descript-audio-codec, which in turn
pulls onnx + tensorboard + matplotlib via descript-audiotools. Voicebox
ships a 60-line shim that provides JUST the Snake1d class instead. We
ship the same shim in `dac_shim.py` alongside this manifest.

TADA also has a tokenizer-gating issue: it hardcodes `meta-llama/Llama-3.2-1B`
as its tokenizer source, which is a gated HF repo. We redirect to the
ungated `unsloth/Llama-3.2-1B` mirror at load time (voicebox's trick).

hume-tada pins torch>=2.7,<2.8 which would collide with chatterbox's
torch==2.6.0 in a shared venv. Per-engine venv makes that a non-issue.
"""

ID = "tada"
NAME = "TADA"
DESCRIPTION = (
    "HumeAI TADA (Text-Acoustic Dual Alignment) — high-quality voice cloning via "
    "forced alignment + flow-matching diffusion. Multilingual 3B variant (en, ar, "
    "de, es, fr, it, ja, pl, pt, zh). 24 kHz output. bf16 on CUDA."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
}

REQUIREMENTS = {
    "disk_space_mb": 6000,
    "vram_min_mb": 8000,
    "gpu_runtimes": ["cuda", "cpu"],
}

INSTALL = [
    # torch 2.7+ — hume-tada's pin. cu128 wheels exist for 2.7.x.
    {"kind": "torch", "version": "2.7.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
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
            "numba>=0.60,<0.61",
        ],
    },
    # hume-tada pins torch>=2.7,<2.8 — install --no-deps so it doesn't try
    # to pull a different torch wheel (we already have the cu128 build).
    {"kind": "pip-no-deps", "packages": ["hume-tada"]},
]

MODELS = [
    {"hf_repo": "HumeAI/tada-3b-ml", "size_mb": 4500},
    {"hf_repo": "HumeAI/tada-codec", "size_mb": 800},
]

STATIC_VOICES = []
