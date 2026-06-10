# SPDX-License-Identifier: GPL-3.0-or-later
"""Lexicon storage — SQLite-backed (Phase 2 storage unification).

Same public interface as the old JSON-file store. Entry shape mapping
between the API model and the DB rows:

    pydantic LexiconEntry          lexicon_entries row
    grapheme                  ←→   word
    phoneme_ipa (when ipa)    ←→   pronunciation + notation="ipa"
    alias (when phonetic)     ←→   pronunciation + notation="phonetic"

Legacy ``$DATA_DIR/lexicons/*.json`` files import on first construction,
then move into ``lexicons/_migrated_to_sqlite/``.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from ..database import models as orm
from ..models import Lexicon, LexiconEntry
from ..paths import lexicons_root

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _session():
    from ..database.session import SessionLocal

    if SessionLocal is None:
        raise RuntimeError("Database not initialized — init_db() must run before stores")
    return SessionLocal()


def _entry_to_row(lexicon_id: str, e: LexiconEntry) -> orm.LexiconEntry:
    if e.phoneme_ipa:
        pronunciation, notation = e.phoneme_ipa, "ipa"
    else:
        pronunciation, notation = e.alias or "", "phonetic"
    return orm.LexiconEntry(
        lexicon_id=lexicon_id,
        word=e.grapheme,
        pronunciation=pronunciation,
        notation=notation,
    )


def _entry_from_row(r: orm.LexiconEntry) -> LexiconEntry:
    if r.notation == "ipa":
        return LexiconEntry(grapheme=r.word, phoneme_ipa=r.pronunciation)
    return LexiconEntry(grapheme=r.word, alias=r.pronunciation)


def _to_pydantic(db, row: orm.Lexicon) -> Lexicon:
    entry_rows = (
        db.query(orm.LexiconEntry)
        .filter(orm.LexiconEntry.lexicon_id == row.id)
        .order_by(orm.LexiconEntry.created_at)
        .all()
    )
    return Lexicon(
        id=row.id,
        name=row.name,
        entries=[_entry_from_row(r) for r in entry_rows],
        scope=row.scope or "global",
        description=row.description,
        project_id=row.project_id,
        persona_id=row.persona_id,
        created_at=row.created_at or _now(),
        updated_at=row.updated_at or _now(),
    )


class LexiconStore:
    def __init__(self, data_dir: Path):
        self._legacy_dir = lexicons_root(data_dir)
        self._import_legacy_json()

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
                    lex = Lexicon.model_validate(json.loads(f.read_text(encoding="utf-8")))
                except Exception as e:
                    log.warning("legacy lexicon %s unreadable, skipping: %s", f, e)
                    continue
                if db.query(orm.Lexicon).filter(orm.Lexicon.id == lex.id).first() is None:
                    db.add(
                        orm.Lexicon(
                            id=lex.id,
                            name=lex.name,
                            description=lex.description,
                            scope=lex.scope,
                            project_id=lex.project_id,
                            persona_id=lex.persona_id,
                            created_at=lex.created_at,
                            updated_at=lex.updated_at,
                        )
                    )
                    for e in lex.entries:
                        db.add(_entry_to_row(lex.id, e))
                    imported += 1
                moved_dir.mkdir(exist_ok=True)
                f.rename(moved_dir / f.name)
            db.commit()
            if imported:
                log.info("migrated %d legacy JSON lexicons into SQLite", imported)
        finally:
            db.close()

    # ── CRUD ──────────────────────────────────────────────────────────

    def list(self) -> list[Lexicon]:
        db = _session()
        try:
            rows = db.query(orm.Lexicon).order_by(orm.Lexicon.created_at).all()
            return [_to_pydantic(db, r) for r in rows]
        finally:
            db.close()

    def get(self, id: str) -> Lexicon | None:
        db = _session()
        try:
            row = db.query(orm.Lexicon).filter(orm.Lexicon.id == id).first()
            return _to_pydantic(db, row) if row else None
        finally:
            db.close()

    def create(
        self,
        name: str,
        entries: list[LexiconEntry] | None = None,
        scope: str = "global",
        description: str | None = None,
        project_id: str | None = None,
        persona_id: str | None = None,
    ) -> Lexicon:
        id = f"lex_{uuid.uuid4().hex}"
        now = _now()
        db = _session()
        try:
            db.add(
                orm.Lexicon(
                    id=id,
                    name=name,
                    description=description,
                    scope=scope,
                    project_id=project_id,
                    persona_id=persona_id,
                    created_at=now,
                    updated_at=now,
                )
            )
            for e in entries or []:
                db.add(_entry_to_row(id, e))
            db.commit()
            row = db.query(orm.Lexicon).filter(orm.Lexicon.id == id).first()
            return _to_pydantic(db, row)
        finally:
            db.close()

    def update(self, id: str, entries: list[LexiconEntry]) -> Lexicon | None:
        """Replace the full entry list (same semantics as the JSON store)."""
        db = _session()
        try:
            row = db.query(orm.Lexicon).filter(orm.Lexicon.id == id).first()
            if not row:
                return None
            db.query(orm.LexiconEntry).filter(orm.LexiconEntry.lexicon_id == id).delete()
            for e in entries:
                db.add(_entry_to_row(id, e))
            row.updated_at = _now()
            db.commit()
            return _to_pydantic(db, row)
        finally:
            db.close()

    def append_entry(self, id: str, entry: LexiconEntry) -> Lexicon | None:
        db = _session()
        try:
            row = db.query(orm.Lexicon).filter(orm.Lexicon.id == id).first()
            if not row:
                return None
            db.add(_entry_to_row(id, entry))
            row.updated_at = _now()
            db.commit()
            return _to_pydantic(db, row)
        finally:
            db.close()

    def delete(self, id: str) -> bool:
        db = _session()
        try:
            row = db.query(orm.Lexicon).filter(orm.Lexicon.id == id).first()
            if not row:
                return False
            db.query(orm.LexiconEntry).filter(orm.LexiconEntry.lexicon_id == id).delete()
            db.delete(row)
            db.commit()
            return True
        finally:
            db.close()
