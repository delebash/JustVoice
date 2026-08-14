"""/v1/engines/{id}/models — installable model variants.

The `/models/recommended` endpoint died 2026-08-14 (the measured redesign's
second rethink): it ranked variants by scaffold-invented per-variant
`vram_mb` conclusions, and its one renderer read was a field it never
returned. A no-choice install resolves through
`model_catalog.default_variant_for` instead."""

from __future__ import annotations

from fastapi import APIRouter

from ..engines.catalog import known_engines
from ..engines.model_catalog import models_for
from ..errors import not_found
from ..models import ModelsListResponse

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
    # (Download vs Load/Delete). Phase ② (plan doc §12): the SPEECH CACHE's
    # files.json is the first truth; a legacy install under the engine's own
    # HF cache (models/hf — the per-engine HF_HOME) still counts until it's
    # re-downloaded the new way.
    from ..app_state import get_state
    from ..hf_cache import is_hf_repo_cached
    from ..speech_cache import variant_on_disk

    st = get_state()
    manifest = get_manager().get_manifest(id)
    for v in variants:
        if variant_on_disk(st.data_dir, id, v.id):
            v.on_disk = True
            continue
        repo = v.hf_repo
        if repo:
            root = manifest.models_dir / "hf" / "hub" if manifest else None
            v.on_disk = is_hf_repo_cached(repo, root=root) or is_hf_repo_cached(repo)
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

    from ..engines.manager import get_manager
    from ..engines.model_catalog import models_for
    from ..errors import not_found
    from ..hf_cache import hf_cache_dir, is_hf_repo_cached

    variant = next((v for v in models_for(id) if v.id == variant_id), None)
    if variant is None:
        raise not_found(f"variant {variant_id} on engine {id}")
    # Phase ②: a speech-cache variant deletes as one plain directory —
    # the manifest dies with it, so on_disk goes honestly False.
    from ..app_state import get_state
    from ..speech_cache import variant_dir, variant_on_disk

    st = get_state()
    if variant_on_disk(st.data_dir, id, variant_id):
        vdir = variant_dir(st.data_dir, id, variant_id)
        shutil.rmtree(vdir, ignore_errors=True)
        return {"deleted": True, "engine_id": id, "variant_id": variant_id,
                "path": str(vdir)}
    repo = variant.hf_repo
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
    # Legacy HF-cache installs: the per-engine cache (models/hf/hub — the
    # HF_HOME the manager sets at spawn) first, the process-env cache second.
    manifest = get_manager().get_manifest(id)
    eng_root = manifest.models_dir / "hf" / "hub" if manifest else None
    if eng_root and is_hf_repo_cached(repo, root=eng_root):
        repo_dir = eng_root / ("models--" + repo.replace("/", "--"))
    elif is_hf_repo_cached(repo):
        repo_dir = hf_cache_dir() / ("models--" + repo.replace("/", "--"))
    else:
        raise not_found(f"{repo} has no weights in the local cache")
    shutil.rmtree(repo_dir, ignore_errors=True)
    return {"deleted": True, "engine_id": id, "variant_id": variant_id, "repo": repo}


