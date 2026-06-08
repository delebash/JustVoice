"""GET /v1/health."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import EngineHealth, HealthResponse
from ..version import API_VERSION, VERSION

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
    return HealthResponse(
        status="ok",
        version=VERSION,
        api_version=API_VERSION,
        current_engine=st.engines.current(),
        engines=engines,
    )
