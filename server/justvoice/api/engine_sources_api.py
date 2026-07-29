# SPDX-License-Identifier: MIT
"""Per-(engine, variant) download-source overrides.

CLAUDE.md project rule: "No hardcoded operator-tunable values — every
knob lives in settings.json + reachable via PATCH /v1/settings". Engine
model URLs / HF repos live in each engine's manifest.MODELS as
*defaults*, and this surface lets the operator override them per
variant without editing code (e.g. if k2-fsa moves kokoro's release
tarball, or if the user wants to point Chatterbox at a fork).

Endpoints:

- GET    /v1/engines/{engine_id}/sources
    Returns every variant with its effective source + provenance
    ("manifest" | "override"). Renderer uses this to render the
    per-row "Source ▾" affordance.
- PUT    /v1/engines/{engine_id}/sources/{variant_id}
    Set the override (url | hf_repo + revision). Validates at least
    one is present.
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
    # Effective values after override resolution. Exactly one of url/
    # hf_repo will be set for a valid source; both null = unconfigured
    # (a misconfigured manifest, surfaced honestly).
    url: str | None = None
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


def _hf_from_url(url: str | None) -> tuple[str | None, str | None]:
    """Recognise a huggingface.co URL and pull out (repo_id, revision).

    Catalog entries store direct file URLs like
        https://huggingface.co/<owner>/<repo>/resolve/<rev>/<path...>
    The unified Download contract wants to fetch the WHOLE repo
    (snapshot_download), not just one file, so we promote any
    huggingface.co URL to an hf_repo for downstream resolution.
    """
    if not url:
        return None, None
    import re

    m = re.match(
        r"https?://huggingface\.co/([^/]+)/([^/]+)/resolve/([^/]+)(?:/.*)?$", url
    )
    if not m:
        return None, None
    owner, repo, rev = m.group(1), m.group(2), m.group(3)
    return f"{owner}/{repo}", (rev if rev not in ("main", "master") else None)


def _default_source_for(variant: ModelVariant) -> dict[str, Any]:
    """Pull the canonical default URL / HF repo from a catalog entry.

    Catalog entries store direct file URLs. For huggingface.co URLs we
    surface BOTH the URL (operator-readable) AND the derived hf_repo +
    revision (so the worker uses snapshot_download to pull the whole
    repo, not a single file). URL-tarball engines (kokoro → github.com)
    just surface the URL.
    """
    url = variant.files[0].url if variant.files else None
    hf_repo, hf_revision = _hf_from_url(url)
    return {
        "url": url,
        "hf_repo": hf_repo,
        "hf_revision": hf_revision,
        "size_mb": variant.size_mb,
        "name": variant.name,
    }


def resolve_source(engine_id: str, variant_id: str) -> tuple[dict[str, Any], str]:
    """Resolve the effective download source for (engine, variant).

    Returns ({url?, hf_repo?, hf_revision?, size_mb?, name?},
            "manifest" | "override").

    Used by the prefetch worker (S1) and by GET /sources for the UI.
    """
    variant = _catalog_variant(engine_id, variant_id)
    default = _default_source_for(variant) if variant else {
        "url": None, "hf_repo": None, "hf_revision": None,
        "size_mb": None, "name": variant_id,
    }

    settings = get_state().settings.get()
    overrides = settings.engines.engine_overrides.get(engine_id)
    override = overrides.sources.get(variant_id) if overrides else None
    if override and (override.url or override.hf_repo):
        effective = {
            "url": override.url,
            "hf_repo": override.hf_repo,
            "hf_revision": override.hf_revision,
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
                url=eff.get("url"),
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
    if not (body.url or body.hf_repo):
        raise bad_request("override needs at least one of url or hf_repo")

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
        url=eff.get("url"),
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
        url=eff.get("url"),
        hf_repo=eff.get("hf_repo"),
        hf_revision=eff.get("hf_revision"),
        provenance=prov,
    )
