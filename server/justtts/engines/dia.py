"""Dia engine adapter.

Single-pass multi-speaker dialogue model. 1.6B + 2-2B variants.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


_VARIANTS = {
    "dia-1_6b": "nari-labs/Dia-1.6B",
    "dia-2-2b": "nari-labs/Dia-2-2B",
}
DEFAULT_VARIANT = "dia-1_6b"


class DiaBackend:
    meta = EngineMeta(
        engine_id="dia",
        display_name="Dia",
        backend="python",
        supported_runtimes=["cuda", "metal", "cpu"],
    )

    SAMPLE_RATE = 44_100

    def __init__(self):
        self._model = None
        self._device = "cpu"
        self._loaded_variant: str | None = None

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        variant = model_variant or DEFAULT_VARIANT
        if variant not in _VARIANTS:
            raise ValueError(f"unknown dia variant {variant!r}; known: {sorted(_VARIANTS)}")
        if self._model is not None and self._loaded_variant == variant:
            return
        if self._model is not None:
            self.unload()
        try:
            from dia.model import Dia  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "dia package not installed. Install via `pip install justtts[dia]`."
            ) from e
        self._device = auto_device(device)
        self._model = Dia.from_pretrained(_VARIANTS[variant], device=self._device)
        self._loaded_variant = variant

    def unload(self) -> None:
        self._model = None
        self._loaded_variant = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        # Dia is dialogue-tagged ([S1]/[S2]) — one logical "voice" per session.
        return [PresetVoice(id="default", name="Dia Dialogue", language="en")]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("dia: not loaded")
        d = req.delivery or {}
        kwargs = dict(
            text=req.text,
            temperature=float(d.get("temperature", 1.2)),
            top_p=float(d.get("top_p", 0.95)),
            cfg_scale=float(d.get("cfg_scale", 3.0)),
        )
        if req.audio_prompt_path:
            kwargs["audio_prompt"] = req.audio_prompt_path
        if req.seed is not None:
            kwargs["seed"] = req.seed
        tensor = self._model.generate(**kwargs)
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
