# SPDX-License-Identifier: MIT
"""/v1/align + chapter captions — word-level timestamps (C1, 2026-08-21).

The route: rendered audio + the KNOWN text → per-word times. Whisper
transcribes with token timestamps (whisper/engine.py `align`), the host
maps that hypothesis onto the real words (justvoice.alignment — knowing
the text is what makes this forced alignment: an ASR misread never loses
a word's timing), and captions.py formats the result as WebVTT or SRT.

Engine-agnostic by construction — it measures the finished audio, so it
works identically for every TTS engine, which is strictly more than
Kokoro-FastAPI's Kokoro-only timestamps.

Accuracy honest-note (research in the 2026-08-21 plan doc §3): Whisper
cross-attention timing carries roughly ±100 ms of jitter — right for
read-along highlighting and captions, not for frame-exact editing.
"""

from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response

from ..alignment import align_known_text
from ..app_state import get_state
from ..captions import to_srt, to_vtt
from ..errors import bad_request

log = logging.getLogger(__name__)

router = APIRouter(tags=["align"])


def _align_wav_bytes(wav: bytes, text: str, language: str | None) -> list[dict]:
    """WAV + known text → [{word,start,end}], via the stt slot."""
    from .captures_api import ensure_stt_loaded

    mgr, settings = ensure_stt_loaded()
    lang = language or settings.captures.language
    hyp = mgr.align(
        {
            "wav_b64": base64.b64encode(wav).decode(),
            "text": text,
            "language": None if lang in ("", "auto") else lang,
        }
    )
    duration = _wav_seconds(wav)
    return align_known_text(text, hyp, total_duration=duration)


def _wav_seconds(wav: bytes) -> float | None:
    try:
        from ..audio.wav import parse_wav_header

        fmt, _off, _size = parse_wav_header(wav)
        return fmt.duration_sec
    except Exception:
        return None


@router.post("/v1/align", summary="Word timings for known text in an audio file")
async def align_audio(
    file: UploadFile = File(...),
    text: str = Form(...),
    language: str | None = Form(None),
) -> dict:
    """Upload audio + the text it speaks → when each word is spoken.

    Returns {"words": [{word, start, end}]} with seconds, one entry per
    word of `text`, in order.
    """
    from .captures_api import _MAX_UPLOAD_MB

    if not text.strip():
        raise bad_request("text must not be empty — alignment needs the spoken words")
    wav = await file.read()
    if len(wav) > _MAX_UPLOAD_MB * 1024 * 1024:
        raise bad_request(f"upload exceeds {_MAX_UPLOAD_MB} MB")
    try:
        words = _align_wav_bytes(wav, text.strip(), language)
    except RuntimeError as e:
        raise bad_request(str(e))
    return {"words": words}


@router.get(
    "/v1/scenes/{scene_id}/captions",
    summary="Captions for a rendered chapter (VTT or SRT)",
)
def scene_captions(scene_id: str, format: str = "vtt") -> Response:
    """Render the chapter (cache-warm lines render instantly), align every
    word, and return a caption file. `format` is `vtt` or `srt`.

    Sync def on purpose — the render + alignment are long, threadpool-run.
    """
    if format not in ("vtt", "srt"):
        raise bad_request("format must be vtt or srt")

    from .render_chapter_api import _resolve_scene_to_lines, render_scene_to_wav

    st = get_state()
    # No blanket except: the resolver already raises the honest answers
    # (404 for a missing scene, 400 for an empty one) — wrapping them as
    # "not found" masked real errors as missing scenes (review R5).
    lines, _lexicons = _resolve_scene_to_lines(scene_id, None, st, strict=False)
    text = " ".join((line.text or "").strip() for line in lines if (line.text or "").strip())
    if not text:
        raise bad_request("this chapter has no renderable lines to caption")

    wav = render_scene_to_wav(st, scene_id, strict=False, master=True)
    try:
        words = _align_wav_bytes(wav, text, None)
    except RuntimeError as e:
        raise bad_request(str(e))

    body = to_vtt(words) if format == "vtt" else to_srt(words)
    media = "text/vtt" if format == "vtt" else "application/x-subrip"
    return Response(
        content=body,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="chapter-{scene_id}.{format}"'
        },
    )
