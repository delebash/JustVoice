# SPDX-License-Identifier: MIT
"""Game voiceline export — per-line WAVs named by stable line id + manifest.

The game build consumes audio BY LINE ID (mock #game/6, CONCEPTS §1):
    EmberfallVO/
      q01-ashfall/
        Q01_HALE_001.wav
        ...
      manifest.json        ← one diffable entry per line

Rendering reuses the production scene resolution (persona → voice /
delivery / lexicon, after the book's own lexicon), one line at a time so
each WAV is exactly one block.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import zipfile

from .database import session as db_session
from .api._speaker_helpers import persona_for_block
from .database.models import Block, Scene, Speaker

log = logging.getLogger(__name__)


def _slug(text: str, fallback: str = "scene") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s or fallback


def _line_id(block: Block, scene_idx: int, pos: int) -> str:
    if block.metadata_json:
        try:
            ref = json.loads(block.metadata_json).get("source_ref")
            if ref:
                return str(ref)
        except json.JSONDecodeError:
            pass
    return f"s{scene_idx + 1:02d}_l{pos + 1:03d}"


def _wav_duration_s(wav: bytes) -> float:
    import wave

    with wave.open(io.BytesIO(wav), "rb") as r:
        return r.getnframes() / (r.getframerate() or 1)


def export_voicelines(state, project_id: str, *, render_block_fn=None) -> bytes:
    """Render every block to its own WAV; return the zip bytes.

    `render_block_fn(state, persona, block) -> bytes` is the test seam;
    production uses render_core.render_line + the persona's delivery and the
    line's lexicons, matching the Studio render path.
    """
    if render_block_fn is None:
        render_block_fn = _render_block_production

    db = db_session.SessionLocal()
    try:
        scenes = (
            db.query(Scene)
            .filter(Scene.project_id == project_id)
            .order_by(Scene.position)
            .all()
        )
        manifest: list[dict] = []
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for si, scene in enumerate(scenes):
                group = _slug(scene.title or f"scene-{si + 1}")
                blocks = (
                    db.query(Block)
                    .filter(Block.scene_id == scene.id)
                    .order_by(Block.position)
                    .all()
                )
                for bi, block in enumerate(blocks):
                    speaker = db.get(Speaker, block.speaker_id) if block.speaker_id else None
                    persona = persona_for_block(db, block)
                    lid = _line_id(block, si, bi)
                    wav = render_block_fn(state, persona, block)
                    path = f"{group}/{lid}.wav"
                    zf.writestr(path, wav)
                    manifest.append(
                        {
                            "line_id": lid,
                            "scene": scene.title,
                            "speaker": speaker.name if speaker else None,
                            "text": block.text,
                            "file": path,
                            "duration_s": round(_wav_duration_s(wav), 3),
                            "text_hash": hashlib.sha256(block.text.encode()).hexdigest()[:16],
                        }
                    )
            zf.writestr(
                "manifest.json",
                json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            )
        return buf.getvalue()
    finally:
        db.close()


def _book_lexicon_id(scene_id: str) -> str | None:
    """The lexicon chosen for the book this scene belongs to (Overview →
    Pronunciation lexicon). Its own short session: the single-line door runs
    on scheduler threads, on plain copies of the rows (render_jobs)."""
    from .database.models import Project

    db = db_session.SessionLocal()
    try:
        row = (
            db.query(Project.default_lexicon_id)
            .join(Scene, Scene.project_id == Project.id)
            .filter(Scene.id == scene_id)
            .first()
        )
        return row[0] if row else None
    finally:
        db.close()


def _render_block_production(state, persona, block) -> bytes:
    """One block → one WAV through the production render path.

    The same resolver the chapter render uses (persona_render.plan_line,
    2026-10-03): the persona's voice and model settings, the direction —
    its standing delivery, emotion and the block's own — its language and
    seed, its effects, and the book's lexicon then its own. Until then this
    door sent the persona's raw delivery and dropped the direction, so a
    Lines ↻, a take or the game export spoke differently from the chapter.
    """
    from .audio.wav import write_wav_container
    from .errors import bad_request
    from .persona_render import plan_line
    from .render_core import render_line

    store_p = state.personas.get(persona.id) if persona is not None else None
    if store_p is None or not store_p.voice_id:
        who = f"the persona {persona.name}" if persona is not None else "no persona"
        raise bad_request(
            f"line {block.id} has no voice ({who}) — give every speaker a persona with a voice "
            f"before exporting"
        )
    plan = plan_line(
        state, store_p, text=block.text,
        direction=getattr(block, "direction", None),
        book_lexicon=_book_lexicon_id(block.scene_id),
    )
    rl = render_line(
        state,
        voice=plan.voice,
        text=plan.text,
        language=plan.language,
        delivery=plan.delivery,
        seed=plan.seed,
        lexicons=plan.lexicons,
        effects=plan.effects,
        cache_scope=f"scene:{block.scene_id}",
        use_cache=True,
    )
    return write_wav_container(rl.pcm, rl.sample_rate, rl.channels)


def collect_block_specs(state, project_id: str):
    """(engine_id, render-callable) per voiced block in scene order — the
    whole-project warm set for the scheduler (§7 of the 2026-08-08 plan).
    Returns [] the moment an unvoiced block appears: the export loop raises
    on that block, so warming past it would render audio the export never
    reaches."""
    from .voice_model import model_key

    db = db_session.SessionLocal()
    try:
        scenes = (
            db.query(Scene)
            .filter(Scene.project_id == project_id)
            .order_by(Scene.position)
            .all()
        )
        specs = []
        for scene in scenes:
            blocks = (
                db.query(Block)
                .filter(Block.scene_id == scene.id)
                .order_by(Block.position)
                .all()
            )
            for block in blocks:
                persona = persona_for_block(db, block)
                voice = None
                if persona is not None:
                    store_p = state.personas.get(persona.id)
                    if store_p is not None:
                        voice = store_p.voice_id or None
                if not voice:
                    return []
                engine_id = model_key(state, voice) if voice else f"?voice:{voice}"
                specs.append(
                    (engine_id, lambda p=persona, b=block: _render_block_production(state, p, b))
                )
        return specs
    finally:
        db.close()
