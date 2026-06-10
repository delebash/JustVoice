"""GET/PUT/PATCH /v1/settings — settings read + update."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import Settings, SettingsPatch, SettingsPatchResponse

router = APIRouter(tags=["settings"])


@router.get("/v1/settings", response_model=Settings, summary="Read the runtime-mutable settings")
async def get_settings() -> Settings:
    return get_state().settings.get()


@router.put("/v1/settings", response_model=SettingsPatchResponse, summary="Replace settings wholesale")
async def put_settings(new: Settings) -> SettingsPatchResponse:
    saved = get_state().settings.set(new)
    return SettingsPatchResponse(settings=saved, restart_required=[])


@router.patch("/v1/settings", response_model=SettingsPatchResponse, summary="Partially update settings")
async def patch_settings(patch: SettingsPatch) -> SettingsPatchResponse:
    saved, restart = get_state().settings.patch(patch)
    return SettingsPatchResponse(settings=saved, restart_required=restart)
