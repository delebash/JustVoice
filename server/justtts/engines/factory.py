"""Engine-id → backend constructor lookup.

Used by ``installer._register_engine_after_install`` and
``app._register_existing_engines`` so both paths share one source of
truth for "which adapter handles which engine."
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .chatterbox import ChatterboxBackend
from .dia import DiaBackend
from .higgs_audio import HiggsAudioBackend
from .kokoro import KokoroBackend
from .luxtts import LuxttsBackend
from .moss_tts import MossTtsBackend
from .qwen3 import Qwen3Backend
from .tada import TadaBackend


# (model_dir) -> backend instance. Kokoro receives the resolved model
# directory; all sidecar engines build their own backend without a
# directory (HF cache via from_pretrained on first load).
_FACTORIES: dict[str, Callable[[Path], Any]] = {
    "kokoro": lambda model_dir: KokoroBackend(model_dir),
    "luxtts": lambda model_dir: LuxttsBackend(),
    "qwen3": lambda model_dir: Qwen3Backend(),
    "chatterbox": lambda model_dir: ChatterboxBackend(),
    "tada": lambda model_dir: TadaBackend(),
    "dia": lambda model_dir: DiaBackend(),
    "moss-tts": lambda model_dir: MossTtsBackend(),
    "higgs-audio": lambda model_dir: HiggsAudioBackend(),
}


def construct(engine_id: str, model_dir: Path):
    """Build a backend for the named engine. Returns None for unknown ids."""
    f = _FACTORIES.get(engine_id)
    if f is None:
        return None
    return f(model_dir)


def known_ids() -> list[str]:
    return sorted(_FACTORIES.keys())
