# SPDX-License-Identifier: GPL-3.0-or-later
"""Compat shim — the LLM adapter contract now lives in the shared
`llm_runner.llm` package (2026-06-21 AI-stack convergence: extract →
share → adopt, JV is the reference). Re-exported here so JustVoice's
existing `..engines.llm.base` imports (and `local_managed.py`) keep
working while the implementation is single-sourced in `llm_runner`."""

from __future__ import annotations

from llm_runner.llm.base import LLMAdapter, LLMMessage, LLMResponse

__all__ = ["LLMAdapter", "LLMMessage", "LLMResponse"]
