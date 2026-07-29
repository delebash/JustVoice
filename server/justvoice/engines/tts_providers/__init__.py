# SPDX-License-Identifier: MIT
"""TTS provider adapters beyond the bundled engines.

Phase 2 / Slice 5 of the Profile-kill plan. Mirrors the LLM-side registry:
each external TTS provider type (ElevenLabs / Speechify / Speechmatics /
OpenAI TTS / Edge TTS) is its own adapter that satisfies the existing
TTS backend Protocol from server/justvoice/engines/base.py.

The legacy server/justvoice/engines/external_openai.py is preserved for
backward compat with persisted ExternalEngineConfig settings; new providers
register through this package.
"""

from .elevenlabs import ElevenLabsBackend
from .speechify import SpeechifyBackend
from .speechmatics import SpeechmaticsBackend

__all__ = [
    "ElevenLabsBackend",
    "SpeechifyBackend",
    "SpeechmaticsBackend",
]
