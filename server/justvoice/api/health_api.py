"""GET /v1/health."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.manager import get_manager
from ..engines.model_catalog import _variant_rows
from ..models import EngineHealth, HealthResponse
from ..version import API_VERSION, PRODUCT, VERSION

router = APIRouter(tags=["system"])


def loaded_model_name(engine_id: str | None) -> str | None:
    """The loaded model's own name — its catalog row's (*Kokoro 82M*), else the engine's,
    else whatever the registry calls it. Never the bare id when a name exists."""
    if not engine_id:
        return None
    mgr = get_manager()
    variant = mgr.current_variant_id(engine_id)
    row = next((r for r in _variant_rows(engine_id) if r["id"] == variant), None)
    if row:
        return row.get("name") or variant
    manifest = mgr.get_manifest(engine_id)
    if manifest:
        return manifest.name
    inst = get_state().engines.get(engine_id)
    return inst.meta.display_name if inst else engine_id


@router.get("/v1/health", response_model=HealthResponse, summary="Liveness + engine readiness")
async def get_health() -> HealthResponse:
    st = get_state()
    engines = [
        EngineHealth(
            id=e.meta.engine_id,
            name=e.meta.display_name,
            ready=e.ready(),
            backend=e.meta.backend,
        )
        for e in st.engines.all()
    ]
    # The legacy in-process registry (st.engines) tracks "current" for
    # backends registered at boot. The plugin EngineManager tracks the
    # TTS slot's loaded engine independently — checking both keeps the
    # topbar pill + state-lede honest no matter how the engine was
    # loaded (manager.load() vs registry.set_current()).
    current = get_manager().current_id() or st.engines.current()
    return HealthResponse(
        product=PRODUCT,
        apiVersion=API_VERSION,
        status="ok",
        version=VERSION,
        api_version=API_VERSION,
        current_engine=current,
        current_model=loaded_model_name(current),
        engines=engines,
    )
