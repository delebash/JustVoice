# SPDX-License-Identifier: MIT
"""Per-format import adapters.

Each module exports a `parse(raw: bytes, *, filename: str | None = None)
-> StandardImport` callable. The registry in `imports/__init__.py`
collects them all keyed by their source id.
"""
