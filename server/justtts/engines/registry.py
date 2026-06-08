"""Engine registry — thread-safe, one engine active at a time.

Owns the set of registered backends + which is current. Handlers call
`registry.synthesize(...)` which routes to the right backend.
"""

from __future__ import annotations

import logging
from threading import RLock

from .base import SynthOutput, SynthRequest, TTSBackend

log = logging.getLogger(__name__)


class EngineRegistry:
    def __init__(self) -> None:
        self._engines: dict[str, TTSBackend] = {}
        self._current: str | None = None
        self._lock = RLock()

    def register(self, engine: TTSBackend) -> None:
        with self._lock:
            id = engine.meta.engine_id
            self._engines[id] = engine
            if self._current is None and engine.ready():
                self._current = id

    def unregister(self, id: str) -> bool:
        with self._lock:
            if id not in self._engines:
                return False
            self._engines.pop(id, None)
            if self._current == id:
                self._current = None
            return True

    def has(self, id: str) -> bool:
        with self._lock:
            return id in self._engines

    def get(self, id: str) -> TTSBackend | None:
        with self._lock:
            return self._engines.get(id)

    def current(self) -> str | None:
        with self._lock:
            return self._current

    def set_current(self, id: str) -> None:
        with self._lock:
            self._current = id

    def clear_current(self) -> str | None:
        with self._lock:
            was = self._current
            self._current = None
            return was

    def registered_ids(self) -> list[str]:
        with self._lock:
            return sorted(self._engines.keys())

    def all(self) -> list[TTSBackend]:
        with self._lock:
            return list(self._engines.values())

    def synthesize(self, engine_id: str, req: SynthRequest) -> SynthOutput:
        engine = self.get(engine_id)
        if engine is None:
            raise KeyError(f"engine not registered: {engine_id}")
        return engine.synthesize(req)
