# SPDX-License-Identifier: MIT
"""The speech model catalog — a READER over the engine manifests.

Phase ②c of the 2026-08-13 redesign (plan doc §12): each engine's
``manifest.py`` carries facts-only ``VARIANTS`` rows — id, name, languages,
per-variant capabilities (cloning first-class), weights license, and pinned
``sources`` (repo + revision + verified file list + real summed bytes, or a
release-tarball URL). This module just projects those rows onto the wire
shape. The old hand-typed per-engine nests died here: they duplicated the
manifests, pointed four engines at repos that never existed (the dia-2-2b
and moss-tts-v1.5 rows were pure fiction; tada's and luxtts's rows named
wrong repos), carried invented ``vram_mb``/size numbers, and shipped
placeholder ``ModelFile`` rows with fake URLs and TODO sha256 strings.

No memory numbers live here — a variant's footprint is MEASURED at load
time (the §10 amended currency)."""

from __future__ import annotations

from typing import Any

from ..models import ModelVariant


def _variant_rows(engine_id: str) -> list[dict[str, Any]]:
    from .manager import _current_os_label, get_manager

    m = get_manager().get_manifest(engine_id)
    rows = getattr(m.module, "VARIANTS", None) if m else None
    # A row may gate itself by OS ("oses": [...]) — qwen3's -mlx rows are
    # macOS-only, its torch rows Windows/Linux (2026-08-19). No key =
    # visible everywhere. Filtering at THIS door covers models_for,
    # sources_for and the default-variant picker in one place.
    here = _current_os_label()
    return [r for r in (rows or []) if here in (r.get("oses") or (here,))]


def models_for(engine_id: str) -> list[ModelVariant]:
    out: list[ModelVariant] = []
    for r in _variant_rows(engine_id):
        sources = r.get("sources") or []
        size = sum(int(s.get("size_bytes") or 0) for s in sources)
        out.append(ModelVariant(
            id=r["id"],
            name=r.get("name", r["id"]),
            description=r.get("description", ""),
            size_mb=size // (1024 * 1024),
            quality=int(r.get("quality") or 0),
            languages=list(r.get("languages") or []),
            voice_cloning=r.get("voice_cloning"),
            voice_design=r.get("voice_design"),
            preset_voices=r.get("preset_voices"),
            weights_license=r.get("weights_license", ""),
            hf_repo=next((s.get("hf_repo") for s in sources if s.get("hf_repo")), None),
            url=next((s.get("url") for s in sources if s.get("url")), None),
        ))
    return out


def sources_for(engine_id: str, variant_id: str) -> list[dict[str, Any]]:
    """The variant's verified source rows — the download spec the sources
    layer and the speech-cache fetch consume verbatim (multi-source
    variants, e.g. TADA's codec+model+tokenizer, keep every row)."""
    for r in _variant_rows(engine_id):
        if r.get("id") == variant_id:
            return [dict(s) for s in (r.get("sources") or [])]
    return []


def default_variant_for(engine_id: str) -> ModelVariant | None:
    """The variant a no-choice install fetches: the manager's resolved
    default (user override → manifest DEFAULT_VARIANT_ID → on-disk →
    first), else the smallest download. (Replaced the dead
    `recommend_for_vram` picker on 2026-08-14 — that ranked variants by
    scaffold-invented vram_mb conclusions.)"""
    variants = models_for(engine_id)
    if not variants:
        return None
    try:
        from .manager import get_manager

        vid = get_manager().resolved_default_variant(engine_id)
        chosen = next((v for v in variants if v.id == vid), None)
        if chosen is not None:
            return chosen
    except Exception:  # noqa: BLE001 — no manifest (legacy engine) / bare tests
        pass
    return min(variants, key=lambda v: v.size_mb)
