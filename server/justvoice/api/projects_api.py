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
from typing import Optional, Literal

import re

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
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
from ..database.models import Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry
from ..errors import not_found, bad_request
from ..app_state import get_state
from ._persona_helpers import ensure_project_persona
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
    # Phase 3 / Slice 2 — extraction telemetry surfaced to the Studio
    # Script tab. Null on blocks created manually (source="manual" or
    # left null pre-extraction).
    extraction_confidence: Optional[float] = None
    source: Optional[str] = None
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
            extraction_confidence=row.extraction_confidence,
            source=row.source,
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
    # Phase 3 / Slice 2 — extraction telemetry. When the Studio Script
    # tab "Apply" action writes blocks from an analyze run, it passes
    # these through; manual block creation leaves them null + source="manual".
    extraction_confidence: Optional[float] = None
    source: Optional[str] = "manual"


class UpdateBlockRequest(BaseModel):
    position: Optional[int] = None
    text: Optional[str] = None
    persona_id: Optional[str] = None
    direction: Optional[str] = None
    metadata: Optional[dict] = None
    extraction_confidence: Optional[float] = None
    source: Optional[str] = None


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


class UpdateSceneRequest(BaseModel):
    title: str | None = None
    position: int | None = None


@router.patch("/v1/scenes/{scene_id}", response_model=SceneResponse)
async def update_scene(
    scene_id: str, body: UpdateSceneRequest, db: Session = Depends(get_db)
) -> SceneResponse:
    """Rename / reorder a chapter (Chapters management, 2026-06-12).
    Position moves swap with the displaced neighbor so ordering stays
    dense."""
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if not sc:
        raise not_found(f"scene {scene_id}")
    if body.title is not None:
        sc.title = body.title
    if body.position is not None and body.position != sc.position:
        other = (
            db.query(Scene)
            .filter(Scene.project_id == sc.project_id, Scene.position == body.position)
            .first()
        )
        if other:
            other.position = sc.position
        sc.position = body.position
    db.commit()
    db.refresh(sc)
    return SceneResponse.from_orm(sc)


@router.delete("/v1/scenes/{scene_id}")
async def delete_scene(scene_id: str, db: Session = Depends(get_db)) -> dict:
    """Delete a chapter and its blocks/takes (FK cascade)."""
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if not sc:
        raise not_found(f"scene {scene_id}")
    db.delete(sc)
    db.commit()
    return {"deleted": True, "scene_id": scene_id}


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
        extraction_confidence=body.extraction_confidence,
        source=body.source,
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

    # Phase 5: capture speaker corrections — when persona_id changes from
    # the existing value to a new one AND the existing value wasn't null
    # (manual reassignment, not "first assignment"), write a
    # SpeakerCorrection row for the future analyze pipeline to learn from.
    persona_id_changed = (
        body.persona_id is not None
        and b.persona_id is not None
        and body.persona_id != b.persona_id
    )

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
    if body.extraction_confidence is not None:
        b.extraction_confidence = body.extraction_confidence
    if body.source is not None:
        b.source = body.source

    if persona_id_changed:
        # Look up the parent project via the scene.
        scene = db.query(Scene).filter(Scene.id == b.scene_id).first()
        if scene:
            from ..database.models import SpeakerCorrection

            db.add(
                SpeakerCorrection(
                    project_id=scene.project_id,
                    text_snippet=b.text[:400],
                    character_id=body.persona_id,
                )
            )
            # Cap at 200 per project — drop oldest on overflow.
            existing = (
                db.query(SpeakerCorrection)
                .filter(SpeakerCorrection.project_id == scene.project_id)
                .order_by(SpeakerCorrection.created_at.desc())
                .offset(200)
                .all()
            )
            for row in existing:
                db.delete(row)

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

    # Personas — create-or-reuse via the shared dual-write helper.
    created_personas: list[str] = []
    reused_personas: list[str] = []
    char_to_persona_id: dict[str, str] = {}
    for char in standard.characters:
        bio_text = char.notes or ""
        if char.voice_hint:
            bio_text = f"{bio_text}\n\nVoice hint:\n{char.voice_hint}".strip()
        pid, created = ensure_project_persona(
            db,
            p.id,
            name=char.name,
            bio=bio_text or None,
            imported_from=standard.source,
            imported_id=char.id,
        )
        char_to_persona_id[char.id] = pid
        (created_personas if created else reused_personas).append(pid)

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
            is_marker = False
            if line.delivery:
                if isinstance(line.delivery, dict):
                    direction = line.delivery.get("emotion") or line.delivery.get("style")
                    is_marker = bool(line.delivery.get("marker"))
            # source_ref = the import's stable line id (game CSV dialogue
            # ids, epub paragraph refs) — re-imports + voiceline export key
            # on it. marker = music/ad direction lines (podcast): they're
            # legitimately speaker-less, so attribution checks skip them
            # (was dropped here → episodes showed "unassigned speakers"
            # forever).
            meta: dict = {}
            if line.source_ref:
                meta["source_ref"] = line.source_ref
            if is_marker:
                meta["marker"] = True
            db.add(
                Block(
                    scene_id=s.id,
                    position=block_idx,
                    text=line.text,
                    persona_id=persona_id,
                    direction=direction,
                    metadata_json=json.dumps(meta) if meta else None,
                )
            )
            total_blocks += 1

    return p, len(standard.scenes), total_blocks, created_personas, reused_personas


