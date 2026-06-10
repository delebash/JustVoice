# SPDX-License-Identifier: GPL-3.0-or-later
"""Online STT adapter — openai-compatible transcription endpoints.

Slice E (plan D4): posts captured audio as multipart form data to
``{base_url}/audio/transcriptions`` (the OpenAI shape — also served by
Groq, Fireworks, and self-hosted whisper servers like faster-whisper).
No local model, no load gate: readiness is just base_url + key.
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

import httpx

from ..models import ExternalSTTProviderConfig

log = logging.getLogger(__name__)

REQUEST_TIMEOUT_S = 120.0


class ExternalSTTError(RuntimeError):
    """Transcription via an online provider failed (network / HTTP / shape)."""


def transcribe_external(
    cfg: ExternalSTTProviderConfig,
    audio_path: str,
    language: str | None = None,
) -> str:
    if not cfg.base_url:
        raise ExternalSTTError(
            f"STT provider {cfg.id!r} has no base_url configured — "
            "edit it on the Engines → STT tab."
        )
    path = Path(audio_path)
    if not path.is_file():
        raise ExternalSTTError(f"audio file not found: {audio_path}")

    url = cfg.base_url.rstrip("/") + "/audio/transcriptions"
    headers = {}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"

    mime = mimetypes.guess_type(path.name)[0] or "audio/wav"
    data: dict[str, str] = {"model": cfg.model or "whisper-1"}
    if language:
        data["language"] = language

    try:
        with path.open("rb") as fh:
            resp = httpx.post(
                url,
                headers=headers,
                data=data,
                files={"file": (path.name, fh, mime)},
                timeout=REQUEST_TIMEOUT_S,
            )
    except httpx.HTTPError as e:
        raise ExternalSTTError(f"STT provider {cfg.id!r} unreachable: {e}") from e

    if resp.status_code != 200:
        raise ExternalSTTError(
            f"STT provider {cfg.id!r} returned {resp.status_code}: {resp.text[:300]}"
        )
    try:
        text = resp.json().get("text", "")
    except ValueError as e:
        raise ExternalSTTError(
            f"STT provider {cfg.id!r} returned a non-JSON body"
        ) from e
    return (text or "").strip()
