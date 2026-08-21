"""TTS backend protocol + shared types.

Every engine adapter — Kokoro, Chatterbox, Qwen3, …, plus the
external-OpenAI HTTP wrapper — implements this protocol. The registry
treats them uniformly.

Structurally typed (Protocol) rather than ABC so third-party engines
published as pip packages can satisfy the contract without importing
this module at runtime. Same Protocol-typing pattern the previous
JustVoice sidecar used.
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
    # Reference-clip transcript, for engines whose clone call takes one
    # (Qwen3 Base `ref_text`). None = the engine's no-transcript path.
    ref_text: str | None = None
    # Clone from the speaker vector alone, ignoring the transcript
    # (Qwen3 Base `x_vector_only_mode`).
    xvector_only: bool = False
    # A blended voice's style vector — kokoro-onnx takes it per call.
    voice_vector: list[float] | None = None
    # A trained voice's LoRA adapter directory.
    adapter_path: str | None = None


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
    # Phase 2 / Slice 1 of the Profile-kill plan: engines split into
    # disjoint kinds so EngineManager can keep one slot per kind loaded
    # simultaneously. The default "tts" keeps existing manifests + the
    # external-OpenAI adapter compatible without code change.
    kind: str = "tts"  # "tts" | "llm" | "embedding"
    supports_cloning: bool = False
    supports_streaming: bool = False
    supports_paralinguistic_tags: bool = False
    supports_voice_design: bool = False
    supports_instruct_field: bool = False


@runtime_checkable
class TTSBackend(Protocol):
    """The contract every engine adapter satisfies."""

    meta: EngineMeta

    def load(self, device: str, model_variant: str | None = None) -> None: ...
    def unload(self) -> None: ...
    def ready(self) -> bool: ...
    def voices(self) -> list[PresetVoice]: ...
    def synthesize(self, req: SynthRequest) -> SynthOutput: ...

    # Optional methods — default to raising NotImplementedError; callers
    # check the capability surface before calling.
    #
    # Retired 2026-08-19, all with zero implementations: get_embedding /
    # synthesize_with_embedding (blending is HOST-side file math — see
    # engines/blending.py — because managed engines run as subprocess
    # procs the registry never holds; a blended voice reaches synth as
    # SynthRequest.voice_vector) and train_start / train_cancel (training
    # is a host-owned subprocess per engine — see training_runner.py — for
    # the same registry reason, and because VRAM eviction before a run is
    # the manager's job, not an adapter's). The supports_voice_blending /
    # supports_training booleans live on EngineCapabilityDetail, per
    # variant, not here.
    def clone(self, reference_wav_path: str, name: str) -> str: ...
