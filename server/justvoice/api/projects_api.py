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

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
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
from ..imports import list_adapters, run_adapter
from ..imports.standard_schema import (
    AdapterListResponse,
    ImportRunResponse,
    StandardImport,
)


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


# ── Multi-adapter import pipeline ─────────────────────────────────────────
#
# Replaces the original JustWrite-only endpoint. Sources are pluggable
# (see server/justvoice/imports/) and the adapter registry produces a
# normalized StandardImport that this endpoint materializes into ORM
# rows. JustWrite is one adapter among several (csv_lines, srt,
# audacity_labels, justvoice_standard, elevenlabs-stub).
#
# Transport:
#   - Preferred: multipart/form-data { source, file, dry_run? }
#   - Legacy backward-compat for JustWrite's existing client:
#       POST /v1/projects/import?source=justwrite (raw JSON body)


_KIND_TO_PROJECT_TYPE: dict[str, str] = {
    "audiobook": "audiobook",
    "game_voicelines": "game_voicelines",
    "podcast": "podcast",
    "custom": "custom",
}


def _materialize_standard(
    standard: StandardImport,
    db: Session,
) -> tuple[Project, int, int, list[str], list[str]]:
    """Turn a StandardImport into ORM rows. Returns (project, scene_count, block_count, created_personas, reused_personas).

    Caller commits + refreshes. We only flush to get ids.
    """
    project_type = _KIND_TO_PROJECT_TYPE.get(standard.project.kind, "custom")

    p = Project(
        name=standard.project.name,
        description=standard.project.description,
        project_type=project_type,
        metadata_json=json.dumps(
            {
                "language": standard.project.language,
                "schema_version": standard.schema_version,
            }
        ),
        mastering_preset="acx" if project_type == "audiobook" else None,
        imported_from=standard.source,
    )
    db.add(p)
    db.flush()

    # Personas — reuse if (source, source_id) pair already exists.
    created_personas: list[str] = []
    reused_personas: list[str] = []
    char_to_persona_id: dict[str, str] = {}
    for char in standard.characters:
        existing = (
            db.query(Persona)
            .filter(Persona.imported_from == standard.source, Persona.imported_id == char.id)
            .first()
        )
        if existing:
            char_to_persona_id[char.id] = existing.id
            reused_personas.append(existing.id)
            continue
        bio_text = char.notes or ""
        if char.voice_hint:
            bio_text = f"{bio_text}\n\nVoice hint:\n{char.voice_hint}".strip()
        persona = Persona(
            name=char.name,
            bio=bio_text or None,
            imported_from=standard.source,
            imported_id=char.id,
            personality_enabled=bool(bio_text),
        )
        db.add(persona)
        db.flush()
        char_to_persona_id[char.id] = persona.id
        created_personas.append(persona.id)
        db.add(ProjectPersona(project_id=p.id, persona_id=persona.id))

    # Scenes + Blocks.
    total_blocks = 0
    for scene_idx, scene in enumerate(standard.scenes):
        s = Scene(
            project_id=p.id,
            position=scene_idx,
            title=scene.title,
            description=None,
            metadata_json=json.dumps(
                {
                    "kind": scene.kind,
                    "source_id": scene.id,
                    "index_one_based": scene_idx + 1,
                }
            ),
        )
        db.add(s)
        db.flush()
        for block_idx, line in enumerate(scene.lines):
            persona_id = (
                char_to_persona_id.get(line.character_id) if line.character_id else None
            )
            # delivery → direction: best-effort surface a short tag for the UI
            direction = None
            if line.delivery:
                if isinstance(line.delivery, dict):
                    direction = line.delivery.get("emotion") or line.delivery.get("style")
            db.add(
                Block(
                    scene_id=s.id,
                    position=block_idx,
                    text=line.text,
                    persona_id=persona_id,
                    direction=direction,
                )
            )
            total_blocks += 1

    return p, len(standard.scenes), total_blocks, created_personas, reused_personas


@router.get("/v1/projects/import/adapters", response_model=AdapterListResponse)
async def get_import_adapters() -> AdapterListResponse:
    """List the import adapters the UI's format picker can choose from."""
    return AdapterListResponse(adapters=list_adapters())


@router.post("/v1/projects/import", response_model=ImportRunResponse)
async def import_project(
    request: Request,
    source: Optional[str] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    dry_run: Optional[bool] = Form(default=None),
    source_q: Optional[str] = Query(default=None, alias="source"),
    dry_run_q: Optional[bool] = Query(default=None, alias="dry_run"),
    db: Session = Depends(get_db),
) -> ImportRunResponse:
    """Run an import adapter.

    Multipart shape (preferred — what ImportModal sends):
      multipart/form-data
        source   = adapter id (justwrite | csv_lines | srt | audacity_labels | justvoice_standard | elevenlabs)
        file     = the source file
        dry_run  = "true" to parse + return preview without committing

    Backwards-compatible query-string shape (JustWrite's existing client):
      POST /v1/projects/import?source=justwrite[&dry_run=true]
      Content-Type: application/json
      <raw JustWrite JSON body>
    """
    effective_source = (source or source_q or "").strip()
    if not effective_source:
        raise bad_request(
            "import: missing 'source' — pass as multipart form field or ?source= query param"
        )
    effective_dry_run = bool(dry_run if dry_run is not None else dry_run_q)

    filename: str | None = None
    raw: bytes
    if file is not None:
        raw = await file.read()
        filename = file.filename
    else:
        try:
            raw = await request.body()
        except RuntimeError:
            raw = b""
        if not raw:
            raise bad_request("import: no file uploaded and no raw request body")

    standard = run_adapter(effective_source, raw, filename=filename)

    if effective_dry_run:
        return ImportRunResponse(
            committed=False,
            project_id=None,
            standard=standard,
            warnings=standard.warnings,
        )

    project, _scene_count, _block_count, _created, _reused = _materialize_standard(
        standard, db
    )
    db.commit()
    db.refresh(project)
    standard.project.id = project.id
    return ImportRunResponse(
        committed=True,
        project_id=project.id,
        standard=standard,
        warnings=standard.warnings,
    )
