# SPDX-License-Identifier: GPL-3.0-or-later
"""Feature-pin → provider dispatch.

Compose, Rewrite, Speaker-attribution, Smart-assign and Render-preset-Suggest
all call into the LLM registry through one of these helpers. The dispatch
looks up `settings.engines.feature_pins` for the feature key, finds the
matching provider, and calls its `.chat()`.

Slice 3 has the basic structure; Slice 6 layers tier-aware prompt
selection on top; Slice 7 wires Compose + Rewrite endpoints to call
into here instead of returning 501.
"""

from __future__ import annotations

import logging
from typing import Iterable

from .base import LLMAdapter, LLMMessage, LLMResponse
from .registry import get_llm_registry

log = logging.getLogger(__name__)


class LLMNotConfiguredError(RuntimeError):
    """Raised when a feature is invoked but no provider is pinned (or
    the pinned provider isn't registered). The API layer maps this to
    HTTP 501 so the UI can show the actionable "wire an LLM provider"
    message rather than a generic 500."""


def resolve_pin(settings, feature: str) -> tuple[LLMAdapter, str, str | None]:
    """Resolve the (provider, model, tier) tuple for a feature key.

    Returns (adapter, model, tier). Raises LLMNotConfiguredError when
    no pin exists for the feature or the pinned provider isn't
    registered (settings entry missing / boot construct() failed).
    """
    feature_pins = getattr(settings.engines, "feature_pins", []) or []
    pin = next((p for p in feature_pins if p.feature == feature), None)
    if pin is None:
        # No pin set yet — fall back to the first registered LLM if any.
        # Better UX than 501 in the "user added one Claude key but didn't
        # configure pins" common case.
        adapters = get_llm_registry().all()
        if not adapters:
            raise LLMNotConfiguredError(
                f"No LLM provider registered. Add one in EnginesView's LLM "
                f"tab, then pin it to '{feature}' in Settings → AI Features."
            )
        adapter = adapters[0]
        return adapter, adapter.default_model, None

    adapter = get_llm_registry().get(pin.provider_id)
    if adapter is None:
        raise LLMNotConfiguredError(
            f"Feature {feature!r} is pinned to provider {pin.provider_id!r} "
            f"but that provider isn't registered. Check the registry in "
            f"EnginesView's LLM tab."
        )
    return adapter, pin.model or adapter.default_model, pin.tier


def chat(
    *,
    settings,
    feature: str,
    messages: Iterable[LLMMessage],
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    think: bool = False,
) -> LLMResponse:
    """One-shot LLM call for a feature key."""
    adapter, model, _tier = resolve_pin(settings, feature)
    return adapter.chat(
        list(messages),
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        system=system,
        think=think,
    )
