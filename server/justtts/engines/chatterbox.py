"""Chatterbox engine adapter — handles all three variants.

Resemble AI's Chatterbox is a family of three model architectures
sharing the `chatterbox-tts` package:

  - original (500M)      English-only, emotion exaggeration + CFG
  - turbo (350M)         English-only, native paralinguistic tags, low-latency
  - multilingual (500M)  23 languages via language_id

The adapter dispatches on `model_variant` to the right Python class.
Mac caveat: forced to CPU. Chatterbox's MPS support is broken upstream.
"""

from __future__ import annotations

from ._torch_helpers import cuda_empty_cache, force_cpu_on_mac, tensor_to_wav_bytes
from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest


_VARIANTS = {
    "chatterbox-original-v1": {
        "module": "chatterbox.tts",
        "class": "ChatterboxTTS",
        "multilingual": False,
    },
    "chatterbox-turbo-v1": {
        "module": "chatterbox.tts_turbo",
        "class": "ChatterboxTurboTTS",
        "multilingual": False,
    },
    "chatterbox-multilingual-v2": {
        "module": "chatterbox.mtl_tts",
        "class": "ChatterboxMultilingualTTS",
        "multilingual": True,
    },
}
DEFAULT_VARIANT = "chatterbox-original-v1"


class ChatterboxBackend:
    meta = EngineMeta(
        engine_id="chatterbox",
        display_name="Chatterbox",
        backend="python",
        supported_runtimes=["cuda", "cpu"],
        supports_cloning=True,
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
                f"unknown chatterbox variant {variant!r}; known: {sorted(_VARIANTS)}"
            )
        if self._model is not None and self._loaded_variant == variant:
            return
        if self._model is not None:
            self.unload()

        spec = _VARIANTS[variant]
        try:
            module = __import__(spec["module"], fromlist=[spec["class"]])
        except ImportError as e:
            raise RuntimeError(
                "chatterbox-tts package not installed. Install via `pip install justtts[chatterbox]`."
            ) from e
        klass = getattr(module, spec["class"])
        self._device = force_cpu_on_mac(device)
        self._model = klass.from_pretrained(device=self._device)
        self._loaded_variant = variant

    def unload(self) -> None:
        self._model = None
        self._loaded_variant = None
        cuda_empty_cache()

    def ready(self) -> bool:
        return self._model is not None

    def voices(self) -> list[PresetVoice]:
        if self._loaded_variant and _VARIANTS[self._loaded_variant]["multilingual"]:
            return [PresetVoice(id="default", name="Chatterbox Multilingual Default", language="multi")]
        return [PresetVoice(id="default", name="Chatterbox Default", language="en")]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._model is None:
            raise RuntimeError("chatterbox: not loaded — call load() first")

        d = req.delivery or {}
        gen_kwargs = dict(
            text=req.text,
            audio_prompt_path=req.audio_prompt_path,
            exaggeration=float(d.get("exaggeration", 0.5)),
            cfg_weight=float(d.get("cfg_weight", 0.5)),
            temperature=float(d.get("temperature", 0.8)),
        )
        if self._loaded_variant and _VARIANTS[self._loaded_variant]["multilingual"]:
            gen_kwargs["language_id"] = req.language or "en"

        tensor = self._model.generate(**gen_kwargs)
        wav = tensor_to_wav_bytes(tensor, self.SAMPLE_RATE)
        return SynthOutput(bytes=wav, sample_rate=self.SAMPLE_RATE, channels=1, is_wav_container=True)
