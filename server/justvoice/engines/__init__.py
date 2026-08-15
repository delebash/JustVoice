"""Engine layer — backends + registry + catalog.

All TTS engines live in the same process. Each adapter implements the
``TTSBackend`` protocol from ``base.py``. The ``EngineRegistry`` owns
the loaded set; the static ``catalog.py`` describes what's known about
each engine independent of whether it's installed.
"""

from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest, TTSBackend
from .registry import EngineRegistry

__all__ = [
    "TTSBackend",
    "EngineMeta",
    "PresetVoice",
    "SynthOutput",
    "SynthRequest",
    "EngineRegistry",
]
