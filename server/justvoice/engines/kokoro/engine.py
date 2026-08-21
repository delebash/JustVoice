# SPDX-License-Identifier: MIT
"""Kokoro engine subprocess — kokoro-onnx wrapper.

Runs in its own venv created by the JustVoice engine manager. The host
spawns this script with `python engine.py serve --port 0`; we bind to a
free port, write `PORT=<n>` to stdout (the `justvoice_plugin.serve` shim
handles that), then accept the host's HTTP requests.

Model layout (the host puts files under $JUSTVOICE_MODEL_DIR / the speech
cache's variant dir): one `kokoro-*.onnx` model plus one name-keyed
`voices-*.bin` pack (np.load-able; keys = the ids in voices.py).

Runtime swapped 2026-08-19 from sherpa-onnx. What that door change buys:

  * `create(text, voice)` takes a name OR a raw (510, 1, 256) float32
    style vector — a blended voice (SynthRequest.voice_vector) renders
    directly, no repacking, no reload.
  * `lang` is per call, so every voice finally speaks its own language
    (the old wrapper hardcoded one language at load — the tracked
    "every Kokoro voice speaks English" finding).
  * `is_phonemes` makes the declared IPA bypass real (delivery.phonemes).

Provider selection is kokoro-onnx's: ONNX_PROVIDER env wins; an installed
accelerated onnxruntime distribution (gpu/directml/rocm) enables every
available provider; otherwise plain CPU — which is real-time for this
82M-param model. The host's device hint maps onto ONNX_PROVIDER below.
"""

from __future__ import annotations

# Put the engine's own directory on sys.path so `from voices import ...`
# resolves whether the script is launched from the host (cwd != engine dir)
# or by a developer directly inside the engine dir.
import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging
import os
from pathlib import Path

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

from voices import VOICES  # noqa: E402  — same dir, see sys.path tweak above

log = logging.getLogger("justvoice.engines.kokoro")

# Device hint → onnxruntime execution provider (kokoro-onnx reads
# ONNX_PROVIDER). "auto" stays unset so the package's own resolution runs.
_PROVIDER = {
    "cuda": "CUDAExecutionProvider",
    "directml": "DmlExecutionProvider",
    "coreml": "CoreMLExecutionProvider",
    "metal": "CoreMLExecutionProvider",
    "cpu": "CPUExecutionProvider",
}

# Catalog language → espeak voice code for kokoro-onnx's `lang` argument.
#
# kokoro-onnx passes `lang` straight into
# `phonemizer.phonemize(text, lang, ...)` on the espeak-ng backend, so the
# accepted values are espeak-ng voice codes and these are all real ones.
# Its own docstring only documents en-us / en-gb though, so the non-English
# rows are correct-by-construction rather than heard: if a language comes
# out wrong, this map is the first place to look.
_ESPEAK_LANG = {
    "en-us": "en-us", "en": "en-us", "en-gb": "en-gb",
    "ja": "ja", "zh": "cmn", "es": "es", "fr": "fr-fr",
    "hi": "hi", "it": "it", "pt-br": "pt-br", "pt": "pt-br",
}

_VOICE_LANG = {vid: lang for vid, _name, lang, _gender in VOICES}


