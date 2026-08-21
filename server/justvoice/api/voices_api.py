"""/v1/voices — list + CRUD, plus the acquisition paths: clone, design,
import, blend."""

from __future__ import annotations

import base64
import hashlib
import json as _json
import re as _re
from datetime import datetime, timezone

from fastapi import APIRouter
from llm_runner.llm import LLMNotConfiguredError
from pydantic import BaseModel as _BaseModel

from ..app_state import get_state
from ..engines.llm.run import run_feature
from ..engines.manager import get_manager
from ..errors import bad_request, not_found, not_implemented
from ..models import (
    BlendRecipe,
    BlendVoiceRequest,
    CloneVoiceRequest,
    DesignVoiceRequest,
    ImportVoiceRequest,
    UpdateVoiceRequest,
    Voice,
    VoiceList,
    VoiceRecord,
)
from .extraction_api import RunUsage

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


# ── LLM gender guess (F1 Phase 3 — the voice_gender feature) ─────────────
# EXPLICIT trigger only (ruling 2, 2026-08-05: a button in Voices, never auto
# on fetch). The renderer sends the voices its dictionary could not label; the
# `voice_gender` template row + its preset (p_classify) do the wording and
# tunables; this route computes the variable VALUE and maps the row's
# male/female/unknown contract onto JV's F/M/"" vocabulary.



class GenderGuessVoice(_BaseModel):
    name: str
    description: str = ""


class GenderGuessRequest(_BaseModel):
    voices: list[GenderGuessVoice]


class GenderGuessResponse(_BaseModel):
    # {input name: "F" | "M" | ""} — "" = the model said unknown (left unset).
    guesses: dict[str, str]
    # §16: every AI response carries the run's usage (found violated 2026-08-08
    # by the AI-call-convention pass). None on the no-voices early return.
    usage: RunUsage | None = None


_GENDER_MAP = {"female": "F", "male": "M"}


def _first_json_object(text: str) -> dict:
    text = _re.sub(r"<think>.*?</think>", "", text, flags=_re.DOTALL).strip()
    m = _re.search(r"\{.*\}", text, flags=_re.DOTALL)
    if not m:
        return {}
    try:
        v = _json.loads(m.group(0))
    except (ValueError, TypeError):
        return {}
    return v if isinstance(v, dict) else {}


@router.post("/v1/voices/gender-guess", response_model=GenderGuessResponse,
             summary="LLM-label the voices the built-in dictionary doesn't know")
async def gender_guess(body: GenderGuessRequest) -> GenderGuessResponse:
    from fastapi import HTTPException

    if not body.voices:
        return GenderGuessResponse(guesses={})
    lines = [
        f"- {v.name}" + (f" — {v.description}" if v.description else "")
        for v in body.voices
    ]
    try:
        resp = run_feature("voice_gender", {"voices": "\n".join(lines)})
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    raw = _first_json_object(resp.text)
    wanted = {v.name for v in body.voices}
    guesses = {}
    for name, val in raw.items():
        if name in wanted:
            guesses[name] = _GENDER_MAP.get(str(val).strip().lower(), "")
    return GenderGuessResponse(
        guesses=guesses,
        usage=RunUsage(
            prompt_tokens=resp.prompt_tokens,
            completion_tokens=resp.completion_tokens,
            model=resp.model,
        ),
    )


# ── Blend — the fourth acquisition path ──────────────────────────────────
# Host-side file math (engines/blending.py): the style vectors live in the
# installed variant's voices file, so creating a blend needs no engine
# process at all. Moved here from the lift-era phase5_api 2026-08-19 —
# blend belongs beside clone / design / import.


def blend_language_for(st, engine: str, source_ids: list[str]) -> str:
    """`blending.blend_language` bound to this server's state.

    Exported (no underscore) because the PRE-SAVE audition in
    voice_preview_api must reach the same answer this endpoint reaches —
    that divergence is exactly the bug being closed.
    """
    from ..engines import blending

    def _lang(vid: str) -> str | None:
        rec = st.voices.get(vid)
        return rec.language if rec else None

    return blending.blend_language(
        engine,
        source_ids,
        stored_language=_lang,
        default=st.settings.get().training.default_voice_language,
    )


