# SPDX-License-Identifier: GPL-3.0-or-later
"""LLM provider registry (Phase 2 / Slice 3 of the Profile-kill plan).

Mirrors the per-provider adapter pattern lifted from JustWrite. Each
provider type (Anthropic / OpenAI / OpenAI-compat / Gemini / Ollama /
DeepSeek / OpenRouter) registers an LLMAdapter at boot. The dispatch
helpers in `dispatch.py` route Compose / Rewrite / Speaker-attribution
calls to the right provider via feature pins from settings.engines.feature_pins.
"""

from .base import LLMAdapter, LLMMessage, LLMResponse
from .registry import LLMRegistry, get_llm_registry

__all__ = [
    "LLMAdapter",
    "LLMMessage",
    "LLMResponse",
    "LLMRegistry",
    "get_llm_registry",
]
