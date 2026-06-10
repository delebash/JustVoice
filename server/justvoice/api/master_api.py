"""POST /v1/master — apply a mastering preset to an uploaded WAV."""

from __future__ import annotations

import base64

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ..app_state import get_state
from ..audio.wav import parse_wav_header
from ..errors import bad_request, service_unavailable
from ..mastering import have_ffmpeg, master


class MasterRequest(BaseModel):
    wav_b64: str
    preset: str  # acx | inaudio | podcast | youtube
    title: str | None = None
    author: str | None = None
    book: str | None = None


router = APIRouter(tags=["mastering"])


@router.post(
    "/v1/master",
    summary="Apply a mastering preset to a WAV",
    responses={200: {"content": {"audio/mpeg": {}, "audio/aac": {}, "audio/wav": {}}}},
)
async def master_endpoint(req: MasterRequest) -> Response:
    try:
        buf = base64.b64decode(req.wav_b64)
    except Exception as e:
        raise bad_request(f"invalid base64: {e}")

    if not have_ffmpeg():
        raise service_unavailable(
            "ffmpeg not installed. Install ffmpeg + restart to use mastering."
        )

    try:
        fmt, data_off, data_size = parse_wav_header(buf)
    except ValueError as e:
        raise bad_request(str(e))

    pcm = buf[data_off : data_off + data_size]
    settings = get_state().settings.get()
    try:
        mastered = master(
            pcm,
            fmt.sample_rate,
            fmt.channels,
            preset_name=req.preset,
            presets=settings.mastering,
            title=req.title,
            author=req.author,
            book=req.book,
        )
    except Exception as e:
        raise bad_request(f"mastering: {e}")

    media = {
        "acx": "audio/mpeg",
        "inaudio": "audio/mpeg",
        "podcast": "audio/mpeg",
        "youtube": "audio/aac",
    }.get(req.preset, "audio/wav")
    return Response(content=mastered, media_type=media)
