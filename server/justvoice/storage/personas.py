# SPDX-License-Identifier: GPL-3.0-or-later
"""Persona storage — SQLite-backed (Phase 2 storage unification).

Same public interface as the old JSON-file store so call sites
(``state.personas.*``) are untouched. Legacy ``$DATA_DIR/personas/*.json``
files are imported into the DB the first time the store is constructed,
then moved into ``personas/_migrated_to_sqlite/`` for recoverability.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..database import models as orm
from ..models import Persona
from ..paths import personas_root

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session():
    from ..database.session import SessionLocal

    if SessionLocal is None:
        raise RuntimeError("Database not initialized — init_db() must run before stores")
    return SessionLocal()


def _to_pydantic(row: orm.Persona) -> Persona:
    return Persona(
        id=row.id,
        name=row.name,
        voice_id=row.voice_id or "",
        language=row.language or "en",
        avatar_path=row.avatar_path,
        bio=row.bio,
        personality=row.personality,
        default_delivery=json.loads(row.default_delivery) if row.default_delivery else {},
        effects_chain=json.loads(row.effects_chain) if row.effects_chain else [],
        lexicon_id=row.lexicon_id,
        engine_override=row.engine_override,
        llm_rewrite_enabled=bool(row.llm_rewrite_enabled),
        llm_model=row.llm_model,
        imported_from=row.imported_from,
        imported_id=row.imported_id,
        created_at=row.created_at or _now(),
        updated_at=row.updated_at or _now(),
    )


class PersonaStore:
    def __init__(self, data_dir: Path):
        self._legacy_dir = personas_root(data_dir)
        self._import_legacy_json()

    # ── legacy JSON import (one-time) ─────────────────────────────────

    def _import_legacy_json(self) -> None:
        if not self._legacy_dir.is_dir():
            return
        files = sorted(self._legacy_dir.glob("*.json"))
        if not files:
            return
        moved_dir = self._legacy_dir / "_migrated_to_sqlite"
        db = _session()
        try:
            imported = 0
            for f in files:
                try:
                    p = Persona.model_validate(json.loads(f.read_text(encoding="utf-8")))
                except Exception as e:
                    log.warning("legacy persona %s unreadable, skipping: %s", f, e)
                    continue
                if db.query(orm.Persona).filter(orm.Persona.id == p.id).first() is None:
                    db.add(self._to_row(p))
                    imported += 1
                moved_dir.mkdir(exist_ok=True)
                f.rename(moved_dir / f.name)
            db.commit()
            if imported:
                log.info("migrated %d legacy JSON personas into SQLite", imported)
        finally:
            db.close()

    @staticmethod
    def _to_row(p: Persona) -> orm.Persona:
        return orm.Persona(
            id=p.id,
            name=p.name,
            voice_id=p.voice_id or None,
            language=p.language,
            avatar_path=p.avatar_path,
            bio=p.bio,
            personality=p.personality,
            default_delivery=json.dumps(p.default_delivery) if p.default_delivery else None,
            effects_chain=json.dumps(p.effects_chain) if p.effects_chain else None,
            lexicon_id=p.lexicon_id,
            engine_override=p.engine_override,
            llm_rewrite_enabled=p.llm_rewrite_enabled,
            llm_model=p.llm_model,
            imported_from=p.imported_from,
            imported_id=p.imported_id,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )

    # ── CRUD (same interface as the JSON store) ───────────────────────

    def list(self) -> list[Persona]:
        db = _session()
        try:
            rows = db.query(orm.Persona).order_by(orm.Persona.created_at).all()
            return [_to_pydantic(r) for r in rows]
        finally:
            db.close()

    def get(self, id: str) -> Persona | None:
        db = _session()
        try:
            row = db.query(orm.Persona).filter(orm.Persona.id == id).first()
            return _to_pydantic(row) if row else None
        finally:
            db.close()

    def create(
        self,
        name: str,
        voice_id: str,
        default_delivery: dict | None = None,
        bio: str | None = None,
        engine_override: str | None = None,
        lexicon_id: str | None = None,
        llm_rewrite_enabled: bool = False,
        llm_model: str | None = None,
        language: str = "en",
        avatar_path: str | None = None,
        personality: str | None = None,
        effects_chain: list[dict] | None = None,
        imported_from: str | None = None,
        imported_id: str | None = None,
        id: str | None = None,
    ) -> Persona:
        """Create a persona. ``id`` may be supplied by migrations that need
        to preserve the source record's id."""
        persona = Persona(
            id=id or f"persona_{uuid.uuid4().hex}",
            name=name,
            voice_id=voice_id,
            language=language,
            avatar_path=avatar_path,
            bio=bio,
            personality=personality,
            default_delivery=default_delivery or {},
            effects_chain=effects_chain or [],
            lexicon_id=lexicon_id,
            engine_override=engine_override,
            llm_rewrite_enabled=llm_rewrite_enabled,
            llm_model=llm_model,
            imported_from=imported_from,
            imported_id=imported_id,
            created_at=_now(),
            updated_at=_now(),
        )
        db = _session()
        try:
            db.add(self._to_row(persona))
            db.commit()
            return persona
        finally:
            db.close()

    def update(self, id: str, **fields) -> Persona | None:
        db = _session()
        try:
            row = db.query(orm.Persona).filter(orm.Persona.id == id).first()
            if not row:
                return None
            current = _to_pydantic(row)
            data = current.model_dump()
            # Same semantics as the JSON store: None values leave the
            # existing value in place.
            data.update({k: v for k, v in fields.items() if v is not None})
            data["updated_at"] = _now()
            new = Persona.model_validate(data)
            row.name = new.name
            row.voice_id = new.voice_id or None
            row.language = new.language
            row.avatar_path = new.avatar_path
            row.bio = new.bio
            row.personality = new.personality
            row.default_delivery = json.dumps(new.default_delivery) if new.default_delivery else None
            row.effects_chain = json.dumps(new.effects_chain) if new.effects_chain else None
            row.lexicon_id = new.lexicon_id
            row.engine_override = new.engine_override
            row.llm_rewrite_enabled = new.llm_rewrite_enabled
            row.llm_model = new.llm_model
            row.updated_at = new.updated_at
            db.commit()
            return new
        finally:
            db.close()

    def delete(self, id: str) -> bool:
        db = _session()
        try:
            row = db.query(orm.Persona).filter(orm.Persona.id == id).first()
            if not row:
                return False
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()
