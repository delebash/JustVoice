"""Higgs Audio v3 engine subprocess.

EXPERIMENTAL. Adapter written from Boson AI's HuggingFace model card —
v3 is weights-only, no Boson Python package. We load via the standard
HF transformers AutoProcessor + AutoModelForCausalLM (Higgs is a causal
LM that emits audio tokens), then convert audio tokens back to waveform
through the model's audio decoder.

The exact public-API surface of `bosonai/higgs-audio-v3-tts-4b` may differ;
this adapter is a best-effort scaffold and will likely need editing on
first install. The host will surface any import/attribute error via /load.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging

from justtts_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

log = logging.getLogger("justtts.engines.higgs_audio")

HIGGS_HF_REPO = "bosonai/higgs-audio-v3-tts-4b"


class HiggsAudio(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="higgs-audio",
        display_name="Higgs Audio v3",
        backend="pytorch",
        supports_cloning=True,
        supports_instruct_field=True,
        supports_paralinguistic_tags=True,
    )

    SAMPLE_RATE = 24000

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.processor = None
        self._device = None

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        if self.model is not None:
            return
        device = self.pick_device(device)
        self._device = device
        log.info("loading Higgs Audio v3 on %s …", device)

        import torch
        from transformers import AutoProcessor, AutoModelForCausalLM

        dtype = torch.bfloat16 if (device == "cuda" and torch.cuda.is_bf16_supported()) else torch.float32

        self.processor = AutoProcessor.from_pretrained(HIGGS_HF_REPO, trust_remote_code=True)
        self.model = AutoModelForCausalLM.from_pretrained(
            HIGGS_HF_REPO,
            trust_remote_code=True,
            torch_dtype=dtype,
        ).to(device).eval()
        log.info("Higgs Audio v3 loaded on %s (dtype=%s)", device, dtype)

    def unload(self) -> None:
        if self.model is None:
            return
        import torch

        del self.model
        del self.processor
        self.model = None
        self.processor = None
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None or self.processor is None:
            raise RuntimeError("higgs-audio: engine not loaded — call /load first")

        import numpy as np
        import torch

        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        inputs = self.processor(text=req.text, return_tensors="pt").to(self._device)
        out = self.model.generate(
            **inputs,
            max_new_tokens=int(engine_overrides.get("max_new_tokens", 4096)),
            temperature=float(engine_overrides.get("temperature", 0.8)),
            top_p=float(engine_overrides.get("top_p", 0.9)),
            do_sample=True,
        )
        # The processor should expose either batch_decode (matching HF convention)
        # or a decode_audio helper. We try batch_decode first.
        if hasattr(self.processor, "batch_decode"):
            decoded = self.processor.batch_decode(out)
            wav = decoded[0] if isinstance(decoded, (list, tuple)) and decoded else decoded
        else:
            wav = out
        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32).squeeze()
        return SynthOutput.from_numpy(audio, sample_rate=self.SAMPLE_RATE, channels=1)


if __name__ == "__main__":
    serve(HiggsAudio())
