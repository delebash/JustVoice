"""External OpenAI-compatible TTS engine adapter.

Wraps any server speaking the standard OpenAI TTS spec at
``POST /v1/audio/speech``. Configured via
``settings.engines.external``.
"""

from __future__ import annotations

import logging

import httpx

from .base import EngineMeta, PresetVoice, SynthOutput, SynthRequest

log = logging.getLogger(__name__)


class ExternalOpenAiTtsBackend:
    def __init__(
        self,
        *,
        id: str,
        name: str,
        base_url: str,
        api_key: str | None,
        model: str,
        voices: list[str],
        response_format: str = "wav",
    ):
        self.meta = EngineMeta(
            engine_id=id,
            display_name=name,
            backend="external-openai-tts",
            supported_runtimes=["http"],
            supports_cloning=False,
            supports_streaming=False,
        )
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._response_format = response_format
        self._voices: list[PresetVoice] = [
            PresetVoice(id=v, name=v, language="en") for v in voices
        ] or [
            PresetVoice(id="default", name=f"{name} default", language="en")
        ]
        self._ready = False
        self._client = httpx.Client(timeout=120.0)

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        try:
            resp = self._client.head(self._base_url + "/", timeout=5.0)
            self._ready = True
        except Exception as e:
            self._ready = False
            raise RuntimeError(
                f"External TTS server at {self._base_url} is not responding: {e}"
            )

    def unload(self) -> None:
        self._ready = False

    def ready(self) -> bool:
        return self._ready

    def voices(self) -> list[PresetVoice]:
        return list(self._voices)

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        delivery = req.delivery or {}
        body = {
            "model": self._model,
            "input": req.text,
            "voice": req.voice_id,
            "response_format": self._response_format,
            "speed": float(delivery.get("speed") or 1.0),
        }
        headers = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        url = f"{self._base_url}/v1/audio/speech"
        resp = self._client.post(url, json=body, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"{self.meta.engine_id}: {resp.status_code} from {url}: {resp.text}"
            )

        return SynthOutput(
            bytes=resp.content,
            sample_rate=24_000,  # WAV header is authoritative
            channels=1,
            is_wav_container=True,
        )
