"""MOSS-TTS v1.5 engine adapter.

Documented 1-hour stable single-pass generation. 12-16 GB VRAM.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


class MossTtsBackend:
    meta = EngineMeta(
        engine_id="moss-tts",
        display_name="MOSS-TTS v1.5",
        backend="python",
        supported_runtimes=["cuda", "cpu"],
    )

    SAMPLE_RATE = 24_000

    def __init__(self):
        self._model = None
        self._device = "cpu"

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        if self._model is not None:
            return
        try:
            from moss_tts import MOSSTTS  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "moss-tts package not installed. Install via `pip install justtts[moss-tts]`."
            ) from e
        self._device = auto_device(device)
        self._model = MOSSTTS.from_pretrained(device=self._device)

    def unload(self) -> None:
        self._model = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id="moss-en-default", name="MOSS English Default", language="en"),
            PresetVoice(id="moss-zh-default", name="MOSS Chinese Default", language="zh"),
        ]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("moss-tts: not loaded")
        d = req.delivery or {}
        kwargs = dict(
            text=req.text,
            voice=req.voice_id,
            language=req.language,
            temperature=float(d.get("temperature", 0.7)),
        )
        if req.audio_prompt_path:
            kwargs["audio_prompt_path"] = req.audio_prompt_path
        if req.seed is not None:
            kwargs["seed"] = req.seed
        tensor = self._model.generate(**kwargs)
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