def _materialize_lexicon(
    standard: StandardImport, project: Project, db: Session
) -> str | None:
    """Create a project-scoped lexicon from the import's entries.

    Returns the new lexicon id (also written to project.default_lexicon_id),
    or None when the import carries no lexicon entries.

    Post-Phase-1.5 flip: LexiconStore reads the same rows, so this writes
    ONLY through the caller's session (one transaction with the project
    row — a separate store session would hit the FK before the project
    commits). The old dual-write is gone.
    """
    if not standard.lexicon_entries:
        return None
    import uuid as _uuid

    lex_id = f"lex_{_uuid.uuid4().hex}"
    db.add(
        DbLexicon(
            id=lex_id,
            name=f"{project.name} (imported)",
            description=f"Materialized from {standard.source} import",
            scope="project",
            project_id=project.id,
        )
    )
    for e in standard.lexicon_entries:
        db.add(
            DbLexiconEntry(
                lexicon_id=lex_id,
                word=e.grapheme,
                pronunciation=e.phoneme_ipa or e.alias or "",
                notation="ipa" if e.phoneme_ipa else "phonetic",
            )
        )
    project.default_lexicon_id = lex_id
    return lex_id


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
    project_id: Optional[str] = Form(default=None),
    project_id_q: Optional[str] = Query(default=None, alias="project_id"),
    include_scenes: Optional[str] = Form(default=None),
    # Chapter-split strategy (book_prose: auto | h1 | h1_h2 | none) —
    # the import-review "Split chapters on" selector re-runs the dry
    # run with this; adapters that don't take it ignore it.
    split_on: Optional[str] = Form(default=None),
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

    standard = run_adapter(effective_source, raw, filename=filename, split_on=split_on)

    # Per-chapter include list (import-page checkboxes): comma-separated
    # scene indices from the dry-run preview. Unlisted scenes don't
    # materialize. Dry runs ignore it — the preview always shows all.
    if include_scenes is not None and not effective_dry_run:
        try:
            keep = {int(i) for i in include_scenes.split(",") if i.strip() != ""}
        except ValueError:
            raise bad_request("import: include_scenes must be comma-separated indices")
        standard.scenes = [sc for i, sc in enumerate(standard.scenes) if i in keep]
        if not standard.scenes:
            raise bad_request("import: include_scenes excluded every chapter")

    # Update mode — re-import INTO an existing project, matching by
    # stable line ids (game workflow: writers' next CSV revision).
    effective_project_id = (project_id or project_id_q or "").strip() or None
    if effective_project_id and not effective_dry_run:
        project = db.query(Project).filter(Project.id == effective_project_id).first()
        if project is None:
            raise not_found(f"project {effective_project_id}")
        summary = _update_project_from_standard(standard, project, db)
        db.commit()
        standard.project.id = project.id
        standard.warnings.append(
            "updated in place: "
            + ", ".join(f"{k}={v}" for k, v in summary.items() if v)
        )
        return ImportRunResponse(
            committed=True,
            project_id=project.id,
            standard=standard,
            warnings=standard.warnings,
        )

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
    _materialize_lexicon(standard, project, db)
    db.commit()
    db.refresh(project)
    standard.project.id = project.id
    return ImportRunResponse(
        committed=True,
        project_id=project.id,
        standard=standard,
        warnings=standard.warnings,
    )

