# SPDX-License-Identifier: MIT
#
# Adapted from voicebox (MIT) — backend/backends/pytorch_backend.py
# PyTorchSTTBackend at the commit pinned in voicebox-pin.txt, restructured
# for JustVoice's venv-subprocess engine protocol. Original copyright
# (c) the voicebox authors.
"""Whisper STT engine subprocess.

Transcribes via transformers' WhisperForConditionalGeneration (same path
as upstream). Variant ids map to the five sizes the Models catalog lists.
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
    SynthRequest,
    SynthOutput,
    serve,
)

log = logging.getLogger("justvoice.engines.whisper")

WHISPER_VARIANT_REPOS = {
    "whisper-base": "openai/whisper-base",
    "whisper-small": "openai/whisper-small",
    "whisper-medium": "openai/whisper-medium",
    "whisper-large": "openai/whisper-large-v3",
    "whisper-turbo": "openai/whisper-large-v3-turbo",
}
DEFAULT_VARIANT = "whisper-turbo"


class WhisperSTT(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="whisper",
        display_name="Whisper STT",
        backend="pytorch",
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.processor = None
        self._device = None
        self._variant = None

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if variant and variant not in WHISPER_VARIANT_REPOS:
            raise RuntimeError(
                f"whisper: unknown variant {variant!r}; valid: {sorted(WHISPER_VARIANT_REPOS)}"
            )
        if self.model is not None:
            if variant and variant != self._variant:
                self.unload()
            else:
                return
        device = self.pick_device(device)
        self._device = device
        self._variant = variant or DEFAULT_VARIANT
        # Phase ②: a host-provided local dir (the speech cache) beats the
        # repo id — transformers loads plain local files, zero network.
        repo = model_dir or WHISPER_VARIANT_REPOS[self._variant]
        log.info("loading Whisper %s (%s) on %s …", self._variant, repo, device)

        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        self.processor = WhisperProcessor.from_pretrained(repo)
        self.model = WhisperForConditionalGeneration.from_pretrained(repo)
        self.model.to(device)
        self.model.eval()
        log.info("Whisper %s loaded on %s", self._variant, device)

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
        raise RuntimeError("whisper is an STT engine — use /transcribe, not /synth")

    def transcribe(self, audio_path: str, language: str | None = None) -> str:
        """Upstream recipe: load at 16 kHz, optional forced-language decoder
        prompt, generate with no_grad, batch_decode skipping specials."""
        if self.model is None:
            raise RuntimeError("whisper: engine not loaded — call /load first")

        import librosa
        import torch

        audio, _sr = librosa.load(audio_path, sr=16000, mono=True)

        inputs = self.processor(audio, sampling_rate=16000, return_tensors="pt")
        inputs = inputs.to(self._device)

        generate_kwargs = {}
        if language:
            generate_kwargs["forced_decoder_ids"] = self.processor.get_decoder_prompt_ids(
                language=language, task="transcribe"
            )

        with torch.no_grad():
            predicted_ids = self.model.generate(inputs["input_features"], **generate_kwargs)

        text = self.processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        return text.strip()


if __name__ == "__main__":
    serve(WhisperSTT())
