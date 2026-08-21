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
        # Which trained LoRA adapter currently wraps t3, if any.
        self._adapter_path = None
        # Conditioning cache: chatterbox re-preps the reference clip on
        # EVERY generate(audio_prompt_path=...) — for a chapter render on a
        # cloned voice that is the same clip re-encoded per line. Key it on
        # (path, mtime) and hand the model a prompt only when it changes.
        # (devnen/Chatterbox-TTS-Server caches the same way.)
        self._conds_key = None
        self._variant = None
        self._is_turbo = False

    def _ensure_adapter(self, adapter_path: str) -> None:
        """Wrap t3 with a trained LoRA adapter (upstream inference pattern:
        PeftModel.from_pretrained onto the loaded engine's t3, which also
        restores the saved text embeddings). Switching adapters reloads the
        clean base first, because PEFT wraps in place."""
        if self._adapter_path == adapter_path:
            return
        if self._adapter_path is not None:
            device, variant = self._device or "auto", self._variant
            self.unload()
            self.load(device, variant)
        try:
            from peft import PeftModel
        except ImportError:
            raise RuntimeError(
                "chatterbox: peft is not installed in the engine environment "
                "\u2014 re-run engine setup to render trained voices."
            )
        self.model.t3 = PeftModel.from_pretrained(self.model.t3, adapter_path)
        self.model.t3.eval()
        self._adapter_path = adapter_path
        log.info("chatterbox: LoRA adapter loaded from %s", adapter_path)

    def _pick_device_chatterbox(self, requested: str) -> str:
        """Chatterbox's device pick. On macOS this used to force CPU
        unconditionally — the stock package crashes on MPS ("Cannot convert
        a MPS Tensor to float64 dtype" in s3tokenizer / voice_encoder).
        Since 2026-08-19 load() applies the known float32 fix (mps_patch.py,
        devnen's repair) BEFORE the model modules import, so Apple GPU is
        attempted; an explicit "cpu" from the Device dropdown still wins,
        and any MPS load failure falls back to CPU in load(). UNMEASURED on
        real Apple hardware."""
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
        # Nano rides the Turbo class (upstream: ChatterboxTurboTTS(nano=True)).
        self._is_nano = "nano" in self._variant
        self._is_turbo = self._is_nano or self._variant == "chatterbox-turbo-v1"
        log.info("loading Chatterbox (%s) on %s …", self._variant, device)

        import torch

        # The MPS float32 fix edits source files, so it has to land
        # BEFORE the model modules import (an already-imported module keeps
        # its old code). Idempotent; also harmless on CUDA/CPU — float32 on
        # these audio tensors is already the norm there.
        from mps_patch import apply as _apply_mps_patch

        _apply_mps_patch()

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
        # Per-variant load arguments, signature-guarded: an older installed
        # package (pre-master) lacks `nano` / `t3_model`, and the honest
        # failure there is "re-run engine setup", not a TypeError five
        # frames deep.
        extra = {}
        if self._is_nano:
            extra["nano"] = True
        elif self._variant == "chatterbox-multilingual-v3":
            extra["t3_model"] = "v3"

        def _construct():
            try:
                if model_dir:
                    return _ModelCls.from_local(model_dir, device, **extra)
                return _ModelCls.from_pretrained(device=device, **extra)
            except TypeError as e:
                if extra:
                    raise RuntimeError(
                        f"chatterbox: the installed package predates "
                        f"{self._variant} ({e}) — re-run engine setup to get "
                        f"the pinned upstream master."
                    ) from e
                raise

        # MPS first where picked: the float32 fix above makes it viable,
        # but a corner it misses must fall back to CPU rather than fail the
        # load (UNMEASURED on real Apple hardware; devnen-verified repair).
        if device == "mps":
            try:
                self.model = _construct()
                log.info("Chatterbox loaded on MPS")
            except Exception as e:  # noqa: BLE001 — any MPS failure → CPU
                log.warning("chatterbox: MPS load failed (%s) — falling back to CPU", e)
                device = "cpu"
                self._device = "cpu"

        if self.model is not None:
            pass  # loaded on MPS above; fall through to the attention patch
        elif device == "cpu":
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
        self._adapter_path = None
        self._conds_key = None
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

        from pathlib import Path

        # A trained voice renders as its adapter over the base checkpoint,
        # conditioned on the reference clip saved beside the adapter at
        # training time.
        if req.adapter_path:
            self._ensure_adapter(req.adapter_path)

        ref_audio = req.audio_prompt_path
        if not ref_audio and req.adapter_path:
            trained_ref = Path(req.adapter_path) / "ref_sample.wav"
            if trained_ref.is_file():
                ref_audio = str(trained_ref)
        if ref_audio and not Path(ref_audio).is_file():
            log.warning("reference audio not found: %s", ref_audio)
            ref_audio = None

        # Same clip + same exaggeration as last time → the model's stored
        # conditionals are already right, so drop the path and let generate
        # reuse them. Chatterbox re-preps conds on EVERY
        # generate(audio_prompt_path=...) call, which for a chapter render
        # on one cloned voice is the same clip re-encoded per line.
        # Exaggeration is part of the key because prepare_conditionals
        # BAKES it into the conds — a (path, mtime)-only key would freeze
        # the slider (devnen's server caches on exactly this triple).
        if ref_audio:
            exagg = ((req.delivery or {}).get("engine") or {}).get("exaggeration")
            try:
                key = (ref_audio, Path(ref_audio).stat().st_mtime_ns, exagg)
            except OSError:
                key = (ref_audio, None, exagg)
            if key == self._conds_key and getattr(self.model, "conds", None) is not None:
                ref_audio = None
            else:
                self._conds_key = key
        else:
            self._conds_key = None

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
            # Upstream signature: repetition_penalty=1.2, min_p=0.0,
            # top_p=0.95, exaggeration=0.0, cfg_weight=0.0, temperature=0.8,
            # top_k=1000, norm_loudness=True. top_k/top_p were hardcoded here
            # and unreachable; they are declared knobs now.
            wav = self.model.generate(
                req.text,
                audio_prompt_path=ref_audio,
                temperature=_temperature(0.8),
                top_k=int(engine_overrides.get("top_k", 1000)),
                top_p=float(engine_overrides.get("top_p", 0.95)),
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
                # Declared in capability_details since the beginning, never
                # forwarded until 2026-08-17. Introspected defaults from
                # ChatterboxMultilingualTTS.generate: min_p=0.05, top_p=1.0.
                min_p=float(engine_overrides.get("min_p", 0.05)),
                top_p=float(engine_overrides.get("top_p", 1.0)),
            )

        if isinstance(wav, torch.Tensor):
            audio = wav.squeeze().cpu().numpy().astype(np.float32)
        else:
            audio = np.asarray(wav, dtype=np.float32)
        sample_rate = int(getattr(self.model, "sr", None) or getattr(self.model, "sample_rate", 24000))
        return SynthOutput.from_numpy(audio, sample_rate=sample_rate, channels=1)


if __name__ == "__main__":
    serve(Chatterbox())
