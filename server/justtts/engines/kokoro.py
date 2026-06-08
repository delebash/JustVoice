"""Kokoro engine via sherpa-onnx-python.

Same .onnx model files k2-fsa publishes; same audio quality the
Rust path produced via the sherpa-onnx Rust crate. The Rust path was
~50 MB tighter on binary footprint; with all-Python we pay the Python
runtime overhead but gain a single-language codebase.

Model layout (matches Rust):
  $DATA_DIR/justtts/models/kokoro/                        (default)
  OR settings.engines.kokoro.model_dir_override           (override)

The tarball k2-fsa ships unpacks into a nested subdir like
`kokoro-multi-lang-v1_0/`. We walk model_dir + immediate subdirs to
locate the canonical file set (model.onnx + voices.bin + tokens.txt).
"""

from __future__ import annotations

import io
import logging
import wave
from pathlib import Path

from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest
from .kokoro_voices import preset_voices, speaker_id_for

log = logging.getLogger(__name__)


class KokoroBackend:
    meta = EngineMeta(
        engine_id="kokoro",
        display_name="Kokoro",
        backend="sherpa-onnx",
        supported_runtimes=["cuda", "coreml", "directml", "cpu"],
        supports_cloning=False,
        supports_streaming=False,
        supports_paralinguistic_tags=False,
        supports_voice_design=False,
        supports_instruct_field=False,
    )

    SAMPLE_RATE = 24_000

    def __init__(self, model_dir: Path):
        self._model_dir = Path(model_dir)
        self._tts = None
        self._device = "cpu"

    # ─── Path resolution ──────────────────────────────────────────────

    def resolved_dir(self) -> Path | None:
        """Walk model_dir + immediate subdirs to find the canonical file set."""
        if self._has_required_files(self._model_dir):
            return self._model_dir
        if not self._model_dir.exists():
            return None
        for sub in self._model_dir.iterdir():
            if sub.is_dir() and self._has_required_files(sub):
                return sub
        return None

    @staticmethod
    def _has_required_files(dir: Path) -> bool:
        return (
            (dir / "model.onnx").exists()
            and (dir / "voices.bin").exists()
            and (dir / "tokens.txt").exists()
        )

    def model_files_present(self) -> bool:
        return self.resolved_dir() is not None

    # ─── Lifecycle ────────────────────────────────────────────────────

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        if self._tts is not None:
            return
        resolved = self.resolved_dir()
        if resolved is None:
            raise RuntimeError(
                f"Kokoro model files not located under {self._model_dir}. "
                f"POST /v1/engines/kokoro/install to download, or set "
                f"settings.engines.kokoro.model_dir_override to point at an "
                f"existing local install."
            )

        # Deferred import so the dep is optional (`pip install justtts[kokoro]`)
        try:
            import sherpa_onnx
        except ImportError as e:
            raise RuntimeError(
                "Kokoro requires `sherpa-onnx`. Install with: pip install sherpa-onnx"
            ) from e

        # Multilingual Kokoro (v1.0+) needs lexicon files + dict_dir + lang.
        lexicon_files = sorted(resolved.glob("lexicon-*.txt"))
        lexicon = ",".join(str(p) for p in lexicon_files) if lexicon_files else ""
        dict_dir = str(resolved)
        espeak = resolved / "espeak-ng-data"
        data_dir = str(espeak) if espeak.is_dir() else ""
        lang = "en-us" if lexicon else ""

        provider = {
            "cuda": "cuda",
            "metal": "coreml",
            "coreml": "coreml",
            "directml": "directml",
            "cpu": "cpu",
        }.get(device, "")  # empty → sherpa-onnx auto

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(resolved / "model.onnx"),
                    voices=str(resolved / "voices.bin"),
                    tokens=str(resolved / "tokens.txt"),
                    data_dir=data_dir,
                    dict_dir=dict_dir,
                    lexicon=lexicon,
                    lang=lang,
                ),
                num_threads=1,
                debug=False,
                provider=provider,
            ),
        )
        self._tts = sherpa_onnx.OfflineTts(config)
        self._device = device
        log.info("Kokoro loaded (device=%s, dir=%s)", device, resolved)

    def unload(self) -> None:
        self._tts = None

    def ready(self) -> bool:
        return self._tts is not None

    # ─── Catalog ──────────────────────────────────────────────────────

    def voices(self) -> list[PresetVoice]:
        return preset_voices()

    # ─── Synthesis ────────────────────────────────────────────────────

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        if self._tts is None:
            raise RuntimeError("kokoro: engine not loaded — call load() first")

        sid = speaker_id_for(req.voice_id)
        if sid is None:
            raise ValueError(
                f"kokoro: unknown voice id {req.voice_id!r}; expected one of the Kokoro preset ids"
            )

        delivery = req.delivery or {}
        speed = float(delivery.get("speed") or 1.0)
        speed = max(0.25, min(4.0, speed))

        audio = self._tts.generate(req.text, sid=sid, speed=speed)
        samples = audio.samples  # numpy float32 array in [-1, 1]
        sr = audio.sample_rate

        # Convert to 16-bit PCM bytes, then wrap with WAV header so
        # upper layers don't have to know the format.
        import numpy as np

        i16 = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(i16.tobytes())
        return SynthOutput(bytes=buf.getvalue(), sample_rate=sr, channels=1, is_wav_container=True)
