# SPDX-License-Identifier: MIT
"""/v1/projects/{id}/export — per-project ZIP for machine migration + handoff.

Different from /v1/backup (whole-server disaster recovery): export bundles
a single project's data (Scenes + Blocks + Cast + Lexicons + rendered audio
+ masters) so a producer can hand off a book to an author for review or
move it between studio + travel laptops.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import (
    Project,
    ProjectPersona,
    Scene,
    Block,
    Persona,
    Lexicon,
    LexiconEntry,
    Generation,
    Take,
    get_db,
)
from ..errors import not_found
from ..media_paths import media_file
from ..version import VERSION


router = APIRouter(tags=["projects"])


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9-_]+", "-", name).strip("-")
    return s.lower() or "project"


@router.get("/v1/projects/{project_id}/export")
async def export_project(
    project_id: str,
    include_audio: bool = True,
    include_masters: bool = True,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise not_found(f"project {project_id}")

    scenes = (
        db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    )
    persona_ids = [r.persona_id for r in db.query(ProjectPersona).filter(ProjectPersona.project_id == project_id).all()]
    personas = db.query(Persona).filter(Persona.id.in_(persona_ids)).all() if persona_ids else []
    lexicon_ids = {project.default_lexicon_id} | {p.lexicon_id for p in personas}
    lexicon_ids.discard(None)
    lexicons = db.query(Lexicon).filter(Lexicon.id.in_(lexicon_ids)).all() if lexicon_ids else []

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # project.json
        zf.writestr(
            "project.json",
            json.dumps(
                {
                    "id": project.id,
                    "name": project.name,
                    "description": project.description,
                    "project_type": project.project_type,
                    "metadata": json.loads(project.metadata_json or "{}"),
                    "mastering_preset": project.mastering_preset,
                    "default_lexicon_id": project.default_lexicon_id,
                    "scene_count": len(scenes),
                },
                indent=2,
            ),
        )

        # scenes/*.json with embedded blocks
        for scene in scenes:
            blocks = (
                db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
            )
            scene_payload = {
                "id": scene.id,
                "position": scene.position,
                "title": scene.title,
                "description": scene.description,
                "metadata": json.loads(scene.metadata_json or "{}"),
                "blocks": [
                    {
                        "id": b.id,
                        "position": b.position,
                        "text": b.text,
                        "persona_id": b.persona_id,
                        "direction": b.direction,
                        "metadata": json.loads(b.metadata_json or "{}"),
                    }
                    for b in blocks
                ],
            }
            zf.writestr(f"scenes/{scene.position:03d}-{_slugify(scene.title or scene.id)}.json", json.dumps(scene_payload, indent=2))

        # cast/<persona_id>.json
        for persona in personas:
            zf.writestr(
                f"cast/{persona.id}.json",
                json.dumps(
                    {
                        "id": persona.id,
                        "name": persona.name,
                        "bio": persona.bio,
                        "language": persona.language,
                        "voice_id": persona.voice_id,
                        "personality": persona.personality,
                        "engine_override": persona.engine_override,
                        "lexicon_id": persona.lexicon_id,
                    },
                    indent=2,
                ),
            )

        # lexicons/<id>.json
        for lex in lexicons:
            entries = db.query(LexiconEntry).filter(LexiconEntry.lexicon_id == lex.id).all()
            zf.writestr(
                f"lexicons/{lex.id}.json",
                json.dumps(
                    {
                        "id": lex.id,
                        "name": lex.name,
                        "description": lex.description,
                        "scope": lex.scope,
                        "entries": [
                            {
                                "word": e.word,
                                "pronunciation": e.pronunciation,
                                "notation": e.notation,
                                "notes": e.notes,
                            }
                            for e in entries
                        ],
                    },
                    indent=2,
                ),
            )

        # audio/<scene_pos>/<block_pos>.wav (the default-take per block)
        if include_audio:
            for scene in scenes:
                blocks = (
                    db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
                )
                for block in blocks:
                    # Resolve the default take for this block.
                    take = (
                        db.query(Take)
                        .filter(Take.block_id == block.id, Take.is_default == True)  # noqa: E712
                        .first()
                    )
                    if take is None:
                        continue
                    gen = (
                        db.query(Generation)
                        .filter(Generation.id == take.generation_id)
                        .first()
                    )
                    if gen is None or not gen.audio_path:
                        continue
                    audio_path = media_file(gen.audio_path)
                    if not audio_path.is_file():
                        continue
                    arc = f"audio/{scene.position:03d}/{block.position:04d}-{block.id}.wav"
                    zf.write(audio_path, arc)

        # manifest.json (last so it includes the file count)
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "schema_version": "1",
                    "server_version": VERSION,
                    "project_id": project.id,
                    "exported_at": datetime.now(timezone.utc).isoformat(),
                    "scene_count": len(scenes),
                    "persona_count": len(personas),
                    "lexicon_count": len(lexicons),
                    "include_audio": include_audio,
                    "include_masters": include_masters,
                },
                indent=2,
            ),
        )

    buf.seek(0)
    bytes_out = buf.getvalue()
    slug = _slugify(project.name)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"{slug}-{ts}.zip"
    return StreamingResponse(
        iter([bytes_out]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(bytes_out)),
        },
    )
