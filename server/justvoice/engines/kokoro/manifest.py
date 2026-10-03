# SPDX-License-Identifier: MIT
"""Manifest for Kokoro — 54 preset voices, run by the audio.cpp runtime.

Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) Kokoro is one GGUF
file served by audio.cpp, not a Python program: no venv, no onnxruntime, no torch. The
voice pack is inside the GGUF; the voice ids are unchanged (`voices.py`, k2-fsa naming
`<lang><gender>_<name>`), so every persona built on a Kokoro voice keeps working.

English, Spanish, French, Hindi, Italian and Portuguese are phonemized by eSpeak NG, which
the runtime install fetches onto this machine (`engines/audiocpp/espeak.py`). Chinese works
from the GGUF's own table. Japanese needs MeCab + UniDic, which the release GGUF does not
carry — Japanese voices return with the gaps (plan §5).

Not yet back after the switch (plan §5): blended voices (audio.cpp takes no voice vector
yet) and per-word IPA from lexicons (respellings still work).
"""

from ..audiocpp.release import model_source, pinned_has, sixteen_bit

ID = "kokoro"
NAME = "Kokoro"

SUPPORTED_OSES = ["windows", "linux", "macos"]
DESCRIPTION = (
    "Kokoro-82M — 49 preset voices in eight languages, fast on any machine. Runs in the "
    "audio.cpp speech runtime from one 190 MB model file."
)
LICENSE = "Apache-2.0"

CAPABILITIES = {
    "preset_voices": True,
    "voice_cloning": False,
    "voice_design": False,
    "instruct_field": False,
    "paralinguistic_tags": False,
    # A lexicon's IPA rides our audio.cpp's inline pronunciations (gap 3) — on with the pin.
    "phoneme_override": pinned_has("inline_ipa"),
    # Blends need our audio.cpp's `voice_pack` option (gap 2) — on once the pin has it.
    "voice_blending": pinned_has("voice_pack"),
}

REQUIREMENTS = {
    "gpu_runtimes": ["cuda", "vulkan", "metal", "cpu"],
}

from .voices import preset_voices_as_dicts as _preset_voices_as_dicts  # noqa: E402

# The five Japanese voices need MeCab + UniDic, which the release GGUF lacks — offered
# again when that lands (plan §5, gap 7). 49 of the 54 speak today.
STATIC_VOICES = [v for v in _preset_voices_as_dicts() if v.get("language") != "ja"]

VARIANTS = [
    {
        "id": "kokoro-82m-q8",
        "name": "Kokoro 82M",
        "description": "49 preset voices in eight languages. 8-bit weights.",
        "languages": ["en-US", "en-GB", "zh", "es", "fr", "hi", "it", "pt-BR"],
        "voice_cloning": False,
        "preset_voices": len(STATIC_VOICES),
        "quality": 95,
        "weights_license": "Apache-2.0",
        "sources": [model_source("Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf", 189_549_408)],
        "audiocpp": {"family": "kokoro_tts", "task": "tts", "file": "Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf"},
        # Seconds of audio per second of work on the CPU — the reference machine's figure
        # (Ryzen 7 5700X, 8 threads, 2026-10-02) until a render measures this one
        # (docs/plans/2026-10-02-cpu-placement.md §6).
        "cpu_realtime": 3.15,
    },
]
# The 16-bit file at the same pinned commit (gap 9); the 8-bit row stays the default.
VARIANTS.append(sixteen_bit(VARIANTS[0], "Kokoro-82M-GGUF/kokoro-82m-bf16.gguf", 211_954_816))

DEFAULT_VARIANT_ID = "kokoro-82m-q8"
