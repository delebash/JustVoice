# SPDX-License-Identifier: GPL-3.0-or-later
"""Compat shim — Guided/Direct/Reasoned tier classification now lives in
the shared `llm_runner.llm.tiers` (2026-06-21 AI-stack convergence).
Re-exported so JustVoice's `..engines.llm.tiers` imports keep working."""

from __future__ import annotations

from llm_runner.llm.tiers import TIERS, Tier, TierSpec, classify, spec_for

__all__ = ["TIERS", "Tier", "TierSpec", "classify", "spec_for"]
