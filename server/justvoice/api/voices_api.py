"""/v1/voices — list + CRUD for clones/designed/imported, plus presets."""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.manager import get_manager
from ..errors import bad_request, not_found
from ..models import (
    CloneVoiceRequest,
    DesignVoiceRequest,
    ImportVoiceRequest,
    UpdateVoiceRequest,
    Voice,
    VoiceList,
    VoiceRecord,
)

router = APIRouter(tags=["voices"])


def _stored_to_dto(rec: VoiceRecord) -> Voice:
    return Voice(
        id=rec.id,
        engine=rec.engine,
        source=rec.source,
        name=rec.name,
        language=rec.language,
        gender=rec.gender or "",
    )


@router.get("/v1/voices", response_model=VoiceList, summary="List all voices (presets + stored)")
async def list_voices() -> VoiceList:
    st = get_state()
    out: list[Voice] = []

    # 1. Static presets from managed engine manifests (always available, no
    #    subprocess needed). Kokoro ships 54 here; clone-only engines empty.
    mgr = get_manager()
    for manifest in mgr.manifests().values():
        for v in manifest.static_voices:
            out.append(
                Voice(
                    id=v.get("id"),
                    engine=manifest.id,
                    source="preset",
                    name=v.get("name", v.get("id", "")),
                    language=v.get("language", "en"),
                    gender=v.get("gender", "") or "",
                )
            )

    # 2. Presets from in-process engines (currently only external-openai-tts).
    for engine in st.engines.all():
        for p in engine.voices():
            out.append(
                Voice(
                    id=p.id,
                    engine=engine.meta.engine_id,
                    source="preset",
                    name=p.name,
                    language=p.language,
                    gender=p.gender or "",
                    sample_url=p.sample_url,
                )
            )

    # 3. Stored (clones / designs / imports).
    for rec in st.voices.list():
        out.append(_stored_to_dto(rec))
    return VoiceList(voices=out)


@router.get("/v1/voices/{id}", response_model=Voice, summary="Get one voice")
async def get_voice(id: str) -> Voice:
    st = get_state()
    # Check presets first
    for engine in st.engines.all():
        for p in engine.voices():
            if p.id == id:
                return Voice(
                    id=p.id,
                    engine=engine.meta.engine_id,
                    source="preset",
                    name=p.name,
                    language=p.language,
                    gender=p.gender or "",
                )
    # Stored
    rec = st.voices.get(id)
    if rec:
        return _stored_to_dto(rec)
    raise not_found(f"voice {id}")


@router.patch("/v1/voices/{id}", response_model=Voice, summary="Update a stored voice's metadata")
async def update_voice(id: str, body: UpdateVoiceRequest) -> Voice:
    st = get_state()
    # Preset voices ship with the engine — nothing stored to update.
    for engine in st.engines.all():
        for p in engine.voices():
            if p.id == id:
                raise bad_request(f"voice {id} is an engine preset and cannot be updated")
    rec = st.voices.update(id, **body.model_dump(exclude_unset=True))
    if not rec:
        raise not_found(f"voice {id}")
    return _stored_to_dto(rec)


@router.delete("/v1/voices/{id}", summary="Delete a stored voice")
async def delete_voice(id: str) -> dict:
    st = get_state()
    if not st.voices.delete(id):
        raise not_found(f"voice {id}")
    return {"deleted": True}


@router.post(
    "/v1/voices/clone", response_model=Voice, status_code=201, summary="Clone a voice from a reference clip"
)
async def clone_voice(body: CloneVoiceRequest) -> Voice:
    st = get_state()
    if not body.engine or not body.name:
        raise bad_request("engine + name required")
    try:
        wav_bytes = base64.b64decode(body.ref_wav_b64)
    except Exception as e:
        raise bad_request(f"invalid base64: {e}")
    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=body.engine,
        source="cloned",
        name=body.name,
        language=body.language,
        gender=body.gender,
        transcript=body.transcript,
        sample_count=0,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    st.voices.write_ref_wav(created.id, wav_bytes)
    return _stored_to_dto(created)


@router.post(
    "/v1/voices/design", response_model=Voice, status_code=201, summary="Create a voice from a prose description"
)
async def design_voice(body: DesignVoiceRequest) -> Voice:
    st = get_state()
    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=body.engine,
        source="designed",
        name=body.name,
        language=body.language,
        gender=body.gender,
        design_prompt=body.prompt,
        sample_count=0,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    return _stored_to_dto(created)


@router.post(
    "/v1/voices/import", response_model=Voice, status_code=201, summary="Import an existing audio clip as a voice"
)
async def import_voice(body: ImportVoiceRequest) -> Voice:
    st = get_state()
    try:
        wav_bytes = base64.b64decode(body.wav_b64)
    except Exception as e:
        raise bad_request(f"invalid base64: {e}")
    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=body.engine,
        source="imported",
        name=body.name,
        language=body.language,
        gender=body.gender,
        transcript=body.transcript,
        sample_count=0,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    st.voices.write_ref_wav(created.id, wav_bytes)
    return _stored_to_dto(created)
