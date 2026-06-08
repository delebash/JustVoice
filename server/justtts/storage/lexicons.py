"""Lexicon storage — JSON file per lexicon under ``$DATA_DIR/lexicons/``."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from ..models import Lexicon, LexiconEntry
from ..paths import lexicons_root
from .atomic import atomic_write_json

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class LexiconStore:
    def __init__(self, data_dir: Path):
        self._dir = lexicons_root(data_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._cache: dict[str, Lexicon] = {}
        self._load_all()

    def _load_all(self) -> None:
        for f in self._dir.glob("*.json"):
            try:
                lex = Lexicon.model_validate(json.loads(f.read_text(encoding="utf-8")))
                self._cache[lex.id] = lex
            except Exception as e:
                log.warning("lexicon %s unreadable: %s", f, e)

    def _path(self, id: str) -> Path:
        return self._dir / f"{id}.json"

    def list(self) -> list[Lexicon]:
        with self._lock:
            return sorted(self._cache.values(), key=lambda l: l.created_at)

    def get(self, id: str) -> Lexicon | None:
        with self._lock:
            return self._cache.get(id)

    def create(self, name: str, entries: list[LexiconEntry] | None = None) -> Lexicon:
        with self._lock:
            id = f"lex_{uuid.uuid4().hex}"
            lex = Lexicon(
                id=id,
                name=name,
                entries=entries or [],
                created_at=_now(),
                updated_at=_now(),
            )
            self._cache[id] = lex
            atomic_write_json(self._path(id), lex.model_dump())
            return lex.model_copy(deep=True)

    def update(self, id: str, entries: list[LexiconEntry]) -> Lexicon | None:
        with self._lock:
            lex = self._cache.get(id)
            if not lex:
                return None
            lex.entries = entries
            lex.updated_at = _now()
            atomic_write_json(self._path(id), lex.model_dump())
            return lex.model_copy(deep=True)

    def append_entry(self, id: str, entry: LexiconEntry) -> Lexicon | None:
        with self._lock:
            lex = self._cache.get(id)
            if not lex:
                return None
            lex.entries.append(entry)
            lex.updated_at = _now()
            atomic_write_json(self._path(id), lex.model_dump())
            return lex.model_copy(deep=True)

    def delete(self, id: str) -> bool:
        with self._lock:
            if id not in self._cache:
                return False
            self._cache.pop(id, None)
            p = self._path(id)
            if p.exists():
                p.unlink()
            return True
