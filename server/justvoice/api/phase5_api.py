"""Phase 5 endpoints — voice fine-tuning + voice blending.

Surface complete; engine adapters opt in by setting
`supports_training=True` / `supports_embedding_blending=True` and
implementing the optional methods on the TTSBackend protocol.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

from ..app_state import get_state
from ..errors import bad_request, conflict, not_found, not_implemented
from ..models import (
    BlendVoiceRequest,
    TrainingCallback,
    TrainJob,
    TrainJobList,
    TrainVoiceRequest,
    Voice,
    VoiceRecord,
)

router = APIRouter(tags=["phase5"])


# ─── Blending ──────────────────────────────────────────────────────────


def _recipe_hash(sources: list[str], weights: list[float], strategy: str) -> str:
    pairs = sorted(zip(sources, weights), key=lambda p: p[0])
    h = hashlib.sha256()
    h.update(strategy.encode("utf-8"))
    for s, w in pairs:
        h.update(s.encode("utf-8"))
        h.update(str(w).encode("utf-8"))
    return h.hexdigest()


def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    return [(1 - t) * av + t * bv for av, bv in zip(a, b)]


def _norm(v: list[float]) -> float:
    return (sum(x * x for x in v)) ** 0.5


def _slerp(a: list[float], b: list[float], t: float) -> list[float]:
    import math

    na, nb = _norm(a), _norm(b)
    if na < 1e-9 or nb < 1e-9:
        return _lerp(a, b, t)
    radius = (na + nb) * 0.5
    au = [x / na for x in a]
    bu = [x / nb for x in b]
    dot = sum(x * y for x, y in zip(au, bu))
    dot = max(-1.0, min(1.0, dot))
    theta = math.acos(dot)
    if abs(theta) < 1e-6:
        return _lerp(a, b, t)
    sin_theta = math.sin(theta)
    scale_a = math.sin((1 - t) * theta) / sin_theta
    scale_b = math.sin(t * theta) / sin_theta
    return [(scale_a * x + scale_b * y) * radius for x, y in zip(au, bu)]


def _weighted_sum(embeddings: list[list[float]], weights: list[float]) -> list[float]:
    total = sum(weights)
    if total <= 1e-9:
        return list(embeddings[0])
    norm_w = [w / total for w in weights]
    dim = len(embeddings[0])
    out = [0.0] * dim
    for emb, w in zip(embeddings, norm_w):
        for i in range(dim):
            out[i] += w * emb[i]
    mean_norm = sum(_norm(e) for e in embeddings) / len(embeddings)
    current = _norm(out)
    if current > 1e-9:
        scale = mean_norm / current
        out = [x * scale for x in out]
    return out


def _blend(embeddings: list[list[float]], weights: list[float], strategy: str) -> list[float]:
    if strategy == "lerp" and len(embeddings) == 2:
        t = weights[1] / (weights[0] + weights[1])
        return _lerp(embeddings[0], embeddings[1], t)
    if strategy == "slerp" and len(embeddings) == 2:
        t = weights[1] / (weights[0] + weights[1])
        return _slerp(embeddings[0], embeddings[1], t)
    return _weighted_sum(embeddings, weights)


@router.post("/v1/voices/blend", response_model=Voice, status_code=201)
async def blend_voices(req: BlendVoiceRequest) -> Voice:
    st = get_state()
    if len(req.source_voice_ids) < 2:
        raise bad_request("blend requires at least 2 source voices")
    if req.weights and len(req.weights) != len(req.source_voice_ids):
        raise bad_request("weights length must match source_voice_ids length")

    engine = st.engines.get(req.engine)
    if engine is None:
        raise not_found(f"engine '{req.engine}' not installed")
    if not engine.meta.supports_embedding_blending:
        raise not_implemented(
            f"engine '{req.engine}' does not expose speaker embeddings; blending is not supported. "
            f"Pick a blending-capable engine."
        )
    if not engine.ready():
        raise bad_request(
            f"engine '{req.engine}' is not loaded. POST /v1/engines/{req.engine}/load first."
        )

    n = len(req.source_voice_ids)
    weights = req.weights or [1.0] * n
    total = sum(weights)
    normalized = [w / total for w in weights]

    recipe_hash = _recipe_hash(req.source_voice_ids, normalized, req.strategy)

    # Dedup
    for v in st.voices.list():
        if (
            v.engine == req.engine
            and v.source == "blended"
            and v.blend_recipe
            and _recipe_hash(v.blend_recipe.sources, v.blend_recipe.weights, v.blend_recipe.strategy)
            == recipe_hash
        ):
            return Voice(
                id=v.id,
                engine=v.engine,
                source="blended",
                name=v.name,
                language=v.language,
                gender=v.gender or "",
            )

    embeddings: list[list[float]] = []
    for vid in req.source_voice_ids:
        try:
            emb = engine.get_embedding(vid)
        except Exception as e:
            raise bad_request(f"failed to fetch embedding for voice '{vid}': {e}")
        embeddings.append(list(emb))

    blended = _blend(embeddings, normalized, req.strategy)

    # Derive language from sources
    source_langs = set()
    for vid in req.source_voice_ids:
        for eng in st.engines.all():
            for p in eng.voices():
                if p.id == vid:
                    source_langs.add(p.language)
        stored = st.voices.get(vid)
        if stored:
            source_langs.add(stored.language)
    lang = next(iter(source_langs)) if len(source_langs) == 1 else st.settings.get().training.default_voice_language

    from ..models import BlendRecipe

    now = datetime.now(timezone.utc)
    rec = VoiceRecord(
        id="",
        engine=req.engine,
        source="blended",
        name=req.name,
        language=lang,
        sample_count=0,
        blend_recipe=BlendRecipe(
            sources=req.source_voice_ids,
            weights=normalized,
            strategy=req.strategy,
        ),
        embedding=blended,
        created_at=now,
        updated_at=now,
    )
    created = st.voices.create(rec)
    return Voice(
        id=created.id,
        engine=created.engine,
        source="blended",
        name=created.name,
        language=created.language,
        gender=created.gender or "",
    )


# ─── Training ──────────────────────────────────────────────────────────


@router.post("/v1/train", response_model=TrainJob, status_code=202)
async def train_voice(req: TrainVoiceRequest) -> TrainJob:
    st = get_state()
    settings = st.settings.get()
    if not settings.training.enabled:
        raise not_implemented(
            "Training is disabled on this server (settings.training.enabled = false)."
        )
    if not req.name.strip():
        raise bad_request("name must not be empty")
    if not req.samples:
        raise bad_request("samples must contain at least one item")
    if len(req.samples) > settings.training.max_samples_per_job:
        raise bad_request(
            f"samples > {settings.training.max_samples_per_job} not supported "
            f"(settings.training.max_samples_per_job)"
        )
    engine = st.engines.get(req.engine)
    if engine is None:
        raise not_found(f"engine '{req.engine}' not installed")
    if not engine.meta.supports_training:
        raise not_implemented(
            f"engine '{req.engine}' does not support fine-tuning. "
            f"Pick a training-capable engine."
        )
    if not engine.ready():
        raise bad_request(
            f"engine '{req.engine}' is not loaded. POST /v1/engines/{req.engine}/load first."
        )

    if st.training.active_count() >= settings.training.max_concurrent_jobs:
        raise conflict(
            f"max concurrent training jobs reached ({settings.training.max_concurrent_jobs}). "
            f"Cancel an active job first (settings.training.max_concurrent_jobs)."
        )

    job_id = f"train-{uuid.uuid4().hex}"
    job = TrainJob(
        job_id=job_id,
        engine=req.engine,
        voice_name=req.name,
        phase="queued",
        progress=0.0,
        loss_curve=[],
    )
    st.training.insert(job)

    # Forward to engine.train_start in a thread (engine handles its own
    # threading via training_worker.py)
    try:
        engine.train_start(job_id, req.model_dump())
        st.training.update(job_id, phase="validating")
    except NotImplementedError as e:
        st.training.update(job_id, phase="failed", error=str(e))
        raise not_implemented(str(e))
    except Exception as e:
        st.training.update(job_id, phase="failed", error=str(e))
    return st.training.get(job_id) or job


@router.get("/v1/train", response_model=TrainJobList)
async def list_train_jobs() -> TrainJobList:
    return TrainJobList(jobs=get_state().training.list())


@router.get("/v1/train/{job_id}", response_model=TrainJob)
async def get_train_job(job_id: str) -> TrainJob:
    job = get_state().training.get(job_id)
    if not job:
        raise not_found(f"training job '{job_id}' not found")
    return job


@router.delete("/v1/train/{job_id}", response_model=TrainJob)
async def cancel_train_job(job_id: str) -> TrainJob:
    st = get_state()
    job = st.training.get(job_id)
    if not job:
        raise not_found(f"training job '{job_id}' not found")

    # Best-effort engine cancel
    engine = st.engines.get(job.engine)
    if engine:
        try:
            engine.train_cancel(job_id)
        except Exception:
            pass

    if job.phase in ("queued", "validating", "preparing", "running"):
        st.training.update(job_id, phase="cancelled")
    return st.training.get(job_id) or job


@router.post("/internal/training/callback", status_code=204)
async def training_callback(cb: TrainingCallback):
    st = get_state()
    job = st.training.get(cb.job_id)
    if not job:
        raise not_found(f"training job '{cb.job_id}' not found")

    final_voice_id = None
    if cb.phase == "completed":
        # Mint a Voice record pointing at the adapter
        from ..models import VoiceRecord

        now = datetime.now(timezone.utc)
        rec = VoiceRecord(
            id="",
            engine=job.engine,
            source="trained",
            name=job.voice_name,
            language=st.settings.get().training.default_voice_language,
            adapter_path=cb.adapter_path,
            training_job_id=cb.job_id,
            created_at=now,
            updated_at=now,
        )
        created = st.voices.create(rec)
        final_voice_id = created.id

    new_loss = list(job.loss_curve) + list(cb.loss_curve_append)
    st.training.update(
        cb.job_id,
        phase=cb.phase,
        progress=cb.progress,
        loss_curve=new_loss,
        eta_seconds=cb.eta_seconds,
        validation=cb.validation,
        error=cb.error,
        final_voice_id=final_voice_id,
    )
