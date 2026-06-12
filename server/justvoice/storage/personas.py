"""Persona storage — JSON file per persona under ``$DATA_DIR/personas/``."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import Persona
from ..paths import personas_root
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _mirror_to_db(persona: Persona) -> None:
    """Upsert the persona into the SQLite personas table.

    FK targets (mcp_bindings.persona_id, lexicons.persona_id, generations,
    project_personas) live in SQLite, so a file-store-only persona breaks
    every binding written against it. Mid-Phase-1.5 the file store is still
    the read path; this mirror keeps the DB row in lock-step until the
    store flips to SQLite-primary. Best-effort: skips silently when the DB
    isn't initialized (CLI tools, early boot)."""
    try:
        from ..database import session as _db_session
        from ..database.models import Persona as DBPersona

        if _db_session.SessionLocal is None:
            return
        db = _db_session.SessionLocal()
    except Exception:
        return
    try:
        row = db.query(DBPersona).filter(DBPersona.id == persona.id).first()
        if row is None:
            row = DBPersona(id=persona.id)
            db.add(row)
        row.name = persona.name
        row.language = persona.language
        row.avatar_path = persona.avatar_path
        row.bio = persona.bio
        row.voice_id = persona.voice_id or None
        row.personality = persona.personality
        row.default_delivery = json.dumps(persona.default_delivery) if persona.default_delivery else None
        row.effects_chain = json.dumps(persona.effects_chain) if persona.effects_chain else None
        row.engine_override = persona.engine_override
        row.lexicon_id = persona.lexicon_id
        row.imported_from = persona.imported_from
        row.imported_id = persona.imported_id
        db.commit()
    except Exception as e:
        log.warning("persona %s: SQLite mirror failed: %s", persona.id, e)
        db.rollback()
    finally:
        db.close()


def _delete_from_db(persona_id: str) -> None:
    """Remove the SQLite twin on file-store delete (FKs are SET NULL/CASCADE)."""
    try:
        from ..database import session as _db_session
        from ..database.models import Persona as DBPersona

        if _db_session.SessionLocal is None:
            return
        db = _db_session.SessionLocal()
    except Exception:
        return
    try:
        db.query(DBPersona).filter(DBPersona.id == persona_id).delete()
        db.commit()
    except Exception as e:
        log.warning("persona %s: SQLite delete-mirror failed: %s", persona_id, e)
        db.rollback()
    finally:
        db.close()


class PersonaStore:
    def __init__(self, data_dir: Path):
        self._dir = personas_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._cache: dict[str, Persona] = {}
        self._load_all()

    def _load_all(self) -> None:
        for f in self._dir.glob("*.json"):
            try:
                p = Persona.model_validate(json.loads(f.read_text(encoding="utf-8")))
                self._cache[p.id] = p
            except Exception as e:
                log.warning("persona %s unreadable: %s", f, e)

    def _path(self, id: str) -> Path:
        return self._dir / f"{id}.json"

    def list(self) -> list[Persona]:
        with self._lock:
            return sorted(self._cache.values(), key=lambda p: p.created_at)

    def get(self, id: str) -> Persona | None:
        with self._lock:
            return self._cache.get(id)

    def create(
        self,
        name: str,
        voice_id: str | None = None,
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
        """Create a persona.

        `id` may be supplied for migrations that need to preserve the source
        record's id; otherwise a fresh `persona_<uuid>` is allocated.
        """
        with self._lock:
            new_id = id or f"persona_{uuid.uuid4().hex}"
            persona = Persona(
                id=new_id,
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
            self._cache[new_id] = persona
            atomic_write_json(self._path(new_id), persona.model_dump())
            _mirror_to_db(persona)
            return persona.model_copy(deep=True)

    def update(self, id: str, **fields) -> Persona | None:
        with self._lock:
            persona = self._cache.get(id)
            if not persona:
                return None
            data = persona.model_dump()
            data.update({k: v for k, v in fields.items() if v is not None})
            data["updated_at"] = _now().isoformat()
            new = Persona.model_validate(data)
            self._cache[id] = new
            atomic_write_json(self._path(id), new.model_dump())
            _mirror_to_db(new)
            return new.model_copy(deep=True)

    def delete(self, id: str) -> bool:
        with self._lock:
            if id not in self._cache:
                return False
            self._cache.pop(id, None)
            p = self._path(id)
            if p.exists():
                p.unlink()
            _delete_from_db(id)
            return True
