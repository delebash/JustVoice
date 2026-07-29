# SPDX-License-Identifier: MIT
"""Game voiceline export — per-line WAVs named by stable line id + manifest.

The game build consumes audio BY LINE ID (mock #game/6, CONCEPTS §1):
    EmberfallVO/
      q01-ashfall/
        Q01_HALE_001.wav
        ...
      manifest.json        ← one diffable entry per line

Rendering reuses the production scene resolution (persona → voice /
delivery / lexicon), one line at a time so each WAV is exactly one block.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import zipfile

from .database import session as db_session
from .database.models import Block, Persona, Scene

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

    `render_block_fn(state, voice_id, text, persona) -> bytes` is the
    test seam; production uses render_core.render_line + the persona's
    delivery/lexicon, matching the Studio render path.
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
                    persona = (
                        db.query(Persona).filter(Persona.id == block.persona_id).first()
                        if block.persona_id
                        else None
                    )
                    lid = _line_id(block, si, bi)
                    wav = render_block_fn(state, persona, block)
                    path = f"{group}/{lid}.wav"
                    zf.writestr(path, wav)
                    manifest.append(
                        {
                            "line_id": lid,
                            "scene": scene.title,
                            "character": persona.name if persona else None,
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


def _render_block_production(state, persona, block) -> bytes:
    """One block → one WAV through the production render path."""
    from .audio.wav import write_wav_container
    from .errors import bad_request
    from .render_core import render_line

    # Persona resolution mirrors render_chapter's scene mode: the persona
    # contributes voice + tier-2 delivery + lexicon.
    voice = None
    delivery = None
    lexicons: list[str] = []
    if persona is not None:
        store_p = state.personas.get(persona.id)
        if store_p is not None:
            voice = store_p.voice_id or None
            delivery = dict(store_p.default_delivery or {}) or None
            if store_p.lexicon_id:
                lexicons.append(store_p.lexicon_id)
    if not voice:
        who = persona.name if persona is not None else "narrator/unassigned"
        raise bad_request(
            f"block {block.id} ({who}) has no voice assigned — cast every speaker before exporting"
        )
    rl = render_line(
        state,
        voice=voice,
        text=block.text,
        delivery=delivery,
        lexicons=lexicons,
        cache_scope=f"scene:{block.scene_id}",
        use_cache=True,
    )
    return write_wav_container(rl.pcm, rl.sample_rate, rl.channels)
