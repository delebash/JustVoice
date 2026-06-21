"""GET/PUT/PATCH /v1/settings — settings read + update.

The nested LLM-config models (`LLMProviderConfig` / `FeaturePinConfig` /
`LLMRoleTarget` / `ProductionConfig`) are camelCase-NATIVE as of 2026-06-21 —
the Python field IS the JSON key, with no snake_case aliases. So this surface
emits `engines.llm[].providerType`, `engines.llm_roles.quick.providerId`, etc.
natively (no `response_model_by_alias` needed — there are no aliases to pick
between), and the renderer reads/writes those sections in camelCase. Non-LLM
settings sections keep their own (snake) field names unchanged.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import Settings, SettingsPatch, SettingsPatchResponse

router = APIRouter(tags=["settings"])


@router.get(
    "/v1/settings",
    response_model=Settings,
    summary="Read the runtime-mutable settings",
)
async def get_settings() -> Settings:
    return get_state().settings.get()


@router.put(
    "/v1/settings",
    response_model=SettingsPatchResponse,
    summary="Replace settings wholesale",
)
async def put_settings(new: Settings) -> SettingsPatchResponse:
    saved = get_state().settings.set(new)
    return SettingsPatchResponse(settings=saved, restart_required=[])


@router.patch(
    "/v1/settings",
    response_model=SettingsPatchResponse,
    summary="Partially update settings",
)
async def patch_settings(patch: SettingsPatch) -> SettingsPatchResponse:
    saved, restart = get_state().settings.patch(patch)
    return SettingsPatchResponse(settings=saved, restart_required=restart)