# ── Audiobook export + QC (mock #audiobook/7) ────────────────────────────


class ChapterQCOut(BaseModel):
    scene_id: str
    title: str
    duration_s: float
    rms_dbfs: float
    peak_dbfs: float
    rms_ok: bool
    peak_ok: bool
    ok: bool


class ProjectQCResponse(BaseModel):
    project_id: str
    chapters: list[ChapterQCOut]
    all_ok: bool
    limits: dict


@router.get("/v1/projects/{project_id}/qc", response_model=ProjectQCResponse)
async def project_qc(project_id: str, db: Session = Depends(get_db)) -> ProjectQCResponse:
    """Render every chapter (cache-served when unchanged) and run the ACX
    technical checks — RMS window + peak ceiling — per chapter."""
    from ..export_audiobook import (
        ACX_PEAK_MAX_DB,
        ACX_RMS_MAX_DB,
        ACX_RMS_MIN_DB,
        assemble_project,
        qc_report,
    )

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    chapters = assemble_project(get_state(), project_id)
    if not chapters:
        raise bad_request("project has no scenes to check")
    report = qc_report(chapters)
    out = [
        ChapterQCOut(
            scene_id=c.scene_id, title=c.title, duration_s=c.duration_s,
            rms_dbfs=c.rms_dbfs, peak_dbfs=c.peak_dbfs,
            rms_ok=c.rms_ok, peak_ok=c.peak_ok, ok=c.ok,
        )
        for c in report
    ]
    return ProjectQCResponse(
        project_id=project_id,
        chapters=out,
        all_ok=all(c.ok for c in out),
        limits={
            "rms_min_db": ACX_RMS_MIN_DB,
            "rms_max_db": ACX_RMS_MAX_DB,
            "peak_max_db": ACX_PEAK_MAX_DB,
        },
    )


@router.post("/v1/projects/{project_id}/export_m4b")
async def project_export_m4b(project_id: str, db: Session = Depends(get_db)) -> Response:
    """Assemble all chapters into one .m4b with chapter markers."""
    from fastapi import HTTPException

    from ..export_audiobook import assemble_project, have_ffmpeg, mux_m4b

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    if not have_ffmpeg():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server.",
        )
    chapters = assemble_project(get_state(), project_id)
    if not chapters:
        raise bad_request("project has no scenes to export")
    author = None
    if project.description and project.description.startswith("by "):
        author = project.description[3:]
    m4b = mux_m4b(chapters, project.name, author)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", project.name) or "book"
    return Response(
        content=m4b,
        media_type="audio/mp4",
        headers={"Content-Disposition": f'attachment; filename="{safe}.m4b"'},
    )

@router.post("/v1/projects/{project_id}/export_voicelines")
async def project_export_voicelines(
    project_id: str, db: Session = Depends(get_db)
) -> Response:
    """Game export — zip of per-line WAVs named by stable line id, grouped
    by scene, plus a diffable manifest.json (mock #game/6)."""
    from ..export_voicelines import export_voicelines

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    data = export_voicelines(get_state(), project_id)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", project.name) or "voicelines"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{safe}_VO.zip"'},
    )

# ── Game re-import (update-in-place) + line status (Phase B3/B5) ─────────


