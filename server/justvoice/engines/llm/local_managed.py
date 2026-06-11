# SPDX-License-Identifier: GPL-3.0-or-later
"""Local managed-engine adapter — routes chat through the EngineManager's
LLM slot (the bundled qwen3-llm engine, parity gap G1).

Registered at boot AFTER settings-configured providers so the no-pin
fallback prefers an explicitly configured provider; pin a feature to
"local-qwen3" (or load only this engine) to use the local model.

Auto-load: if the qwen3-llm engine is installed but not loaded, the first
chat() loads it (same pattern as stored-voice TTS auto-load) so dictation
refinement works without a trip to the Engines tab.
"""

from __future__ import annotations

import logging

from .base import LLMMessage, LLMResponse

log = logging.getLogger(__name__)

LOCAL_PROVIDER_ID = "local-qwen3"
LOCAL_ENGINE_ID = "qwen3-llm"


class LocalManagedAdapter:
    """Adapter over the managed qwen3-llm engine subprocess."""

    def __init__(self):
        self.provider_id = LOCAL_PROVIDER_ID
        self.provider_type = "local"
        self.default_model = "qwen3-llm-0.6b"

    def _ensure_loaded(self):
        from ..manager import get_manager

        mgr = get_manager()
        if mgr.loaded_for("llm") is not None:
            return mgr
        status = mgr.status(LOCAL_ENGINE_ID)
        if status == "installed":
            log.info("local LLM: auto-loading %s on first use", LOCAL_ENGINE_ID)
            mgr.load(LOCAL_ENGINE_ID, device="auto")
            return mgr
        raise RuntimeError(
            f"local LLM engine '{LOCAL_ENGINE_ID}' is {status} — install it "
            "on the Engines tab (LLM section) first"
        )

    def chat(
        self,
        messages: list[LLMMessage],
        *,
        model: str | None = None,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        system: str | None = None,
        think: bool = False,
        extra: dict | None = None,
    ) -> LLMResponse:
        # think is ignored — the engine runs enable_thinking=False (the
        # bundled sizes degrade with thinking on short rewrite tasks).
        mgr = self._ensure_loaded()
        # Collapse the message list into upstream's (prompt, examples)
        # shape: trailing user message is the prompt; preceding
        # user/assistant pairs ride as few-shot examples.
        prompt = ""
        examples: list[list[str]] = []
        pending_user: str | None = None
        for m in messages:
            if m.role == "user":
                pending_user = m.content
            elif m.role == "assistant" and pending_user is not None:
                examples.append([pending_user, m.content])
                pending_user = None
            elif m.role == "system" and not system:
                system = m.content
        if pending_user is not None:
            prompt = pending_user
        text = mgr.chat(
            {
                "prompt": prompt,
                "system": system,
                "max_tokens": max_tokens or 512,
                "temperature": temperature,
                "examples": examples,
            }
        )
        return LLMResponse(text=text, model=model or self.default_model)

    def stream_chat(self, *args, **kwargs):
        raise NotImplementedError("local managed adapter is non-streaming")


def register_local_adapter() -> None:
    """Register the local adapter when the qwen3-llm engine is installed
    (or loaded). Called at boot and again after engine loads — an engine
    that isn't on disk must NOT satisfy the no-pin fallback, or features
    would 502 instead of the actionable 501 ("wire an LLM provider")."""
    from ..manager import get_manager
    from .registry import get_llm_registry

    if get_manager().status(LOCAL_ENGINE_ID) == "not_installed":
        return
    reg = get_llm_registry()
    if reg.get(LOCAL_PROVIDER_ID) is None:
        reg.register(LocalManagedAdapter())
