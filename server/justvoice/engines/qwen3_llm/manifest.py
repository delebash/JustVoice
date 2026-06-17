"""Manifest for Qwen3 LLM — bundled local language model (parity gap G1).

Lightweight CPU/low-VRAM fallback (0.6B / 1.7B). Powers dictation transcript
refinement and persona Compose/Rewrite with zero external setup — registered
as the "local-qwen3" provider. The built-in llama.cpp runner (local-llamacpp)
is the primary local LLM for heavier work like speaker attribution; the 4B
transformers variant was dropped (worst trade — heavy VRAM, unquantized).
"""

ID = "qwen3-llm"
NAME = "Qwen3 LLM (local)"
KIND = "llm"
DESCRIPTION = (
    "Alibaba's open-weight chat LLM, run locally. Cleans up dictation "
    "transcripts (filler removal, self-corrections, punctuation) and powers "
    "persona Compose/Rewrite without an external provider. A lightweight "
    "fallback — the built-in llama.cpp runner is the primary local LLM for "
    "heavier work like attribution."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "chat": True,
}

REQUIREMENTS = {
    "disk_space_mb": 1500,
    "vram_min_mb": 1500,
    "gpu_runtimes": ["cuda"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch"]},
    {
        "kind": "pip",
        "packages": [
            "transformers>=4.51",
            "accelerate>=0.26",
            "huggingface_hub>=0.20",
            "safetensors>=0.4",
        ],
    },
]

MODELS = [
    {"hf_repo": "Qwen/Qwen3-0.6B", "size_mb": 1400},
    {"hf_repo": "Qwen/Qwen3-1.7B", "size_mb": 3500},
]

DEFAULT_VARIANT_ID = "qwen3-llm-0.6b"

STATIC_VOICES = []
