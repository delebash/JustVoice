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
from .tiers import TierSpec, spec_for

log = logging.getLogger(__name__)


class LLMNotConfiguredError(RuntimeError):
    """Raised when a feature is invoked but no provider is pinned (or
    the pinned provider isn't registered). The API layer maps this to
    HTTP 501 so the UI can show the actionable "wire an LLM provider"
    message rather than a generic 500."""


# Default role per feature — the factory wiring of the two-speed pattern
# (docs/plans/2026-06-11-engines-ai-features-implementation.md). Latency-
# sensitive interactive features ride Quick; accuracy-critical async
# features ride Accuracy. Used only when no production config and no pin.
DEFAULT_FEATURE_ROLES: dict[str, str] = {
    "refine": "quick",
    "compose": "quick",
    "persona_rewrite": "quick",
    "voice_gender": "quick",
    "speaker_attribution": "accuracy",
    "smart_assign": "accuracy",
    "show_notes": "accuracy",
    "render_preset_suggest": "accuracy",
}


def _resolve_role(settings, role: str) -> tuple[LLMAdapter, str] | None:
    """Map a role name to (adapter, model) via settings.engines.llm_roles."""
    roles = getattr(settings.engines, "llm_roles", None)
    target = getattr(roles, role, None) if roles else None
    if target is None or not target.provider_id:
        return None
    adapter = get_llm_registry().get(target.provider_id)
    if adapter is None:
        return None
    return adapter, target.model or adapter.default_model


def active_production_config(settings, feature: str):
    """The frozen Lab config for a feature, or None. Precedence step 1."""
    configs = getattr(settings.engines, "production_configs", []) or []
    return next((c for c in configs if c.feature == feature), None)


def resolve_pin(settings, feature: str) -> tuple[LLMAdapter, str, str | None]:
    """Resolve the (provider, model, tier) tuple for a feature key.

    Precedence (AI-features redesign):
      1. active production config (model part — prompts ride separately)
      2. feature pin with explicit provider/model
      3. feature pin inheriting a role ("quick"/"accuracy")
      4. DEFAULT_FEATURE_ROLES → llm_roles
      5. first registered adapter (legacy fallback)
    Raises LLMNotConfiguredError when nothing resolves.
    """
    cfg = active_production_config(settings, feature)
    if cfg is not None:
        adapter = get_llm_registry().get(cfg.provider_id)
        if adapter is not None:
            return adapter, cfg.model or adapter.default_model, cfg.tier
        log.warning(
            "production config %r for %s names unregistered provider %s — falling through",
            cfg.name, feature, cfg.provider_id,
        )

    feature_pins = getattr(settings.engines, "feature_pins", []) or []
    pin = next((p for p in feature_pins if p.feature == feature), None)

    if pin is not None and not pin.provider_id and pin.role:
        resolved = _resolve_role(settings, pin.role)
        if resolved is not None:
            return resolved[0], resolved[1], pin.tier

    if pin is None or not pin.provider_id:
        # Role-default path: the feature's factory role, if configured.
        default_role = DEFAULT_FEATURE_ROLES.get(feature)
        if default_role:
            resolved = _resolve_role(settings, default_role)
            if resolved is not None:
                return resolved[0], resolved[1], None
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


def resolve_tier(settings, feature: str) -> TierSpec:
    """Combine pin-resolution + tier auto-classify into one call.

    Returns the TierSpec the dispatcher should use for a feature: pin
    tier override wins, else auto-classified from the resolved model id.
    Slice 7 + the extraction backend (Phase 3) read system_key from
    this spec to pick the right prompt body.
    """
    _adapter, model, tier_override = resolve_pin(settings, feature)
    return spec_for(model, tier_override)


def chat(
    *,
    settings,
    feature: str,
    messages: Iterable[LLMMessage],
    system: str | None = None,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    think: bool | None = None,
    model_override: str | None = None,
) -> LLMResponse:
    """One-shot LLM call for a feature key.

    `think` defaults to the resolved tier's `think` flag so reasoned-tier
    models on Ollama emit reasoning blocks without the caller knowing the
    tier. Pass an explicit bool to override (e.g. the Speaker-Lab forces
    `think: false` to compare reasoned vs direct on the same model).
    """
    adapter, model, tier_override = resolve_pin(settings, feature)
    if model_override:
        # Speaker Lab column override — same provider, different model.
        # The tier re-derives from the OVERRIDE (a qwen3:14b column goes
        # Reasoned even when the pin's default model is Guided-class).
        model = model_override
        tier_override = None
    tier = spec_for(model, tier_override)

    import time as _time

    from .usage import UsageEntry, get_ledger

    started = _time.monotonic()
    try:
        resp = adapter.chat(
            list(messages),
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            system=system,
            think=tier.think if think is None else think,
        )
    except Exception as e:
        get_ledger().record(
            UsageEntry(
                feature=feature, model=model, prompt_tokens=0, completion_tokens=0,
                duration_ms=int((_time.monotonic() - started) * 1000),
                ok=False, error=str(e)[:200],
            )
        )
        raise
    get_ledger().record(
        UsageEntry(
            feature=feature, model=resp.model or model,
            prompt_tokens=resp.prompt_tokens, completion_tokens=resp.completion_tokens,
            duration_ms=int((_time.monotonic() - started) * 1000),
            ok=True,
        )
    )
    return resp
