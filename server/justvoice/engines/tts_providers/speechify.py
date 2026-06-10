# SPDX-License-Identifier: GPL-3.0-or-later
"""Speechify TTS adapter (SIMBA 3.0 API).

POST /v1/audio/speech with bearer auth. Response is base64-encoded audio
in JSON (`audio_data` field) — distinct from ElevenLabs returning raw bytes.
"""

from __future__ import annotations

import base64
import io
import logging
import wave

import httpx

from ..base import EngineMeta, PresetVoice, SynthOutput, SynthRequest

log = logging.getLogger(__name__)


DEFAULT_BASE_URL = "https://api.sws.speechify.com"
DEFAULT_MODEL = "simba-multilingual"


class SpeechifyBackend:
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
            backend="speechify",
            supported_runtimes=["http"],
            kind="tts",
        )
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._model = model
        self._configured_voices = voices or []
        self._voices_cache: list[PresetVoice] | None = None
        self._ready = False
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        try:
            r = self._client.get(
                f"{self._base_url}/v1/voices", headers=self._headers(), timeout=5.0
            )
            self._ready = r.status_code < 500
            if model_variant:
                self._model = model_variant
        except httpx.HTTPError as e:
            self._ready = False
            raise RuntimeError(f"Speechify auth check failed: {e}") from e

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
                return [PresetVoice(id=v, name=v) for v in self._configured_voices]
            data = r.json()
            # Speechify nests by language: {voices: [{id, display_name, gender, languages: [...]}]}
            voices_payload = data.get("voices") or data
            self._voices_cache = [
                PresetVoice(
                    id=v.get("id") or v.get("voice_id") or v.get("name"),
                    name=v.get("display_name") or v.get("name") or "voice",
                    language=(v.get("languages") or [{}])[0].get("locale", "en") if isinstance(v.get("languages"), list) else "en",
                    gender=v.get("gender"),
                )
                for v in voices_payload
                if isinstance(v, dict) and (v.get("id") or v.get("voice_id") or v.get("name"))
            ]
            return list(self._voices_cache)
        except (httpx.HTTPError, ValueError) as e:
            log.warning("Speechify voices() failed: %s", e)
            return [PresetVoice(id=v, name=v) for v in self._configured_voices]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        body = {
            "input": req.text,
            "voice_id": req.voice_id,
            "model": self._model,
            "audio_format": "wav",
        }
        url = f"{self._base_url}/v1/audio/speech"
        try:
            r = self._client.post(url, json=body, headers=self._headers())
        except httpx.HTTPError as e:
            raise RuntimeError(f"Speechify request failed: {e}") from e
        if r.status_code >= 400:
            raise RuntimeError(f"Speechify {r.status_code}: {r.text[:400]}")

        payload = r.json()
        audio_b64 = payload.get("audio_data") or payload.get("audio") or ""
        if not audio_b64:
            raise RuntimeError("Speechify returned no audio_data")
        wav_bytes = base64.b64decode(audio_b64)
        return SynthOutput(
            bytes=wav_bytes,
            sample_rate=24000,
            channels=1,
            is_wav_container=True,
        )
