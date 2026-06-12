"""/v1/engines/{id}/models — installable model variants + VRAM-aware recommendation."""

from __future__ import annotations

from fastapi import APIRouter

from ..engines.catalog import known_engines
from ..engines.model_catalog import models_for, recommend_for_vram
from ..errors import not_found
from ..models import ModelsListResponse, RecommendedResponse
from ..system_info import detect

router = APIRouter(tags=["engines"])


@router.get("/v1/engines/{id}/models", response_model=ModelsListResponse)
async def list_models(id: str) -> ModelsListResponse:
    # Validate against the manager's discovered manifests (single source of
    # truth) — the legacy static known_engines() list predates whisper /
    # qwen3-llm and silently 404'd them.
    from ..engines.manager import get_manager

    if get_manager().get_manifest(id) is None and not any(e.id == id for e in known_engines()):
        raise not_found(f"engine {id}")
    variants = models_for(id)
    # Engines redesign: per-model on-disk flag drives the verb shown
    # (Download vs Load/Delete). HF-cache probe; non-HF urls stay None.
    from ..hf_cache import is_hf_repo_cached, repo_from_url

    manifest = get_manager().get_manifest(id)
    for v in variants:
        repo = repo_from_url(v.files[0].url) if v.files else None
        if repo:
            v.on_disk = is_hf_repo_cached(repo)
        elif manifest is not None:
            # Tarball-installed engines (Kokoro via sherpa-onnx release):
            # weights live in the manifest's models_dir, not the HF
            # cache. Probe the declared expected_files so the UI shows
            # ⬇ Download vs Load/Delete truthfully (user-hit: Kokoro
            # offered Load with nothing on disk).
            try:
                steps = manifest.model_install_steps
                expected = [f for st in steps for f in (st.get("expected_files") or [])]
                if expected:
                    mdir = manifest.models_dir
                    v.on_disk = mdir.exists() and all(any(mdir.rglob(f)) for f in expected)
            except Exception:  # noqa: BLE001 — probe must never 500 the list
                pass
    return ModelsListResponse(engine_id=id, variants=variants)


@router.delete("/v1/engines/{id}/models/{variant_id}")
async def delete_model(id: str, variant_id: str) -> dict:
    """Delete one model's weights from the HF cache (Engines redesign:
    the per-model 'Delete model' verb). Engine + other variants stay."""
    import shutil
    from pathlib import Path

    from huggingface_hub import constants as hf_constants

    from ..engines.manager import get_manager
    from ..engines.model_catalog import models_for
    from ..errors import not_found
    from ..hf_cache import is_hf_repo_cached, repo_from_url

    variant = next((v for v in models_for(id) if v.id == variant_id), None)
    if variant is None:
        raise not_found(f"variant {variant_id} on engine {id}")
    repo = repo_from_url(variant.files[0].url) if variant.files else None
    if not repo:
        # Tarball-installed engine (Kokoro): weights live in the
        # manifest's models_dir, not the HF cache — delete that instead.
        manifest = get_manager().get_manifest(id)
        if manifest is None:
            raise not_found(f"engine {id}")
        mdir = manifest.models_dir
        if not mdir.exists() or not any(mdir.iterdir()):
            raise not_found(f"engine {id} has no downloaded model files")
        shutil.rmtree(mdir, ignore_errors=True)
        return {"deleted": True, "engine_id": id, "variant_id": variant_id, "path": str(mdir)}
    if not is_hf_repo_cached(repo):
        raise not_found(f"{repo} has no weights in the local cache")
    repo_dir = Path(hf_constants.HF_HUB_CACHE) / ("models--" + repo.replace("/", "--"))
    shutil.rmtree(repo_dir, ignore_errors=True)
    return {"deleted": True, "engine_id": id, "variant_id": variant_id, "repo": repo}


@router.get("/v1/engines/{id}/models/recommended", response_model=RecommendedResponse)
async def recommended_models(id: str) -> RecommendedResponse:
    # Validate against the manager's discovered manifests (single source of
    # truth) — the legacy static known_engines() list predates whisper /
    # qwen3-llm and silently 404'd them.
    from ..engines.manager import get_manager

    if get_manager().get_manifest(id) is None and not any(e.id == id for e in known_engines()):
        raise not_found(f"engine {id}")
    info = detect()
    vram = max((g.vram_mb for g in info.gpus if g.vram_mb), default=None)
    best_fit, fastest, would_oom = recommend_for_vram(id, vram)
    return RecommendedResponse(
        engine_id=id,
        best_fit=best_fit,
        fastest=fastest,
        would_oom=would_oom,
        detected_vram_mb=vram,
    )