class Kokoro(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="kokoro",
        display_name="Kokoro",
        backend="kokoro-onnx",
    )

    SAMPLE_RATE = 24_000

    def __init__(self, model_dir: Path | None = None):
        super().__init__(model_dir)
        self._tts = None
        self._device = "cpu"
        self._style_shape = None  # the pack's per-voice array shape

    # ─── Model file discovery ────────────────────────────────────────

    def _resolved_files(self) -> tuple[Path, Path] | None:
        """(model.onnx, voices pack) under model_dir or one subdir deep."""
        for root in [self.model_dir, *(
            p for p in (self.model_dir.iterdir() if self.model_dir.exists() else [])
            if p.is_dir()
        )]:
            models = sorted(root.glob("kokoro-*.onnx")) or sorted(root.glob("model.onnx"))
            packs = sorted(root.glob("voices-*.bin")) or sorted(root.glob("voices*.npz"))
            if models and packs:
                return models[0], packs[0]
            # A sherpa-era directory (raw packed voices.bin + tokens.txt)
            # cannot feed this runtime — say so instead of failing deep
            # inside np.load.
            if (root / "tokens.txt").exists() and (root / "voices.bin").exists():
                raise RuntimeError(
                    "kokoro: this model directory is from the retired "
                    "sherpa-onnx runtime — re-download Kokoro in Engines "
                    f"({root})."
                )
        return None

    # ─── Lifecycle ───────────────────────────────────────────────────

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self._tts is not None:
            return
        if model_dir:
            self.model_dir = Path(model_dir)
        found = self._resolved_files()
        if found is None:
            raise RuntimeError(
                f"Kokoro model files not found under {self.model_dir}. "
                f"Expected kokoro-*.onnx + voices-*.bin."
            )
        model_path, voices_path = found

        provider = _PROVIDER.get(device)
        if provider:
            # Pre-flight: kokoro-onnx passes ONNX_PROVIDER straight to the
            # session, and an unavailable provider dies deep inside ORT
            # with a stack trace. Check here and say what to actually do.
            import onnxruntime as _ort

            available = _ort.get_available_providers()
            if provider not in available:
                raise RuntimeError(
                    f"kokoro: this install's onnxruntime has no {provider} "
                    f"(available: {', '.join(available)}). Reinstall the "
                    f"Kokoro engine to pick up the accelerated runtime for "
                    f"this machine, or set the engine's Device to cpu."
                )
            os.environ["ONNX_PROVIDER"] = provider
        else:
            os.environ.pop("ONNX_PROVIDER", None)

        from kokoro_onnx import Kokoro as _KokoroOnnx  # deferred heavy import

        self._tts = _KokoroOnnx(str(model_path), str(voices_path))
        self._device = device
        try:
            first = sorted(self._tts.voices.keys())[0]
            self._style_shape = self._tts.voices[first].shape
        except Exception:
            self._style_shape = None
        log.info("Kokoro loaded (device=%s, model=%s)", device, model_path.name)

    def unload(self) -> None:
        self._tts = None
        self._style_shape = None

    # ─── Catalog ──────────────────────────────────────────────────────

    def voices(self) -> list[PresetVoice]:
        return [
            PresetVoice(id=vid, name=name, language=lang, gender=gender)
            for vid, name, lang, gender in VOICES
        ]

    # ─── Synthesis ────────────────────────────────────────────────────

    def _resolve_voice(self, req: SynthRequest):
        """Name for presets; the reshaped style vector for blends."""
        import numpy as np

        if req.voice_vector:
            vec = np.asarray(req.voice_vector, dtype=np.float32)
            if self._style_shape is not None:
                try:
                    vec = vec.reshape(self._style_shape)
                except ValueError:
                    raise ValueError(
                        f"kokoro: blended vector has {vec.size} values; this "
                        f"pack's voices are {self._style_shape} — re-blend "
                        f"against the installed voice pack."
                    )
            return vec
        if req.voice_id in self._tts.voices:
            return req.voice_id
        raise ValueError(
            f"kokoro: unknown voice id {req.voice_id!r}; expected a Kokoro "
            f"preset id or a blended voice."
        )

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self._tts is None:
            raise RuntimeError("kokoro: engine not loaded — call /load first")

        voice = self._resolve_voice(req)

        delivery = req.delivery or {}
        speed = float(delivery.get("speed") or 1.0)
        # The declared range of the Speed knob (capability_details'
        # _speed_knob): clamping tighter here would silently ignore a
        # value the UI accepted.
        speed = max(0.5, min(3.0, speed))

        # Per-call language — the voice's own catalog language unless the
        # request says otherwise. (The retired runtime hardcoded en-us at
        # load; this is the fix for the every-voice-speaks-English finding.)
        raw_lang = (req.language or _VOICE_LANG.get(req.voice_id) or "en-US").lower()
        lang = _ESPEAK_LANG.get(raw_lang, _ESPEAK_LANG.get(raw_lang.split("-")[0], "en-us"))

        # The declared IPA bypass, real now: delivery.phonemes skips the
        # text parser entirely.
        phonemes = delivery.get("phonemes")
        text = str(phonemes) if phonemes else req.text
        is_phonemes = bool(phonemes)

        # Per-word pronunciations from the lexicon (delivery.ipa_map,
        # collected host-side): splice the given IPA into the phoneme
        # stream, phonemizing the rest with the SAME espeak pipeline
        # create() would use — so only the mapped words change. A failed
        # splice falls back to plain text: a guessed pronunciation beats
        # a dead render.
        ipa_map = delivery.get("ipa_map")
        if ipa_map and not is_phonemes:
            import ipa as _ipa  # same-dir module, see the sys.path tweak above

            spliced = _ipa.splice(
                text, dict(ipa_map),
                lambda seg: self._tts.tokenizer.phonemize(seg, lang=lang),
            )
            if spliced:
                text = spliced
                is_phonemes = True

        samples, sample_rate = self._tts.create(
            text,
            voice=voice,
            speed=speed,
            lang=lang,
            is_phonemes=is_phonemes,
        )
        return SynthOutput.from_numpy(samples, sample_rate=sample_rate, channels=1)


if __name__ == "__main__":
    serve(Kokoro())
