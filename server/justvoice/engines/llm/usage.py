# SPDX-License-Identifier: GPL-3.0-or-later
"""Compat shim — the AI usage ledger now lives in the shared
`llm_runner.llm.usage` (2026-06-21 AI-stack convergence). Re-exported so
JustVoice's `..engines.llm.usage` imports resolve the SAME singleton
ledger that the shared dispatch records into."""

from __future__ import annotations

from llm_runner.llm.usage import UsageEntry, UsageLedger, get_ledger

__all__ = ["UsageEntry", "UsageLedger", "get_ledger"]
