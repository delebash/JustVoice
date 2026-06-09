"""Application-wide state container, FastAPI-injected via Depends.

Holds long-lived singletons: the engine registry, the four stores
(settings/voices/personas/lexicons), the training registry, the
render cache, and the data dir.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .cache import RenderCache
from .engines import EngineRegistry
from .paths import cache_root
from .storage import LexiconStore, PersonaStore, SettingsStore, TrainingRegistry, VoiceStore

log = logging.getLogger(__name__)


class AppState:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        self.settings = SettingsStore(data_dir)
        self.voices = VoiceStore(data_dir)
        self.personas = PersonaStore(data_dir)
        self._render_cache = RenderCache(
            cache_root(data_dir),
            max_memory_entries=self.settings.get().cache.max_memory_entries,
        )
        self.lexicons = LexiconStore(data_dir)
        self.training = TrainingRegistry(data_dir)
        self.engines = EngineRegistry()
        self._jobs: dict[str, dict] = {}  # install jobs, in-memory

    def job_get(self, job_id: str) -> dict | None:
        return self._jobs.get(job_id)

    def job_set(self, job_id: str, status: dict) -> None:
        self._jobs[job_id] = status

    def job_update(self, job_id: str, **patch) -> None:
        if job_id in self._jobs:
            self._jobs[job_id].update(patch)

    def job_append_log(self, job_id: str, line: str, max_lines: int = 400) -> None:
        """Append a line to the job's rolling log tail. Caps at `max_lines`
        so a long install doesn't balloon the in-memory job state."""
        job = self._jobs.get(job_id)
        if job is None:
            return
        log = job.setdefault("log_tail", [])
        log.append(line)
        if len(log) > max_lines:
            del log[: len(log) - max_lines]


# Singleton — set in main.py during boot, retrieved via Depends.
_STATE: AppState | None = None


def set_state(state: AppState) -> None:
    global _STATE
    _STATE = state


def get_state() -> AppState:
    if _STATE is None:
        raise RuntimeError("AppState not initialized — call set_state() during boot")
    return _STATE
