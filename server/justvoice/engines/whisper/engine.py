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
import math

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

    def transcribe(self, audio_path: str, language: str | None = None) -> dict:
        """Upstream recipe: load at 16 kHz, optional forced-language decoder
        prompt, generate with no_grad, batch_decode skipping specials.

        Returns `{"text", "confidence"}`. Confidence is the geometric mean of
        the chosen tokens' probabilities — `exp(mean(log p(token)))` over the
        generated sequence — which is Whisper's own `avg_logprob` in
        probability space, the quantity openai-whisper thresholds on. It is a
        real measurement, not a placeholder: the Preparer's min-confidence
        gate reads it to drop clips Whisper itself was unsure about.

        `None` when the backend cannot produce scores (an older transformers
        build, or a beam-search path with no per-step scores). None means
        UNKNOWN and callers must not gate on it — the same contract SNR uses
        in training_prep.
        """
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
            out = self.model.generate(
                inputs["input_features"],
                output_scores=True,
                return_dict_in_generate=True,
                **generate_kwargs,
            )

        predicted_ids = out.sequences
        text = self.processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        return {
            "text": text.strip(),
            "confidence": self._sequence_confidence(out, predicted_ids),
        }

    def align(self, audio_path: str, text: str, language: str | None = None) -> list[dict]:
        """Word timings for KNOWN text spoken in `audio_path`.

        Transcribes with per-token timestamps (HF generate's
        `return_token_timestamps=True` — cross-attention + DTW over the
        checkpoint's own alignment heads), groups tokens into hypothesis
        words, and returns the hypothesis as [{word, start, end}]. The
        HOST maps these onto the known text (justvoice.alignment) — the
        engine subprocess only measures.

        Raises RuntimeError with the reason when this checkpoint or
        transformers build cannot produce token timestamps.
        """
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
        try:
            with torch.no_grad():
                out = self.model.generate(
                    inputs["input_features"],
                    return_token_timestamps=True,
                    return_dict_in_generate=True,
                    **generate_kwargs,
                )
        except Exception as e:
            raise RuntimeError(
                f"whisper: this checkpoint/transformers build cannot produce "
                f"token timestamps ({e}) — word alignment needs a Whisper "
                f"model whose generation_config carries alignment_heads."
            )
        stamps = getattr(out, "token_timestamps", None)
        if stamps is None:
            raise RuntimeError(
                "whisper: generate returned no token_timestamps — word "
                "alignment is unavailable on this build."
            )

        ids = out.sequences[0].tolist()
        times = stamps[0].tolist()
        # sequences carries the decoder prompt too; timestamps align to the
        # END of the id list.
        ids = ids[-len(times):]
        tok = self.processor.tokenizer
        specials = set(tok.all_special_ids)

        # Token pieces → words: a piece beginning with a space starts a new
        # word (Whisper's byte-level vocabulary encodes the boundary in the
        # piece itself). A token's timestamp is its START; a word ends at
        # the next word's start.
        words: list[dict] = []
        for i, (tid, ts) in enumerate(zip(ids, times)):
            if tid in specials:
                continue
            piece = tok.decode([tid])
            if not piece.strip():
                continue
            starts_new = piece.startswith(" ") or not words
            if starts_new:
                words.append({"word": piece.strip(), "start": float(ts), "end": float(ts)})
            else:
                words[-1]["word"] += piece
                words[-1]["end"] = float(ts)
        duration = len(audio) / 16000.0
        for i, w in enumerate(words):
            w["end"] = words[i + 1]["start"] if i + 1 < len(words) else min(
                duration, w["end"] + 0.5
            )
            if w["end"] < w["start"]:
                w["end"] = w["start"]
        return words

    @staticmethod
    def _sequence_confidence(out, predicted_ids) -> float | None:
        """exp(mean log p) over the generated tokens, or None if unavailable.

        `generate` returns one score tensor per generated step; the sequence
        is longer by the decoder prompt, so the last len(scores) ids are the
        generated ones. Special tokens stay IN the average deliberately —
        Whisper's own avg_logprob includes them, and an unsure end-of-text is
        exactly the signal a confidence gate wants.
        """
        scores = getattr(out, "scores", None)
        if not scores:
            return None
        try:
            import torch

            ids = predicted_ids[0]
            generated = ids[-len(scores):]
            total = 0.0
            for step, logits in enumerate(scores):
                logprobs = torch.log_softmax(logits[0].float(), dim=-1)
                total += float(logprobs[generated[step]])
            mean_logprob = total / len(scores)
            # exp() of a very negative mean underflows to 0.0, which is the
            # correct answer (no confidence at all), so no clamping needed.
            return round(float(math.exp(mean_logprob)), 4)
        except Exception:
            log.warning("whisper: confidence unavailable", exc_info=True)
            return None


if __name__ == "__main__":
    serve(WhisperSTT())
