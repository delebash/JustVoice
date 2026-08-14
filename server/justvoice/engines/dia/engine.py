"""Dia engine subprocess — Nari Labs Dia-1.6B via HuggingFace transformers.

Written from the upstream README example. Text input that lacks `[S1]`
/ `[S2]` speaker tags is auto-wrapped in `[S1]` for single-speaker synth.
Voice cloning is supported via `audio_prompt_path` — the processor takes
the reference clip.
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

log = logging.getLogger("justvoice.engines.dia")

DIA_HF_REPO = "nari-labs/Dia-1.6B-0626"


class Dia(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="dia",
        display_name="Dia",
        backend="pytorch",
        supports_cloning=True,
        supports_paralinguistic_tags=True,
    )

    SAMPLE_RATE = 44100  # Dia's native output rate

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.processor = None
        self._device = None

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self.model is not None:
            return
        device = self.pick_device(device)
        self._device = device
        log.info("loading Dia on %s …", device)

        from transformers import AutoProcessor, DiaForConditionalGeneration

        # Phase ②: a host-provided local dir (the speech cache) beats the
        # repo id — plain local files, zero network in the load path.
        src = model_dir or DIA_HF_REPO
        self.processor = AutoProcessor.from_pretrained(src)
        self.model = DiaForConditionalGeneration.from_pretrained(src).to(device)
        log.info("Dia loaded on %s", device)

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
        # Single default speaker. Multi-speaker happens via [S1]/[S2] tags
        # the user writes inside the text. Voice cloning is supported via
        # the host's stored-voice flow (audio_prompt_path).
        # Name kept in lock-step with manifest STATIC_VOICES ("Dia stock
        # voice" — the old "Dia (default)" read as a default-engine setting).
        return [PresetVoice(id="default", name="Dia stock voice", language="en", gender="")]

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None or self.processor is None:
            raise RuntimeError("dia: engine not loaded — call /load first")

        import numpy as np
        import torch

        # Wrap text with [S1] if it has no speaker tag.
        text = req.text
        if "[S1]" not in text and "[S2]" not in text:
            text = f"[S1] {text}"

        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        inputs = self.processor(text=[text], padding=True, return_tensors="pt").to(self._device)

        # Default max_new_tokens lowered from 3072 → 1024 for snappier first
        # synth on consumer GPUs. Users with patience (or H100s) can override
        # via delivery.engine.max_new_tokens.
        outputs = self.model.generate(
            **inputs,
            max_new_tokens=int(engine_overrides.get("max_new_tokens", 1024)),
            guidance_scale=float(engine_overrides.get("guidance_scale", 3.0)),
            temperature=float(engine_overrides.get("temperature", 1.8)),
            top_p=float(engine_overrides.get("top_p", 0.90)),
            top_k=int(engine_overrides.get("top_k", 45)),
        )

        decoded = self.processor.batch_decode(outputs)
        # batch_decode returns a list (one per input) of audio tensors / arrays.
        if not decoded:
            raise RuntimeError("dia: empty output from processor.batch_decode")
        wav = decoded[0]
        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32).squeeze()
        return SynthOutput.from_numpy(audio, sample_rate=self.SAMPLE_RATE, channels=1)


if __name__ == "__main__":
    serve(Dia())
