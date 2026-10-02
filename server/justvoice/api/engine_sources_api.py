# SPDX-License-Identifier: MIT
"""Per-(engine, variant) download-source overrides.

CLAUDE.md project rule: "No hardcoded operator-tunable values — every
knob lives in settings.json + reachable via PATCH /v1/settings". Engine
model repos live in each engine's manifest VARIANTS rows as verified
*defaults* (phase ②c), and this surface lets the operator point a variant at
another Hugging Face repo (a mirror, a fork) without editing code. The
override swaps the repository and revision and KEEPS the pinned file names —
the runtime's config names those files, and a whole-tree fetch of a GGUF repo
can run to many gigabytes. (A `url` override for tarball engines went with
them on 2026-10-01.)

Endpoints:

- GET    /v1/engines/{engine_id}/sources
    Returns every variant with its effective source + provenance
    ("manifest" | "override"). Renderer uses this to render the
    per-row "Source ▾" affordance.
- PUT    /v1/engines/{engine_id}/sources/{variant_id}
    Set the override (hf_repo + optional revision). hf_repo is required.
- DELETE /v1/engines/{engine_id}/sources/{variant_id}
    Clear the override → reverts to the manifest default.

Writes go through the state's settings store so they persist + the
prefetch worker reads the same Settings.engines.engine_overrides map.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..app_state import get_state
from ..engines.manager import get_manager
from ..engines.model_catalog import models_for
from ..errors import bad_request, not_found
from ..models import EngineModelSourceOverride, ModelVariant

log = logging.getLogger(__name__)
router = APIRouter(tags=["engines"])


# ── Response shapes ──────────────────────────────────────────────────


class VariantSource(BaseModel):
    variant_id: str
    name: str | None = None
    size_mb: int | None = None
    # Effective values after override resolution. hf_repo null =
    # unconfigured (a misconfigured manifest, surfaced honestly).
    hf_repo: str | None = None
    hf_revision: str | None = None
    # "manifest" (no override) | "override" (operator-set).
    provenance: str = "manifest"


class EngineSourcesResponse(BaseModel):
    engine_id: str
    variants: list[VariantSource] = []


# ── Helpers ──────────────────────────────────────────────────────────


def _catalog_variant(engine_id: str, variant_id: str) -> ModelVariant | None:
    """Look up a variant by id in the engine's model catalog."""
    for v in models_for(engine_id):
        if v.id == variant_id:
            return v
    return None


def _default_source_for(engine_id: str, variant: ModelVariant) -> dict[str, Any]:
    """The manifest's VERIFIED source rows (phase ②c, plan doc §12): the
    first source drives the single-source wire fields; the FULL list rides
    `sources` so multi-file variants (speech recognition: the recogniser +
    its aligner) download completely. `files` is the pinned per-file list the
    speech-cache fetch resolves verbatim — a missing name fails loud."""
    from ..engines.model_catalog import sources_for

    sources = sources_for(engine_id, variant.id)
    first = sources[0] if sources else {}
    return {
        "hf_repo": first.get("hf_repo"),
        "hf_revision": first.get("revision"),
        "files": first.get("files"),
        "sources": sources or None,
        "size_mb": variant.size_mb,
        "name": variant.name,
    }


def resolve_source(engine_id: str, variant_id: str) -> tuple[dict[str, Any], str]:
    """Resolve the effective download source for (engine, variant).

    Returns ({hf_repo?, hf_revision?, files?, sources?, size_mb?, name?},
    "manifest" | "override"). `sources` is the manifest's full verified
    multi-source list (phase ②c); an operator OVERRIDE swaps every row's repo
    and revision and keeps its pinned files, so the fetch asks the mirror for
    exactly the names the runtime will load (a missing one fails loud).

    Used by the prefetch worker (S1), the load door's acquisition, and
    GET /sources for the UI.
    """
    variant = _catalog_variant(engine_id, variant_id)
    default = _default_source_for(engine_id, variant) if variant else {
        "hf_repo": None, "hf_revision": None,
        "files": None, "sources": None, "size_mb": None, "name": variant_id,
    }

    settings = get_state().settings.get()
    overrides = settings.engines.engine_overrides.get(engine_id)
    override = overrides.sources.get(variant_id) if overrides else None
    if override and override.hf_repo:
        rows = [{**row, "hf_repo": override.hf_repo, "revision": override.hf_revision}
                for row in (default["sources"] or [])]
        effective = {
            "hf_repo": override.hf_repo,
            "hf_revision": override.hf_revision,
            "files": default["files"],
            "sources": rows or None,
            "size_mb": default["size_mb"],
            "name": default["name"],
        }
        return effective, "override"
    return default, "manifest"


