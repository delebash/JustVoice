"""GET/PUT/PATCH /v1/settings — settings read + update.

`response_model_by_alias=False` on every route: `LLMProviderConfig` /
`FeaturePinConfig` carry camelCase aliases (Thread 3) so the API accepts both
shapes on input, but the nested Settings tree must keep EMITTING snake_case
here — the current renderer reads `engines.llm[].provider_type` etc. in
snake. The camelCase emission flip lands with the renderer's llm-ui adoption.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import Settings, SettingsPatch, SettingsPatchResponse

router = APIRouter(tags=["settings"])


@router.get(
    "/v1/settings",
    response_model=Settings,
    response_model_by_alias=False,
    summary="Read the runtime-mutable settings",
)
async def get_settings() -> Settings:
    return get_state().settings.get()


@router.put(
    "/v1/settings",
    response_model=SettingsPatchResponse,
    response_model_by_alias=False,
    summary="Replace settings wholesale",
)
async def put_settings(new: Settings) -> SettingsPatchResponse:
    saved = get_state().settings.set(new)
    return SettingsPatchResponse(settings=saved, restart_required=[])


@router.patch(
    "/v1/settings",
    response_model=SettingsPatchResponse,
    response_model_by_alias=False,
    summary="Partially update settings",
)
async def patch_settings(patch: SettingsPatch) -> SettingsPatchResponse:
    saved, restart = get_state().settings.patch(patch)
    return SettingsPatchResponse(settings=saved, restart_required=restart)
