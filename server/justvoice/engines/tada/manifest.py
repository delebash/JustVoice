"""Manifest for HumeAI TADA.

TADA (Text-Acoustic Dual Alignment) needs a custom DAC shim — the model
imports `dac.nn.layers.Snake1d` from descript-audio-codec, which in turn
pulls onnx + tensorboard + matplotlib via descript-audiotools. Voicebox
ships a 60-line shim that provides JUST the Snake1d class instead. We
ship the same shim in `dac_shim.py` alongside this manifest.

TADA also has a tokenizer-gating issue: it hardcodes `meta-llama/Llama-3.2-1B`
as its tokenizer source, which is a gated HF repo. We redirect to the
ungated `unsloth/Llama-3.2-1B` mirror at load time.

hume-tada pins torch>=2.7,<2.8 which would collide with chatterbox's
torch==2.6.0 in a shared venv. Per-engine venv makes that a non-issue.
"""

ID = "tada"
NAME = "TADA"
# engine.py loads HumeAI/tada-3b-ml unconditionally — declare the matching
# catalog variant so the manager records what actually loaded.
DEFAULT_VARIANT_ID = "tada-3b"
DESCRIPTION = (
    "HumeAI TADA (Text-Acoustic Dual Alignment) — high-quality voice cloning via "
    "forced alignment + flow-matching diffusion. Multilingual 3B variant (en, ar, "
    "de, es, fr, it, ja, pl, pt, zh). 24 kHz output. bf16 on CUDA."
)
LICENSE = "Apache-2.0"  # hume-tada Python package (framework code)
# Model weights ship under Meta's Llama 3.2 Community License because
# TADA is built on Llama 3.2. Verified 2026-06-09 on huggingface.co/HumeAI/tada-3b-ml
# and llama.com/llama3_2/license. Codec is MIT (huggingface.co/HumeAI/tada-codec).
WEIGHTS_LICENSE = "Llama-3.2-Community"
# Llama 3.2 Community License §1.b: any product or service built using
# Llama-derived models must display "Built with Llama" in the user
# interface and include the same notice in documentation. JustVoice
# surfaces this on the Engines card + NOTICE.md.
ATTRIBUTION = "Built with Llama"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
}

REQUIREMENTS = {
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

# Facts-only variant row (phase ②c): ONE variant, THREE pinned sources —
# the model repo, the codec repo (per-language aligners included: the
# engine's own loader takes the whole set), and the ungated Llama tokenizer
# mirror engine.py redirects TADA to. Real summed bytes verified 2026-08-14
# (19.6 GB total — the old "4500 + 800 MB" claims were invented). The old
# catalog's "hume/tada-1b" / "hume/tada-3b" repos never existed.
VARIANTS = [
    {
        "id": "tada-3b",
        "name": "TADA 3B Multilingual",
        "description": (
            "Voice cloning via forced alignment + flow-matching diffusion; "
            "long-form coherent. 24 kHz output."
        ),
        "languages": ["en", "ar", "de", "es", "fr", "it", "ja", "pl", "pt", "zh"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 85,
        "weights_license": "Llama-3.2-Community",
        "sources": [
            {
                "hf_repo": "HumeAI/tada-3b-ml",
                "revision": "main",
                "size_bytes": 8_866_865_866,
                "files": [
                    "LICENSE", "config.json", "generation_config.json",
                    "model-00001-of-00002.safetensors",
                    "model-00002-of-00002.safetensors",
                    "model.safetensors.index.json",
                ],
            },
            {
                "hf_repo": "HumeAI/tada-codec",
                "revision": "main",
                "size_bytes": 10_724_500_733,
                # The whole codec tree minus README/.gitattributes — the
                # engine's own snapshot patterns take all of it (encoder,
                # decoder, llama_decoder, spkr-verf, and the per-language
                # aligners).
                "files": [
                    "aligner-ar/config.json", "aligner-ar/model.safetensors",
                    "aligner-ch/config.json", "aligner-ch/model.safetensors",
                    "aligner-de/config.json", "aligner-de/model.safetensors",
                    "aligner-es/config.json", "aligner-es/model.safetensors",
                    "aligner-fr/config.json", "aligner-fr/model.safetensors",
                    "aligner-it/config.json", "aligner-it/model.safetensors",
                    "aligner-ja/config.json", "aligner-ja/model.safetensors",
                    "aligner-pl/config.json", "aligner-pl/model.safetensors",
                    "aligner-pt/config.json", "aligner-pt/model.safetensors",
                    "aligner/config.json", "aligner/model.safetensors",
                    "decoder/config.json", "decoder/model.safetensors",
                    "encoder/config.json", "encoder/model.safetensors",
                    "llama_decoder/config.json",
                    "llama_decoder/generation_config.json",
                    "llama_decoder/model.safetensors",
                    "spkr-verf/config.json", "spkr-verf/model.safetensors",
                ],
            },
            {
                "hf_repo": "unsloth/Llama-3.2-1B",
                "revision": "main",
                "size_bytes": 17_261_020,
                "files": [
                    "special_tokens_map.json", "tokenizer.json",
                    "tokenizer_config.json",
                ],
            },
        ],
    },
]

STATIC_VOICES = []
