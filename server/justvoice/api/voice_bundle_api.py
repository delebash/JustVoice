# SPDX-License-Identifier: MIT
"""/v1/voices/{id}/bundle.zip + /v1/voices/bundle — voice portability (C4).

Deliberately its OWN file, not an addition to voices_api.py: that file is
held by the parallel Blend-tab session (user's wall, 2026-08-21), and the
bundle doors don't touch anything it owns. The UI button lands after that
session releases VoicesView — recorded in the tracker.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import Response

from ..app_state import get_state
from ..errors import bad_request, not_found
from ..models import Voice
from ..voice_bundle import build_bundle, import_bundle

log = logging.getLogger(__name__)

router = APIRouter(tags=["voices"])


@router.get("/v1/voices/{voice_id}/bundle.zip", summary="Export a voice as one file")
async def export_voice_bundle(voice_id: str):
    st = get_state()
    try:
        payload, filename = build_bundle(st.voices, voice_id)
    except LookupError as e:
        raise not_found(str(e))
    except ValueError as e:
        raise bad_request(str(e))
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/v1/voices/bundle",
    response_model=Voice,
    status_code=201,
    summary="Import a voice bundle",
)
async def import_voice_bundle(file: UploadFile = File(...)) -> Voice:
    from ..engines.manager import get_manager
    from .captures_api import _MAX_UPLOAD_MB

    payload = await file.read()
    if len(payload) > _MAX_UPLOAD_MB * 1024 * 1024:
        raise bad_request(f"upload exceeds {_MAX_UPLOAD_MB} MB")

    st = get_state()
    # manifests() is a dict keyed by engine id.
    known = set(get_manager().manifests().keys())
    try:
        rec = import_bundle(st.voices, payload, known_engines=known)
    except ValueError as e:
        raise bad_request(str(e))
    return Voice(
        id=rec.id,
        engine=rec.engine,
        source=rec.source,
        name=rec.name,
        language=rec.language,
        gender=rec.gender or "",
    )
