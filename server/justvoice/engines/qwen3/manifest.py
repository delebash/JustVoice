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

# Facts-only variant rows (phase ②c): whole-repo pins minus README /
# .gitattributes (these trees are lean — the backbone + speech_tokenizer +
# tokenizer set), sizes = the real summed bytes, verified 2026-08-14.
# CustomVoice = 9 preset speakers + instruct + cloning; Base = clone-only.
# Ids mirror the engine's QWEN_VARIANT_REPOS map one-for-one.
_QWEN_FILES = [
    "config.json", "generation_config.json", "merges.txt",
    "model.safetensors", "preprocessor_config.json",
    "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
    "speech_tokenizer/model.safetensors",
    "speech_tokenizer/preprocessor_config.json",
    "tokenizer_config.json", "vocab.json",
]
_QWEN_LANGS = [
    "en", "zh", "ja", "es", "fr", "de", "ko", "it", "pt-BR", "ru", "ar",
    "tr", "nl", "pl", "vi", "th", "id",
]

def _qwen_variant(vid, name, repo, size_bytes, quality, presets, description):
    return {
        "id": vid, "name": name, "description": description,
        "languages": list(_QWEN_LANGS), "voice_cloning": True,
        "preset_voices": presets, "quality": quality,
        "weights_license": "Apache-2.0",
        "sources": [{"hf_repo": repo, "revision": "main",
                     "size_bytes": size_bytes, "files": list(_QWEN_FILES)}],
    }

VARIANTS = [
    _qwen_variant("qwen3-cv-1.7b", "Qwen3-TTS CustomVoice 1.7B",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", 4_520_159_586, 92, 9,
                  "9 preset speakers + instruct style control + cloning. Full feature set."),
    _qwen_variant("qwen3-cv-0.6b", "Qwen3-TTS CustomVoice 0.6B",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", 2_498_383_610, 80, 9,
                  "Same feature set, lower quality ceiling, ~3× faster."),
    _qwen_variant("qwen3-base-1.7b", "Qwen3-TTS Base 1.7B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-Base", 4_544_170_364, 90, 0,
                  "Voice-cloning checkpoint — no preset speakers; drops instruct silently."),
    _qwen_variant("qwen3-base-0.6b", "Qwen3-TTS Base 0.6B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-Base", 2_516_100_892, 78, 0,
                  "Lightweight cloning checkpoint for lower-end hardware."),
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
