# SPDX-License-Identifier: MIT
"""Dia engine subprocess — Nari Labs **Dia2**, via the `dia2` package.

Replaced the Dia 1.6B / HuggingFace-transformers adapter on 2026-08-17.
Written against the upstream source, not the README:

* `Dia2.from_repo(repo, *, device, dtype, tokenizer_id, mimi_id)` and
  `Dia2.from_local(config_path, weights_path, *, device, dtype, tokenizer_id,
  mimi_id)` — `dia2/engine.py:53-83`.
* `generate(script, *, config=GenerationConfig|None, output_wav=None,
  prefix_speaker_1=None, prefix_speaker_2=None, include_prefix=None,
  verbose=False, **overrides)` returning a `GenerationResult` with
  `.waveform`, `.sample_rate`, `.timestamps` — `dia2/engine.py:101` and
  `dia2/generation.py`.
* `GenerationConfig(text=SamplingConfig(0.6, 50), audio=SamplingConfig(0.8, 50),
  cfg_scale=2.0, cfg_filter_k=50, initial_padding=2, prefix=None,
  use_cuda_graph=False, use_torch_compile=False)` — `dia2/generation.py:33`.

Two consequences worth stating, because both were wrong before:

**Cloning is real.** Dia 1's adapter never read `req.audio_prompt_path`, so a
cloned voice pointed at Dia rendered in the stock voice. Dia2 takes a reference
clip per speaker, and this adapter passes it.

**Sampling is split in two.** Dia2 samples text and audio streams separately,
each with its own temperature/top_k, and has **no top_p at all** — `top_p`
knobs from the old adapter do not map and were removed rather than silently
ignored.

Text without `[S1]` / `[S2]` is auto-wrapped in `[S1]` for single-speaker synth.
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

DIA_HF_REPO = "nari-labs/Dia2-1B"

# Manifest variant id → the HF repo it loads.
_VARIANT_REPOS = {
    "dia2-1b": "nari-labs/Dia2-1B",
    "dia2-2b": "nari-labs/Dia2-2B",
}


class Dia(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="dia",
        display_name="Dia",
        backend="pytorch",
        supports_cloning=True,
        supports_paralinguistic_tags=True,
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None
        self._sample_rate = 24000  # replaced by the model's own rate on load

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self.model is not None:
            return
        device = self.pick_device(device)
        self._device = device
        repo = _VARIANT_REPOS.get(variant or "", DIA_HF_REPO)
        log.info("loading Dia2 (%s) on %s …", repo, device)

        from dia2 import Dia2

        # A host-provided local dir (the speech cache) beats the repo id —
        # plain local files, zero network in the load path. `dia2_assets.json`
        # in each repo names the config and weights files, and points `mimi` at
        # kyutai/mimi, which the manifest downloads as a second source into the
        # same variant dir.
        if model_dir:
            d = _P(model_dir)
            cfg, weights = d / "config.json", d / "model.safetensors"
            if cfg.is_file() and weights.is_file():
                self.model = Dia2.from_local(
                    cfg, weights, device=device, dtype="auto",
                    tokenizer_id=str(d), mimi_id=str(d),
                )
            else:
                log.warning(
                    "dia: model_dir %s lacks config.json/model.safetensors — "
                    "falling back to the hub", model_dir,
                )
                self.model = Dia2.from_repo(repo, device=device, dtype="auto")
        else:
            self.model = Dia2.from_repo(repo, device=device, dtype="auto")

        try:
            self._sample_rate = int(self.model.sample_rate)
        except Exception:  # noqa: BLE001 — property is optional across versions
            log.warning("dia: model exposes no sample_rate; assuming %d", self._sample_rate)
        log.info("Dia2 loaded on %s at %d Hz", device, self._sample_rate)

    def unload(self) -> None:
        if self.model is None:
            return
        import torch

        try:
            self.model.close()
        except Exception:  # noqa: BLE001 — close() is best-effort
            pass
        del self.model
        self.model = None
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        # Dia2 has no preset speakers: the voice comes from the reference clip,
        # or from the model's own sampling when none is given. Dia 1 exposed a
        # "stock voice" row because it could not clone — keeping it would now
        # misdescribe where the voice comes from.
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("dia: engine not loaded — call /load first")

        import numpy as np
        import torch

        from dia2 import GenerationConfig, SamplingConfig

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

        # Two sampling streams, each with its own temperature/top_k. The
        # single `temperature` a user turns is the AUDIO one — that is the
        # knob that changes how it sounds; the text stream stays at upstream's
        # 0.6 unless someone asks for it by name.
        audio_temp = delivery.get("temperature")
        if audio_temp is None:
            audio_temp = 0.8
        cfg = GenerationConfig(
            text=SamplingConfig(
                temperature=float(engine_overrides.get("text_temperature", 0.6)),
                top_k=int(engine_overrides.get("text_top_k", 50)),
            ),
            audio=SamplingConfig(
                temperature=float(audio_temp),
                top_k=int(engine_overrides.get("audio_top_k", 50)),
            ),
            cfg_scale=float(engine_overrides.get("cfg_scale", 2.0)),
            cfg_filter_k=int(engine_overrides.get("cfg_filter_k", 50)),
            initial_padding=int(engine_overrides.get("initial_padding", 2)),
        )

        # The reference clip, when the cast voice is a clone. Speaker 2 is only
        # meaningful for a two-speaker script; a single clip drives [S1].
        result = self.model.generate(
            text,
            config=cfg,
            prefix_speaker_1=req.audio_prompt_path or None,
            prefix_speaker_2=engine_overrides.get("prefix_speaker_2") or None,
        )

        wav = getattr(result, "waveform", result)
        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().float().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32).squeeze()
        sample_rate = int(getattr(result, "sample_rate", 0) or self._sample_rate)
        return SynthOutput.from_numpy(audio, sample_rate=sample_rate, channels=1)


if __name__ == "__main__":
    serve(Dia())
