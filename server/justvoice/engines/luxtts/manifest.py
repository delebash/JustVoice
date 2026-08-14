"""Manifest for LuxTTS (ZipVoice).

LuxTTS installs via:
- Custom find-links for piper-phonemize (no PyPI wheels)
- git+ for LinaCodec (uv-only source, pip can't resolve)
- git+ for ZipVoice itself

ZipVoice is also published on PyPI as `zipvoice`, but the git fork at
ysharma3501/LuxTTS has fixes our adapter relies on, so the git path is
the default for compatibility.
"""

ID = "luxtts"
NAME = "LuxTTS"
# Single catalog variant (engine.py loads YatharthS/LuxTTS unconditionally).
DEFAULT_VARIANT_ID = "luxtts-base"
DESCRIPTION = (
    "ZipVoice-based zero-shot voice cloning. 48 kHz output; upstream quotes "
    "150× realtime. Lightweight alternative to the Chatterbox/Qwen3 tier. "
    "English."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": False,
    "voice_cloning": True,
    "voice_design": False,
    "instruct_field": False,
}

REQUIREMENTS = {
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
    # piper-phonemize ships no PyPI wheels — use k2-fsa's find-links index.
    {
        "kind": "pip-find-links",
        "url": "https://k2-fsa.github.io/icefall/piper_phonemize.html",
        "packages": ["piper-phonemize"],
    },
    # LinaCodec is git-only.
    {"kind": "pip-git", "url": "https://github.com/ysharma3501/LinaCodec.git"},
    # ZipVoice via the ysharma3501/LuxTTS git mirror.
    {"kind": "pip-git", "url": "https://github.com/ysharma3501/LuxTTS.git"},
]

# Facts-only variant row (phase ②c): the repo the engine loads (the old
# catalog's "luxtts/luxtts-base" repo never existed, and its 7-language
# claim was fiction — the model card says English). Whole lean repo pinned
# (both fp and int8 onnx variants ride along; the wrapper picks), real
# summed bytes verified 2026-08-14.
VARIANTS = [
    {
        "id": "luxtts-base",
        "name": "LuxTTS",
        "description": "ZipVoice-based cloning — 48 kHz output, fast on CPU.",
        "languages": ["en"],
        "voice_cloning": True,
        "preset_voices": 0,
        "quality": 80,
        "weights_license": "Apache-2.0",
        "sources": [{
            "hf_repo": "YatharthS/LuxTTS",
            "revision": "main",
            "size_bytes": 1_180_689_290,
            "files": [
                "config.json", "fm_decoder.onnx", "fm_decoder_int8.onnx",
                "model.pt", "text_encoder.onnx", "text_encoder_int8.onnx",
                "tokens.txt", "vocoder/config.yaml", "vocoder/vocos.bin",
            ],
        }],
    },
]

STATIC_VOICES = []
