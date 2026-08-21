# SPDX-License-Identifier: MIT
"""Voice fine-tuning jobs — /v1/train.

Engine adapters opt in by setting `supports_training=True` and implementing
`train_start` / `train_cancel`. Trainers run as subprocesses in the engine's
own environment (see each engine's trainer script); job state lives in the
training registry and the trainer reports back through
POST /internal/training/callback, which also mints the trained Voice record
on completion.

(Extracted 2026-08-19 from the lift-era `phase5_api.py` — a plan-phase name,
not an API name. Blending moved to voices_api.py with the other acquisition
paths.)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile

from ..app_state import get_state
from ..storage.training_jobs import JOB_LOG_CAP
from ..errors import bad_request, conflict, not_found, not_implemented
from ..models import (
    CreateTrainingDatasetRequest,
    TrainingCallback,
    TrainingDataset,
    TrainingDatasetList,
    TrainJob,
    TrainJobList,
    TrainVoiceRequest,
    UpdateTrainingDatasetRequest,
    VoiceRecord,
)

router = APIRouter(tags=["training"])


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
    sample_count = len(req.samples)
    dataset_name: str | None = None
    # The language the run actually trains at: the request wins, then the
    # dataset's own recorded language, then the operator default. It is
    # stamped on the job so a finished adapter can say what it speaks —
    # an adapter carries its training language's phonology, and until now
    # every run silently fell through to English.
    language = req.language
    if req.dataset_id:
        from ..storage import training_datasets

        ds = training_datasets.get_dataset(st.data_dir, req.dataset_id)
        if ds is None:
            raise not_found(f"training dataset '{req.dataset_id}' not found")
        sample_count = ds.clip_count
        dataset_name = ds.name
        if not language:
            language = ds.language
    elif not req.samples:
        raise bad_request("samples must contain at least one item — or pick a dataset")
    if len(req.samples) > settings.training.max_samples_per_job:
        raise bad_request(
            f"samples > {settings.training.max_samples_per_job} not supported "
            f"(settings.training.max_samples_per_job)"
        )
    from .. import training_runner

    # Managed engines live in subprocess procs the registry never holds —
    # the trainer dispatch, per-variant capability gate and checkpoint
    # check all live host-side in training_runner. No loaded engine is
    # required (the run evicts them all anyway).
    if not training_runner.supports(req.engine):
        raise not_implemented(
            f"engine '{req.engine}' does not support fine-tuning. "
            f"Pick a training-capable engine."
        )

    if st.training.active_count() >= settings.training.max_concurrent_jobs:
        raise conflict(
            f"max concurrent training jobs reached ({settings.training.max_concurrent_jobs}). "
            f"Cancel an active job first (settings.training.max_concurrent_jobs)."
        )

    if not language:
        language = settings.training.default_voice_language

    job_id = f"train-{uuid.uuid4().hex}"
    job = TrainJob(
        job_id=job_id,
        engine=req.engine,
        voice_name=req.name,
        phase="queued",
        progress=0.0,
        loss_curve=[],
        epochs=req.epochs,
        sample_count=sample_count,
        dataset_id=req.dataset_id,
        dataset_name=dataset_name,
        language=language,
    )
    st.training.insert(job)

    # Spawn the subprocess trainer; it tails progress back into the
    # registry and mints the Voice on success. The resolved language goes
    # with it — the request's own field may have been blank.
    payload = req.model_dump()
    payload["language"] = language
    try:
        training_runner.start(job_id, req.engine, payload)
        st.training.update(job_id, phase="validating")
    except (LookupError, ValueError) as e:
        st.training.update(job_id, phase="failed", error=str(e))
        raise bad_request(str(e))
    except Exception as e:
        st.training.update(job_id, phase="failed", error=str(e))
    return st.training.get(job_id) or job


@router.get("/v1/train", response_model=TrainJobList)
async def list_train_jobs() -> TrainJobList:
    return TrainJobList(jobs=get_state().training.list())


# ── Datasets — clips that survive the page (Alexandria's Dataset tab) ──
# Declared BEFORE /v1/train/{job_id}: FastAPI matches in order and the
# job route would otherwise capture "datasets" as a job id.


@router.get("/v1/train/datasets", response_model=TrainingDatasetList)
async def list_training_datasets() -> TrainingDatasetList:
    from ..storage import training_datasets

    return TrainingDatasetList(
        datasets=training_datasets.list_datasets(get_state().data_dir)
    )


@router.post("/v1/train/datasets", response_model=TrainingDataset, status_code=201)
async def create_training_dataset(req: CreateTrainingDatasetRequest) -> TrainingDataset:
    from ..storage import training_datasets

    if not req.name.strip():
        raise bad_request("name must not be empty")
    if not req.samples:
        raise bad_request("samples must contain at least one clip")
    return training_datasets.create_dataset(
        get_state().data_dir,
        req.name.strip(),
        [s.model_dump() for s in req.samples],
        language=req.language,
        ref_index=req.ref_index,
        origin=req.origin,
    )


@router.post(
    "/v1/train/datasets/upload",
    response_model=TrainingDataset,
    status_code=201,
    summary="Import a dataset from a ZIP (Alexandria-compatible)",
)
async def upload_training_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    language: str | None = Form(None),
) -> TrainingDataset:
    """A ZIP of WAV clips + metadata.jsonl, exactly what Download produces —
    and exactly what Alexandria's Training tab uploads, so datasets travel
    between the two apps unchanged. A ref.wav matching one of the clips
    becomes the reference sample."""
    from ..storage import training_datasets
    from .captures_api import _MAX_UPLOAD_MB

    buf = await file.read()
    if len(buf) > _MAX_UPLOAD_MB * 1024 * 1024:
        raise bad_request(f"upload exceeds {_MAX_UPLOAD_MB} MB")
    ds_name = (name or "").strip() or Path(file.filename or "dataset").stem
    try:
        return training_datasets.import_zip(
            get_state().data_dir, ds_name, buf, language=language
        )
    except ValueError as e:
        raise bad_request(str(e))


@router.get(
    "/v1/train/datasets/{dataset_id}/archive.zip",
    summary="Download the dataset as a ZIP",
)
async def download_training_dataset(dataset_id: str):
    from fastapi.responses import Response

    from ..storage import training_datasets

    st = get_state()
    rec = training_datasets.get_dataset(st.data_dir, dataset_id)
    payload = training_datasets.build_zip(st.data_dir, dataset_id)
    if rec is None or payload is None:
        raise not_found(f"training dataset '{dataset_id}' not found")
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in rec.name).strip() or dataset_id
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}.zip"'},
    )


@router.patch("/v1/train/datasets/{dataset_id}", response_model=TrainingDataset)
async def update_training_dataset(
    dataset_id: str, req: UpdateTrainingDatasetRequest
) -> TrainingDataset:
    """Rename, correct the spoken language, or retarget the reference clip."""
    from ..storage import training_datasets

    name = req.name.strip() if req.name is not None else None
    if name is not None and not name:
        raise bad_request("name must not be empty")
    try:
        rec = training_datasets.update_dataset(
            get_state().data_dir,
            dataset_id,
            name=name,
            language=req.language,
            ref_index=req.ref_index,
        )
    except ValueError as e:
        raise bad_request(str(e))
    if rec is None:
        raise not_found(f"training dataset '{dataset_id}' not found")
    return rec


@router.get("/v1/train/datasets/{dataset_id}/samples")
async def get_training_dataset_samples(dataset_id: str) -> dict:
    from ..storage import training_datasets

    st = get_state()
    if training_datasets.get_dataset(st.data_dir, dataset_id) is None:
        raise not_found(f"training dataset '{dataset_id}' not found")
    return {"samples": training_datasets.load_samples(st.data_dir, dataset_id)}


@router.delete("/v1/train/datasets/{dataset_id}", status_code=204)
async def delete_training_dataset(dataset_id: str) -> None:
    from ..storage import training_datasets

    if not training_datasets.delete_dataset(get_state().data_dir, dataset_id):
        raise not_found(f"training dataset '{dataset_id}' not found")


@router.get("/v1/train/builtin", summary="Built-in adapters and their download state")
async def list_builtin_adapters() -> dict:
    from .. import training_builtin

    return {"adapters": training_builtin.list_builtin(get_state())}


@router.post(
    "/v1/train/builtin/{builtin_id}/download",
    summary="Download a built-in adapter's weights and add its voice",
)
def download_builtin_adapter(builtin_id: str) -> dict:
    """Sync def on purpose: FastAPI runs it in the threadpool, so the
    (possibly minutes-long) download never blocks the event loop."""
    from .. import training_builtin

    try:
        return training_builtin.download(get_state(), builtin_id)
    except LookupError as e:
        raise not_found(str(e))
    except ValueError as e:
        raise bad_request(str(e))


@router.get("/v1/train/{job_id}/adapter.zip", summary="Download a trained adapter")
async def download_adapter(job_id: str):
    """Zip the completed job's adapter directory (Alexandria has per-adapter
    download; so do we). The zip is built once and cached beside the
    adapter."""
    import shutil
    from pathlib import Path

    from fastapi.responses import FileResponse

    st = get_state()
    job = st.training.get(job_id)
    if not job:
        raise not_found(f"training job '{job_id}' not found")
    if job.phase != "completed":
        raise bad_request(f"job '{job_id}' is {job.phase} — only completed jobs have an adapter")
    adapter_dir = Path(st.data_dir) / "training" / job_id / "adapter"
    if not adapter_dir.is_dir() or not any(adapter_dir.iterdir()):
        raise not_found(f"adapter files for '{job_id}' are missing on disk")
    zip_path = adapter_dir.parent / "adapter.zip"
    if not zip_path.is_file():
        shutil.make_archive(str(zip_path.with_suffix("")), "zip", adapter_dir)
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{job.voice_name or job_id}-adapter.zip",
    )


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

    # Kill the trainer's whole process tree (Windows launcher shims spawn
    # the real interpreter as a child).
    from .. import training_runner

    killed = training_runner.cancel(job_id)
    if not killed and job.phase in ("queued", "validating", "preparing", "running"):
        # No live process (e.g. server restarted) — just mark it.
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
        now = datetime.now(timezone.utc)
        rec = VoiceRecord(
            id="",
            engine=job.engine,
            source="lora",
            name=job.voice_name,
            # The language the run actually trained at, not the operator
            # default: an adapter carries its training language's phonology,
            # so labelling a German adapter "en-US" is simply wrong.
            language=job.language or st.settings.get().training.default_voice_language,
            adapter_path=cb.adapter_path,
            training_job_id=cb.job_id,
            created_at=now,
            updated_at=now,
        )
        created = st.voices.create(rec)
        final_voice_id = created.id

    new_loss = list(job.loss_curve) + list(cb.loss_curve_append)
    # Ring-buffered: a long run must not grow the job record without bound,
    # and the tail is the part that explains how a run ended.
    new_logs = (list(job.logs) + list(cb.logs_append))[-JOB_LOG_CAP:]
    st.training.update(
        cb.job_id,
        phase=cb.phase,
        progress=cb.progress,
        loss_curve=new_loss,
        logs=new_logs,
        eta_seconds=cb.eta_seconds,
        validation=cb.validation,
        error=cb.error,
        final_voice_id=final_voice_id,
    )


@router.post(
    "/v1/train/prepare",
    status_code=202,
    summary="Start a background preparation run: recordings in, gated clips out",
)
async def prepare_start(
    files: list[UploadFile] = File(...),
    language: str | None = Form(None),
    dataset_names: list[str] | None = Form(None),
    save_datasets: bool = Form(False),
):
    """Alexandria's Preparer contract: single slot, background run, streamed
    progress, cancel, results fetched when done (training_prep.py). 409 when
    a run is already in progress.

    One or many recordings — batch mode is the same path with a longer
    queue. `save_datasets` turns each recording's surviving clips into its
    own training set, named from `dataset_names[i]` or the file's own stem.
    """
    from .. import training_prep
    from .captures_api import _MAX_UPLOAD_MB

    payload: list[tuple[str, bytes]] = []
    for f in files:
        buf = await f.read()
        if len(buf) > _MAX_UPLOAD_MB * 1024 * 1024:
            raise bad_request(f"{f.filename or 'upload'} exceeds {_MAX_UPLOAD_MB} MB")
        if not buf:
            raise bad_request(f"{f.filename or 'upload'} is empty")
        payload.append((f.filename or "recording.wav", buf))
    if not payload:
        raise bad_request("attach at least one recording")
    try:
        training_prep.start(
            payload,
            language,
            dataset_names=dataset_names,
            save_datasets=save_datasets,
        )
    except RuntimeError as e:
        raise conflict(str(e))
    return training_prep.status()


@router.get("/v1/train/prepare/status", summary="Progress of the running preparation")
async def prepare_status() -> dict:
    from .. import training_prep

    return training_prep.status()


@router.post("/v1/train/prepare/cancel", summary="Cancel the running preparation")
async def prepare_cancel() -> dict:
    from .. import training_prep

    training_prep.cancel()
    return training_prep.status()


@router.get("/v1/train/prepare/result", summary="The finished preparation's clips")
async def prepare_result() -> dict:
    from .. import training_prep

    r = training_prep.result()
    if r is None:
        raise not_found("no finished preparation — start one and poll status")
    return r
