# SPDX-License-Identifier: GPL-3.0-or-later
"""Voice storage — SQLite metadata + on-disk audio artifacts (Phase 2).

Metadata rows live in the ``voices`` table; binary artifacts keep their
old layout under ``$DATA_DIR/voices/<id>/`` (ref.wav + samples/). Legacy
``manifest.json`` files import on first construction and are renamed to
``manifest.json.migrated`` in place (the directory must survive — it
holds the reference audio the engines clone from).
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..database import models as orm
from ..models import BlendRecipe, VoiceRecord
from ..paths import voices_root

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session():
    from ..database.session import SessionLocal

    if SessionLocal is None:
        raise RuntimeError("Database not initialized — init_db() must run before stores")
    return SessionLocal()


def _to_pydantic(row: orm.Voice) -> VoiceRecord:
    blend = None
    if row.blend_recipe_json:
        try:
            blend = BlendRecipe.model_validate(json.loads(row.blend_recipe_json))
        except Exception:
            blend = None
    embedding = None
    if row.embedding_json:
        try:
            embedding = json.loads(row.embedding_json)
        except Exception:
            embedding = None
    return VoiceRecord(
        id=row.id,
        engine=row.engine,
        source=row.source,
        name=row.name,
        language=row.language,
        gender=row.gender,
        design_prompt=row.design_prompt,
        transcript=row.transcript,
        sample_count=row.sample_count or 0,
        blend_recipe=blend,
        embedding=embedding,
        adapter_path=row.adapter_path,
        training_job_id=row.training_job_id,
        created_at=row.created_at or _now(),
        updated_at=row.updated_at or _now(),
    )


def _apply(row: orm.Voice, record: VoiceRecord) -> None:
    row.engine = record.engine
    row.source = record.source
    row.name = record.name
    row.language = record.language
    row.gender = record.gender
    row.design_prompt = record.design_prompt
    row.transcript = record.transcript
    row.sample_count = record.sample_count
    row.blend_recipe_json = (
        json.dumps(record.blend_recipe.model_dump()) if record.blend_recipe else None
    )
    row.embedding_json = json.dumps(record.embedding) if record.embedding else None
    row.adapter_path = record.adapter_path
    row.training_job_id = record.training_job_id
    row.updated_at = record.updated_at


class VoiceStore:
    REF_FILENAME = "ref.wav"
    MANIFEST_FILENAME = "manifest.json"
    SAMPLES_DIRNAME = "samples"

    def __init__(self, data_dir: Path):
        self._dir = voices_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._import_legacy_manifests()

    def _import_legacy_manifests(self) -> None:
        db = _session()
        try:
            imported = 0
            for sub in self._dir.iterdir():
                if not sub.is_dir():
                    continue
                manifest = sub / self.MANIFEST_FILENAME
                if not manifest.exists():
                    continue
                try:
                    record = VoiceRecord.model_validate(
                        json.loads(manifest.read_text(encoding="utf-8"))
                    )
                except Exception as e:
                    log.warning("voice manifest %s unreadable, skipping: %s", manifest, e)
                    continue
                if db.query(orm.Voice).filter(orm.Voice.id == record.id).first() is None:
                    row = orm.Voice(id=record.id, created_at=record.created_at)
                    _apply(row, record)
                    db.add(row)
                    imported += 1
                manifest.rename(manifest.with_suffix(".json.migrated"))
            db.commit()
            if imported:
                log.info("migrated %d legacy voice manifests into SQLite", imported)
        finally:
            db.close()

    # ── on-disk artifact helpers (unchanged layout) ───────────────────

    def voice_dir(self, id: str) -> Path:
        return self._dir / id

    def ref_wav_path(self, id: str) -> Path:
        return self.voice_dir(id) / self.REF_FILENAME

    def samples_dir(self, id: str) -> Path:
        return self.voice_dir(id) / self.SAMPLES_DIRNAME

    def write_ref_wav(self, id: str, data: bytes) -> None:
        self.voice_dir(id).mkdir(parents=True, exist_ok=True)
        self.ref_wav_path(id).write_bytes(data)

    # ── CRUD ──────────────────────────────────────────────────────────

    def list(self) -> list[VoiceRecord]:
        db = _session()
        try:
            rows = db.query(orm.Voice).order_by(orm.Voice.created_at).all()
            return [_to_pydantic(r) for r in rows]
        finally:
            db.close()

    def get(self, id: str) -> VoiceRecord | None:
        db = _session()
        try:
            row = db.query(orm.Voice).filter(orm.Voice.id == id).first()
            return _to_pydantic(row) if row else None
        finally:
            db.close()

    def create(self, record: VoiceRecord) -> VoiceRecord:
        if not record.id:
            record.id = f"voice_{uuid.uuid4().hex}"
        record.created_at = _now()
        record.updated_at = _now()
        db = _session()
        try:
            row = orm.Voice(id=record.id, created_at=record.created_at)
            _apply(row, record)
            db.add(row)
            db.commit()
            return record.model_copy(deep=True)
        finally:
            db.close()

    def add_sample(self, id: str, data: bytes) -> int:
        db = _session()
        try:
            row = db.query(orm.Voice).filter(orm.Voice.id == id).first()
            if not row:
                raise KeyError(f"voice not found: {id}")
            self.samples_dir(id).mkdir(parents=True, exist_ok=True)
            next_idx = (row.sample_count or 0) + 1
            (self.samples_dir(id) / f"sample_{next_idx:03d}.wav").write_bytes(data)
            row.sample_count = next_idx
            row.updated_at = _now()
            db.commit()
            return next_idx
        finally:
            db.close()

    def delete(self, id: str) -> bool:
        db = _session()
        try:
            row = db.query(orm.Voice).filter(orm.Voice.id == id).first()
            if not row:
                return False
            d = self.voice_dir(id)
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()
