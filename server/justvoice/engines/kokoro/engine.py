"""Kokoro engine subprocess — sherpa-onnx wrapper.

Runs in its own venv created by the JustVoice engine manager. The host
spawns this script with `python engine.py serve --port 0`; we bind to a
free port, write `PORT=<n>` to stdout (the `justvoice_plugin.serve` shim
handles that), then accept the host's HTTP requests.

Model layout (the host puts files under $JUSTVOICE_MODEL_DIR):

    engines/kokoro/models/                          ← JUSTVOICE_MODEL_DIR
      kokoro-multi-lang-v1_0/                       ← what k2-fsa's tarball unpacks into
        model.onnx, voices.bin, tokens.txt, lexicon-*.txt, espeak-ng-data/

We walk model_dir + its immediate subdirs to find the canonical files.
Same logic as the legacy in-process adapter — porting only the transport,
not the model wrapping.
"""

from __future__ import annotations

# Put the engine's own directory on sys.path so `from voices import ...`
# resolves whether the script is launched from the host (cwd != engine dir)
# or by a developer directly inside the engine dir.
import sys as _sys
from pathlib import Path as _P

_sys.path.insert(0, str(_P(__file__).resolve().parent))

import logging
from pathlib import Path

from justvoice_plugin import (
    EmbeddedEngine,
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    serve,
)

from voices import VOICES, speaker_id_for  # noqa: E402  — same dir, see sys.path tweak above

log = logging.getLogger("justvoice.engines.kokoro")


class Kokoro(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="kokoro",
        display_name="Kokoro",
        backend="sherpa-onnx",
    )

    SAMPLE_RATE = 24_000

    def __init__(self, model_dir: Path | None = None):
        super().__init__(model_dir)
        self._tts = None
        self._device = "cpu"

    # ─── Model file discovery ────────────────────────────────────────

    def _resolved_dir(self) -> Path | None:
        if self._has_required_files(self.model_dir):
            return self.model_dir
        if not self.model_dir.exists():
            return None
        for sub in self.model_dir.iterdir():
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

    # ─── Lifecycle ───────────────────────────────────────────────────

    def load(self, device: str = "auto", variant: str | None = None,
             model_dir: str | None = None) -> None:
        if self._tts is not None:
            return

        # Phase ②: the host's speech-cache variant dir wins over the
        # spawn-time JUSTVOICE_MODEL_DIR default. Same flat-or-one-subdir
        # resolution either way (the release tarball extracts a subdir).
        if model_dir:
            self.model_dir = Path(model_dir)
        resolved = self._resolved_dir()
        if resolved is None:
            raise RuntimeError(
                f"Kokoro model files not found under {self.model_dir}. "
                f"Expected model.onnx + voices.bin + tokens.txt (flat or one subdir deep)."
            )

        import sherpa_onnx  # heavy import — deferred until load

        # Multilingual Kokoro (v1.0+) needs lexicon files + dict_dir + lang.
        lexicon_files = sorted(resolved.glob("lexicon-*.txt"))
        lexicon = ",".join(str(p) for p in lexicon_files) if lexicon_files else ""
        dict_dir = str(resolved)
        espeak = resolved / "espeak-ng-data"
        data_dir = str(espeak) if espeak.is_dir() else ""
        lang = "en-us" if lexicon else ""

        # Auto-detect provider from device hint.
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

    # ─── Catalog ──────────────────────────────────────────────────────

    def voices(self) -> list[PresetVoice]:
        return [PresetVoice(id=vid, name=name, language=lang, gender=gender) for vid, name, lang, gender in VOICES]

    # ─── Synthesis ────────────────────────────────────────────────────

    def synth(self, req: SynthRequest) -> SynthOutput:
        if self._tts is None:
            raise RuntimeError("kokoro: engine not loaded — call /load first")

        sid = speaker_id_for(req.voice_id)
        if sid is None:
            raise ValueError(
                f"kokoro: unknown voice id {req.voice_id!r}; expected one of the Kokoro preset ids"
            )

        delivery = req.delivery or {}
        speed = float(delivery.get("speed") or 1.0)
        speed = max(0.25, min(4.0, speed))

        audio = self._tts.generate(req.text, sid=sid, speed=speed)
        # audio.samples = numpy float32 array in [-1, 1], audio.sample_rate = 24000
        return SynthOutput.from_numpy(audio.samples, sample_rate=audio.sample_rate, channels=1)


if __name__ == "__main__":
    serve(Kokoro())
