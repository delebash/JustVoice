"""GET /v1/system/info — OS / CPU / RAM / GPU / runtime detection."""

from __future__ import annotations

from fastapi import APIRouter

from ..app_state import get_state
from ..models import SystemInfo
from ..system_info import detect

router = APIRouter(tags=["system"])


@router.get("/v1/system/info", response_model=SystemInfo, summary="Hardware + runtime detection")
async def get_system_info() -> SystemInfo:
    info = detect()
    # data_dir rides along so the desktop shell can open on-disk
    # artifacts (the rotating log file) at their real location (W4 rev).
    info.data_dir = str(get_state().data_dir)
    return info
