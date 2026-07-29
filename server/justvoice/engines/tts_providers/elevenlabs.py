# SPDX-License-Identifier: MIT
"""ElevenLabs TTS adapter.

Proprietary /v1/text-to-speech/{voice_id} endpoint. Voices listed at
/v1/voices, models hardcoded (ElevenLabs doesn't expose a /models
endpoint).
"""

from __future__ import annotations

import io
import logging
import wave

import httpx

from ..base import EngineMeta, PresetVoice, SynthOutput, SynthRequest

log = logging.getLogger(__name__)


DEFAULT_BASE_URL = "https://api.elevenlabs.io"
DEFAULT_MODEL = "eleven_flash_v2_5"

# Pinned model list — ElevenLabs adds/retires models without an API to
# enumerate them, so the UI shows this list and the user can paste a
# custom id into the dropdown if needed.
KNOWN_MODELS = [
    "eleven_v3",
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_turbo_v2_5",
]


class ElevenLabsBackend:
    def __init__(
        self,
        *,
        id: str,
        name: str,
        api_key: str,
        model: str = DEFAULT_MODEL,
        voices: list[str] | None = None,
        base_url: str = "",
        response_format: str = "wav",
    ):
        self.meta = EngineMeta(
            engine_id=id,
            display_name=name,
            backend="elevenlabs",
            supported_runtimes=["http"],
            kind="tts",
            supports_cloning=True,
        )
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._model = model
        self._response_format = response_format
        self._voices_cache: list[PresetVoice] | None = None
        self._configured_voices = voices or []
        self._ready = False
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict[str, str]:
        return {"xi-api-key": self._api_key, "Accept": "*/*"}

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        try:
            r = self._client.get(
                f"{self._base_url}/v1/voices", headers=self._headers(), timeout=5.0
            )
            self._ready = r.status_code < 400
            if model_variant:
                self._model = model_variant
        except httpx.HTTPError as e:
            self._ready = False
            raise RuntimeError(f"ElevenLabs auth check failed: {e}") from e

    def unload(self) -> None:
        self._ready = False

    def ready(self) -> bool:
        return self._ready

    def voices(self) -> list[PresetVoice]:
        if self._voices_cache is not None:
            return list(self._voices_cache)
        try:
            r = self._client.get(f"{self._base_url}/v1/voices", headers=self._headers())
            if r.status_code >= 400:
                return [PresetVoice(id=v, name=v, language="en") for v in self._configured_voices]
            data = r.json()
            self._voices_cache = [
                PresetVoice(
                    id=v.get("voice_id"),
                    name=v.get("name") or v.get("voice_id"),
                    language=(v.get("labels") or {}).get("language") or "en",
                    gender=(v.get("labels") or {}).get("gender"),
                )
                for v in data.get("voices") or []
                if v.get("voice_id")
            ]
            return list(self._voices_cache)
        except httpx.HTTPError as e:
            log.warning("ElevenLabs voices() failed: %s", e)
            return [PresetVoice(id=v, name=v, language="en") for v in self._configured_voices]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        # ElevenLabs returns MP3 by default; wrap to WAV via output_format=pcm_24000.
        body = {
            "text": req.text,
            "model_id": self._model,
            "output_format": "pcm_24000",
        }
        delivery = req.delivery or {}
        if "stability" in delivery or "similarity_boost" in delivery or "style" in delivery:
            body["voice_settings"] = {
                k: v
                for k, v in {
                    "stability": delivery.get("stability"),
                    "similarity_boost": delivery.get("similarity_boost"),
                    "style": delivery.get("style"),
                    "use_speaker_boost": delivery.get("use_speaker_boost"),
                }.items()
                if v is not None
            }
        url = f"{self._base_url}/v1/text-to-speech/{req.voice_id}"
        try:
            r = self._client.post(url, json=body, headers=self._headers())
        except httpx.HTTPError as e:
            raise RuntimeError(f"ElevenLabs request failed: {e}") from e
        if r.status_code >= 400:
            raise RuntimeError(
                f"ElevenLabs {r.status_code}: {r.text[:400]}"
            )

        # Wrap raw PCM in a WAV container.
        pcm = r.content
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(pcm)
        return SynthOutput(
            bytes=buf.getvalue(),
            sample_rate=24000,
            channels=1,
            is_wav_container=True,
        )

    @staticmethod
    def known_models() -> list[str]:
        return list(KNOWN_MODELS)
