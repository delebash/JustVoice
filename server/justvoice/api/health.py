"""GET /v1/health."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.manager import get_manager
from ..models import EngineHealth, HealthResponse
from ..version import API_VERSION, PRODUCT, VERSION

router = APIRouter(tags=["system"])


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
        engines=engines,
    )