def _recipe_hash(
    sources: list[str],
    weights: list[float],
    strategy: str = "blend",
    segments: "list | None" = None,
) -> str:
    """The dedup key for a blended voice.

    `strategy` and `segments` joined it 2026-08-21. Without them, two voices
    that are genuinely different collide: a `vector` mix does not normalize
    while a `blend` of the same sources and weights does, and a `recombine`
    carries no weights at all — so all three would have hashed alike and the
    second one asked for would have silently handed back the first.
    """
    h = hashlib.sha256()
    h.update(strategy.encode("utf-8"))
    for s, w in sorted(zip(sources, weights), key=lambda p: p[0]):
        h.update(s.encode("utf-8"))
        h.update(str(w).encode("utf-8"))
    # Segment ORDER is meaningful (later segments overwrite earlier ones on
    # any overlap), so this list is not sorted.
    for seg in segments or []:
        h.update(f"{seg.voice_id}:{seg.start}:{seg.end}".encode("utf-8"))
    return h.hexdigest()


@router.post(
    "/v1/voices/blend", response_model=Voice, status_code=201,
    summary="Blend 2–5 voices into a new voice (elementwise weighted average)",
)
async def blend_voices(req: BlendVoiceRequest) -> Voice:
    st = get_state()

    from ..engines import blending

    if not blending.supports(req.engine):
        raise not_implemented(
            f"engine '{req.engine}' cannot blend — its voices are not style "
            f"vectors. Kokoro is the blending engine."
        )

    def _stored_vector(vid: str) -> list[float] | None:
        rec = st.voices.get(vid)
        return list(rec.embedding) if rec and rec.embedding else None

    # ── Per-strategy validation + the weights that get STORED ───────────
    # Recombine is the odd one: no weights, ordered segments. The three
    # weighted strategies differ only in whether Σw divides the result.
    segments = list(req.segments or [])
    if req.strategy == "recombine":
        if len(segments) < 2:
            raise bad_request("recombine needs at least 2 segments")
        if len(segments) > 5:
            raise bad_request("recombine takes at most 5 segments")
        source_ids = [s.voice_id for s in segments]
        stored_weights: list[float] = []
    else:
        source_ids = list(req.source_voice_ids)
        # Extrapolate is one voice plus the pack centroid, so it is the one
        # weighted strategy that legitimately arrives with a single voice.
        floor = 1 if req.strategy == "extrapolate" else 2
        if len(source_ids) < floor:
            raise bad_request(
                f"{req.strategy} requires at least {floor} source voice"
                f"{'' if floor == 1 else 's'}"
            )
        if len(source_ids) > 5:
            raise bad_request("blend takes at most 5 source voices")
        if req.weights and len(req.weights) != len(source_ids):
            raise bad_request("weights length must match source_voice_ids length")

        weights = req.weights or [1.0] * len(source_ids)
        # A mix divides by Σw so its weights are shares; an analogy keeps its
        # magnitude. Only the dividing kind needs a positive sum.
        normalize = req.strategy != "vector"
        if normalize:
            total = sum(weights)
            if total <= 0:
                raise bad_request("weights must sum to a positive value")
            stored_weights = [w / total for w in weights]
        else:
            if not any(weights):
                raise bad_request("every weight is zero — there is nothing to combine")
            stored_weights = list(weights)

    # Dedup — the same recipe returns the existing voice.
    recipe_hash = _recipe_hash(source_ids, stored_weights, req.strategy, segments)
    for v in st.voices.list():
        if (
            v.engine == req.engine
            and v.source == "blended"
            and v.blend_recipe
            and _recipe_hash(
                v.blend_recipe.sources,
                v.blend_recipe.weights,
                v.blend_recipe.strategy,
                v.blend_recipe.segments,
            )
            == recipe_hash
        ):
            return _stored_to_dto(v)

    try:
        if req.strategy == "recombine":
            blended = blending.recombine(
                req.engine,
                [(s.voice_id, s.start, s.end) for s in segments],
                data_dir=st.data_dir,
                resolve_stored=_stored_vector,
            )
        else:
            blended = blending.blend(
                req.engine,
                source_ids,
                stored_weights,
                data_dir=st.data_dir,
                resolve_stored=_stored_vector,
                normalize=False,  # already applied above, per strategy
            )
    except LookupError as e:
        raise bad_request(str(e))
    except NotImplementedError as e:
        raise not_implemented(str(e))
    except Exception as e:
        raise bad_request(f"blend failed: {e}")

    lang = blend_language_for(st, req.engine, source_ids)

    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=req.engine,
        source="blended",
        name=req.name,
        language=lang,
        sample_count=0,
        blend_recipe=BlendRecipe(
            strategy=req.strategy,
            sources=source_ids,
            weights=stored_weights,
            segments=segments or None,
        ),
        embedding=blended,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    return _stored_to_dto(created)