def _update_project_from_standard(
    standard: StandardImport,
    project: Project,
    db: Session,
) -> dict:
    """Update an existing project from a re-imported StandardImport,
    matching scenes by source_id and blocks by stable line id
    (source_ref). Changed text updates in place — staleness is derived
    later (block text vs latest take's generation text), so only the
    truly-changed lines lose their rendered status (CONCEPTS §3).

    Requires every incoming line to carry a source_ref; without stable
    ids an update merge would be guesswork.
    """
    for scene in standard.scenes:
        for line in scene.lines:
            if not line.source_ref or line.source_ref.startswith("row:"):
                # row:N fallbacks are positional, not stable — reordering
                # the sheet would silently mismatch every line.
                raise bad_request(
                    "update re-import requires a stable line id on every row "
                    "(id / line_id / dialogue_id column)"
                )

    # Characters create-or-reuse, as on first import.
    char_to_persona_id: dict[str, str] = {}
    for char in standard.characters:
        bio_text = char.notes or ""
        if char.voice_hint:
            bio_text = f"{bio_text}\n\nVoice hint:\n{char.voice_hint}".strip()
        pid, _created = ensure_project_persona(
            db, project.id,
            name=char.name, bio=bio_text or None,
            imported_from=standard.source, imported_id=char.id,
        )
        char_to_persona_id[char.id] = pid

    existing_scenes = (
        db.query(Scene).filter(Scene.project_id == project.id).order_by(Scene.position).all()
    )

    def scene_key(sc: Scene) -> str | None:
        if sc.metadata_json:
            try:
                return json.loads(sc.metadata_json).get("source_id") or sc.title
            except json.JSONDecodeError:
                return sc.title
        return sc.title

    by_key = {scene_key(sc): sc for sc in existing_scenes}
    summary = {"scenes_added": 0, "added": 0, "updated": 0, "removed": 0, "unchanged": 0}

    next_scene_pos = len(existing_scenes)
    for std_scene in standard.scenes:
        scene = by_key.get(std_scene.id) or by_key.get(std_scene.title)
        if scene is None:
            scene = Scene(
                project_id=project.id,
                position=next_scene_pos,
                title=std_scene.title,
                metadata_json=json.dumps(
                    {"kind": std_scene.kind, "source_id": std_scene.id,
                     "index_one_based": next_scene_pos + 1}
                ),
            )
            db.add(scene)
            db.flush()
            next_scene_pos += 1
            summary["scenes_added"] += 1

        blocks = (
            db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
        )

        def block_ref(b: Block) -> str | None:
            if b.metadata_json:
                try:
                    return json.loads(b.metadata_json).get("source_ref")
                except json.JSONDecodeError:
                    return None
            return None

        by_ref = {block_ref(b): b for b in blocks if block_ref(b)}
        incoming_refs = set()
        next_pos = len(blocks)
        for line in std_scene.lines:
            incoming_refs.add(line.source_ref)
            persona_id = (
                char_to_persona_id.get(line.character_id) if line.character_id else None
            )
            existing = by_ref.get(line.source_ref)
            if existing is None:
                db.add(
                    Block(
                        scene_id=scene.id, position=next_pos, text=line.text,
                        persona_id=persona_id,
                        metadata_json=json.dumps({"source_ref": line.source_ref}),
                    )
                )
                next_pos += 1
                summary["added"] += 1
            elif existing.text != line.text or existing.persona_id != persona_id:
                existing.text = line.text
                existing.persona_id = persona_id
                summary["updated"] += 1
            else:
                summary["unchanged"] += 1
        # Lines that vanished from the sheet are removed (takes cascade).
        for ref, b in by_ref.items():
            if ref not in incoming_refs:
                db.delete(b)
                summary["removed"] += 1
    return summary


class ProjectLineOut(BaseModel):
    block_id: str
    line_id: str | None
    scene_id: str
    scene_title: str | None
    character: str | None
    text: str
    # "none" (never rendered) | "rendered" | "stale" (text changed since)
    take_status: str


class ProjectLinesResponse(BaseModel):
    project_id: str
    lines: list[ProjectLineOut]
    counts: dict


