# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/projects — Books, game-voicelines, podcasts, custom projects.

Use-case-generalized Project → Scene → Block model from DESIGN_FREEZE §4.4.
Audiobook = chapters + paragraphs; game = dialogue trees + NPC lines;
podcast = episodes + segments. Same data model, different metadata +
export pipelines.

Also: POST /v1/projects/import?source=justwrite ingests a JustWrite book
JSON and auto-creates Project + Scenes + Blocks + Personas.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional, Literal, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import (
    Project,
    ProjectPersona,
    Scene,
    Block,
    Persona,
    get_db,
)
from ..errors import not_found, bad_request


router = APIRouter(tags=["projects"])


ProjectType = Literal["audiobook", "game_voicelines", "podcast", "custom"]


# ── Response shapes ──────────────────────────────────────────────────────


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    project_type: ProjectType
    metadata: dict
    default_lexicon_id: Optional[str]
    mastering_preset: Optional[str]
    imported_from: Optional[str]
    scene_count: int = 0
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm(cls, row: Project, scene_count: int = 0) -> "ProjectResponse":
        return cls(
            id=row.id,
            name=row.name,
            description=row.description,
            project_type=row.project_type,  # type: ignore
            metadata=json.loads(row.metadata_json or "{}"),
            default_lexicon_id=row.default_lexicon_id,
            mastering_preset=row.mastering_preset,
            imported_from=row.imported_from,
            scene_count=scene_count,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


class ProjectList(BaseModel):
    projects: list[ProjectResponse]


class SceneResponse(BaseModel):
    id: str
    project_id: str
    position: int
    title: Optional[str]
    description: Optional[str]
    metadata: dict
    block_count: int = 0
    created_at: datetime

    @classmethod
    def from_orm(cls, row: Scene, block_count: int = 0) -> "SceneResponse":
        return cls(
            id=row.id,
            project_id=row.project_id,
            position=row.position,
            title=row.title,
            description=row.description,
            metadata=json.loads(row.metadata_json or "{}"),
            block_count=block_count,
            created_at=row.created_at,
        )


class BlockResponse(BaseModel):
    id: str
    scene_id: str
    position: int
    text: str
    persona_id: Optional[str]
    direction: Optional[str]
    metadata: dict
    created_at: datetime

    @classmethod
    def from_orm(cls, row: Block) -> "BlockResponse":
        return cls(
            id=row.id,
            scene_id=row.scene_id,
            position=row.position,
            text=row.text,
            persona_id=row.persona_id,
            direction=row.direction,
            metadata=json.loads(row.metadata_json or "{}"),
            created_at=row.created_at,
        )


class CastEntry(BaseModel):
    persona_id: str
    role_label: Optional[str]


class CastResponse(BaseModel):
    cast: list[CastEntry]


# ── Request shapes ──────────────────────────────────────────────────────


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    project_type: ProjectType
    metadata: dict = Field(default_factory=dict)
    default_lexicon_id: Optional[str] = None
    mastering_preset: Optional[str] = None


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    metadata: Optional[dict] = None
    default_lexicon_id: Optional[str] = None
    mastering_preset: Optional[str] = None


class CreateSceneRequest(BaseModel):
    position: int = 0
    title: Optional[str] = None
    description: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class CreateBlockRequest(BaseModel):
    position: int = 0
    text: str = Field(..., min_length=1)
    persona_id: Optional[str] = None
    direction: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class UpdateBlockRequest(BaseModel):
    position: Optional[int] = None
    text: Optional[str] = None
    persona_id: Optional[str] = None
    direction: Optional[str] = None
    metadata: Optional[dict] = None


class CastAssignRequest(BaseModel):
    persona_id: str
    role_label: Optional[str] = None


# ── Project CRUD ─────────────────────────────────────────────────────────


@router.get("/v1/projects", response_model=ProjectList)
async def list_projects(
    project_type: Optional[ProjectType] = None, db: Session = Depends(get_db)
) -> ProjectList:
    q = db.query(Project)
    if project_type is not None:
        q = q.filter(Project.project_type == project_type)
    rows = q.order_by(Project.created_at.desc()).all()
    return ProjectList(
        projects=[
            ProjectResponse.from_orm(
                row, scene_count=db.query(Scene).filter(Scene.project_id == row.id).count()
            )
            for row in rows
        ]
    )


@router.post("/v1/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    body: CreateProjectRequest, db: Session = Depends(get_db)
) -> ProjectResponse:
    p = Project(
        name=body.name,
        description=body.description,
        project_type=body.project_type,
        metadata_json=json.dumps(body.metadata),
        default_lexicon_id=body.default_lexicon_id,
        mastering_preset=body.mastering_preset,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return ProjectResponse.from_orm(p)


@router.get("/v1/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, db: Session = Depends(get_db)) -> ProjectResponse:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise not_found(f"project {project_id}")
    return ProjectResponse.from_orm(
        p, scene_count=db.query(Scene).filter(Scene.project_id == p.id).count()
    )


@router.patch("/v1/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str, body: UpdateProjectRequest, db: Session = Depends(get_db)
) -> ProjectResponse:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise not_found(f"project {project_id}")
    if body.name is not None:
        p.name = body.name
    if body.description is not None:
        p.description = body.description
    if body.metadata is not None:
        p.metadata_json = json.dumps(body.metadata)
    if body.default_lexicon_id is not None:
        p.default_lexicon_id = body.default_lexicon_id
    if body.mastering_preset is not None:
        p.mastering_preset = body.mastering_preset
    db.commit()
    db.refresh(p)
    return ProjectResponse.from_orm(p)


@router.delete("/v1/projects/{project_id}")
async def delete_project(project_id: str, db: Session = Depends(get_db)) -> dict:
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise not_found(f"project {project_id}")
    db.delete(p)
    db.commit()
    return {"deleted": True}


# ── Scene CRUD ───────────────────────────────────────────────────────────


@router.get("/v1/projects/{project_id}/scenes", response_model=list[SceneResponse])
async def list_scenes(project_id: str, db: Session = Depends(get_db)) -> list[SceneResponse]:
    if not db.query(Project).filter(Project.id == project_id).first():
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    )
    return [
        SceneResponse.from_orm(
            s, block_count=db.query(Block).filter(Block.scene_id == s.id).count()
        )
        for s in scenes
    ]


@router.post("/v1/projects/{project_id}/scenes", response_model=SceneResponse, status_code=201)
async def create_scene(
    project_id: str, body: CreateSceneRequest, db: Session = Depends(get_db)
) -> SceneResponse:
    if not db.query(Project).filter(Project.id == project_id).first():
        raise not_found(f"project {project_id}")
    s = Scene(
        project_id=project_id,
        position=body.position,
        title=body.title,
        description=body.description,
        metadata_json=json.dumps(body.metadata),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return SceneResponse.from_orm(s)


@router.get("/v1/scenes/{scene_id}/blocks", response_model=list[BlockResponse])
async def list_blocks(scene_id: str, db: Session = Depends(get_db)) -> list[BlockResponse]:
    if not db.query(Scene).filter(Scene.id == scene_id).first():
        raise not_found(f"scene {scene_id}")
    blocks = db.query(Block).filter(Block.scene_id == scene_id).order_by(Block.position).all()
    return [BlockResponse.from_orm(b) for b in blocks]


@router.post("/v1/scenes/{scene_id}/blocks", response_model=BlockResponse, status_code=201)
async def create_block(
    scene_id: str, body: CreateBlockRequest, db: Session = Depends(get_db)
) -> BlockResponse:
    if not db.query(Scene).filter(Scene.id == scene_id).first():
        raise not_found(f"scene {scene_id}")
    b = Block(
        scene_id=scene_id,
        position=body.position,
        text=body.text,
        persona_id=body.persona_id,
        direction=body.direction,
        metadata_json=json.dumps(body.metadata),
    )
    db.add(b)
    db.commit()
    db.refresh(b)
    return BlockResponse.from_orm(b)


@router.patch("/v1/blocks/{block_id}", response_model=BlockResponse)
async def update_block(
    block_id: str, body: UpdateBlockRequest, db: Session = Depends(get_db)
) -> BlockResponse:
    b = db.query(Block).filter(Block.id == block_id).first()
    if not b:
        raise not_found(f"block {block_id}")
    if body.position is not None:
        b.position = body.position
    if body.text is not None:
        b.text = body.text
    if body.persona_id is not None:
        b.persona_id = body.persona_id
    if body.direction is not None:
        b.direction = body.direction
    if body.metadata is not None:
        b.metadata_json = json.dumps(body.metadata)
    db.commit()
    db.refresh(b)
    return BlockResponse.from_orm(b)


@router.delete("/v1/blocks/{block_id}")
async def delete_block(block_id: str, db: Session = Depends(get_db)) -> dict:
    b = db.query(Block).filter(Block.id == block_id).first()
    if not b:
        raise not_found(f"block {block_id}")
    db.delete(b)
    db.commit()
    return {"deleted": True}


# ── Cast (project ↔ persona many-to-many) ────────────────────────────────


@router.get("/v1/projects/{project_id}/cast", response_model=CastResponse)
async def get_cast(project_id: str, db: Session = Depends(get_db)) -> CastResponse:
    if not db.query(Project).filter(Project.id == project_id).first():
        raise not_found(f"project {project_id}")
    rows = db.query(ProjectPersona).filter(ProjectPersona.project_id == project_id).all()
    return CastResponse(
        cast=[CastEntry(persona_id=r.persona_id, role_label=r.role_label) for r in rows]
    )


@router.post("/v1/projects/{project_id}/cast", response_model=CastResponse, status_code=201)
async def assign_to_cast(
    project_id: str, body: CastAssignRequest, db: Session = Depends(get_db)
) -> CastResponse:
    if not db.query(Project).filter(Project.id == project_id).first():
        raise not_found(f"project {project_id}")
    if not db.query(Persona).filter(Persona.id == body.persona_id).first():
        raise not_found(f"persona {body.persona_id}")
    existing = (
        db.query(ProjectPersona)
        .filter(
            ProjectPersona.project_id == project_id,
            ProjectPersona.persona_id == body.persona_id,
        )
        .first()
    )
    if existing:
        existing.role_label = body.role_label
    else:
        db.add(
            ProjectPersona(
                project_id=project_id,
                persona_id=body.persona_id,
                role_label=body.role_label,
            )
        )
    db.commit()
    return await get_cast(project_id, db)


@router.delete("/v1/projects/{project_id}/cast/{persona_id}")
async def remove_from_cast(
    project_id: str, persona_id: str, db: Session = Depends(get_db)
) -> dict:
    deleted = (
        db.query(ProjectPersona)
        .filter(
            ProjectPersona.project_id == project_id,
            ProjectPersona.persona_id == persona_id,
        )
        .delete()
    )
    db.commit()
    return {"deleted": bool(deleted)}


# ── Import (Phase 5: JustWrite → JustVoice book ingestion) ────────────────


class JustWriteCharacter(BaseModel):
    """Shape of a character in a JustWrite book export.

    JustWrite's actual export schema needs to be confirmed via Phase 5 spike
    (per DESIGN_FREEZE §3.2). This is a reasonable guess from the JustWrite
    audit summary.
    """

    id: str
    name: str
    bio: Optional[str] = None
    voice_notes: Optional[str] = None


class JustWriteBlock(BaseModel):
    text: str
    character_id: Optional[str] = None  # speaker attribution
    direction: Optional[str] = None  # emotion/style hint


class JustWriteScene(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    blocks: list[JustWriteBlock] = []


class JustWriteBookImport(BaseModel):
    name: str
    description: Optional[str] = None
    author: Optional[str] = None
    title: Optional[str] = None
    isbn: Optional[str] = None
    characters: list[JustWriteCharacter] = []
    scenes: list[JustWriteScene] = []


class JustWriteImportResult(BaseModel):
    project_id: str
    scene_count: int
    block_count: int
    persona_count: int
    created_personas: list[str]
    reused_personas: list[str]


@router.post("/v1/projects/import", response_model=JustWriteImportResult)
async def import_project(
    body: JustWriteBookImport,
    source: str = Query("justwrite", description="Source system identifier"),
    db: Session = Depends(get_db),
) -> JustWriteImportResult:
    """Import a project from JustWrite (or another supported source).

    Source values:
      - "justwrite": JustWrite book export JSON (audiobook project)
      - "unreal_uplugin" (future): Unreal game-voicelines JSON
      - "json" (generic project archive — future)
    """
    if source not in ("justwrite",):
        raise bad_request(f"Unsupported import source '{source}' for v1. Use 'justwrite'.")

    # 1. Create the Project row.
    p = Project(
        name=body.name,
        description=body.description,
        project_type="audiobook",
        metadata_json=json.dumps(
            {
                "author": body.author,
                "title": body.title,
                "isbn": body.isbn,
            }
        ),
        mastering_preset="acx",
        imported_from=source,
    )
    db.add(p)
    db.flush()  # need p.id

    # 2. Resolve / create Personas per JustWrite character.
    created_personas: list[str] = []
    reused_personas: list[str] = []
    char_to_persona_id: dict[str, str] = {}
    for char in body.characters:
        existing = (
            db.query(Persona)
            .filter(Persona.imported_from == "justwrite", Persona.imported_id == char.id)
            .first()
        )
        if existing:
            char_to_persona_id[char.id] = existing.id
            reused_personas.append(existing.id)
            continue
        bio_text = char.bio or ""
        if char.voice_notes:
            bio_text = f"{bio_text}\n\nVoice notes:\n{char.voice_notes}".strip()
        persona = Persona(
            name=char.name,
            bio=bio_text or None,
            imported_from="justwrite",
            imported_id=char.id,
            personality_enabled=bool(bio_text),
        )
        db.add(persona)
        db.flush()
        char_to_persona_id[char.id] = persona.id
        created_personas.append(persona.id)
        # Add to cast.
        db.add(ProjectPersona(project_id=p.id, persona_id=persona.id))

    # 3. Create Scenes (chapters) + Blocks (paragraphs).
    total_blocks = 0
    for scene_idx, scene in enumerate(body.scenes):
        s = Scene(
            project_id=p.id,
            position=scene_idx,
            title=scene.title,
            description=scene.description,
            metadata_json=json.dumps({"chapter_number": scene_idx + 1}),
        )
        db.add(s)
        db.flush()
        for block_idx, blk in enumerate(scene.blocks):
            persona_id = char_to_persona_id.get(blk.character_id) if blk.character_id else None
            db.add(
                Block(
                    scene_id=s.id,
                    position=block_idx,
                    text=blk.text,
                    persona_id=persona_id,
                    direction=blk.direction,
                )
            )
            total_blocks += 1

    db.commit()
    db.refresh(p)

    return JustWriteImportResult(
        project_id=p.id,
        scene_count=len(body.scenes),
        block_count=total_blocks,
        persona_count=len(created_personas) + len(reused_personas),
        created_personas=created_personas,
        reused_personas=reused_personas,
    )
