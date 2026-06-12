"""POST /v1/render_chapter — multi-line script in, mastered chapter out.

Two modes:
  * Direct mode — `lines[]` passed literally (legacy adapter use).
  * Scene mode — `scene_id` (+ optional `preset_id`) passed; the server
    resolves blocks → personas → lines internally. Each block's persona
    contributes voice_id, default_delivery (tier-2), personality (→
    delivery.instruct for engines that consume it), and lexicon_id. The
    preset overlays on top (tier-3).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ..app_state import get_state
from ..audio.wav import write_wav_container
from ..database.models import Block, RenderPreset, Scene
from ..database import session as _db_session
from ..database.session import SessionLocal
from ..delivery_merge import merge_delivery
from ..errors import bad_request, internal, not_found
from ..mastering import have_ffmpeg, master
from ..models import ChapterLine, Delivery, RenderChapterRequest
from ..render_core import concat_lines, probe_line_cached, render_line


def _open_db():
    """SessionLocal is None until init_db() runs at boot — the module-level
    import binds the pre-init value. Resolve lazily; tests still patch
    this module's SessionLocal attribute directly."""
    factory = SessionLocal or _db_session.SessionLocal
    if factory is None:
        raise internal("database not initialized")
    return factory()

log = logging.getLogger(__name__)
router = APIRouter(tags=["generation"])


def _resolve_scene_to_lines(
    scene_id: str,
    preset_id: str | None,
    st,
) -> tuple[list[ChapterLine], list[str]]:
    """Resolve a scene's blocks → ChapterLines via persona lookup.

    Each block becomes one ChapterLine. The persona contributes voice,
    tier-2 delivery overlay, personality (→ delivery.instruct), and
    lexicon. The preset (tier-3) overlays on top via merge_delivery.

    Returns (lines, lexicon_ids). Raises if the scene has no blocks or
    any block lacks a usable voice.
    """
    db = _open_db()
    try:
        scene = db.query(Scene).filter(Scene.id == scene_id).first()
        if scene is None:
            raise not_found(f"scene {scene_id}")
        blocks = (
            db.query(Block)
            .filter(Block.scene_id == scene_id)
            .order_by(Block.position)
            .all()
        )
        if not blocks:
            raise bad_request(f"scene {scene_id} has no blocks to render")

        preset = None
        if preset_id:
            preset = db.query(RenderPreset).filter(RenderPreset.id == preset_id).first()
            if preset is None:
                log.warning("render_chapter: preset %s not found, ignoring", preset_id)

        lines: list[ChapterLine] = []
        lexicon_ids: set[str] = set()
        skipped = 0

        for block in blocks:
            if not block.text or not block.text.strip():
                continue

            voice_id: str | None = None
            tier2: dict = {}
            personality: str | None = None

            if block.persona_id:
                persona = st.personas.get(block.persona_id)
                if persona is not None:
                    voice_id = persona.voice_id
                    tier2 = persona.default_delivery or {}
                    personality = (persona.personality or "").strip() or None
                    if persona.lexicon_id:
                        lexicon_ids.add(persona.lexicon_id)

            if not voice_id:
                # No persona / no voice → skip this block. Studio Cast
                # tab is the place to bind voices; rendering silently
                # skips unbound blocks rather than failing the chapter.
                # DEBUG, not WARNING: this resolver also serves the
                # read-only cache-stats probe, which Home/Studio hit on
                # every visit — per-block WARNING spam there read as
                # "the app renders when I click Home" (user-hit).
                skipped += 1
                log.debug("scene resolve: block %s has no voice — excluded", block.id)
                continue

            merged = merge_delivery(
                request_delivery={},
                preset_id=preset_id,
                db=db,
                tier2_overlay=tier2,
            )
            if personality and not merged.get("instruct"):
                merged["instruct"] = personality

            lines.append(
                ChapterLine(
                    voice=voice_id,
                    text=block.text,
                    delivery=Delivery(**{k: v for k, v in merged.items() if k in Delivery.model_fields}),
                )
            )

        if skipped and lines:
            log.info(
                "scene %s: %d of %d blocks have no voice and were excluded",
                scene_id, skipped, skipped + len(lines),
            )
        if not lines:
            raise bad_request(
                f"scene {scene_id} has blocks but none could be rendered "
                f"(no persona/voice assigned). Open Studio Cast tab to assign voices."
            )

        return lines, list(lexicon_ids)
    finally:
        db.close()


