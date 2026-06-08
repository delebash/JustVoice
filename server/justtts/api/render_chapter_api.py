"""POST /v1/render_chapter — multi-line script in, mastered chapter out."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Response

from ..app_state import get_state
from ..audio.wav import write_wav_container
from ..errors import bad_request, internal
from ..mastering import have_ffmpeg, master
from ..models import RenderChapterRequest
from ..render_core import concat_lines, render_line

log = logging.getLogger(__name__)
router = APIRouter(tags=["generation"])


@router.post(
    "/v1/render_chapter",
    summary="Render a multi-line chapter → mastered audio",
    responses={200: {"content": {"audio/wav": {}, "audio/mpeg": {}, "audio/aac": {}}}},
)
async def render_chapter(req: RenderChapterRequest) -> Response:
    st = get_state()
    settings = st.settings.get()

    if not req.lines:
        raise bad_request("lines must not be empty")
    if len(req.lines) > settings.limits.chapter_max_lines:
        raise bad_request(
            f"lines count {len(req.lines)} > limit {settings.limits.chapter_max_lines}"
        )

    rendered = []
    for line in req.lines:
        rl = render_line(
            st,
            voice=line.voice,
            text=line.text,
            language=line.language,
            delivery=line.delivery.model_dump(exclude_none=True) if line.delivery else None,
            seed=line.seed,
            lexicons=req.lexicons,
            cache_scope=req.cache_scope,
            use_cache=True,
        )
        rendered.append(rl)

    combined = concat_lines(rendered, silence_ms=req.between_lines.silence_ms)

    # No mastering — return raw WAV
    if not req.master or req.master == "none":
        wav = write_wav_container(combined.pcm, combined.sample_rate, combined.channels)
        return Response(content=wav, media_type="audio/wav")

    # Mastering
    if not have_ffmpeg():
        raise internal(
            "ffmpeg is not installed. Install ffmpeg + restart the server to use mastering presets."
        )
    try:
        mastered = master(
            combined.pcm,
            combined.sample_rate,
            combined.channels,
            preset_name=req.master,
            presets=settings.mastering,
            title=req.title,
            author=req.author,
            book=req.book,
        )
    except Exception as e:
        raise internal(f"mastering: {e}")

    media_map = {
        "acx": "audio/mpeg",
        "inaudio": "audio/mpeg",
        "podcast": "audio/mpeg",
        "youtube": "audio/aac",
    }
    return Response(content=mastered, media_type=media_map.get(req.master, "audio/wav"))
