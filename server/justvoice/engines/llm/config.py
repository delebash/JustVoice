# SPDX-License-Identifier: MIT
"""JustVoice's LLM config — the boundary between JV's settings and the
shared `llm_runner.llm` dispatch.

This is NOT a forwarding shim (RULE #8). It holds the two genuinely
JustVoice-specific things the shared dispatch needs and which cannot live
in the shared package:

  1. JV's **feature catalog** → default role (which features exist and
     whether each rides Quick or Accuracy). JustWrite has a different
     catalog; this is the per-app data the shared dispatch is parameterized on.
  2. The **mapping** from JV's settings tree (`settings.engines.*`) to the
     shared `LLMConfig` contract.

JustWrite has its own equivalent of this file (its catalog + its
settings→LLMConfig mapping). Everything else — adapters, registry,
tiers, usage, the dispatch logic itself — is the single shared
implementation in `llm_runner.llm`.
"""

from __future__ import annotations

from llm_runner.llm import LLMConfig

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

# Features that prefer the built-in llama.cpp runner when nothing more
# specific is configured (privacy-sensitive, accuracy-critical work).
PREFER_LOCAL_FEATURES: set[str] = {"speaker_attribution"}
LOCAL_RUNNER_PROVIDER_ID = "local-llamacpp"


def llm_config(settings) -> LLMConfig:
    """Build the shared dispatch's `LLMConfig` from JustVoice settings."""
    eng = settings.engines
    return LLMConfig(
        providers=list(getattr(eng, "llm", []) or []),
        feature_pins=list(getattr(eng, "feature_pins", []) or []),
        llm_roles=getattr(eng, "llm_roles", None),
        production_configs=list(getattr(eng, "production_configs", []) or []),
        default_feature_roles=DEFAULT_FEATURE_ROLES,
        prefer_local_features=PREFER_LOCAL_FEATURES,
        local_runner_provider_id=LOCAL_RUNNER_PROVIDER_ID,
    )
