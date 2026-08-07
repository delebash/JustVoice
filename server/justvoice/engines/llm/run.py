# SPDX-License-Identifier: MIT
"""JV's in-server door onto the shared run path (F1 Phase 2, 2026-08-05).

One thin seam so all eight feature call sites read the same way:

    from ..engines.llm.run import run_feature
    resp = run_feature("smart_assign", {"characters": …, "voices": …})

`run_feature` = the kit's `run_action` (resolve the action's template row →
render fail-loud → resolve its ENGINE PRESET → overlay tunables → ensure a
local model resident → dispatch) over the SHARED prompt store and the shared
`build_llm_config` — the same path POST /v1/ai/run takes, so a feature and its
Lab column can never drift. Kwargs pass through to RunRequest (per-call
`maxTokens` for a Lab/API override — caps ruling 2026-08-07: no code-computed
budgets, an empty preset means uncapped — `system`/`userTemplate` for the
refine composition's explicit-system door, `history` for few-shot turns,
`think`/`model`/`providerId` for the attribution Lab's overrides).

This file replaces the pin-era `config.py` mapper as the features' entry:
providers come from the shared DB store; routing is preset-resolved per action;
`PREFER_LOCAL_FEATURES` rides the config. Raises the kit's own errors
(LLMNotConfiguredError → 501 at the API layer, MissingTemplateVariables → a
caller bug named loudly, UnknownActionError → an unseeded row).
"""

from __future__ import annotations

from llm_runner.llm import RunRequest, run_action, stores
from llm_runner.llm.base import LLMResponse
from llm_runner.llm.config_builder import build_llm_config

from ...feature_catalog import PREFER_LOCAL_FEATURES


def jv_llm_config():
    """The dispatch view over the shared stores — JV's one per-app input is the
    prefer-local set (the same value install_llm registers)."""
    return build_llm_config(PREFER_LOCAL_FEATURES)


def run_feature(action: str, variables: dict, **overrides) -> LLMResponse:
    return run_action(
        stores.get_prompt_store(),
        jv_llm_config(),
        RunRequest(action=action, variables=variables, **overrides),
    )
