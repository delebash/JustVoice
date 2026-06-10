"""LuxTTS engine subprocess — ZipVoice voice cloning.

Adapter for ZipVoice / LuxTTS. NOT YET RUN-TESTED.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging
import os

from justtts_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

log = logging.getLogger("justtts.engines.luxtts")

LUXTTS_HF_REPO = "YatharthS/LuxTTS"


class LuxTTS(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="luxtts",
        display_name="LuxTTS",
        backend="pytorch",
        supports_cloning=True,
    )

    SAMPLE_RATE = 48000

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        if self.model is not None:
            return
        device = self.pick_device(device)
        self._device = device
        log.info("loading LuxTTS on %s …", device)

        # Actual zipvoice API (inspected from installed package):
        #   LuxTTS(model_path='YatharthS/LuxTTS', device='cuda', threads=4)
        # No from_pretrained classmethod. Init takes the HF repo id as
        # model_path and the device string directly.
        from zipvoice.luxvoice import LuxTTS as _LuxTTSModel  # type: ignore

        threads = min(os.cpu_count() or 4, 8) if device == "cpu" else 4
        self.model = _LuxTTSModel(model_path=LUXTTS_HF_REPO, device=device, threads=threads)
        log.info("LuxTTS loaded on %s (threads=%d)", device, threads)

    def unload(self) -> None:
        if self.model is None:
            return
        import torch

        del self.model
        self.model = None
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("luxtts: engine not loaded — call /load first")

        ref_audio = req.audio_prompt_path
        if not ref_audio:
            raise ValueError("luxtts: voice cloning required — pass audio_prompt_path")

        import numpy as np
        import torch

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        # zipvoice API: encode_prompt -> dict; then generate_speech(text, encode_dict).
        encode_dict = self.model.encode_prompt(ref_audio)
        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}
        wav = self.model.generate_speech(
            req.text,
            encode_dict,
            num_steps=int(engine_overrides.get("num_steps", 4)),
            guidance_scale=float(engine_overrides.get("guidance_scale", 3.0)),
            t_shift=float(engine_overrides.get("t_shift", 0.5)),
            speed=float(delivery.get("speed", 1.0)),
        )
        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32).squeeze()
        return SynthOutput.from_numpy(audio, sample_rate=self.SAMPLE_RATE, channels=1)


if __name__ == "__main__":
    serve(LuxTTS())
