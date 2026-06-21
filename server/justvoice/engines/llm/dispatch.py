# SPDX-License-Identifier: GPL-3.0-or-later
"""Compat bridge — feature dispatch now lives in the shared
`llm_runner.llm.dispatch` (2026-06-21 AI-stack convergence). The shared
dispatch takes an `LLMConfig`; this module keeps JustVoice's existing
`(settings, feature)` call signatures and builds the `LLMConfig` from
`settings.engines.*` so the ~14 existing call sites stay unchanged.

The two app-catalog values (`DEFAULT_FEATURE_ROLES` — which features
default to quick/accuracy — and the local-runner preference) live HERE
because they're JustVoice's catalog data, not shared machinery."""

from __future__ import annotations

from typing import Iterable

from llm_runner.llm import LLMConfig
from llm_runner.llm import dispatch as _shared
from llm_runner.llm.base import LLMMessage, LLMResponse
from llm_runner.llm.dispatch import LLMNotConfiguredError

# JustVoice feature catalog → default role (the two-speed pattern).
# Latency-sensitive interactive features ride Quick; accuracy-critical
# async features ride Accuracy. Used only when no production config / pin.
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

# The built-in llama.cpp runner is the smart local default for its target
# (privacy-sensitive, accuracy-critical) features when nothing more
# specific is configured.
LOCAL_RUNNER_PROVIDER_ID = "local-llamacpp"
_PREFER_LOCAL_RUNNER: set[str] = {"speaker_attribution"}


def _config(settings) -> LLMConfig:
    """Build the shared dispatch's `LLMConfig` from JV settings."""
    eng = settings.engines
    return LLMConfig(
        providers=list(getattr(eng, "llm", []) or []),
        feature_pins=list(getattr(eng, "feature_pins", []) or []),
        llm_roles=getattr(eng, "llm_roles", None),
        production_configs=list(getattr(eng, "production_configs", []) or []),
        default_feature_roles=DEFAULT_FEATURE_ROLES,
        prefer_local_features=_PREFER_LOCAL_RUNNER,
        local_runner_provider_id=LOCAL_RUNNER_PROVIDER_ID,
    )


def active_production_config(settings, feature: str):
    return _shared.active_production_config(_config(settings), feature)


def resolve_pin(settings, feature: str):
    return _shared.resolve_pin(_config(settings), feature)


def resolve_tier(settings, feature: str):
    return _shared.resolve_tier(_config(settings), feature)


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
    provider_override: str | None = None,
) -> LLMResponse:
    return _shared.chat(
        config=_config(settings),
        feature=feature,
        messages=messages,
        system=system,
        temperature=temperature,
        max_tokens=max_tokens,
        think=think,
        model_override=model_override,
        provider_override=provider_override,
    )


__all__ = [
    "chat",
    "resolve_pin",
    "resolve_tier",
    "active_production_config",
    "LLMNotConfiguredError",
    "DEFAULT_FEATURE_ROLES",
    "LOCAL_RUNNER_PROVIDER_ID",
]
