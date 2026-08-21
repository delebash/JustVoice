"""Wire-level dataclasses shared between the JustVoice host and every engine
subprocess. These mirror the in-process protocol in server/justvoice/engines/
base.py so adapter logic ports cleanly between the two transports.

Each request type carries only the fields an engine plausibly needs; the
host's higher-level types (chapter render, cache scopes, training jobs) stay
on the host side and aren't visible to engine plugins.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PresetVoice:
    """One voice the engine exposes. Returned from `EmbeddedEngine.voices()`."""

    id: str
    name: str
    language: str = "en"
    gender: str | None = None
    sample_url: str | None = None


@dataclass
class EngineMeta:
    """Runtime metadata the host queries via /info after Load.

    Catalog-level metadata (capabilities, requirements, install steps)
    lives in the engine's `manifest.py` and is consumed by the host
    BEFORE the subprocess starts — none of that travels in protocol
    messages.
    """

    engine_id: str
    display_name: str
    backend: str
    supports_cloning: bool = False
    supports_voice_design: bool = False
    supports_streaming: bool = False
    supports_paralinguistic_tags: bool = False
    supports_instruct_field: bool = False
    # (supports_embedding_blending / supports_training dropped 2026-08-19:
    # no adapter ever set them and the host never read them back. Blending
    # is host-side vector math over the engine's voices file, and training
    # is a host-spawned subprocess — neither is a property of a loaded
    # engine process. The capability truth lives in the manifest and in
    # capability_details, per variant.)


@dataclass
class SynthRequest:
    """One synth call. Mirrors the host's `/v1/generate` body for the parts
    an engine plugin cares about; the host translates between this and its
    public API."""

    voice_id: str
    text: str
    language: str | None = None
    delivery: dict[str, Any] = field(default_factory=dict)
    seed: int | None = None
    # Path to a reference WAV on disk — present when the host wants the
    # engine to use a one-shot reference clone for this synth (vs. a
    # pre-registered voice). The host puts the file somewhere both
    # processes can read; the engine reads-only.
    audio_prompt_path: str | None = None
    # The reference clip's exact transcript, for engines whose clone call
    # takes one (Qwen3 Base `ref_text`). None = the engine's
    # no-transcript path.
    ref_text: str | None = None
    # Clone from the speaker vector alone, ignoring the transcript.
    xvector_only: bool = False
    # A blended voice's style vector, flat. Engines whose synth call accepts
    # a raw voice array (kokoro-onnx) render it directly; the host computes
    # the blend from the engine's own voices file.
    voice_vector: list[float] | None = None
    # A trained voice's LoRA adapter directory, readable by the engine
    # process. The adapter also holds its reference sample + training_meta.
    adapter_path: str | None = None


@dataclass
class SynthOutput:
    """Engine's audio response.

    The HTTP layer in `server.py` wraps this into a binary `audio/wav` or
    `audio/raw` response — the wire never sends this dataclass directly.
    `from_numpy` is the common path; `from_wav_bytes` is for engines that
    already produce a complete WAV file.
    """

    audio_bytes: bytes
    sample_rate: int
    channels: int = 1
    # True = `audio_bytes` is a complete WAV file (RIFF header included).
    # False = raw PCM, host must wrap with sample_rate/channels.
    is_wav_container: bool = False

    @classmethod
    def from_numpy(cls, arr, sample_rate: int, channels: int = 1) -> "SynthOutput":
        """Encode a float / int numpy array as a complete WAV file."""
        from .audio import wav_bytes_from_numpy

        return cls(
            audio_bytes=wav_bytes_from_numpy(arr, sample_rate, channels),
            sample_rate=sample_rate,
            channels=channels,
            is_wav_container=True,
        )

    @classmethod
    def from_wav_bytes(cls, wav_bytes: bytes, sample_rate: int, channels: int = 1) -> "SynthOutput":
        return cls(
            audio_bytes=wav_bytes,
            sample_rate=sample_rate,
            channels=channels,
            is_wav_container=True,
        )


@dataclass
class VoiceCloneRequest:
    """Register a new voice from a reference clip. Engine returns a voice_id
    the host can later pass to `synth()`."""

    name: str
    wav_b64: str
    transcript: str | None = None
    language: str | None = None


@dataclass
class VoiceCloneResponse:
    voice_id: str
    name: str
