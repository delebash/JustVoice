"""Training job registry — restart-survivable.

Jobs persist as ``$DATA_DIR/justtts/training/jobs/<id>.json``. In-flight
phases (Validating / Preparing / Running) are reconciled to Failed on
boot since the Python worker won't have the in-memory state to resume.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import TrainJob
from ..paths import training_root
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TrainingRegistry:
    def __init__(self, data_dir: Path):
        self._root = training_root(data_dir)
        (self._root / "jobs").mkdir(parents=True, exist_ok=True)
        (self._root / "adapters").mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._jobs: dict[str, TrainJob] = {}
        self._load_all()

    def _load_all(self) -> None:
        for f in (self._root / "jobs").glob("*.json"):
            try:
                job = TrainJob.model_validate(json.loads(f.read_text(encoding="utf-8")))
                if job.phase in ("validating", "preparing", "running"):
                    job.phase = "failed"
                    job.error = "Job interrupted by server restart. Resume not yet supported."
                    self._flush(job)
                self._jobs[job.job_id] = job
            except Exception as e:
                log.warning("training job %s unreadable: %s", f, e)

    def _flush(self, job: TrainJob) -> None:
        atomic_write_json(self._root / "jobs" / f"{job.job_id}.json", job.model_dump())

    def root(self) -> Path:
        return self._root

    def adapter_dir(self, job_id: str) -> Path:
        return self._root / "adapters" / job_id

    def insert(self, job: TrainJob) -> None:
        with self._lock:
            self._jobs[job.job_id] = job
            self._flush(job)

    def get(self, job_id: str) -> TrainJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[TrainJob]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j.job_id, reverse=True)

    def update(self, job_id: str, **fields) -> TrainJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            for k, v in fields.items():
                if v is not None:
                    setattr(job, k, v)
            self._flush(job)
            return job

    def active_count(self) -> int:
        with self._lock:
            return sum(
                1
                for j in self._jobs.values()
                if j.phase in ("queued", "validating", "preparing", "running")
            )
