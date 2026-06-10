"""EmbeddedEngine base class — what every engine adapter inherits from.

The subclass overrides `load() / unload() / voices() / synth()`, optionally
`clone()`. Everything else (device detection, model-dir paths, error
envelopes, the FastAPI server in `server.py`) is provided.
"""

from __future__ import annotations

import logging
import os
import platform
from pathlib import Path

from .protocol import EngineMeta, PresetVoice, SynthOutput, SynthRequest, VoiceCloneResponse

logger = logging.getLogger("justvoice_plugin.embedded")


class EmbeddedEngine:
    """Subclass and override.

    `meta` is set by the subclass as a class attribute or filled in `__init__`.
    """

    meta: EngineMeta = EngineMeta(engine_id="", display_name="", backend="")

    def __init__(self, model_dir: Path | None = None):
        # model_dir is where the host has placed (or expects) this engine's
        # downloaded model files. The host passes this in via env var
        # JUSTVOICE_MODEL_DIR when it spawns the subprocess; the subclass can
        # use it as-is or ignore it (e.g. if it wants HF cache instead).
        self.model_dir = model_dir or self._default_model_dir()
        self._loaded = False

    # ─── Lifecycle (subclass implements) ────────────────────────────────

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        """Bring the model into memory. Called once after subprocess spawn."""
        raise NotImplementedError

    def unload(self) -> None:
        """Release the model + GPU memory. Subclass should null out the model."""
        raise NotImplementedError

    def voices(self) -> list[PresetVoice]:
        """Return preset voices this engine ships. Empty list = clone-only engine."""
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        """The actual TTS call."""
        raise NotImplementedError

    def clone(self, name: str, wav_b64: str, transcript: str | None) -> VoiceCloneResponse:
        """Register a new voice from a reference clip. Override if
        meta.supports_cloning. Default raises."""
        raise NotImplementedError("This engine does not support voice cloning.")

    def transcribe(self, audio_path: str, language: str | None = None) -> str:
        """Speech-to-text. Override in KIND="stt" engines (whisper).
        `audio_path` is a host-local file the subprocess can read.
        Default raises — TTS engines don't transcribe."""
        raise NotImplementedError("This engine does not support transcription.")

    # ─── Shared helpers (subclasses just call these) ────────────────────

    def is_loaded(self) -> bool:
        return self._loaded

    def _default_model_dir(self) -> Path:
        """Where the host puts model files when JUSTVOICE_MODEL_DIR isn't set
        (mostly during local development of an engine)."""
        env = os.environ.get("JUSTVOICE_MODEL_DIR")
        if env:
            return Path(env)
        return Path.cwd() / ".models"

    def pick_device(
        self,
        requested: str = "auto",
        *,
        allow_xpu: bool = False,
        allow_directml: bool = False,
        allow_mps: bool = True,
        force_cpu_on_mac: bool = False,
    ) -> str:
        """Cross-platform device detection. Returns the device string the
        engine should `.to()`.

        Cross-platform device detection (ported from upstream MIT
        torch helpers; per-file attribution in engines/_torch_helpers.py).
        Priority order:

        1. If `requested` is anything other than "auto", honor it (caller
           explicitly chose a device).
        2. `force_cpu_on_mac` (Chatterbox, TADA — MPS has tensor issues
           with their models) → "cpu" on Darwin.
        3. CUDA (Linux + Windows + NVIDIA).
        4. Intel XPU via intel_extension_for_pytorch (Windows + Intel Arc).
        5. Windows DirectML (last-ditch GPU fallback).
        6. Apple Silicon MPS.
        7. CPU.
        """
        if requested != "auto":
            return requested

        if force_cpu_on_mac and platform.system() == "Darwin":
            return "cpu"

        try:
            import torch
        except ImportError:
            return "cpu"

        if torch.cuda.is_available():
            return "cuda"

        if allow_xpu:
            try:
                import intel_extension_for_pytorch  # noqa: F401

                if hasattr(torch, "xpu") and torch.xpu.is_available():
                    return "xpu"
            except ImportError:
                pass

        if allow_directml:
            try:
                import torch_directml

                if torch_directml.device_count() > 0:
                    return torch_directml.device(0)
            except ImportError:
                pass

        if (
            allow_mps
            and platform.system() == "Darwin"
            and hasattr(torch.backends, "mps")
            and torch.backends.mps.is_available()
        ):
            return "mps"

        return "cpu"
