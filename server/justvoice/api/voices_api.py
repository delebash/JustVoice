"""/v1/voices — list + CRUD for clones/designed/imported, plus presets."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from fastapi import APIRouter

from ..app_state import get_state
from ..engines.manager import get_manager
from ..errors import bad_request, not_found
from ..models import (
    CloneVoiceRequest,
    DesignVoiceRequest,
    ImportVoiceRequest,
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


def _cached_voice_lists() -> list[tuple[str, str, list[dict]]]:
    """Rows from engine_voice_cache as (engine_id, variant_id, voices).
    Empty when the DB isn't initialized (bare unit tests)."""
    try:
        from ..database import session as db_session
        from ..database.models import EngineVoiceCache

        if db_session.SessionLocal is None:
            return []
        db = db_session.SessionLocal()
        try:
            rows = db.query(EngineVoiceCache).all()
            return [
                (r.engine_id, r.variant_id or "", json.loads(r.voices_json or "[]"))
                for r in rows
            ]
        finally:
            db.close()
    except Exception:
        return []


@router.get("/v1/voices", response_model=VoiceList, summary="List all voices (presets + stored)")
async def list_voices() -> VoiceList:
    st = get_state()
    out: list[Voice] = []

    mgr = get_manager()
    loaded = mgr.loaded_ids()
    seen: set[tuple[str, str]] = set()

    def _flags(engine_id: str) -> tuple[bool, str | None]:
        is_loaded = engine_id in loaded
        return is_loaded, (mgr.current_variant_id(engine_id) if is_loaded else None)

    # 1. Static presets from managed engine manifests (always available, no
    #    subprocess needed). Kokoro ships 54 here; clone-only engines empty.
    for manifest in mgr.manifests().values():
        eng_loaded, variant = _flags(manifest.id)
        for v in manifest.static_voices:
            out.append(
                Voice(
                    id=v.get("id"),
                    engine=manifest.id,
                    source="preset",
                    name=v.get("name", v.get("id", "")),
                    language=v.get("language", "en"),
                    gender=v.get("gender", "") or "",
                    engine_loaded=eng_loaded,
                    variant_id=variant,
                )
            )
            seen.add((manifest.id, v.get("id") or ""))

    # 1.5 Cached live voice lists from previously loaded (engine, variant)
    #     pairs — persisted by the manager on every successful load. Covers
    #     variant-discovered voices while the engine is cold. Static presets
    #     win on id collisions.
    for engine_id, variant_id, cached in _cached_voice_lists():
        eng_loaded = engine_id in loaded
        for v in cached:
            vid = v.get("id") or ""
            if not vid or (engine_id, vid) in seen:
                continue
            seen.add((engine_id, vid))
            out.append(
                Voice(
                    id=vid,
                    engine=engine_id,
                    source="preset",
                    name=v.get("name", vid),
                    language=v.get("language", "en"),
                    gender=v.get("gender", "") or "",
                    sample_url=v.get("sample_url"),
                    engine_loaded=eng_loaded,
                    variant_id=variant_id or None,
                )
            )

    # 2. Presets from in-process engines (currently only external-openai-tts).
    #    External providers have no load cost — ready() means renderable now.
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
                    engine_loaded=engine.ready(),
                )
            )

    # 3. Stored (clones / designs / imports).
    for rec in st.voices.list():
        dto = _stored_to_dto(rec)
        dto.engine_loaded, dto.variant_id = _flags(rec.engine)
        out.append(dto)
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
