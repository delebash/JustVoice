# justvoice-plugin

Tiny SDK every JustVoice engine subprocess imports. Provides:

- `EmbeddedEngine` — base class for your adapter.
- `serve(engine)` — boots a FastAPI on an auto-assigned port and announces it via stdout.
- `PresetVoice`, `SynthRequest`, `SynthOutput`, `VoiceCloneResponse` — protocol dataclasses.
- `wav_bytes_from_numpy` — turn a numpy audio array into a complete WAV file.

## Writing an engine adapter

```python
# server/justvoice/engines/myengine/engine.py
from justvoice_plugin import EmbeddedEngine, EngineMeta, PresetVoice, SynthOutput, serve

class MyEngine(EmbeddedEngine):
    meta = EngineMeta(
        engine_id="myengine",
        display_name="My Engine",
        backend="pytorch",
        supports_cloning=True,
    )

    def load(self, device="auto", variant=None):
        from myengine import Model
        self.model = Model.from_pretrained("hf-org/my-model", device=self.pick_device(device))

    def voices(self):
        return [PresetVoice(id="default", name="Default")]

    def synth(self, req):
        wav = self.model.generate(req.text, voice=req.voice_id)
        return SynthOutput.from_numpy(wav, sample_rate=24000)

    def unload(self):
        del self.model
        self.model = None

if __name__ == "__main__":
    serve(MyEngine())
```

That's the whole adapter contract. The JustVoice host handles install (uv venv + uv pip install per the engine's `manifest.py`), subprocess lifecycle, HTTP proxy from the host's `/v1/generate` to the engine's `/synth`, and shutdown.

## License

Apache-2.0.
