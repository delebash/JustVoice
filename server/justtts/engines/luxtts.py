"""LuxTTS engine adapter.

Multilingual TTS with preset voices, broad language coverage, lighter
footprint than Qwen3/Chatterbox. Exact package shape verified at first
load — adapter writes against the documented `LuxTTS.from_pretrained` +
`generate(text, voice, language)` shape.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


class LuxttsBackend:
    meta = EngineMeta(
        engine_id="luxtts",
        display_name="LuxTTS",
        backend="python",
        supported_runtimes=["cuda", "metal", "cpu"],
    )

    SAMPLE_RATE = 24_000

    def __init__(self):
        self._model = None
        self._device = "cpu"

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        if self._model is not None:
            return
        try:
            from luxtts import LuxTTS  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "luxtts package not installed. Install via `pip install justtts[luxtts]`."
            ) from e
        self._device = auto_device(device)
        self._model = LuxTTS.from_pretrained(device=self._device)

    def unload(self) -> None:
        self._model = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id="en_default", name="LuxTTS English", language="en"),
            PresetVoice(id="fr_default", name="LuxTTS French", language="fr"),
            PresetVoice(id="de_default", name="LuxTTS German", language="de"),
            PresetVoice(id="es_default", name="LuxTTS Spanish", language="es"),
            PresetVoice(id="it_default", name="LuxTTS Italian", language="it"),
        ]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("luxtts: not loaded")
        tensor = self._model.generate(
            text=req.text, voice=req.voice_id, language=req.language
        )
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
