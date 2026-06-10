"""Stores for settings, voices, personas, lexicons, training jobs.

Phase 2 storage unification: voices/personas/lexicons are SQLite-backed
(legacy JSON files auto-import on first boot). ``settings.json`` is the
ONLY remaining atomic-JSON store; training jobs keep their JSON registry
until the training feature lands (no engine sets supports_training yet).
"""

from .atomic import atomic_write_json
from .lexicons import LexiconStore
from .personas import PersonaStore
from .settings_store import SettingsStore
from .training_jobs import TrainingRegistry
from .voices import VoiceStore

__all__ = [
    "atomic_write_json",
    "SettingsStore",
    "VoiceStore",
    "PersonaStore",
    "LexiconStore",
    "TrainingRegistry",
]
