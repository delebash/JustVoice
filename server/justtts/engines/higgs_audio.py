"""Higgs Audio v3 engine adapter.

Rich expression control + wide emotional range. NON-COMMERCIAL LICENSE
— surfaced via the catalog description; not enforced at runtime.
"""

from __future__ import annotations

from ._torch_helpers import auto_device, cuda_empty_cache, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


class HiggsAudioBackend:
    meta = EngineMeta(
        engine_id="higgs-audio",
        display_name="Higgs Audio v3",
        backend="python",
        supported_runtimes=["cuda", "cpu"],
        supports_cloning=True,
        supports_paralinguistic_tags=True,
        supports_instruct_field=True,
    )

    SAMPLE_RATE = 24_000

    def __init__(self):
        self._model = None
        self._device = "cpu"

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        if self._model is not None:
            return
        try:
            from higgs_audio import HiggsAudio  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "higgs-audio package not installed. Install via `pip install justtts[higgs-audio]`."
            ) from e
        self._device = auto_device(device)
        self._model = HiggsAudio.from_pretrained(device=self._device)

    def unload(self) -> None:
        self._model = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id="higgs-en-female", name="Higgs EN Female", language="en", gender="female"),
            PresetVoice(id="higgs-en-male", name="Higgs EN Male", language="en", gender="male"),
        ]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("higgs-audio: not loaded")
        d = req.delivery or {}
        kwargs = dict(
            text=req.text,
            voice=req.voice_id,
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
