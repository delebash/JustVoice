"""/v1/engines + /v1/engines/current — catalog + runtime engine status."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.catalog import compute_status, known_engines
from ..models import CurrentEngineResponse, EngineInfo, EnginesListResponse, Prerequisites

router = APIRouter(tags=["engines"])


def _enrich(entry: EngineInfo, current_id: str | None) -> EngineInfo:
    st = get_state()
    instance = st.engines.get(entry.id)
    registered = instance is not None
    ready = instance.ready() if instance else False
    entry.status = compute_status(entry.id, registered, ready, current_id)
    entry.current = current_id == entry.id
    entry.is_stubbed = False  # No stubs in the Python port
    return entry


@router.get("/v1/engines", response_model=EnginesListResponse, summary="Full engine catalog")
async def list_engines() -> EnginesListResponse:
    st = get_state()
    current_id = st.engines.current()
    catalog = [_enrich(e, current_id) for e in known_engines()]
    catalog_ids = {e.id for e in catalog}

    # Surface runtime-registered engines (e.g. external OpenAI servers)
    # that aren't in the static catalog.
    for engine in st.engines.all():
        if engine.meta.engine_id in catalog_ids:
            continue
        catalog.append(
            EngineInfo(
                id=engine.meta.engine_id,
                name=engine.meta.display_name,
                description=f"Runtime-registered engine (backend: {engine.meta.backend}). Not in the static catalog.",
                backend=engine.meta.backend,
                capabilities=[],
                prerequisites=Prerequisites(),
                status=compute_status(engine.meta.engine_id, True, engine.ready(), current_id),
                current=current_id == engine.meta.engine_id,
                is_stubbed=False,
            )
        )
    return EnginesListResponse(engines=catalog, current=current_id)


@router.get("/v1/engines/current", response_model=CurrentEngineResponse)
async def get_current_engine() -> CurrentEngineResponse:
    st = get_state()
    current_id = st.engines.current()
    if current_id is None:
        return CurrentEngineResponse(engine=None)
    for entry in known_engines():
        if entry.id == current_id:
            return CurrentEngineResponse(engine=_enrich(entry, current_id))
    return CurrentEngineResponse(engine=None)
