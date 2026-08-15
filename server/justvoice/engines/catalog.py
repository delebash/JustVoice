"""Engine status derivation.

The hand-typed static catalog that used to live here — `known_engines()` and its
seven `EngineInfo` builders — was EXCISED 2026-08-14. It was a second source of
truth beside `engines/<id>/manifest.py`: every one of its ids had a real manifest,
so `_is_managed()` short-circuited before any of its fallback arms could run, and
its rows drifted (that is the same class of defect as the invented per-variant
catalog rows deleted in phase 2c). The manifests are the catalog; git holds the
old file.

`compute_status` survives because it is NOT about the static list: it derives a
status for RUNTIME-registered engines — the external OpenAI-compatible servers a
user adds, which have no manifest by design.
"""

from __future__ import annotations


def compute_status(
    entry_id: str,
    registered: bool,
    registered_ready: bool,
    current_id: str | None,
) -> str:
    """Match the Rust crate's compute_status logic."""
    if not registered:
        return "not_installed"
    is_current = current_id == entry_id
    if is_current and registered_ready:
        return "loaded"
    if is_current:
        return "loading"
    return "installed"
