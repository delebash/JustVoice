# SPDX-License-Identifier: MIT
#
# Variant→repo map adapted from voicebox (MIT) — backend/backends/
# qwen_custom_voice_backend.py + pytorch_backend.py at the commit pinned
# in voicebox-pin.txt. Original copyright (c) the voicebox authors.
"""Qwen3-TTS CustomVoice engine subprocess.

Adapter for Qwen3-TTS CustomVoice. Generates with
`model.generate_custom_voice(text, speaker=<id>, instruct=<str>)`
on the qwen-tts library. NOT YET RUN-TESTED on this machine.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P
from typing import Any

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

log = logging.getLogger("justvoice.engines.qwen3")

# Variant id → HF repo. Repos verified against voicebox's backends at the
# pin (qwen_custom_voice_backend.py QWEN_CV_HF_REPOS + pytorch_backend.py
# Base repos). Base checkpoints are clone-only and silently drop `instruct`.
QWEN_VARIANT_REPOS = {
    "qwen3-cv-1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "qwen3-cv-0.6b": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "qwen3-base-1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "qwen3-base-0.6b": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
}
DEFAULT_VARIANT = "qwen3-cv-1.7b"

# Qwen3 expects language NAMES ("english"), not BCP-47 codes ("en").
# Maps the 10 supported language codes; anything not in the map falls
# back to "auto".
_LANG_NAME = {
    "en": "english", "zh": "chinese", "ja": "japanese", "ko": "korean",
    "de": "german", "fr": "french", "ru": "russian", "pt": "portuguese",
    "es": "spanish", "it": "italian",
}

PRESET_VOICES = [
    PresetVoice(id="Vivian", name="Vivian", language="zh", gender="female"),
    PresetVoice(id="Serena", name="Serena", language="zh", gender="female"),
    PresetVoice(id="Uncle_Fu", name="Uncle Fu", language="zh", gender="male"),
    PresetVoice(id="Dylan", name="Dylan", language="zh", gender="male"),
    PresetVoice(id="Eric", name="Eric", language="zh", gender="male"),
    PresetVoice(id="Ryan", name="Ryan", language="en", gender="male"),
    PresetVoice(id="Aiden", name="Aiden", language="en", gender="male"),
    PresetVoice(id="Ono_Anna", name="Ono Anna", language="ja", gender="female"),
    PresetVoice(id="Sohee", name="Sohee", language="ko", gender="female"),
]


class Qwen3(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="qwen3",
        display_name="Qwen3-TTS",
        backend="pytorch",
        supports_cloning=True,
        # VoiceDesign is a third Qwen checkpoint (1.7B-VoiceDesign) with its
        # own generate call. We ship neither, so this said yes to a thing
        # nothing here can do. Flips back when the design path lands.
        supports_voice_design=False,
        supports_instruct_field=True,
        supports_paralinguistic_tags=True,
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None
        self._variant = None

    @property
    def _is_base(self) -> bool:
        return bool(self._variant and "base" in self._variant)

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if variant and variant not in QWEN_VARIANT_REPOS:
            raise RuntimeError(
                f"qwen3: unknown variant {variant!r}; valid: {sorted(QWEN_VARIANT_REPOS)}"
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
        # repo id — from_pretrained loads plain local files, zero network.
        repo = model_dir or QWEN_VARIANT_REPOS[self._variant]
        log.info("loading Qwen3-TTS %s (%s) on %s …", self._variant, repo, device)
        # Canonical load pattern from qwen-tts's own cli/demo.py:
        #   Qwen3TTSModel.from_pretrained(ckpt, device_map=..., dtype=..., attn_implementation=...)
        # NOT a plain .to(device) call.
        import torch
        from qwen_tts import Qwen3TTSModel  # type: ignore

        if device == "cuda" and torch.cuda.is_bf16_supported():
            dtype = torch.bfloat16
        else:
            dtype = torch.float32

        self.model = Qwen3TTSModel.from_pretrained(
            repo,
            device_map=device,
            dtype=dtype,
            attn_implementation=None,  # no flash-attn on Windows / not installed
        )
        log.info("Qwen3-TTS %s loaded on %s (dtype=%s)", self._variant, device, dtype)

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
        # Preset speakers ship only with the CustomVoice checkpoints; the
        # Base checkpoints are clone-only.
        if self._is_base:
            return []
        return list(PRESET_VOICES)

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("qwen3: engine not loaded — call /load first")

        import numpy as np
        import torch

        delivery = req.delivery or {}
        engine_overrides = delivery.get("engine") or {}
        # Qwen has exactly ONE upstream instruct slot. The host composes
        # everything that shapes delivery into it before the request gets here
        # — persona standing instruction, emotion, this line's direction, in
        # that order (`delivery_merge.compose_instruct`). A second
        # `style_prompt` field used to be read here and concatenated onto the
        # front; it was deleted 2026-08-17 because the concat happened one line
        # before the model saw it, so the two fields were never distinguishable
        # downstream.
        instruct = delivery.get("instruct") or engine_overrides.get("instruct")
        bcp = (req.language or "en").split("-")[0].lower()
        language = _LANG_NAME.get(bcp, "auto")

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        # Per upstream qwen-tts docs, generate_custom_voice /
        # generate_voice_clone forward any HuggingFace `model.generate`
        # kwargs (max_new_tokens, top_p, top_k, temperature, …).
        # Map JustVoice's UI surface:
        #   delivery.temperature          → HF temperature (primary slider)
        #   delivery.engine.talker_*      → HF temperature/top_k/top_p
        #                                    (the manifest's alias names)
        # delivery.temperature wins when both are set.
        hf_kwargs: dict[str, Any] = {}
        if delivery.get("temperature") is not None:
            hf_kwargs["temperature"] = float(delivery["temperature"])
        elif engine_overrides.get("talker_temperature") is not None:
            hf_kwargs["temperature"] = float(engine_overrides["talker_temperature"])
        if engine_overrides.get("talker_top_k") is not None:
            hf_kwargs["top_k"] = int(engine_overrides["talker_top_k"])
        if engine_overrides.get("talker_top_p") is not None:
            hf_kwargs["top_p"] = float(engine_overrides["talker_top_p"])
        # Declared in capability_details, never read until 2026-08-17. Both
        # generate_custom_voice and generate_voice_clone take **kwargs and
        # forward them to HF generate, so this reaches the model like the rest.
        if engine_overrides.get("repetition_penalty") is not None:
            hf_kwargs["repetition_penalty"] = float(engine_overrides["repetition_penalty"])

        # Two paths: cloning (ref WAV passed via audio_prompt_path) vs. preset.
        # Both return (list[np.ndarray], sample_rate) per the real package surface.
        #
        # Cloning is a BASE-checkpoint capability. CustomVoice ships the 9
        # preset timbres and the instruct field and nothing else (model card,
        # verified 2026-08-15), so handing it a reference clip used to call
        # generate_voice_clone on weights that cannot honour it. Refuse and
        # name the way out instead of returning audio in the wrong voice.
        if req.audio_prompt_path and not self._is_base:
            raise RuntimeError(
                "qwen3: the CustomVoice checkpoint cannot clone a voice. Load "
                "a Base variant (qwen3-base-1.7b / qwen3-base-0.6b) to clone, "
                "or pick one of CustomVoice's 9 preset speakers."
            )
        if req.audio_prompt_path:
            arrays, sample_rate = self.model.generate_voice_clone(
                req.text,
                language=language,
                ref_audio=req.audio_prompt_path,
                **hf_kwargs,
            )
        elif self._is_base:
            raise RuntimeError(
                "qwen3: the Base checkpoint is clone-only — pass a cloned/"
                "reference voice, or load a CustomVoice variant for preset "
                "speakers."
            )
        else:
            arrays, sample_rate = self.model.generate_custom_voice(
                req.text,
                speaker=req.voice_id,
                language=language,
                instruct=instruct or "",
                **hf_kwargs,
            )

        if not arrays:
            raise RuntimeError("qwen3: model returned no audio")
        first = arrays[0]
        if isinstance(first, torch.Tensor):
            audio = first.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(first, dtype=np.float32).squeeze()
        return SynthOutput.from_numpy(audio, sample_rate=int(sample_rate), channels=1)


if __name__ == "__main__":
    serve(Qwen3())
