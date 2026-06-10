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
            return new.model_copy(deep=True)

    def delete(self, id: str) -> bool:
        with self._lock:
            if id not in self._cache:
                return False
            self._cache.pop(id, None)
            p = self._path(id)
            if p.exists():
                p.unlink()
            return True
