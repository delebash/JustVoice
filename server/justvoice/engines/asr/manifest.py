# SPDX-License-Identifier: MIT
"""Manifest for speech recognition — dictation, clone transcripts, captions.

Replaced Whisper at the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) —
user: "as long as qwen asr is as good as whisper we can drop whisper". Measured on 197
clips with known text (plan §2.2): on English, Qwen3-ASR 1.7B gets fewer words wrong than
Whisper turbo (4.3% against 5.8% on human speech). Each variant carries Qwen3's forced
aligner as a companion file, so captions get word times for the KNOWN text (Whisper's
alignment path had stopped working on this build).

What it does not give: a confidence score, and — on the small sample measured — weaker
recognition outside English, especially when no language is set (plan §8 D).
"""

from ..audiocpp.release import model_source, sixteen_bit

ID = "asr"
NAME = "Speech recognition"
KIND = "stt"

SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Turns speech into text for dictation, clone transcripts and captions (with word "
    "timings). Runs in the audio.cpp speech runtime."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {"stt": True}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}

_ALIGNER = "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf"
_ALIGNER_SIZE = 1_129_966_496

_QWEN3_ASR_LANGS = ["zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi",
                    "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "ro",
                    "hu", "mk"]

VARIANTS = [
    {
        "id": "qwen3-asr-1.7b-q8",
        "name": "Qwen3-ASR 1.7B",
        "description": "30 languages. Set the language when you know it — detection is the "
                       "weak spot. Word timings from Qwen3's aligner.",
        "languages": list(_QWEN3_ASR_LANGS),
        "voice_cloning": False,
        "preset_voices": 0,
        "quality": 90,
        "weights_license": "Apache-2.0",
        "sources": [{
            **model_source("Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf", 2_473_010_048),
            "files": ["Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf", _ALIGNER],
            "size_bytes": 2_473_010_048 + _ALIGNER_SIZE,
        }],
        "audiocpp": {
            "family": "qwen3_asr", "task": "asr", "file": "Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf",
            "companions": [{"role": "aligner", "family": "qwen3_forced_aligner", "task": "align",
                            "file": _ALIGNER}],
        },
        # Seconds of audio per second of work on the CPU, with its GPU accuracy — the
        # reference machine's figure (Ryzen 7 5700X, 8 threads, 2026-10-02) until a
        # transcription measures this one (docs/plans/2026-10-02-cpu-placement.md §6).
        "cpu_realtime": 2.6,
    },
]

# The 16-bit recogniser and aligner at the same pinned commit (gap 9; audio.cpp ships both as
# f16); the 8-bit row stays the default.
_ASR_F16 = "Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-f16.gguf"
_ASR_F16_SIZE = 4_087_653_248
_ALIGNER_F16 = "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-f16.gguf"
_ALIGNER_F16_SIZE = 1_840_097_696
VARIANTS.append(sixteen_bit(
    VARIANTS[0], _ASR_F16, _ASR_F16_SIZE, dtype="f16",
    source={**model_source(_ASR_F16, _ASR_F16_SIZE), "files": [_ASR_F16, _ALIGNER_F16],
            "size_bytes": _ASR_F16_SIZE + _ALIGNER_F16_SIZE},
    companions=[{"role": "aligner", "family": "qwen3_forced_aligner", "task": "align",
                 "file": _ALIGNER_F16}],
))

DEFAULT_VARIANT_ID = "qwen3-asr-1.7b-q8"

STATIC_VOICES = []
