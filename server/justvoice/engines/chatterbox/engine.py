# SPDX-License-Identifier: MIT
#
# Variant→class/repo mapping and turbo generation params adapted from
# voicebox (MIT) — backend/backends/chatterbox_backend.py +
# chatterbox_turbo_backend.py at the commit pinned in voicebox-pin.txt.
# Original copyright (c) the voicebox authors.
"""Chatterbox engine subprocess — Resemble AI's ChatterboxMultilingualTTS.

Adapter for `chatterbox-tts`. Key shape:
- We talk over loopback HTTP to the host (via justvoice_plugin.serve), not
  asyncio in-process.
- Voice prompts come in as audio_prompt_path; forwarded to model.generate().
- macOS CPU fallback retained (PyTorch MPS has a known issue with this model).
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging
import platform
import threading

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

log = logging.getLogger("justvoice.engines.chatterbox")

# Per-language generation defaults.
_LANG_DEFAULTS = {
    "he": {"exaggeration": 0.4, "cfg_weight": 0.7, "temperature": 0.65, "repetition_penalty": 2.5},
}
_GLOBAL_DEFAULTS = {"exaggeration": 0.5, "cfg_weight": 0.5, "temperature": 0.8, "repetition_penalty": 2.0}


class Chatterbox(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="chatterbox",
        display_name="Chatterbox",
        backend="pytorch",
        supports_cloning=True,
        supports_paralinguistic_tags=True,
    )

    # Class-level lock to serialize torch.load monkey-patching on CPU.
    _load_lock = threading.Lock()

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None
        self._variant = None
        self._is_turbo = False

    def _pick_device_chatterbox(self, requested: str) -> str:
        """Override the default device picker — Chatterbox needs CPU on macOS
        due to a known PyTorch MPS issue with their model.
        """
        if platform.system() == "Darwin":
            return "cpu"
        return self.pick_device(requested)

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self.model is not None:
            if variant and variant != self._variant:
                # Switching variants needs a fresh load — drop the old model.
                self.unload()
            else:
                return
        device = self._pick_device_chatterbox(device)
        self._device = device
        self._variant = variant or "chatterbox-multilingual-v2"
        self._is_turbo = self._variant == "chatterbox-turbo-v1"
        log.info("loading Chatterbox (%s) on %s …", self._variant, device)

        import torch

        # Variant → model class. Verified against voicebox's per-variant
        # backends (chatterbox_backend.py / chatterbox_turbo_backend.py at
        # the pin): Multilingual = chatterbox.mtl_tts on ResembleAI/chatterbox,
        # Turbo = chatterbox.tts_turbo on ResembleAI/chatterbox-turbo.
        if self._is_turbo:
            from chatterbox.tts_turbo import ChatterboxTurboTTS as _ModelCls
        else:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS as _ModelCls

        # Phase ② (2026-08-14): a host-provided local dir (the speech cache)
        # loads through the pinned package's from_local — no network, no HF
        # hub code in the load path. Without one, the legacy from_pretrained
        # path stands (HF cache via HF_HOME; downloads on a cache miss).
        def _construct():
            if model_dir:
                return _ModelCls.from_local(model_dir, device)
            return _ModelCls.from_pretrained(device=device)

        if device == "cpu":
            # CPU path — patch torch.load to force map_location='cpu'.
            _orig = torch.load

            def _patched(*args, **kwargs):
                kwargs.setdefault("map_location", "cpu")
                return _orig(*args, **kwargs)

            with Chatterbox._load_lock:
                torch.load = _patched
                try:
                    self.model = _construct()
                finally:
                    torch.load = _orig
        else:
            self.model = _construct()

        # Force eager attention (output_attentions support).
        try:
            t3_tfmr = self.model.t3.tfmr
            if hasattr(t3_tfmr, "config") and hasattr(t3_tfmr.config, "_attn_implementation"):
                t3_tfmr.config._attn_implementation = "eager"
                for layer in getattr(t3_tfmr, "layers", []):
                    if hasattr(layer, "self_attn"):
                        layer.self_attn._attn_implementation = "eager"
        except AttributeError as e:
            log.warning("could not patch t3 attention impl: %s", e)

        log.info("Chatterbox loaded on %s", device)

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
        # Chatterbox is clone-only.
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("chatterbox: engine not loaded — call /load first")

        import numpy as np
        import torch

        ref_audio = req.audio_prompt_path
        if ref_audio:
            from pathlib import Path

            if not Path(ref_audio).is_file():
                log.warning("reference audio not found: %s", ref_audio)
                ref_audio = None

        language = (req.language or "en").split("-")[0].lower()
        defaults = _LANG_DEFAULTS.get(language, _GLOBAL_DEFAULTS)

        # Engine-specific overrides come in through req.delivery.engine.
        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}
        # Top-level delivery.temperature is the UI's authoritative path
        # (the Generate slider). Wins over delivery.engine.temperature
        # which only exists as a legacy escape hatch.
        delivery_temperature = delivery.get("temperature")

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        def _temperature(default: float) -> float:
            if delivery_temperature is not None:
                return float(delivery_temperature)
            return float(engine_overrides.get("temperature", default))

        if self._is_turbo:
            # Turbo is English-only and takes no language_id / exaggeration /
            # cfg_weight. Sampling params per voicebox's turbo backend.
            wav = self.model.generate(
                req.text,
                audio_prompt_path=ref_audio,
                temperature=_temperature(0.8),
                top_k=1000,
                top_p=0.95,
                repetition_penalty=float(engine_overrides.get("repetition_penalty", 1.2)),
            )
        else:
            wav = self.model.generate(
                req.text,
                language_id=language,
                audio_prompt_path=ref_audio,
                exaggeration=float(engine_overrides.get("exaggeration", defaults["exaggeration"])),
                cfg_weight=float(engine_overrides.get("cfg_weight", defaults["cfg_weight"])),
                temperature=_temperature(defaults["temperature"]),
                repetition_penalty=float(engine_overrides.get("repetition_penalty", defaults["repetition_penalty"])),
            )

        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32)
        sample_rate = int(getattr(self.model, "sr", None) or getattr(self.model, "sample_rate", 24000))
        return SynthOutput.from_numpy(audio, sample_rate=sample_rate, channels=1)


if __name__ == "__main__":
    serve(Chatterbox())
