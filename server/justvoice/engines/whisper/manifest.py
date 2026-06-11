"""Manifest for Whisper STT — bundled speech-to-text (parity gap G2).

Five sizes matching upstream voicebox's catalog: base / small / medium /
large-v3 / large-v3-turbo. Drives dictation (Captures), the /v1/transcribe
endpoint, and the justvoice.transcribe MCP tool.
"""

ID = "whisper"
NAME = "Whisper STT"
KIND = "stt"
DESCRIPTION = (
    "OpenAI's open-weight speech-to-text. Powers dictation captures, the "
    "/v1/transcribe endpoint, and agent transcription over MCP. Turbo is "
    "the recommended default — large-v3 accuracy at ~6× the speed."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "transcription": True,
}

REQUIREMENTS = {
    "disk_space_mb": 3200,
    "vram_min_mb": 1500,
    "gpu_runtimes": ["cuda"],
}

INSTALL = [
    {"kind": "torch", "version": "2.6.0", "variant": "auto", "packages": ["torch", "torchaudio"]},
    {
        "kind": "pip",
        "packages": [
            "transformers>=4.45",
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
    {"hf_repo": "openai/whisper-base", "size_mb": 290},
    {"hf_repo": "openai/whisper-small", "size_mb": 970},
    {"hf_repo": "openai/whisper-medium", "size_mb": 3100},
    {"hf_repo": "openai/whisper-large-v3", "size_mb": 6200},
    {"hf_repo": "openai/whisper-large-v3-turbo", "size_mb": 3200},
]

DEFAULT_VARIANT_ID = "whisper-turbo"

STATIC_VOICES = []
