"""MOSS-TTS engine subprocess — OpenMOSS MOSS-TTSD.

EXPERIMENTAL. Not yet validated end-to-end. Adapter shape written from
OpenMOSS's upstream README — the canonical inference example uses:

    from moss_ttsd import MossTTSDPipeline
    pipe = MossTTSDPipeline.from_pretrained("fnlp/MOSS-TTSD-v0", device="cuda")
    audio = pipe.generate(text, mode="voice_clone_and_continuation",
                          reference_audio=ref_path)

If MOSS-TTSD's actual package exposes a different surface, this adapter
will need editing on first load. The host will surface the import error
clearly via the /load endpoint.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

log = logging.getLogger("justvoice.engines.moss_tts")

MOSS_HF_REPO = "fnlp/MOSS-TTSD-v0"


class MossTTS(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="moss-tts",
        display_name="MOSS-TTS v1.5",
        backend="pytorch",
        supports_cloning=True,
        supports_paralinguistic_tags=True,
    )

    SAMPLE_RATE = 24000

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.pipe = None
        self._device = None

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        if self.pipe is not None:
            return
        device = self.pick_device(device)
        self._device = device
        log.info("loading MOSS-TTS on %s …", device)
        try:
            from moss_ttsd import MossTTSDPipeline  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                f"MOSS-TTSD package not importable ({e}). The upstream repo is python-only; "
                f"if `pip install git+https://github.com/OpenMOSS/MOSS-TTSD.git` succeeded but "
                f"this import still fails, check the package's actual top-level module name "
                f"and update engine.py accordingly."
            ) from e
        self.pipe = MossTTSDPipeline.from_pretrained(MOSS_HF_REPO, device=device)
        log.info("MOSS-TTS loaded on %s", device)

    def unload(self) -> None:
        if self.pipe is None:
            return
        import torch

        del self.pipe
        self.pipe = None
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.pipe is None:
            raise RuntimeError("moss-tts: engine not loaded — call /load first")

        import numpy as np
        import torch

        ref = req.audio_prompt_path
        mode = "voice_clone_and_continuation" if ref else "generation"

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}
        kwargs = {
            "mode": mode,
            "reference_audio": ref,
            "temperature": float(engine_overrides.get("temperature", 1.1)),
            "top_p": float(engine_overrides.get("top_p", 0.9)),
            "top_k": int(engine_overrides.get("top_k", 50)),
            "repetition_penalty": float(engine_overrides.get("repetition_penalty", 1.1)),
            "max_new_tokens": int(engine_overrides.get("max_new_tokens", 12000)),
        }
        out = self.pipe.generate(req.text, **{k: v for k, v in kwargs.items() if v is not None})
        if isinstance(out, torch.Tensor):
            audio = out.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(out, dtype=np.float32).squeeze()
        sample_rate = int(getattr(self.pipe, "sample_rate", self.SAMPLE_RATE))
        return SynthOutput.from_numpy(audio, sample_rate=sample_rate, channels=1)


if __name__ == "__main__":
    serve(MossTTS())
