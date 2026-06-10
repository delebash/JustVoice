"""Voice storage — directory per voice under ``$DATA_DIR/voices/<id>/``.

Each voice dir contains:
  - manifest.json — the VoiceRecord
  - ref.wav       — primary reference clip (clone/import only)
  - samples/      — additional samples added via /samples
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import VoiceRecord
from ..paths import voices_root
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VoiceStore:
    REF_FILENAME = "ref.wav"
    MANIFEST_FILENAME = "manifest.json"
    SAMPLES_DIRNAME = "samples"

    def __init__(self, data_dir: Path):
        self._dir = voices_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._cache: dict[str, VoiceRecord] = {}
        self._load_all()

    def _load_all(self) -> None:
        for sub in self._dir.iterdir():
            if not sub.is_dir():
                continue
            manifest = sub / self.MANIFEST_FILENAME
            if not manifest.exists():
                continue
            try:
                text = manifest.read_text(encoding="utf-8")
                record = VoiceRecord.model_validate(json.loads(text))
                self._cache[record.id] = record
            except Exception as e:
                log.warning("voice manifest %s unreadable: %s", manifest, e)

    def voice_dir(self, id: str) -> Path:
        return self._dir / id

    def ref_wav_path(self, id: str) -> Path:
        return self.voice_dir(id) / self.REF_FILENAME

    def samples_dir(self, id: str) -> Path:
        return self.voice_dir(id) / self.SAMPLES_DIRNAME

    def list(self) -> list[VoiceRecord]:
        with self._lock:
            return sorted(self._cache.values(), key=lambda r: r.created_at)

    def get(self, id: str) -> VoiceRecord | None:
        with self._lock:
            return self._cache.get(id)

    def create(self, record: VoiceRecord) -> VoiceRecord:
        with self._lock:
            if not record.id:
                record.id = f"voice_{uuid.uuid4().hex}"
            record.created_at = _now()
            record.updated_at = _now()
            self._flush(record)
            self._cache[record.id] = record
            return record.model_copy(deep=True)

    def write_ref_wav(self, id: str, data: bytes) -> None:
        with self._lock:
            self.voice_dir(id).mkdir(parents=True, exist_ok=True)
            self.ref_wav_path(id).write_bytes(data)

    def add_sample(self, id: str, data: bytes) -> int:
        with self._lock:
            record = self._cache.get(id)
            if not record:
                raise KeyError(f"voice not found: {id}")
            self.samples_dir(id).mkdir(parents=True, exist_ok=True)
            next_idx = record.sample_count + 1
            (self.samples_dir(id) / f"sample_{next_idx:03d}.wav").write_bytes(data)
            record.sample_count = next_idx
            record.updated_at = _now()
            self._flush(record)
            return next_idx

    def update(self, id: str, **fields) -> VoiceRecord | None:
        """Partial metadata update. Unknown fields are rejected by Pydantic
        on assignment; None values are skipped (PATCH semantics)."""
        with self._lock:
            record = self._cache.get(id)
            if not record:
                return None
            for key, value in fields.items():
                if value is None:
                    continue
                setattr(record, key, value)
            record.updated_at = _now()
            self._flush(record)
            return record.model_copy(deep=True)

    def delete(self, id: str) -> bool:
        with self._lock:
            if id not in self._cache:
                return False
            d = self.voice_dir(id)
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
            self._cache.pop(id, None)
            return True

    def _flush(self, record: VoiceRecord) -> None:
        d = self.voice_dir(record.id)
        d.mkdir(parents=True, exist_ok=True)
        atomic_write_json(d / self.MANIFEST_FILENAME, record.model_dump())
