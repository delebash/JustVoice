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
    # A voice from a prose description. 1.7B only — upstream ships no 0.6B
    # VoiceDesign checkpoint (the Space's own app.py pins 1.7B).
    "qwen3-vd-1.7b": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    # macOS (Apple Silicon): mlx-community 8-bit exports, loaded through
    # mlx-audio (roster doc 2026-08-17 §4). Same three families; the -mlx
    # SUFFIX keeps the capability suffix-walk landing on the right family
    # row (qwen3-cv-1.7b-mlx → qwen3-cv-1.7b → qwen3-cv).
    "qwen3-cv-1.7b-mlx": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    "qwen3-cv-0.6b-mlx": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
    "qwen3-base-1.7b-mlx": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
    "qwen3-base-0.6b-mlx": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
    "qwen3-vd-1.7b-mlx": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
}
DEFAULT_VARIANT = "qwen3-cv-1.7b-mlx" if _sys.platform == "darwin" else "qwen3-cv-1.7b"

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
        # The VoiceDesign checkpoint shipped 2026-08-19 as qwen3-vd-1.7b —
        # generate_voice_design renders a voice from a prose description.
        supports_voice_design=True,
        supports_instruct_field=True,
        supports_paralinguistic_tags=True,
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None
        self._variant = None
        # LoRA state (trained voices): which adapter wraps the talker, and
        # the cached x-vector clone prompt built from its ref sample.
        self._adapter_path = None
        self._lora_prompt = None

    @property
    def _is_base(self) -> bool:
        return bool(self._variant and "base" in self._variant)

    @property
    def _is_design(self) -> bool:
        return bool(self._variant and "-vd-" in self._variant)

    @property
    def _is_mlx(self) -> bool:
        return bool(self._variant and self._variant.endswith("-mlx"))

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
        self._variant = variant or DEFAULT_VARIANT
        # Phase ②: a host-provided local dir (the speech cache) beats the
        # repo id — both loaders take plain local files, zero network.
        repo = model_dir or QWEN_VARIANT_REPOS[self._variant]

        if self._is_mlx:
            # Apple-Silicon arm (roster doc 2026-08-17 §4): mlx-audio's
            # load_model takes a local dir or repo id and runs on Metal
            # via unified memory — MLX has no device arg, so the Device
            # pick is not consulted here. UNMEASURED on real Apple
            # hardware; the API surface is v0.5.0-verified.
            log.info("loading Qwen3-TTS %s (%s) via mlx-audio …", self._variant, repo)
            from mlx_audio.tts.utils import load_model  # type: ignore

            self.model = load_model(repo)
            self._device = "mlx"
            log.info("Qwen3-TTS %s loaded via MLX", self._variant)
            return

        device = self.pick_device(device)
        self._device = device
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
        del self.model
        self.model = None
        self._adapter_path = None
        self._lora_prompt = None
        if self._device == "cuda":
            # Inside the branch: the macOS MLX venv has no torch at all.
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        # Preset speakers ship only with the CustomVoice checkpoints; Base
        # is clone-only and VoiceDesign renders from a description.
        if self._is_base or self._is_design:
            return []
        return list(PRESET_VOICES)

    def _ensure_adapter(self, adapter_path: str) -> None:
        """Wrap the talker with a trained LoRA adapter (Alexandria's
        inference pattern: Base + PeftModel.from_pretrained). Switching
        adapters reloads the clean base first — PEFT wraps in place."""
        if self._adapter_path == adapter_path:
            return
        if not self._is_base:
            raise RuntimeError(
                "qwen3: a trained voice renders on its Base checkpoint — "
                f"loaded variant is {self._variant!r}. Load the variant "
                "recorded in the adapter's training_meta.json."
            )
        if self._adapter_path is not None:
            device, variant = self._device or "auto", self._variant
            self.unload()
            self.load(device, variant)
        try:
            from peft import PeftModel
        except ImportError:
            raise RuntimeError(
                "qwen3: peft is not installed in the engine environment — "
                "re-run engine setup to render trained voices."
            )
        self.model.model.talker = PeftModel.from_pretrained(
            self.model.model.talker, adapter_path,
        )
        self.model.model.talker.eval()
        self._adapter_path = adapter_path
        self._lora_prompt = None
        log.info("qwen3: LoRA adapter loaded from %s", adapter_path)

    def _lora_clone_prompt(self, adapter_path: str):
        """The cached x-vector clone prompt for the wrapped adapter, built
        from the ref sample the trainer saved beside it."""
        if self._lora_prompt is not None:
            return self._lora_prompt
        import json as _json
        from pathlib import Path as _Path

        import soundfile as sf

        adir = _Path(adapter_path)
        ref_wav = adir / "ref_sample.wav"
        meta_path = adir / "training_meta.json"
        if not ref_wav.exists() or not meta_path.exists():
            raise RuntimeError(
                f"qwen3: adapter at {adapter_path} is missing ref_sample.wav "
                f"or training_meta.json — re-train the voice."
            )
        meta = _json.loads(meta_path.read_text(encoding="utf-8"))
        ref_text = (meta.get("ref_sample_text") or "").strip()
        audio_array, sample_rate = sf.read(str(ref_wav))
        if getattr(audio_array, "ndim", 1) > 1:
            audio_array = audio_array.mean(axis=1)
        self._lora_prompt = self.model.create_voice_clone_prompt(
            ref_audio=(audio_array, sample_rate),
            ref_text=ref_text,
            x_vector_only_mode=True,
        )
        return self._lora_prompt

    def _synth_mlx(self, req: SynthRequest, instruct: str | None,
                   language: str, delivery: dict[str, Any],
                   engine_overrides: dict[str, Any]) -> SynthOutput:
        """Apple-Silicon render via mlx-audio (roster doc 2026-08-17 §4).
        ONE entry point: the mlx model's generate() self-routes by
        checkpoint family (base clone / custom_voice / voice_design), takes
        ref_audio as a file path and language NAMES for lang_code, and
        yields GenerationResult chunks split on newlines. Signatures read
        from mlx-audio v0.5.0's qwen3_tts.py; UNMEASURED on real Apple
        hardware — this machine is Windows/NVIDIA."""
        import mlx.core as mx
        import numpy as np

        if req.adapter_path:
            raise RuntimeError(
                "qwen3: trained voices render through the PyTorch Base "
                "checkpoint (Windows/Linux) — MLX LoRA inference is not "
                "wired. Use a cloned, designed or preset voice on this Mac."
            )
        if req.seed is not None:
            mx.random.seed(req.seed)

        # Same UI surface as the torch path: delivery.temperature beats the
        # talker_* alias names; mlx generate() takes these directly.
        kwargs: dict[str, Any] = {"lang_code": language, "stream": False}
        if delivery.get("temperature") is not None:
            kwargs["temperature"] = float(delivery["temperature"])
        elif engine_overrides.get("talker_temperature") is not None:
            kwargs["temperature"] = float(engine_overrides["talker_temperature"])
        if engine_overrides.get("talker_top_k") is not None:
            kwargs["top_k"] = int(engine_overrides["talker_top_k"])
        if engine_overrides.get("talker_top_p") is not None:
            kwargs["top_p"] = float(engine_overrides["talker_top_p"])
        if engine_overrides.get("repetition_penalty") is not None:
            kwargs["repetition_penalty"] = float(engine_overrides["repetition_penalty"])

        # Family routing mirrors the torch branches — same refusals, same
        # reasons (the checkpoints have the same capabilities either way).
        if self._is_design:
            if req.audio_prompt_path:
                raise RuntimeError(
                    "qwen3: VoiceDesign takes no reference clip — clone on "
                    "a Base variant instead."
                )
            if not instruct:
                raise RuntimeError(
                    "qwen3: VoiceDesign renders from a voice description "
                    "and this voice has none — write one, or pick another "
                    "variant."
                )
            kwargs["instruct"] = instruct
        elif req.audio_prompt_path and not self._is_base:
            raise RuntimeError(
                "qwen3: the CustomVoice checkpoint cannot clone a voice. "
                "Load a Base variant to clone, or pick one of CustomVoice's "
                "9 preset speakers."
            )
        elif req.audio_prompt_path:
            kwargs["ref_audio"] = req.audio_prompt_path
            if req.ref_text and not req.xvector_only:
                kwargs["ref_text"] = req.ref_text
            # xvector_only: ref_audio alone — the model extracts the
            # speaker embedding without a transcript (its x-vector path).
        elif self._is_base:
            raise RuntimeError(
                "qwen3: the Base checkpoint is clone-only — pass a cloned/"
                "reference voice, or load a CustomVoice variant for preset "
                "speakers."
            )
        else:
            kwargs["voice"] = req.voice_id
            if instruct:
                kwargs["instruct"] = instruct

        results = list(self.model.generate(req.text, **kwargs))
        chunks = [
            np.asarray(r.audio, dtype=np.float32).squeeze()
            for r in results if getattr(r, "audio", None) is not None
        ]
        if not chunks:
            raise RuntimeError("qwen3: model returned no audio")
        audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        return SynthOutput.from_numpy(
            audio, sample_rate=int(self.model.sample_rate), channels=1
        )

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("qwen3: engine not loaded — call /load first")

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

        if self._is_mlx:
            return self._synth_mlx(req, instruct, language, delivery,
                                   engine_overrides)

        import numpy as np
        import torch

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

        # Four paths, one per checkpoint family + the LoRA overlay. All
        # return (list[np.ndarray], sample_rate) per the real package surface.
        #
        # Cloning is a BASE-checkpoint capability. CustomVoice ships the 9
        # preset timbres and the instruct field and nothing else (model card,
        # verified 2026-08-15), so handing it a reference clip used to call
        # generate_voice_clone on weights that cannot honour it. Refuse and
        # name the way out instead of returning audio in the wrong voice.
        if req.adapter_path:
            # Trained voice: Base + PEFT adapter + x-vector prompt from the
            # ref sample saved at training time. instruct DOES work here —
            # tokenized into instruct_ids (Alexandria's inference pattern).
            self._ensure_adapter(req.adapter_path)
            prompt = self._lora_clone_prompt(req.adapter_path)
            if instruct and hasattr(self.model, "_tokenize_texts"):
                instruct_formatted = f"<|im_start|>user\n{instruct}<|im_end|>\n"
                hf_kwargs["instruct_ids"] = self.model._tokenize_texts(
                    [instruct_formatted]
                )
            arrays, sample_rate = self.model.generate_voice_clone(
                text=req.text,
                voice_clone_prompt=prompt,
                non_streaming_mode=True,
                max_new_tokens=2048,
                **hf_kwargs,
            )
        elif self._is_design:
            if req.audio_prompt_path:
                raise RuntimeError(
                    "qwen3: VoiceDesign takes no reference clip — clone on a "
                    "Base variant instead."
                )
            if not instruct:
                raise RuntimeError(
                    "qwen3: VoiceDesign renders from a voice description and "
                    "this voice has none — write one, or pick another variant."
                )
            arrays, sample_rate = self.model.generate_voice_design(
                req.text,
                language=language,
                instruct=instruct,
                non_streaming_mode=True,
                max_new_tokens=2048,
                **hf_kwargs,
            )
        elif req.audio_prompt_path and not self._is_base:
            raise RuntimeError(
                "qwen3: the CustomVoice checkpoint cannot clone a voice. Load "
                "a Base variant (qwen3-base-1.7b / qwen3-base-0.6b) to clone, "
                "or pick one of CustomVoice's 9 preset speakers."
            )
        elif req.audio_prompt_path:
            # Passing the clip's exact transcript raises clone quality
            # (upstream's own demo passes ref_text). Older qwen-tts builds
            # lack the kwarg — retry without rather than failing the render.
            clone_kwargs: dict[str, Any] = dict(
                language=language,
                ref_audio=req.audio_prompt_path,
                **hf_kwargs,
            )
            if req.ref_text:
                clone_kwargs["ref_text"] = req.ref_text
            if req.xvector_only:
                # Speaker vector only: the transcript is ignored, so do not
                # send one alongside it.
                clone_kwargs.pop("ref_text", None)
                clone_kwargs["x_vector_only_mode"] = True
            try:
                arrays, sample_rate = self.model.generate_voice_clone(
                    req.text, **clone_kwargs
                )
            except TypeError:
                if "ref_text" not in clone_kwargs:
                    raise
                clone_kwargs.pop("ref_text")
                log.warning(
                    "qwen3: installed qwen-tts takes no ref_text — cloned "
                    "without the transcript"
                )
                arrays, sample_rate = self.model.generate_voice_clone(
                    req.text, **clone_kwargs
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
