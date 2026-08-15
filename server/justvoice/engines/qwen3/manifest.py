"""Manifest for Qwen3-TTS (CustomVoice variant).

Two paths to install Qwen3-TTS:
- PyPI: `qwen-tts>=0.0.5` (Alibaba's reference package)
- Git: `git+https://github.com/QwenLM/Qwen3-TTS.git` (newer fixes)

Voicebox uses both (PyPI for the stable surface, git for the latest
release-day fixes). We mirror that.

Two checkpoint families, and the split matters — they are not
interchangeable (both model cards are explicit, re-verified 2026-08-15):

- CustomVoice — 9 preset speakers (Vivian, Serena, Uncle Fu, Dylan,
  Eric, Ryan, Aiden, Ono Anna, Sohee) plus the `instruct` field for
  tone/emotion/prosody control over those timbres. It CANNOT clone.
- Base — 3-second voice cloning from a reference clip, and the
  fine-tuning base. No preset speakers.

Every variant speaks the same 10 languages.
"""

ID = "qwen3"
NAME = "Qwen3-TTS"
DESCRIPTION = (
    "Alibaba's open-weight TTS, 10 languages. Two checkpoint families: CustomVoice — "
    "9 preset speakers + a natural-language instruct field for style and emotion; Base — "
    "voice cloning from a short reference clip. 1.7 B and 0.6 B sizes (we default to "
    "CustomVoice 1.7 B; 0.6 B for ~half the VRAM)."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": True,
    # Engine-level = the union across variants: Base clones, CustomVoice
    # does not. The per-variant `voice_cloning` flag below is the one the
    # catalog filter reads.
    "voice_cloning": True,
    # VoiceDesign (a new voice from a text description) is a THIRD Qwen
    # checkpoint we do not ship yet and the engine has no design call for.
    # Claiming it here put qwen3 rows under the catalog's design filter
    # with nothing behind them. Flips back with the VoiceDesign variant.
    "voice_design": False,
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
# CustomVoice = 9 preset speakers + instruct, NO cloning; Base = clone-only,
# no presets (both model cards, re-verified 2026-08-15 — this file used to
# say CustomVoice cloned too, and the catalog's Cloning filter believed it).
# Ids mirror the engine's QWEN_VARIANT_REPOS map one-for-one.
_QWEN_FILES = [
    "config.json", "generation_config.json", "merges.txt",
    "model.safetensors", "preprocessor_config.json",
    "speech_tokenizer/config.json", "speech_tokenizer/configuration.json",
    "speech_tokenizer/model.safetensors",
    "speech_tokenizer/preprocessor_config.json",
    "tokenizer_config.json", "vocab.json",
]
# The 10 languages every Qwen3-TTS checkpoint speaks, per the model cards
# (zh en ja ko de fr ru pt es it). This list carried 17 until 2026-08-15 —
# ar/tr/nl/pl/vi/th/id were never supported, and it said "pt-BR" for what
# upstream calls "pt". The engine's own `_LANG_NAME` map (engine.py) has
# always had exactly these 10; the manifest was the side that lied.
_QWEN_LANGS = [
    "zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it",
]

def _qwen_variant(vid, name, repo, size_bytes, quality, presets, description, *, cloning):
    return {
        "id": vid, "name": name, "description": description,
        "languages": list(_QWEN_LANGS), "voice_cloning": bool(cloning),
        "preset_voices": presets, "quality": quality,
        "weights_license": "Apache-2.0",
        "sources": [{"hf_repo": repo, "revision": "main",
                     "size_bytes": size_bytes, "files": list(_QWEN_FILES)}],
    }

VARIANTS = [
    _qwen_variant("qwen3-cv-1.7b", "Qwen3-TTS CustomVoice 1.7B",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice", 4_520_159_586, 92, 9,
                  "9 premium preset speakers with natural-language style/emotion "
                  "control. No voice cloning — the Base variant clones.",
                  cloning=False),
    _qwen_variant("qwen3-cv-0.6b", "Qwen3-TTS CustomVoice 0.6B",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", 2_498_383_610, 80, 9,
                  "9 premium preset speakers with natural-language style/emotion "
                  "control. No voice cloning — the Base variant clones. Lower "
                  "quality ceiling, ~3× faster.",
                  cloning=False),
    _qwen_variant("qwen3-base-1.7b", "Qwen3-TTS Base 1.7B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-1.7B-Base", 4_544_170_364, 90, 0,
                  "Voice cloning from a 3–10 second reference clip — no preset "
                  "speakers; drops instruct silently.",
                  cloning=True),
    _qwen_variant("qwen3-base-0.6b", "Qwen3-TTS Base 0.6B (clone-only)",
                  "Qwen/Qwen3-TTS-12Hz-0.6B-Base", 2_516_100_892, 78, 0,
                  "Lightweight cloning checkpoint for lower-end hardware.",
                  cloning=True),
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
