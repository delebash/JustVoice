# SPDX-License-Identifier: MIT AND GPL-3.0-or-later
# SPDX-FileCopyrightText: 2025 Jamie Pine and voicebox contributors
#
# Ported from voicebox `backend/backends/pytorch_backend.py`
# (PyTorchSTTBackend) at the commit pinned in /voicebox-pin.txt.
# Adapted to JustVoice's engine-plugin protocol: runs as a KIND="stt"
# subprocess behind the justvoice_plugin shim instead of in-process.
"""Whisper STT engine subprocess — transformers wrapper.

Variant string == whisper size (base / small / medium / large / turbo).
Weights pull from the HF cache (downloaded on first load).
"""

from __future__ import annotations

import logging

from justvoice_plugin import EmbeddedEngine, EngineMeta, serve

log = logging.getLogger("justvoice.engines.whisper")

WHISPER_HF_REPOS = {
    "base": "openai/whisper-base",
    "small": "openai/whisper-small",
    "medium": "openai/whisper-medium",
    "large": "openai/whisper-large-v3",
    "turbo": "openai/whisper-large-v3-turbo",
}
DEFAULT_SIZE = "base"


class WhisperEngine(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="whisper",
        display_name="Whisper STT",
        backend="transformers",
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.processor = None
        self.size = DEFAULT_SIZE
        self.device = "cpu"

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        size = variant or DEFAULT_SIZE
        if size not in WHISPER_HF_REPOS:
            raise ValueError(
                f"unknown whisper size {size!r} — pick one of {sorted(WHISPER_HF_REPOS)}"
            )
        from transformers import WhisperForConditionalGeneration, WhisperProcessor

        repo = WHISPER_HF_REPOS[size]
        self.device = self.pick_device(device)
        log.info("loading %s on %s", repo, self.device)
        self.processor = WhisperProcessor.from_pretrained(repo)
        self.model = WhisperForConditionalGeneration.from_pretrained(repo)
        self.model.to(self.device)
        self.size = size
        self._loaded = True

    def unload(self) -> None:
        self.model = None
        self.processor = None
        self._loaded = False

    def synth(self, req):
        raise NotImplementedError("whisper is an STT engine — it has no synth path")

    def transcribe(self, audio_path: str, language: str | None = None) -> str:
        import librosa
        import torch

        # 16 kHz mono float32 — what the Whisper feature extractor expects.
        # librosa handles decode + resample for wav/mp3/flac/ogg.
        audio, _sr = librosa.load(audio_path, sr=16000, mono=True)

        inputs = self.processor(audio, sampling_rate=16000, return_tensors="pt")
        inputs = inputs.to(self.device)

        generate_kwargs = {}
        if language:
            # Force the language when the caller pinned one; otherwise let
            # Whisper auto-detect from the first 30 s window.
            generate_kwargs["forced_decoder_ids"] = self.processor.get_decoder_prompt_ids(
                language=language, task="transcribe"
            )

        with torch.no_grad():
            predicted_ids = self.model.generate(
                inputs["input_features"], **generate_kwargs
            )
        text = self.processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        return text.strip()


if __name__ == "__main__":
    serve(WhisperEngine())
