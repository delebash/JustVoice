# SPDX-License-Identifier: MIT
"""Persona storage — SQLite-primary (Phase 1.5 flip, 2026-06-12).

The file-per-persona JSON store kept a DB twin via a best-effort mirror,
and the split-brain bit three separate times: preset creates 500'd on
FK targets the DB never saw, factory reset left characters alive, and
re-imports self-healed twins that were never missing. SQLite is now the
single source of truth.

Legacy `$DATA_DIR/personas/*.json` files are imported once at store
init (id-based, so nothing is duplicated) and renamed `*.json.migrated`
so a persona deleted later doesn't resurrect on the next boot.

The legacy `llm_rewrite_enabled` / `llm_model` fields are accepted (old
JSON files still validate; the API request shape keeps them) but are
NOT persisted — the old mirror never wrote them to the DB either, and
nothing reads them (Rewrite is an explicit tool, not a render hook).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import Persona
from ..paths import personas_root

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _row_to_persona(row) -> Persona:
    def _loads(raw, fallback):
        if not raw:
            return fallback
        try:
            out = json.loads(raw)
            return out if isinstance(out, type(fallback)) else fallback
        except (json.JSONDecodeError, TypeError):
            return fallback

    return Persona(
        id=row.id,
        name=row.name,
        voice_id=row.voice_id,
        language=row.language or "en",
        avatar_path=row.avatar_path,
        voice_instruct=row.voice_instruct,
        personality=row.personality,
        default_delivery=_loads(row.default_delivery, {}),
        effects_chain=_loads(row.effects_chain, []),
        lexicon_id=row.lexicon_id,
        engine_override=row.engine_override,
        imported_from=row.imported_from,
        imported_id=row.imported_id,
        is_builtin=bool(getattr(row, "is_builtin", False)),
        created_at=row.created_at or _now(),
        updated_at=row.updated_at or _now(),
    )


class PersonaStore:
    """Same five-method surface as the retired file store; rows live in
    the `personas` table. `session_factory` is injectable for tests; the
    default resolves the module-global SessionLocal lazily at call time
    so factory reset's re-init and test monkeypatching both work."""

    def __init__(self, data_dir: Path, session_factory=None):
        self._dir = personas_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._session_factory = session_factory
        self._import_legacy_files()

    # ── session plumbing ──────────────────────────────────────────────

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
            # DB not initialized yet (CLI tools) — leave the files for the
            # next construction; nothing is lost.
            log.warning("persona store: DB not ready — legacy file import deferred")
            return
        from ..database.models import Persona as DBPersona

        try:
            for f in files:
                try:
                    p = Persona.model_validate(json.loads(f.read_text(encoding="utf-8")))
                except Exception as e:  # noqa: BLE001 — skip unreadable, keep file
                    log.warning("persona file %s unreadable, left in place: %s", f, e)
                    continue
                if db.query(DBPersona).filter(DBPersona.id == p.id).first() is None:
                    db.add(self._to_row(p))
                    log.info("persona %s imported from legacy file store", p.id)
                db.commit()
                f.rename(f.parent / (f.name + ".migrated"))
        except Exception as e:  # noqa: BLE001 — boot must not die on this
            log.warning("persona legacy-file import failed: %s", e)
            db.rollback()
        finally:
            db.close()

    @staticmethod
    def _to_row(p: Persona):
        from ..database.models import Persona as DBPersona

        return DBPersona(
            id=p.id,
            name=p.name,
            voice_id=p.voice_id or None,
            language=p.language,
            avatar_path=p.avatar_path,
            voice_instruct=p.voice_instruct,
            personality=p.personality,
            default_delivery=json.dumps(p.default_delivery) if p.default_delivery else None,
            effects_chain=json.dumps(p.effects_chain) if p.effects_chain else None,
            lexicon_id=p.lexicon_id,
            engine_override=p.engine_override,
            imported_from=p.imported_from,
            imported_id=p.imported_id,
            is_builtin=p.is_builtin,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )

    # ── public surface ────────────────────────────────────────────────

    def list(self) -> list[Persona]:
        from ..database.models import Persona as DBPersona

        db = self._open()
        if db is None:
            return []
        try:
            rows = db.query(DBPersona).order_by(DBPersona.created_at).all()
            return [_row_to_persona(r) for r in rows]
        finally:
            db.close()

    def get(self, id: str) -> Persona | None:
        from ..database.models import Persona as DBPersona

        db = self._open()
        if db is None:
            return None
        try:
            row = db.query(DBPersona).filter(DBPersona.id == id).first()
            return _row_to_persona(row) if row else None
        finally:
            db.close()

    def create(
        self,
        name: str,
        voice_id: str | None = None,
        default_delivery: dict | None = None,
        voice_instruct: str | None = None,
        engine_override: str | None = None,
        lexicon_id: str | None = None,
        llm_rewrite_enabled: bool = False,  # accepted, not persisted (legacy)
        llm_model: str | None = None,  # accepted, not persisted (legacy)
        language: str = "en",
        avatar_path: str | None = None,
        personality: str | None = None,
        effects_chain: list[dict] | None = None,
        imported_from: str | None = None,
        imported_id: str | None = None,
        is_builtin: bool = False,
        id: str | None = None,
    ) -> Persona:
        """Create a persona. `id` may be supplied for migrations that need
        to preserve the source record's id."""
        with self._lock:
            persona = Persona(
                id=id or f"persona_{uuid.uuid4().hex}",
                name=name,
                voice_id=voice_id,
                language=language,
                avatar_path=avatar_path,
                voice_instruct=voice_instruct,
                personality=personality,
                default_delivery=default_delivery or {},
                effects_chain=effects_chain or [],
                lexicon_id=lexicon_id,
                engine_override=engine_override,
                llm_rewrite_enabled=llm_rewrite_enabled,
                llm_model=llm_model,
                imported_from=imported_from,
                imported_id=imported_id,
                is_builtin=is_builtin,
                created_at=_now(),
                updated_at=_now(),
            )
            db = self._open()
            if db is None:
                raise RuntimeError("persona store: database not initialized")
            try:
                db.add(self._to_row(persona))
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            return persona

    def update(self, id: str, **fields) -> Persona | None:
        """Patch semantics preserved from the file store: None values are
        ignored (clear a string field by sending '')."""
        with self._lock:
            current = self.get(id)
            if current is None:
                return None
            data = current.model_dump()
            data.update({k: v for k, v in fields.items() if v is not None})
            data["updated_at"] = _now().isoformat()
            new = Persona.model_validate(data)

            from ..database.models import Persona as DBPersona

            db = self._open()
            if db is None:
                raise RuntimeError("persona store: database not initialized")
            try:
                row = db.query(DBPersona).filter(DBPersona.id == id).first()
                if row is None:
                    return None
                row.name = new.name
                row.voice_id = new.voice_id or None
                row.language = new.language
                row.avatar_path = new.avatar_path
                row.voice_instruct = new.voice_instruct
                row.personality = new.personality
                row.default_delivery = (
                    json.dumps(new.default_delivery) if new.default_delivery else None
                )
                row.effects_chain = (
                    json.dumps(new.effects_chain) if new.effects_chain else None
                )
                row.lexicon_id = new.lexicon_id
                row.engine_override = new.engine_override
                row.imported_from = new.imported_from
                row.imported_id = new.imported_id
                row.updated_at = new.updated_at
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            return new

    def delete(self, id: str) -> bool:
        from ..database.models import Persona as DBPersona

        with self._lock:
            db = self._open()
            if db is None:
                return False
            try:
                deleted = db.query(DBPersona).filter(DBPersona.id == id).delete()
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()
            # Tidy any legacy artifacts so nothing can resurrect it.
            for suffix in (".json", ".json.migrated"):
                p = self._dir / f"{id}{suffix}"
                if p.exists():
                    p.unlink()
            return bool(deleted)
