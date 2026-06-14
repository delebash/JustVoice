# SPDX-License-Identifier: GPL-3.0-or-later
"""Lexicon storage — SQLite-primary (Phase 1.5 flip, 2026-06-12).

Same flip as personas: the file-per-lexicon JSON store kept a DB twin
(lexicons / lexicon_entries are FK targets — `projects.default_lexicon_id`,
`personas.lexicon_id`), so the import path had to dual-write or the
commit died on the FK. SQLite is now the single source of truth.

Legacy `$DATA_DIR/lexicons/*.json` files import once at store init
(id-based) and rename `*.json.migrated` so deletes don't resurrect.

Field mapping (pydantic ↔ DB rows): `grapheme` ↔ `word`;
`phoneme_ipa`/`alias` ↔ `pronunciation` + `notation` ("ipa"/"phonetic").
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import Lexicon, LexiconEntry
from ..paths import lexicons_root

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _entry_to_row_fields(e: LexiconEntry) -> dict:
    return {
        "word": e.grapheme,
        "pronunciation": e.phoneme_ipa or e.alias or "",
        "notation": "ipa" if e.phoneme_ipa else "phonetic",
    }


def _row_to_entry(row) -> LexiconEntry:
    if row.notation == "ipa":
        return LexiconEntry(grapheme=row.word, phoneme_ipa=row.pronunciation)
    return LexiconEntry(grapheme=row.word, alias=row.pronunciation)


class LexiconStore:
    """Method surface unchanged (list/get/create/update/append_entry/
    delete); rows live in lexicons + lexicon_entries. `session_factory`
    is injectable for tests; the default resolves the module-global
    SessionLocal lazily at call time."""

    def __init__(self, data_dir: Path, session_factory=None):
        self._dir = lexicons_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._session_factory = session_factory
        self._import_legacy_files()

    def _open(self):
        if self._session_factory is not None:
            return self._session_factory()
        from ..database import session as _db_session

        if _db_session.SessionLocal is None:
            return None
        return _db_session.SessionLocal()

    # ── legacy file import (one-shot, idempotent) ─────────────────────

    def _import_legacy_files(self) -> None:
        files = sorted(self._dir.glob("*.json"))
        if not files:
            return
        db = self._open()
        if db is None:
            log.warning("lexicon store: DB not ready — legacy file import deferred")
            return
        from ..database.models import Lexicon as DBLexicon
        from ..database.models import LexiconEntry as DBEntry

        try:
            for f in files:
                try:
                    lex = Lexicon.model_validate(json.loads(f.read_text(encoding="utf-8")))
                except Exception as e:  # noqa: BLE001 — skip unreadable, keep file
                    log.warning("lexicon file %s unreadable, left in place: %s", f, e)
                    continue
                if db.query(DBLexicon).filter(DBLexicon.id == lex.id).first() is None:
                    db.add(
                        DBLexicon(
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
                        db.add(DBEntry(lexicon_id=lex.id, **_entry_to_row_fields(e)))
                    log.info("lexicon %s imported from legacy file store", lex.id)
                db.commit()
                f.rename(f.parent / (f.name + ".migrated"))
        except Exception as e:  # noqa: BLE001 — boot must not die on this
            log.warning("lexicon legacy-file import failed: %s", e)
            db.rollback()
        finally:
            db.close()

    # ── row → pydantic ────────────────────────────────────────────────

    def _hydrate(self, db, row) -> Lexicon:
        from ..database.models import LexiconEntry as DBEntry

        entry_rows = (
            db.query(DBEntry)
            .filter(DBEntry.lexicon_id == row.id)
            .order_by(DBEntry.created_at)
            .all()
        )
        return Lexicon(
            id=row.id,
            name=row.name,
            entries=[_row_to_entry(e) for e in entry_rows],
            scope=row.scope or "global",
            description=row.description,
            project_id=row.project_id,
            persona_id=row.persona_id,
            created_at=row.created_at or _now(),
            updated_at=row.updated_at or _now(),
        )

    # ── public surface ────────────────────────────────────────────────

    def list(self) -> list[Lexicon]:
        from ..database.models import Lexicon as DBLexicon

        db = self._open()
        if db is None:
            return []
        try:
            rows = db.query(DBLexicon).order_by(DBLexicon.created_at).all()
            return [self._hydrate(db, r) for r in rows]
        finally:
            db.close()

    def get(self, id: str) -> Lexicon | None:
        from ..database.models import Lexicon as DBLexicon

        db = self._open()
        if db is None:
            return None
        try:
            row = db.query(DBLexicon).filter(DBLexicon.id == id).first()
            return self._hydrate(db, row) if row else None
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
        id: str | None = None,
    ) -> Lexicon:
        from ..database.models import Lexicon as DBLexicon
        from ..database.models import LexiconEntry as DBEntry

        with self._lock:
            lex = Lexicon(
                id=id or f"lex_{uuid.uuid4().hex}",
                name=name,
                entries=entries or [],
                scope=scope,
                description=description,
                project_id=project_id,
                persona_id=persona_id,
                created_at=_now(),
                updated_at=_now(),
            )
            db = self._open()
            if db is None:
                raise RuntimeError("lexicon store: database not initialized")
            try:
                db.add(
                    DBLexicon(
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
                    db.add(DBEntry(lexicon_id=lex.id, **_entry_to_row_fields(e)))
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            return lex

    def update(
        self, id: str, entries: list[LexiconEntry], name: str | None = None
    ) -> Lexicon | None:
        """Replace the entry list wholesale (the API's PUT semantics).

        `name`, when given, also renames the lexicon — so the editor's
        rename + per-entry edit/delete both route through one PUT.
        """
        from ..database.models import Lexicon as DBLexicon
        from ..database.models import LexiconEntry as DBEntry

        with self._lock:
            db = self._open()
            if db is None:
                raise RuntimeError("lexicon store: database not initialized")
            try:
                row = db.query(DBLexicon).filter(DBLexicon.id == id).first()
                if row is None:
                    return None
                if name is not None and name.strip():
                    row.name = name.strip()
                db.query(DBEntry).filter(DBEntry.lexicon_id == id).delete()
                for e in entries:
                    db.add(DBEntry(lexicon_id=id, **_entry_to_row_fields(e)))
                row.updated_at = _now()
                db.commit()
                return self._hydrate(db, row)
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def append_entry(self, id: str, entry: LexiconEntry) -> Lexicon | None:
        from ..database.models import Lexicon as DBLexicon
        from ..database.models import LexiconEntry as DBEntry

        with self._lock:
            db = self._open()
            if db is None:
                raise RuntimeError("lexicon store: database not initialized")
            try:
                row = db.query(DBLexicon).filter(DBLexicon.id == id).first()
                if row is None:
                    return None
                db.add(DBEntry(lexicon_id=id, **_entry_to_row_fields(entry)))
                row.updated_at = _now()
                db.commit()
                return self._hydrate(db, row)
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def delete(self, id: str) -> bool:
        from ..database.models import Lexicon as DBLexicon
        from ..database.models import LexiconEntry as DBEntry

        with self._lock:
            db = self._open()
            if db is None:
                return False
            try:
                # SQLite FK cascade needs PRAGMA foreign_keys per connection;
                # delete entries explicitly so the behavior doesn't depend on it.
                db.query(DBEntry).filter(DBEntry.lexicon_id == id).delete()
                deleted = db.query(DBLexicon).filter(DBLexicon.id == id).delete()
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            for suffix in (".json", ".json.migrated"):
                p = self._dir / f"{id}{suffix}"
                if p.exists():
                    p.unlink()
            return bool(deleted)
