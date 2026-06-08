"""Filesystem-backed stores — settings, voices, personas, lexicons,
training jobs. Each is a JSON file (or directory of JSON files) under
the configured data dir. Writes go through atomic rename.
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
