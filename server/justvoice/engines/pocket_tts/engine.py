# SPDX-License-Identifier: MIT
"""Pocket TTS engine subprocess — CPU voice cloning via kyutai's package.

The upstream API, read from the 2.1.0 wheel's tts_model.py (2026-08-21):

    model = TTSModel.load_model()                       # english default
    state = model.get_state_for_audio_prompt(wav_path)  # the voice
    audio = model.generate_audio(state, text)           # torch.Tensor
    model.sample_rate                                   # mimi's rate

A voice here IS its audio prompt: every synth carries the stored clip as
`audio_prompt_path` (the same contract chatterbox clones use), and the
computed voice state is cached per path so the "relatively slow" encode
(upstream's own words) is paid once per voice per process. Voice-state
export to safetensors (`export_model_state`) is the future wiring for
VoiceRecord.embedding — recorded, not built.
"""

from __future__ import annotations

import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging
import os

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthRequest,
    SynthOutput,
    serve,
)

log = logging.getLogger("justvoice.engines.pocket_tts")


class PocketTTS(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="pocket-tts",
        display_name="Pocket TTS",
        backend="pocket-tts",
        supports_cloning=True,
    )

    def __init__(self, model_dir=None):
        super().__init__(model_dir)
        self.model = None
        self._device = None
        # audio-prompt path → computed voice state. Encoding a prompt is
        # the slow step; the state re-uses instantly (upstream's design).
        self._states: dict[str, dict] = {}

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self.model is not None:
            return
        # cpu_adequate: the host resolves auto → cpu; an explicit cuda/mps
        # still reaches torch through the package's own device handling.
        device = self.pick_device(device)
        self._device = device

        # Weights resolve through huggingface_hub inside the package. Pin
        # the download under the app-managed model dir (the host hands the
        # engine's models/ path) so nothing lands outside the user-chosen
        # data location — the family rule.
        target = model_dir or self.model_dir
        if target:
            os.environ.setdefault("HF_HOME", str(_P(target) / "hf"))

        log.info("loading Pocket TTS on %s …", device)
        from pocket_tts import TTSModel

        self.model = TTSModel.load_model()
        try:
            self.model.to(device)
        except Exception:  # noqa: BLE001 — CPU model; an exotic device stays best-effort
            pass
        log.info("Pocket TTS loaded (device=%s, sample_rate=%s)", device, self.model.sample_rate)

    def unload(self) -> None:
        self.model = None
        self._states.clear()
        self._device = None

    def voices(self) -> list[PresetVoice]:
        return []  # cloning engine — voices are the user's stored clips

    def _state_for(self, audio_prompt_path: str) -> dict:
        st = self._states.get(audio_prompt_path)
        if st is None:
            log.info("pocket-tts: encoding voice prompt %s", audio_prompt_path)
            st = self.model.get_state_for_audio_prompt(audio_prompt_path)
            self._states[audio_prompt_path] = st
        return st

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self.model is None:
            raise RuntimeError("pocket-tts: engine not loaded — call /load first")
        if not req.audio_prompt_path:
            raise RuntimeError(
                "pocket-tts: this engine clones — it needs a reference clip "
                "(the voice's stored recording) and got none."
            )
        state = self._state_for(req.audio_prompt_path)
        audio = self.model.generate_audio(state, req.text)
        samples = audio.detach().cpu().numpy().reshape(-1)
        return SynthOutput.from_numpy(
            samples, sample_rate=int(self.model.sample_rate), channels=1
        )


if __name__ == "__main__":
    serve(PocketTTS())
