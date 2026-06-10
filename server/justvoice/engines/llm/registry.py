# SPDX-License-Identifier: GPL-3.0-or-later
"""LLM provider registry — boots from settings.engines.llm[].

A singleton LLMRegistry holds the live adapter instances keyed by
provider id. `_construct(cfg)` picks the right adapter class for the
`provider_type` discriminator. Boot wires this in app.py after the
external-engine registration step.
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ...models import LLMProviderConfig
    from .base import LLMAdapter

log = logging.getLogger(__name__)


class LLMRegistry:
    """Holds registered LLM provider adapters keyed by provider id."""

    def __init__(self):
        self._adapters: dict[str, "LLMAdapter"] = {}
        self._lock = threading.RLock()

    def register(self, adapter: "LLMAdapter") -> None:
        with self._lock:
            self._adapters[adapter.provider_id] = adapter
            log.info(
                "LLM provider registered: id=%s type=%s default_model=%s",
                adapter.provider_id,
                adapter.provider_type,
                adapter.default_model,
            )

    def deregister(self, provider_id: str) -> None:
        with self._lock:
            self._adapters.pop(provider_id, None)

    def get(self, provider_id: str) -> "LLMAdapter | None":
        with self._lock:
            return self._adapters.get(provider_id)

    def all(self) -> list["LLMAdapter"]:
        with self._lock:
            return list(self._adapters.values())

    def ids(self) -> list[str]:
        with self._lock:
            return list(self._adapters.keys())


_REGISTRY = LLMRegistry()


def get_llm_registry() -> LLMRegistry:
    return _REGISTRY


def construct(cfg: "LLMProviderConfig") -> "LLMAdapter":
    """Pick the right adapter class for the provider_type discriminator.

    Unknown provider types raise ValueError — callers should catch and
    log so a misconfigured settings entry doesn't kill boot.
    """
    pt = cfg.provider_type.lower()
    if pt == "anthropic":
        from .anthropic import AnthropicAdapter

        return AnthropicAdapter(
            cfg.id,
            api_key=cfg.api_key or "",
            base_url=cfg.base_url,
            default_model=cfg.default_model,
            timeout_seconds=cfg.timeout_seconds,
        )
    if pt in ("openai", "openai-compat", "deepseek", "openrouter"):
        from .openai_compat import OpenAICompatAdapter

        return OpenAICompatAdapter(
            cfg.id,
            provider_type=pt,
            api_key=cfg.api_key or "",
            base_url=cfg.base_url,
            default_model=cfg.default_model,
            timeout_seconds=cfg.timeout_seconds,
        )
    if pt == "ollama":
        from .ollama import OllamaAdapter

        return OllamaAdapter(
            cfg.id,
            api_key=cfg.api_key or "",
            base_url=cfg.base_url,
            default_model=cfg.default_model,
            timeout_seconds=cfg.timeout_seconds,
        )
    if pt == "gemini":
        from .gemini import GeminiAdapter

        return GeminiAdapter(
            cfg.id,
            api_key=cfg.api_key or "",
            base_url=cfg.base_url,
            default_model=cfg.default_model,
            timeout_seconds=cfg.timeout_seconds,
        )
    raise ValueError(f"unknown LLM provider_type: {pt!r}")


def load_from_settings(settings) -> None:
    """Boot helper. Walks settings.engines.llm and constructs an adapter
    for each. Silently logs adapter-construction failures rather than
    failing the whole boot — a single bad provider config shouldn't
    block the app from starting."""
    reg = get_llm_registry()
    for cfg in settings.engines.llm:
        try:
            adapter = construct(cfg)
            reg.register(adapter)
        except Exception as e:
            log.warning(
                "LLM provider %s skipped at boot: %s",
                cfg.id,
                e,
            )