def _all_variant_ids(engine_id: str) -> list[str]:
    """Variant ids from the model catalog (the same source the existing
    /v1/engines/{id}/models endpoint uses).
    """
    return [v.id for v in models_for(engine_id)]


# ── Endpoints ────────────────────────────────────────────────────────


@router.get(
    "/v1/engines/{engine_id}/sources",
    response_model=EngineSourcesResponse,
    summary="Effective download source per model variant + provenance",
)
async def list_sources(engine_id: str) -> EngineSourcesResponse:
    if get_manager().get_manifest(engine_id) is None:
        raise not_found(f"engine {engine_id!r} (no manifest)")
    variants: list[VariantSource] = []
    for vid in _all_variant_ids(engine_id):
        eff, prov = resolve_source(engine_id, vid)
        variants.append(
            VariantSource(
                variant_id=vid,
                name=eff.get("name"),
                size_mb=eff.get("size_mb"),
                hf_repo=eff.get("hf_repo"),
                hf_revision=eff.get("hf_revision"),
                provenance=prov,
            )
        )
    return EngineSourcesResponse(engine_id=engine_id, variants=variants)


@router.put(
    "/v1/engines/{engine_id}/sources/{variant_id}",
    response_model=VariantSource,
    summary="Override the download source for one engine model variant",
)
async def set_source(
    engine_id: str, variant_id: str, body: EngineModelSourceOverride
) -> VariantSource:
    if get_manager().get_manifest(engine_id) is None:
        raise not_found(f"engine {engine_id!r} (no manifest)")
    if variant_id not in _all_variant_ids(engine_id):
        # Permissive: allow overrides for variants the manifest doesn't
        # know about? No — that would let a typo become a silently
        # broken row. Reject.
        raise not_found(f"variant {variant_id!r} on engine {engine_id!r}")
    if not body.hf_repo:
        raise bad_request("override needs hf_repo")

    store = get_state().settings
    settings = store.get()
    overrides = settings.engines.engine_overrides.get(engine_id)
    if overrides is None:
        from ..models import EngineOverrides

        overrides = EngineOverrides()
    overrides.sources[variant_id] = body
    settings.engines.engine_overrides[engine_id] = overrides
    store.set(settings)

    eff, prov = resolve_source(engine_id, variant_id)
    return VariantSource(
        variant_id=variant_id,
        name=eff.get("name"),
        size_mb=eff.get("size_mb"),
        hf_repo=eff.get("hf_repo"),
        hf_revision=eff.get("hf_revision"),
        provenance=prov,
    )


@router.delete(
    "/v1/engines/{engine_id}/sources/{variant_id}",
    response_model=VariantSource,
    summary="Clear an override and revert to the manifest default",
)
async def clear_source(engine_id: str, variant_id: str) -> VariantSource:
    if get_manager().get_manifest(engine_id) is None:
        raise not_found(f"engine {engine_id!r} (no manifest)")
    store = get_state().settings
    settings = store.get()
    overrides = settings.engines.engine_overrides.get(engine_id)
    if overrides and variant_id in overrides.sources:
        overrides.sources.pop(variant_id)
        if not overrides.sources:
            settings.engines.engine_overrides.pop(engine_id, None)
        store.set(settings)

    eff, prov = resolve_source(engine_id, variant_id)
    return VariantSource(
        variant_id=variant_id,
        name=eff.get("name"),
        size_mb=eff.get("size_mb"),
        hf_repo=eff.get("hf_repo"),
        hf_revision=eff.get("hf_revision"),
        provenance=prov,
    )
