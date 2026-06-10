"""justvoice-plugin — minimal SDK every JustVoice engine subprocess imports.

Engine authors write:

    from justvoice_plugin import EmbeddedEngine, PresetVoice, SynthOutput, serve

    class MyEngine(EmbeddedEngine):
        def load(self, device="auto", variant=None):
            ...

        def voices(self):
            return [PresetVoice(id="default", name="Default")]

        def synth(self, req):
            wav = self.model.generate(req.text)
            return SynthOutput.from_numpy(wav, sample_rate=24000)

    if __name__ == "__main__":
        serve(MyEngine())

That's the whole adapter contract. The base class + FastAPI shim handle
port allocation, the JustVoice-host handshake (port written to stdout),
HTTP routes, and error envelopes.
"""

from .audio import wav_bytes_from_numpy, pcm_bytes_from_numpy
from .embedded import EmbeddedEngine
from .protocol import (
    EngineMeta,
    PresetVoice,
    SynthOutput,
    SynthRequest,
    VoiceCloneRequest,
    VoiceCloneResponse,
)
from .server import serve

__all__ = [
    "EmbeddedEngine",
    "EngineMeta",
    "PresetVoice",
    "SynthOutput",
    "SynthRequest",
    "VoiceCloneRequest",
    "VoiceCloneResponse",
    "pcm_bytes_from_numpy",
    "serve",
    "wav_bytes_from_numpy",
]

__version__ = "0.1.0"
