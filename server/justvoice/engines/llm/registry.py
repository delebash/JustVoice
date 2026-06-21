# SPDX-License-Identifier: GPL-3.0-or-later
"""Compat shim — the LLM provider registry now lives in the shared
`llm_runner.llm.registry` (2026-06-21 AI-stack convergence). Re-exported
so JustVoice's `..engines.llm.registry` imports resolve the SAME registry
singleton the shared dispatch uses.

`load_from_settings` is JustVoice's boot bridge: it adapts JV's settings
shape (`settings.engines.llm`) to the shared `load_from_configs`."""

from __future__ import annotations

from llm_runner.llm.registry import (
    LLMRegistry,
    construct,
    get_llm_registry,
    load_from_configs,
)


def load_from_settings(settings) -> None:
    """Boot helper — register an adapter for each provider in
    `settings.engines.llm`. Failures are logged, not fatal (see
    `load_from_configs`)."""
    load_from_configs(settings.engines.llm)


__all__ = [
    "LLMRegistry",
    "construct",
    "get_llm_registry",
    "load_from_configs",
    "load_from_settings",
]