@router.get("/v1/projects/{project_id}/lines", response_model=ProjectLinesResponse)
async def project_lines(project_id: str, db: Session = Depends(get_db)) -> ProjectLinesResponse:
    """Flat per-line view for the game Lines grid (mock #game/3).
    take_status is DERIVED: stale = latest take's generation text differs
    from the block's current text — no stored flag to drift."""
    from ..database.models import Generation, Take

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    )
    out: list[ProjectLineOut] = []
    counts = {"none": 0, "rendered": 0, "stale": 0}
    for scene in scenes:
        rows = (
            db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
        )
        for b in rows:
            latest = (
                db.query(Generation.text)
                .join(Take, Take.generation_id == Generation.id)
                .filter(Take.block_id == b.id)
                .order_by(Take.created_at.desc())
                .first()
            )
            if latest is None:
                status = "none"
            elif latest[0] == b.text:
                status = "rendered"
            else:
                status = "stale"
            counts[status] += 1
            line_id = None
            if b.metadata_json:
                try:
                    line_id = json.loads(b.metadata_json).get("source_ref")
                except json.JSONDecodeError:
                    pass
            persona = (
                db.query(Persona.name).filter(Persona.id == b.persona_id).first()
                if b.persona_id
                else None
            )
            out.append(
                ProjectLineOut(
                    block_id=b.id, line_id=line_id,
                    scene_id=scene.id, scene_title=scene.title,
                    character=persona[0] if persona else None,
                    text=b.text, take_status=status,
                )
            )
    return ProjectLinesResponse(project_id=project_id, lines=out, counts=counts)

class CreateDemoRequest(BaseModel):
    kind: str  # "audiobook" | "game_voicelines" | "podcast"


@router.post("/v1/projects/demo", response_model=ImportRunResponse)
async def create_demo_project(
    body: CreateDemoRequest, db: Session = Depends(get_db)
) -> ImportRunResponse:
    """Seed a demo project for the kind — runs through the same
    materializer as a real import (CONCEPTS §13.7), so personas, lexicon
    dual-writes, and line ids behave exactly like production data."""
    from ..demo_projects import demo_standard

    try:
        standard = demo_standard(body.kind)
    except KeyError:
        raise bad_request(
            f"unknown demo kind {body.kind!r} — one of: audiobook, game_voicelines, podcast"
        )
    project, _sc, _bl, _created, _reused = _materialize_standard(
        standard, db
    )
    db.commit()
    db.refresh(project)
    standard.project.id = project.id
    return ImportRunResponse(
        committed=True, project_id=project.id, standard=standard, warnings=[]
    )

class ShowNotesResponse(BaseModel):
    project_id: str
    markdown: str


SHOW_NOTES_SYSTEM = """You write podcast show notes. Given a transcript-style
script (segments with speaker names), produce concise markdown:

## Episode summary
2-3 sentences.

## Chapters
- One bullet per segment/topic, naming who speaks.

## Pull quotes
2 short verbatim quotes, attributed.

Return ONLY the markdown."""


@router.post("/v1/projects/{project_id}/show-notes", response_model=ShowNotesResponse)
async def project_show_notes(
    project_id: str, db: Session = Depends(get_db)
) -> ShowNotesResponse:
    """LLM show notes from the project's segments (CONCEPTS §14.4).
    501 when no provider is pinned, same contract as analyze."""
    from fastapi import HTTPException

    from ..engines.llm import LLMMessage
    from ..engines.llm.dispatch import LLMNotConfiguredError, chat

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    )
    parts: list[str] = []
    for scene in scenes:
        parts.append(f"## {scene.title or 'Segment'}")
        rows = (
            db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
        )
        for b in rows:
            who = None
            if b.persona_id:
                p_row = db.query(Persona.name).filter(Persona.id == b.persona_id).first()
                who = p_row[0] if p_row else None
            parts.append(f"{who or 'NARRATION'}: {b.text}")
    script = "\n".join(parts)
    if not script.strip():
        raise bad_request("project has no segments to summarize")

    settings = get_state().settings.get()
    try:
        resp = chat(
            settings=settings,
            feature="show_notes",
            messages=[LLMMessage(role="user", content=script[:24000])],
            system=SHOW_NOTES_SYSTEM,
            temperature=0.4,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    return ShowNotesResponse(project_id=project_id, markdown=resp.text.strip())