class SceneCacheStats(BaseModel):
    scene_id: str
    title: str
    total: int
    cached: int


class RenderCacheStatsResponse(BaseModel):
    project_id: str
    total: int
    cached: int
    scenes: list[SceneCacheStats]


@router.get(
    "/v1/render/cache-stats",
    response_model=RenderCacheStatsResponse,
    summary="How much of a project's next render is already cached",
)
async def render_cache_stats(project_id: str) -> RenderCacheStatsResponse:
    """Per-scene cache coverage — the Studio Render banner ("412 of 583
    lines unchanged since last render"). Probes each block's cache key
    exactly as render_line would; no audio is produced, no engine loads."""
    db = _open_db()
    try:
        scenes = (
            db.query(Scene)
            .filter(Scene.project_id == project_id)
            .order_by(Scene.position)
            .all()
        )
    finally:
        db.close()
    if not scenes:
        raise not_found(f"project {project_id} has no scenes")
    st = get_state()

    out: list[SceneCacheStats] = []
    grand_total = grand_cached = 0
    for scene in scenes:
        try:
            lines, scene_lexicons = _resolve_scene_to_lines(scene.id, None, st)
        except Exception:
            out.append(SceneCacheStats(scene_id=scene.id, title=scene.title or "", total=0, cached=0))
            continue
        cached = 0
        for line in lines:
            hit = probe_line_cached(
                st,
                line.voice,
                line.text,
                language=line.language,
                delivery=line.delivery.model_dump(exclude_none=True) if line.delivery else {},
                seed=line.seed,
                lexicons=scene_lexicons,
                cache_scope=f"scene:{scene.id}",
            )
            if hit:
                cached += 1
        out.append(SceneCacheStats(scene_id=scene.id, title=scene.title or "", total=len(lines), cached=cached))
        grand_total += len(lines)
        grand_cached += cached
    return RenderCacheStatsResponse(
        project_id=project_id, total=grand_total, cached=grand_cached, scenes=out,
    )


@router.post(
    "/v1/render_chapter",
    summary="Render a multi-line chapter → mastered audio",
    responses={200: {"content": {"audio/wav": {}, "audio/mpeg": {}, "audio/aac": {}}}},
)
async def render_chapter(req: RenderChapterRequest) -> Response:
    st = get_state()
    settings = st.settings.get()

    # Scene mode — resolve blocks → personas → lines on the server.
    cache_scope = req.cache_scope
    if req.scene_id and not req.lines:
        lines, scene_lexicons = _resolve_scene_to_lines(req.scene_id, req.preset_id, st)
        merged_lexicons = list({*req.lexicons, *scene_lexicons})
        # Scene renders share one per-scene cache scope with the QC/M4B
        # assembly path (render_scene_to_wav) and the cache-stats probe —
        # otherwise the same audio caches twice and the banner lies.
        if cache_scope == "default":
            cache_scope = f"scene:{req.scene_id}"
    else:
        lines = req.lines
        merged_lexicons = req.lexicons

    if not lines:
        raise bad_request("lines must not be empty (or pass scene_id)")
    if len(lines) > settings.limits.chapter_max_lines:
        raise bad_request(
            f"lines count {len(lines)} > limit {settings.limits.chapter_max_lines}"
        )

    rendered = []
    for line in lines:
        rl = render_line(
            st,
            voice=line.voice,
            text=line.text,
            language=line.language,
            delivery=line.delivery.model_dump(exclude_none=True) if line.delivery else None,
            seed=line.seed,
            lexicons=merged_lexicons,
            cache_scope=cache_scope,
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

def render_scene_to_wav(st, scene_id: str) -> bytes:
    """Scene → mastered-input WAV bytes for audiobook assembly.

    Same resolution + render path as scene-mode /v1/render_chapter, raw
    WAV out (no per-chapter master — the M4B/QC layer owns loudness).
    """
    lines, scene_lexicons = _resolve_scene_to_lines(scene_id, None, st)
    rendered = []
    for line in lines:
        rl = render_line(
            st,
            voice=line.voice,
            text=line.text,
            language=line.language,
            delivery=line.delivery.model_dump(exclude_none=True) if line.delivery else None,
            seed=line.seed,
            lexicons=scene_lexicons,
            cache_scope=f"scene:{scene_id}",
            use_cache=True,
        )
        rendered.append(rl)
    combined = concat_lines(rendered, silence_ms=600)
    return write_wav_container(combined.pcm, combined.sample_rate, combined.channels)

