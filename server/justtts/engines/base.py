"""TTS backend protocol + shared types.

Every engine adapter — Kokoro, Chatterbox, Qwen3, …, plus the
external-OpenAI HTTP wrapper — implements this protocol. The registry
treats them uniformly.

Structurally typed (Protocol) rather than ABC so third-party engines
published as pip packages can satisfy the contract without importing
this module at runtime. Same pattern voicebox and the previous
JustTTS sidecar used.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class PresetVoice:
    id: str
    name: str
    language: str = "en"
    gender: str | None = None
    sample_url: str | None = None


@dataclass
class SynthRequest:
    voice_id: str
    text: str
    language: str | None = None
    delivery: dict[str, Any] = field(default_factory=dict)
    seed: int | None = None
    audio_prompt_path: str | None = None


@dataclass
class SynthOutput:
    """Audio result. `bytes` is either raw 16-bit PCM (then
    `is_wav_container=False` and the caller wraps with sample_rate /
    channels) or a complete WAV file with RIFF header
    (`is_wav_container=True`)."""

    bytes: bytes
    sample_rate: int
    channels: int = 1
    is_wav_container: bool = False


@dataclass
class EngineMeta:
    """Static metadata an adapter exposes for the catalog."""

    engine_id: str
    display_name: str
    backend: str
    supported_runtimes: list[str]
    supports_cloning: bool = False
    supports_streaming: bool = False
    supports_paralinguistic_tags: bool = False
    supports_voice_design: bool = False
    supports_instruct_field: bool = False
    supports_embedding_blending: bool = False
    supports_training: bool = False


@runtime_checkable
class TTSBackend(Protocol):
    """The contract every engine adapter satisfies."""

    meta: EngineMeta

    def load(self, device: str, model_variant: str | None = None) -> None: ...
    def unload(self) -> None: ...
    def ready(self) -> bool: ...
    def voices(self) -> list[PresetVoice]: ...
    def synthesize(self, req: SynthRequest) -> SynthOutput: ...

    # Optional methods — default to raising NotImplementedError; the
    # registry checks `meta.supports_*` flags before calling.
    def clone(self, reference_wav_path: str, name: str) -> str: ...
    def get_embedding(self, voice_id: str) -> list[float]: ...
    def synthesize_with_embedding(
        self,
        text: str,
        embedding: list[float],
        language: str | None = None,
        delivery: dict | None = None,
    ) -> bytes: ...
    def train_start(self, job_id: str, request: dict) -> None: ...
    def train_cancel(self, job_id: str) -> None: ...
