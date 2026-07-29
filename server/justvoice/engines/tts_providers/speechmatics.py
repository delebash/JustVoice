# SPDX-License-Identifier: MIT
"""Speechmatics TTS adapter.

Proprietary endpoint shape: POST /generate/{voice_name} with `{text}`
in the JSON body. Voices are listed at /voices. Bearer token auth.
"""

from __future__ import annotations

import logging

import httpx

from ..base import EngineMeta, PresetVoice, SynthOutput, SynthRequest

log = logging.getLogger(__name__)


DEFAULT_BASE_URL = "https://preview.tts.speechmatics.com"

# Speechmatics ships a small pinned set of voices. Listed here so the
# UI can render them even when /voices isn't reachable (sometimes the
# preview endpoint goes down without breaking /generate).
KNOWN_VOICES = ["sarah", "theo", "megan", "jack"]


class SpeechmaticsBackend:
    def __init__(
        self,
        *,
        id: str,
        name: str,
        api_key: str,
        model: str = "default",
        voices: list[str] | None = None,
        base_url: str = "",
        response_format: str = "wav",
    ):
        self.meta = EngineMeta(
            engine_id=id,
            display_name=name,
            backend="speechmatics",
            supported_runtimes=["http"],
            kind="tts",
        )
        self._api_key = api_key
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._configured_voices = voices or KNOWN_VOICES
        self._ready = False
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def load(self, device: str = "auto", model_variant: str | None = None) -> None:
        # Speechmatics has no /load semantics; treat the existence of
        # an API key as readiness.
        self._ready = bool(self._api_key)
        if not self._ready:
            raise RuntimeError("Speechmatics requires an API key")

    def unload(self) -> None:
        self._ready = False

    def ready(self) -> bool:
        return self._ready

    def voices(self) -> list[PresetVoice]:
        try:
            r = self._client.get(f"{self._base_url}/voices", headers=self._headers())
            if r.status_code < 400:
                data = r.json()
                voices_payload = data if isinstance(data, list) else data.get("voices") or []
                if voices_payload:
                    return [
                        PresetVoice(
                            id=str(v) if isinstance(v, str) else v.get("name") or v.get("id"),
                            name=v if isinstance(v, str) else v.get("name") or v.get("id"),
                        )
                        for v in voices_payload
                    ]
        except (httpx.HTTPError, ValueError) as e:
            log.warning("Speechmatics voices() failed: %s", e)
        return [PresetVoice(id=v, name=v) for v in self._configured_voices]

    def synthesize(self, req: SynthRequest) -> SynthOutput:
        # Voice goes in the URL path, not the body.
        url = f"{self._base_url}/generate/{req.voice_id}"
        body = {"text": req.text}
        try:
            r = self._client.post(url, json=body, headers=self._headers())
        except httpx.HTTPError as e:
            raise RuntimeError(f"Speechmatics request failed: {e}") from e
        if r.status_code >= 400:
            raise RuntimeError(f"Speechmatics {r.status_code}: {r.text[:400]}")
        return SynthOutput(
            bytes=r.content,
            sample_rate=24000,
            channels=1,
            is_wav_container=True,
        )
