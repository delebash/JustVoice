"""Qwen3-TTS engine adapter.

Alibaba's open-weight TTS family. Two variants:
  - qwen3-tts-1_7b (full feature set, best published English WER)
  - qwen3-tts-0_6b (faster, half the VRAM)

Voice cloning + voice design (from prose) + instruct field + native
paralinguistic tags. Variant selected via `model_variant`.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


_VARIANTS = {
    "qwen3-tts-1_7b": "Qwen/Qwen3-TTS-1.7B",
    "qwen3-tts-0_6b": "Qwen/Qwen3-TTS-0.6B",
}
DEFAULT_VARIANT = "qwen3-tts-1_7b"


class Qwen3Backend:
    meta = EngineMeta(
        engine_id="qwen3",
        display_name="Qwen3-TTS",
        backend="python",
        supported_runtimes=["cuda", "metal", "cpu"],
        supports_cloning=True,
        supports_voice_design=True,
        supports_instruct_field=True,
        supports_paralinguistic_tags=True,
    )

    SAMPLE_RATE = 24_000

    def __init__(self):
        self._model = None
        self._device = "cpu"
        self._loaded_variant: str | None = None

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        variant = model_variant or DEFAULT_VARIANT
        if variant not in _VARIANTS:
            raise ValueError(
                f"unknown qwen3 variant {variant!r}; known: {sorted(_VARIANTS)}"
            )
        if self._model is not None and self._loaded_variant == variant:
            return
        if self._model is not None:
            self.unload()
        try:
            from qwen3_tts import Qwen3TTS  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "qwen3-tts package not installed. Install via `pip install justtts[qwen3]`."
            ) from e
        self._device = auto_device(device)
        self._model = Qwen3TTS.from_pretrained(_VARIANTS[variant], device=self._device)
        self._loaded_variant = variant

    def unload(self) -> None:
        self._model = None
        self._loaded_variant = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id="default-en-female", name="Qwen3 EN Female", language="en", gender="female"),
            PresetVoice(id="default-en-male", name="Qwen3 EN Male", language="en", gender="male"),
            PresetVoice(id="default-zh-female", name="Qwen3 ZH Female", language="zh", gender="female"),
            PresetVoice(id="default-zh-male", name="Qwen3 ZH Male", language="zh", gender="male"),
        ]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("qwen3: not loaded")
        d = req.delivery or {}
        kwargs = dict(
            text=req.text,
            voice=req.voice_id,
            language=req.language or "en",
            temperature=float(d.get("temperature", 0.7)),
            top_p=float(d.get("top_p", 0.95)),
        )
        if d.get("instruct"):
            kwargs["instruct"] = d["instruct"]
        if req.audio_prompt_path:
            kwargs["audio_prompt_path"] = req.audio_prompt_path
        if req.seed is not None:
            kwargs["seed"] = req.seed
        tensor = self._model.generate(**kwargs)
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
