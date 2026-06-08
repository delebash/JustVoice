"""TADA engine adapter (Hume AI).

Multilingual TTS with voice cloning. 1B + 3B variants.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


_VARIANTS = {
    "tada-1b": "HumeAI/TADA-1B",
    "tada-3b": "HumeAI/TADA-3B",
}
DEFAULT_VARIANT = "tada-1b"


class TadaBackend:
    meta = EngineMeta(
        engine_id="tada",
        display_name="TADA",
        backend="python",
        supported_runtimes=["cuda", "metal", "cpu"],
        supports_cloning=True,
    )

    SAMPLE_RATE = 24_000

    def __init__(self):
        self._model = None
        self._device = "cpu"
        self._loaded_variant: str | None = None

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        variant = model_variant or DEFAULT_VARIANT
        if variant not in _VARIANTS:
            raise ValueError(f"unknown tada variant {variant!r}; known: {sorted(_VARIANTS)}")
        if self._model is not None and self._loaded_variant == variant:
            return
        if self._model is not None:
            self.unload()
        try:
            from tada import TADA  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "tada package not installed. Install via `pip install justtts[tada]`."
            ) from e
        self._device = auto_device(device)
        self._model = TADA.from_pretrained(_VARIANTS[variant], device=self._device)
        self._loaded_variant = variant

    def unload(self) -> None:
        self._model = None
        self._loaded_variant = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id="tada-en-default", name="TADA English Default", language="en"),
            PresetVoice(id="tada-multilingual", name="TADA Multilingual", language="multi"),
        ]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("tada: not loaded")
        kwargs = dict(text=req.text, voice=req.voice_id, language=req.language)
        if req.audio_prompt_path:
            kwargs["audio_prompt_path"] = req.audio_prompt_path
        if req.seed is not None:
            kwargs["seed"] = req.seed
        tensor = self._model.generate(**kwargs)
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
