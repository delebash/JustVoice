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

# Facts-only variant rows (phase ②c): pinned SAFETENSORS load sets verified
# against the real HF trees 2026-08-14 — never the flax/tf/pytorch_model.bin
# duplicates (large-v3's repo is 24.7 GB; its load set is 3.1 GB). Ids match
# the engine's WHISPER_VARIANT_REPOS map (test_variant_wiring pins this).
_WHISPER_FILES = [
    "added_tokens.json", "config.json", "generation_config.json",
    "merges.txt", "model.safetensors", "normalizer.json",
    "preprocessor_config.json", "special_tokens_map.json", "tokenizer.json",
    "tokenizer_config.json", "vocab.json",
]

def _whisper_variant(vid, name, repo, size_bytes, quality, description):
    return {
        "id": vid, "name": name, "description": description,
        "languages": ["multilingual"], "voice_cloning": False,
        "preset_voices": 0, "quality": quality,
        "weights_license": "Apache-2.0",
        "sources": [{"hf_repo": repo, "revision": "main",
                     "size_bytes": size_bytes, "files": list(_WHISPER_FILES)}],
    }

_STT_DESC = "Speech-to-text checkpoint; bigger = more accurate, slower."
VARIANTS = [
    _whisper_variant("whisper-base", "Whisper Base (74M)",
                     "openai/whisper-base", 294_776_748, 55, _STT_DESC),
    _whisper_variant("whisper-small", "Whisper Small (244M)",
                     "openai/whisper-small", 971_367_937, 70, _STT_DESC),
    _whisper_variant("whisper-medium", "Whisper Medium (769M)",
                     "openai/whisper-medium", 3_059_917_072, 82, _STT_DESC),
    _whisper_variant("whisper-large", "Whisper Large v3 (1.5B)",
                     "openai/whisper-large-v3", 3_091_519_764, 95, _STT_DESC),
    _whisper_variant("whisper-turbo", "Whisper Large v3 Turbo",
                     "openai/whisper-large-v3-turbo", 1_622_443_339, 92,
                     "Recommended — large-v3 accuracy at ~6× the speed."),
]

DEFAULT_VARIANT_ID = "whisper-turbo"

STATIC_VOICES = []
