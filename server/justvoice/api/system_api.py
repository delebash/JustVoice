"""GET /v1/system/info — OS / CPU / RAM / GPU / runtime detection."""

from __future__ import annotations

from fastapi import APIRouter

from ..models import SystemInfo
from ..system_info import detect

router = APIRouter(tags=["system"])


@router.get("/v1/system/info", response_model=SystemInfo, summary="Hardware + runtime detection")
async def get_system_info() -> SystemInfo:
    return detect()
