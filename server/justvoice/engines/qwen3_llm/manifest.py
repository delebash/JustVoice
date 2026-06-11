"""Manifest for Qwen3 LLM — bundled local language model (parity gap G1).

Three sizes matching upstream voicebox: 0.6B / 1.7B / 4B. Powers dictation
transcript refinement and persona Compose/Rewrite with zero external
setup — registered as the "local-qwen3" provider in the LLM registry.
"""

ID = "qwen3-llm"
NAME = "Qwen3 LLM (local)"
KIND = "llm"
DESCRIPTION = (
    "Alibaba's open-weight chat LLM, run locally. Cleans up dictation "
    "transcripts (filler removal, self-corrections, punctuation) and powers "
    "persona Compose/Rewrite without an external provider. 0.6B is fast "
    "enough for live refinement; 4B handles subtle corrections better."
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
    {"hf_repo": "Qwen/Qwen3-4B", "size_mb": 8000},
]

DEFAULT_VARIANT_ID = "qwen3-llm-0.6b"

STATIC_VOICES = []
