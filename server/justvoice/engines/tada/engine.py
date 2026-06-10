"""HumeAI TADA engine subprocess.

Adapter for HumeAI TADA. Two known integration quirks:

1. **DAC shim**: tada.modules.{encoder,decoder} import `dac.nn.layers.Snake1d`
   which lives in descript-audio-codec. The real package pulls onnx +
   tensorboard + matplotlib via descript-audiotools (~500 MB of unrelated
   ML tooling). We install a 60-line shim under `dac_shim.py` that
   provides only the Snake1d class.

2. **Tokenizer redirect**: TADA hardcodes "meta-llama/Llama-3.2-1B" as
   its tokenizer source. That repo is gated. We download the ungated
   `unsloth/Llama-3.2-1B` mirror and inject its local path into
   TADA's AlignerConfig + TadaConfig before from_pretrained().

Voicebox proves both work in their shipped code; this is a faithful port
of their lifecycle. NOT YET RUN-TESTED on this machine — first install
will exercise it.
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
from dac_shim import install_dac_shim  # noqa: E402

log = logging.getLogger("justvoice.engines.tada")

TADA_CODEC_REPO = "HumeAI/tada-codec"
TADA_MODEL_REPO = "HumeAI/tada-3b-ml"
LLAMA_TOKENIZER_MIRROR = "unsloth/Llama-3.2-1B"


class Tada(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="tada",
        display_name="TADA",
        backend="pytorch",
        supports_cloning=True,
    )

    _load_lock = threading.Lock()

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self.encoder = None
        self._device = None

    def load(self, device: str = "auto", variant: str | None = None) -> None:
        if self.model is not None:
            return
        device = self.pick_device(device)
        self._device = device
        log.info("loading TADA on %s …", device)

        # 1. DAC shim — must come BEFORE any `from tada...` imports.
        install_dac_shim()

        import torch
        from huggingface_hub import snapshot_download

        # 2. Download codec + model weights into the engine's HF cache.
        snapshot_download(repo_id=TADA_CODEC_REPO, allow_patterns=["*.safetensors", "*.json", "*.txt", "*.bin"])
        snapshot_download(repo_id=TADA_MODEL_REPO, allow_patterns=["*.safetensors", "*.json", "*.txt", "*.bin", "*.model"])

        # 3. Pull ungated Llama tokenizer mirror and redirect TADA to it.
        tokenizer_path = snapshot_download(repo_id=LLAMA_TOKENIZER_MIRROR, allow_patterns=["tokenizer*", "special_tokens*"])

        # 4. Choose dtype.
        if device == "cuda" and torch.cuda.is_bf16_supported():
            model_dtype = torch.bfloat16
        else:
            model_dtype = torch.float32

        from tada.modules.aligner import AlignerConfig
        AlignerConfig.tokenizer_name = tokenizer_path

        from tada.modules.encoder import Encoder
        from tada.modules.tada import TadaConfig, TadaForCausalLM

        self.encoder = Encoder.from_pretrained(TADA_CODEC_REPO, subfolder="encoder").to(device)
        self.encoder.eval()

        config = TadaConfig.from_pretrained(TADA_MODEL_REPO)
        config.tokenizer_name = tokenizer_path
        self.model = TadaForCausalLM.from_pretrained(TADA_MODEL_REPO, config=config, torch_dtype=model_dtype).to(device)
        self.model.eval()
        log.info("TADA loaded on %s", device)

    def unload(self) -> None:
        import torch

        for attr in ("model", "encoder"):
            obj = getattr(self, attr, None)
            if obj is not None:
                delattr(self, attr)
                setattr(self, attr, None)
        if self._device == "cuda" and torch.cuda.is_available():
            torch.cuda.empty_cache()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None or self.encoder is None:
            raise RuntimeError("tada: engine not loaded — call /load first")

        ref_audio = req.audio_prompt_path
        if not ref_audio:
            raise ValueError(
                "tada: voice cloning required — pass audio_prompt_path to reference a "
                "voice. TADA has no preset speakers."
            )

        import numpy as np
        import soundfile as sf
        import torch
        from tada.modules.encoder import EncoderOutput

        if req.seed is not None:
            torch.manual_seed(req.seed)
            if self._device == "cuda" and torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

        # Encode reference audio with forced alignment.
        audio_np, sr = sf.read(str(ref_audio), dtype="float32")
        audio = torch.from_numpy(audio_np).float()
        if audio.ndim == 1:
            audio = audio.unsqueeze(0)
        else:
            audio = audio.T
        audio = audio.to(self._device)
        prompt = self.encoder(audio, text=None, sample_rate=sr)

        # Generate audio.
        out_wav = self.model.generate_from_text_and_prompt(
            text=req.text,
            prompt=prompt,
            language=(req.language or "en").split("-")[0].lower(),
        )
        if isinstance(out_wav, torch.Tensor):
            audio_arr = out_wav.squeeze().cpu().float().numpy().astype(np.float32)
        else:
            audio_arr = np.asarray(out_wav, dtype=np.float32).squeeze()
        return SynthOutput.from_numpy(audio_arr, sample_rate=24000, channels=1)


if __name__ == "__main__":
    serve(Tada())
