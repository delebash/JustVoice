# SPDX-License-Identifier: MIT
"""/v1/projects — Books, game-voicelines, podcasts, custom projects.

Use-case-generalized Project → Scene → Block model from DESIGN_FREEZE §4.4.
Audiobook = chapters + paragraphs; game = dialogue trees + NPC lines;
podcast = episodes + segments. Same data model, different metadata +
export pipelines.

Also: POST /v1/projects/import?source=justwrite ingests a JustWrite book
JSON and auto-creates Project + Scenes + Blocks + Speakers.
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
    Scene,
    Block,
    Speaker,
    get_db,
)
from ..database.models import (
    Lexicon as DbLexicon,
    LexiconEntry as DbLexiconEntry,
)
from ..errors import not_found, bad_request
from ..app_state import get_state
from ._speaker_helpers import adopt_book_narrator, ensure_speaker
from ..mastering import kind_master
from .extraction_api import RunUsage, project_ignored
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
    # Names Discover was told to ignore here (2026-09-27, fix 4).
    discover_ignored: list[str] = []
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
            discover_ignored=project_ignored(row),
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
    speaker_id: Optional[str]
    direction: Optional[str]
    metadata: dict
    # Phase 3 / Slice 2 — extraction telemetry surfaced to the Studio
    # Script tab. Null on blocks created manually (source="manual" or
    # left null pre-extraction).
    extraction_confidence: Optional[float] = None
    source: Optional[str] = None
    created_at: datetime
    # Set by the block PATCH when the change saved a speaker fix for the
    # attribution prompt — Script's Undo deletes exactly that fix.
    fix_id: Optional[str] = None

    @classmethod
    def from_orm(cls, row: Block) -> "BlockResponse":
        return cls(
            id=row.id,
            scene_id=row.scene_id,
            position=row.position,
            text=row.text,
            speaker_id=row.speaker_id,
            direction=row.direction,
            metadata=json.loads(row.metadata_json or "{}"),
            extraction_confidence=row.extraction_confidence,
            source=row.source,
            created_at=row.created_at,
        )


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
    speaker_id: Optional[str] = None
    direction: Optional[str] = None
    metadata: dict = Field(default_factory=dict)
    # Phase 3 / Slice 2 — extraction telemetry. Analyze runs write these
    # itself now (extraction_api persists; the Studio "Apply" button that
    # used to POST them died with the Script-tab restore, 2026-08-08).
    # Manual block creation leaves them null + source="manual".
    extraction_confidence: Optional[float] = None
    source: Optional[str] = "manual"


class UpdateBlockRequest(BaseModel):
    position: Optional[int] = None
    text: Optional[str] = None
    # Left out = unchanged. `speaker_id`, `source` and `extraction_confidence`
    # sent as null = cleared: Script's Undo puts back a line exactly as it was,
    # including one that had no speaker, no source or no confidence.
    speaker_id: Optional[str] = None
    direction: Optional[str] = None
    metadata: Optional[dict] = None
    extraction_confidence: Optional[float] = None
    source: Optional[str] = None
    # A speaker change normally saves a fix the next Analyze learns from.
    # Undo sends this: taking a change back is not a fix.
    no_fix: bool = False


# ── Project CRUD ─────────────────────────────────────────────────────────


@router.get("/v1/projects", response_model=ProjectList)
async def list_projects(
    project_type: Optional[ProjectType] = None, db: Session = Depends(get_db)
) -> ProjectList:
    q = db.query(Project)
    if project_type is not None:
        q = q.filter(Project.project_type == project_type)
    rows = q.order_by(Project.created_at.desc()).all()
    # One GROUP BY instead of a COUNT query per project (N+1 — the list
    # endpoint is on every view's load path; user-hit: "takes a second
    # to list projects").
    from sqlalchemy import func

    counts = dict(
        db.query(Scene.project_id, func.count(Scene.id))
        .group_by(Scene.project_id)
        .all()
    )
    return ProjectList(
        projects=[
            ProjectResponse.from_orm(row, scene_count=counts.get(row.id, 0))
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
        mastering_preset=body.mastering_preset or kind_master(body.project_type),
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


def _drop_scene_source_text(db: Session, scene_id: str) -> None:
    """Forget the prose an analyze run was made from, because the blocks no
    longer match it.

    extraction_api stores the analyzed text on the scene so re-analyze feeds
    the pipeline the identical input and the split stays reproducible (the
    Script-tab restore, decision 3). The moment a block's text is edited or a
    block is added/removed, that stored copy describes a chapter that no
    longer exists — keeping it would attribute the OLD wording onto the new
    blocks. Dropping it makes the next analyze fall back to the blocks
    themselves, which is why dialogue blocks keep their quote marks."""
    sc = db.query(Scene).filter(Scene.id == scene_id).first()
    if sc is None or not sc.metadata_json:
        return
    try:
        meta = json.loads(sc.metadata_json)
    except ValueError:
        return
    if meta.pop("source_text", None) is not None:
        sc.metadata_json = json.dumps(meta)


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
        speaker_id=body.speaker_id,
        direction=body.direction,
        metadata_json=json.dumps(body.metadata),
        extraction_confidence=body.extraction_confidence,
        source=body.source,
    )
    db.add(b)
    _drop_scene_source_text(db, scene_id)
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

    # Phase 5: capture speaker corrections — when speaker_id changes from
    # the existing value to a new one AND the existing value wasn't null
    # (manual reassignment, not "first assignment"), write a
    # SpeakerCorrection row for the future analyze pipeline to learn from.
    speaker_changed = (
        body.speaker_id is not None
        and b.speaker_id is not None
        and body.speaker_id != b.speaker_id
        and not body.no_fix
    )

    if body.position is not None:
        b.position = body.position
    if body.text is not None:
        if body.text != b.text:
            _drop_scene_source_text(db, b.scene_id)
        b.text = body.text
    if body.speaker_id is not None or "speaker_id" in body.model_fields_set:
        b.speaker_id = body.speaker_id
    if body.direction is not None:
        b.direction = body.direction
    if body.metadata is not None:
        b.metadata_json = json.dumps(body.metadata)
    sent = body.model_fields_set
    if body.extraction_confidence is not None or "extraction_confidence" in sent:
        b.extraction_confidence = body.extraction_confidence
    if body.source is not None or "source" in sent:
        b.source = body.source
        # Setting or confirming a line clears Script's "changed by the last
        # Analyze" mark — unless the caller is restoring metadata (Undo).
        if body.source == "corrected" and body.metadata is None:
            meta = json.loads(b.metadata_json or "{}")
            if "prev_speaker_id" in meta:
                del meta["prev_speaker_id"]
                b.metadata_json = json.dumps(meta)

    fix_id = None
    if speaker_changed:
        # Look up the parent project via the scene, then write through THE one
        # correction writer (extraction_api.record_correction — the Lab's
        # reassign shares it since the parity batch; cap + shape live once).
        scene = db.query(Scene).filter(Scene.id == b.scene_id).first()
        if scene:
            from .extraction_api import record_correction

            fix_id = record_correction(db, scene.project_id, b.text, body.speaker_id)

    db.commit()
    db.refresh(b)
    out = BlockResponse.from_orm(b)
    out.fix_id = fix_id
    return out


@router.delete("/v1/blocks/{block_id}")
async def delete_block(block_id: str, db: Session = Depends(get_db)) -> dict:
    b = db.query(Block).filter(Block.id == block_id).first()
    if not b:
        raise not_found(f"block {block_id}")
    _drop_scene_source_text(db, b.scene_id)
    db.delete(b)
    db.commit()
    return {"deleted": True}


# ── Split and merge a line — Script's "✎ Edit…" and "⇲ Merge" (2026-09-30) ──
#
# docs/plans/2026-09-30-script-leftovers.md, B1. The only way to fix a line
# the segmenter cut wrong. Both change how many lines the chapter has, so both
# drop its analyzed text: from then on Analyze reads it as its lines
# (`extraction_api._lines_to_keep`) and never re-cuts what was cut by hand.
# Neither has an Undo — each undoes the other.


class SplitBlockRequest(BaseModel):
    # Where the new line starts, as a character offset into `text`.
    at: int
    # The words to split, when the editor changed them first; left out = the
    # line's own.
    text: Optional[str] = None


class MergeBlocksRequest(BaseModel):
    ids: list[str] = Field(..., min_length=2)


class BlockListResponse(BaseModel):
    blocks: list[BlockResponse]


def _renumber(ordered: list[Block]) -> None:
    for i, blk in enumerate(ordered):
        blk.position = i


@router.post("/v1/blocks/{block_id}/split", response_model=BlockListResponse)
async def split_block(
    block_id: str, body: SplitBlockRequest, db: Session = Depends(get_db)
) -> BlockListResponse:
    """One line becomes two, cut at `at`. Both keep the speaker and how it was
    decided. The first keeps the line's id, and with it its rendered takes —
    its words changed, so they are out of date and it re-renders. The second
    is new, with no takes, and does not carry the import's line id
    (`source_ref`): one line of the source can only be one line here."""
    b = db.query(Block).filter(Block.id == block_id).first()
    if not b:
        raise not_found(f"block {block_id}")
    text = b.text if body.text is None else body.text
    first, second = text[: body.at].rstrip(), text[body.at :].lstrip()
    if not first or not second:
        raise bad_request("Put the cursor inside the words — both new lines need some.")

    ordered = (
        db.query(Block).filter(Block.scene_id == b.scene_id).order_by(Block.position).all()
    )
    meta = json.loads(b.metadata_json or "{}")
    meta.pop("source_ref", None)
    new = Block(
        scene_id=b.scene_id,
        position=b.position + 1,
        text=second,
        speaker_id=b.speaker_id,
        direction=b.direction,
        metadata_json=json.dumps(meta) if meta else None,
        extraction_confidence=b.extraction_confidence,
        source=b.source,
    )
    b.text = first
    db.add(new)
    at = next(i for i, blk in enumerate(ordered) if blk.id == b.id)
    _renumber([*ordered[: at + 1], new, *ordered[at + 1 :]])
    _drop_scene_source_text(db, b.scene_id)
    db.commit()
    db.refresh(b)
    db.refresh(new)
    return BlockListResponse(blocks=[BlockResponse.from_orm(b), BlockResponse.from_orm(new)])


@router.post("/v1/scenes/{scene_id}/blocks/merge", response_model=BlockResponse)
async def merge_blocks(
    scene_id: str, body: MergeBlocksRequest, db: Session = Depends(get_db)
) -> BlockResponse:
    """Lines that sit next to each other become one: their words joined with a
    space, on the first line — its id, speaker, takes and everything it
    carries. The others are deleted, and their rendered takes with them
    (Take.block_id is ON DELETE CASCADE); Script asks before it sends this
    when there are any."""
    if not db.query(Scene).filter(Scene.id == scene_id).first():
        raise not_found(f"scene {scene_id}")
    ordered = db.query(Block).filter(Block.scene_id == scene_id).order_by(Block.position).all()
    index = {blk.id: i for i, blk in enumerate(ordered)}
    if len(set(body.ids)) != len(body.ids) or any(i not in index for i in body.ids):
        raise bad_request("Merge takes two or more different lines of this chapter.")
    picked = sorted(index[i] for i in body.ids)
    if picked != list(range(picked[0], picked[0] + len(picked))):
        raise bad_request("Only lines that sit next to each other can be merged.")

    keep, *gone = (ordered[i] for i in picked)
    keep.text = " ".join(t for t in (blk.text.strip() for blk in (keep, *gone)) if t)
    for blk in gone:
        db.delete(blk)
    db.flush()
    _renumber([blk for blk in ordered if blk not in gone])
    _drop_scene_source_text(db, scene_id)
    db.commit()
    db.refresh(keep)
    return BlockResponse.from_orm(keep)


# ── Multi-adapter import pipeline ─────────────────────────────────────────
#
# Replaces the original JustWrite-only endpoint. Sources are pluggable
# (see server/justvoice/imports/) and the adapter registry produces a
# normalized StandardImport that this endpoint materializes into ORM
# rows. JustWrite is one adapter among several (book_prose,
# podcast_markdown, csv_lines, srt, audacity_labels, justvoice_standard).
#
# Transport:
#   - Preferred: multipart/form-data { source, file, dry_run? }
#   - Raw request body with ?source=… — no file part, the body IS the
#     payload (a book zip's bytes, a JSON document); usable by automation


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
    """Turn a StandardImport into ORM rows. Returns (project, scene_count, block_count, created_speakers, reused_speakers).

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
        mastering_preset=kind_master(project_type),
        imported_from=standard.source,
    )
    db.add(p)
    db.flush()

    # The book's characters become its speakers (2026-09-29). Everything the
    # source knows about one is "Who they are" material: the one-liner and the
    # casting hint (voice_hint). An import keeps the characters exactly as the
    # book has them — two with one name stay two; each is cast with the persona
    # of exactly its name when the library has one.
    created_speakers: list[str] = []
    reused_speakers: list[str] = []
    char_to_speaker_id: dict[str, str] = {}
    for char in standard.characters:
        sheet = char.notes or ""
        if char.voice_hint:
            sheet = f"{sheet}\n\nVoice hint:\n{char.voice_hint}".strip()
        speaker, created = ensure_speaker(
            db,
            p.id,
            name=char.name,
            description=sheet or None,
            aliases=char.aliases,
            imported_from=standard.source,
            imported_id=char.id,
        )
        char_to_speaker_id[char.id] = speaker.id
        (created_speakers if created else reused_speakers).append(speaker.id)

    # After the speakers, never before — see adopt_book_narrator.
    adopt_book_narrator(db, p)

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
            speaker_id = (
                char_to_speaker_id.get(line.character_id) if line.character_id else None
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
            # Every adapter parses `pause_after_ms` (CSV column, SRT inter-cue
            # gap, Audacity label gap) and it is a documented import field —
            # but it used to stop here, so an import that specified its own
            # pacing rendered with the project's flat gap instead. Kept on the
            # metadata rather than a new column so honouring it costs no
            # schema change; render_chapter_api reads it back.
            if getattr(line, "pause_after_ms", None):
                meta["pause_after_ms"] = int(line.pause_after_ms)
            db.add(
                Block(
                    scene_id=s.id,
                    position=block_idx,
                    text=line.text,
                    speaker_id=speaker_id,
                    direction=direction,
                    metadata_json=json.dumps(meta) if meta else None,
                )
            )
            total_blocks += 1

    return p, len(standard.scenes), total_blocks, created_speakers, reused_speakers


def _materialize_lexicon(
    standard: StandardImport, project: Project, db: Session
) -> str | None:
    """Create a project-scoped lexicon from the import's entries.

    Returns the new lexicon id (also written to project.default_lexicon_id),
    or None when the import carries neither lexicon entries nor characters.
    Character names land as blank-pronunciation rows — the book's
    pronunciation worklist, seeded free at import.

    Post-Phase-1.5 flip: LexiconStore reads the same rows, so this writes
    ONLY through the caller's session (one transaction with the project
    row — a separate store session would hit the FK before the project
    commits). The old dual-write is gone.
    """
    # The book's NAMES seed the lexicon too (decided item "Seed a
    # pronunciation lexicon from the imported book's proper nouns",
    # built 2026-08-21): every character the source hands over becomes a
    # blank-pronunciation row — a worklist, not a claim. Safe because an
    # empty entry is inert at render: _apply_lexicons acts only on a
    # non-empty alias or IPA (verified with the 2026-08-21 rewiring).
    seen: set[str] = set()
    name_rows = []
    for char in standard.characters:
        name = (char.name or "").strip()
        if not name or name.casefold() in ("narrator",) or name.casefold() in seen:
            continue
        seen.add(name.casefold())
        name_rows.append(name)

    if not standard.lexicon_entries and not name_rows:
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
    explicit = set()
    for e in standard.lexicon_entries:
        explicit.add(e.grapheme.casefold())
        db.add(
            DbLexiconEntry(
                lexicon_id=lex_id,
                word=e.grapheme,
                pronunciation=e.phoneme_ipa or e.alias or "",
                notation="ipa" if e.phoneme_ipa else "phonetic",
            )
        )
    for name in name_rows:
        if name.casefold() in explicit:
            continue  # the import's own entry wins over the blank seed
        db.add(
            DbLexiconEntry(
                lexicon_id=lex_id,
                word=name,
                pronunciation="",
                notation="phonetic",
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
        source   = adapter id (justwrite | book_prose | podcast_markdown | csv_lines | srt | audacity_labels | justvoice_standard)
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
    # Why a chapter fails for a reason the loudness numbers can't express —
    # today: it has lines nobody speaks, so what was measured is not the
    # whole chapter. Null when the chapter is render-ready.
    note: Optional[str] = None


class ProjectQCResponse(BaseModel):
    project_id: str
    chapters: list[ChapterQCOut]
    all_ok: bool
    limits: dict
    # What the numbers were measured ON. An ACX verdict computed over raw TTS
    # output is a wrong answer, so QC says which it did: `mastered` false with
    # a `master_preset` set means ffmpeg is missing and these are raw numbers.
    master_preset: Optional[str] = None
    mastered: bool = False
    note: Optional[str] = None


@router.get("/v1/projects/{project_id}/qc", response_model=ProjectQCResponse)
async def project_qc(project_id: str, db: Session = Depends(get_db)) -> ProjectQCResponse:
    """Render every chapter (cache-served when unchanged) and run the ACX
    technical checks — RMS window + peak ceiling — per chapter."""
    from ..export_audiobook import (
        ACX_PEAK_MAX_DB,
        ACX_RMS_MAX_DB,
        ACX_RMS_MIN_DB,
        assemble_project,
        collect_project_line_kwargs,
        project_scenes,
        qc_report,
    )
    from ..synth_scheduler import warm_lines

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    st = get_state()
    # Whole-book warm, engine-grouped (§7 of the 2026-08-08 plan); the
    # assembly below re-reads the cache and stays the error surface. QC
    # mode: warm the renderable subset of every scene, skipping refusals,
    # exactly like the measuring assembly below.
    await warm_lines(
        st, collect_project_line_kwargs(st, project_id, skip_unrenderable=True)
    )

    # QC MEASURES — it does not ship. The render refusal on unplaced lines
    # (Script-tab restore, decision 5) is right for the M4B export and wrong
    # here: refusing the whole book because chapter 40 has no speakers yet
    # would leave you unable to check chapters 1-39 for the entire middle of
    # a production. Measure what renders; the chapters that can't are
    # reported as failing with the reason, never as passing.
    from ..errors import ApiError
    from .render_chapter_api import _resolve_scene_to_lines, render_scene_to_wav

    def _measure(state, scene_id: str) -> bytes:
        return render_scene_to_wav(state, scene_id, strict=False)

    def _not_ready(scene_id: str) -> Optional[str]:
        """The refusal a real render would raise, as a note instead. Same
        door, so QC can never disagree with what export will do."""
        try:
            _resolve_scene_to_lines(scene_id, None, st, strict=True)
            return None
        except ApiError as e:
            return str(e.detail)

    chapters = assemble_project(
        st, project_id, render_scene_fn=_measure, skip_unrenderable=True,
    )
    scenes = project_scenes(project_id)
    if not scenes:
        raise bad_request("project has no scenes to check")
    measured = {c.scene_id: c for c in qc_report(chapters)}
    out = []
    for scene in scenes:
        note = _not_ready(scene.id)
        c = measured.get(scene.id)
        if c is None:
            # Nothing renderable in it at all — report the reason instead of
            # killing the whole run, which is what a book mid-production
            # looks like for most of its life.
            out.append(ChapterQCOut(
                scene_id=scene.id, title=scene.title or "",
                duration_s=0.0, rms_dbfs=0.0, peak_dbfs=0.0,
                rms_ok=False, peak_ok=False, ok=False,
                note=note or "Nothing in this chapter could be rendered.",
            ))
            continue
        out.append(
            ChapterQCOut(
                scene_id=c.scene_id, title=c.title, duration_s=c.duration_s,
                rms_dbfs=c.rms_dbfs, peak_dbfs=c.peak_dbfs,
                rms_ok=c.rms_ok, peak_ok=c.peak_ok,
                # A chapter measured without the lines it's missing has not
                # passed anything — never report that as ok.
                ok=c.ok and note is None,
                note=note,
            )
        )
    # Say what was measured. `_measure` masters when it can; when the target
    # exists but ffmpeg does not, these are raw-render numbers and the ACX
    # verdict is not the one the finished book would get.
    from ..mastering import have_ffmpeg as _have_ffmpeg
    from .render_chapter_api import _scene_master_target

    target = _scene_master_target(scenes[0].id, None, None)[0] if scenes else None
    mastered = bool(target) and _have_ffmpeg()
    qc_note = None
    if target and not mastered:
        qc_note = (
            f"Measured without the {target} master — ffmpeg is not installed, "
            f"so these are raw-render numbers, not what the finished book "
            f"would measure. Install ffmpeg and re-run."
        )
    return ProjectQCResponse(
        project_id=project_id,
        chapters=out,
        all_ok=all(c.ok for c in out),
        limits={
            "rms_min_db": ACX_RMS_MIN_DB,
            "rms_max_db": ACX_RMS_MAX_DB,
            "peak_max_db": ACX_PEAK_MAX_DB,
        },
        master_preset=target,
        mastered=mastered,
        note=qc_note,
    )


def m4b_author(project: Project) -> str | None:
    """The M4B `artist` tag. The project's Author field (Studio · Overview,
    saved as `metadata.author`) wins; before that field reached the export, the
    only source was a description starting "by ", which stays as the fallback."""
    try:
        meta = json.loads(project.metadata_json) if project.metadata_json else {}
    except (TypeError, ValueError):
        meta = {}
    author = str(meta.get("author") or "").strip() if isinstance(meta, dict) else ""
    if author:
        return author
    if project.description and project.description.startswith("by "):
        return project.description[3:]
    return None


@router.post("/v1/projects/{project_id}/export_m4b")
async def project_export_m4b(project_id: str, db: Session = Depends(get_db)) -> Response:
    """Assemble all chapters into one .m4b with chapter markers."""
    from fastapi import HTTPException

    from ..export_audiobook import (
        assemble_project,
        collect_project_line_kwargs,
        have_ffmpeg,
        mux_m4b,
    )
    from ..synth_scheduler import warm_lines

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    if not have_ffmpeg():
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server.",
        )
    st = get_state()
    # Whole-book warm, engine-grouped (§7 of the 2026-08-08 plan); the
    # assembly below re-reads the cache and stays the error surface.
    await warm_lines(st, collect_project_line_kwargs(st, project_id))
    chapters = assemble_project(st, project_id)
    if not chapters:
        raise bad_request("project has no scenes to export")
    m4b = mux_m4b(chapters, project.name, m4b_author(project))
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
    from ..export_voicelines import collect_block_specs, export_voicelines
    from ..synth_scheduler import warm_specs

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    st = get_state()
    # Whole-project warm, engine-grouped (§7 of the 2026-08-08 plan); the
    # export below re-reads the cache and stays the error surface.
    await warm_specs(collect_block_specs(st, project_id))
    data = export_voicelines(st, project_id)
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

    # Speakers create-or-reuse, as on first import.
    char_to_speaker_id: dict[str, str] = {}
    for char in standard.characters:
        sheet = char.notes or ""
        if char.voice_hint:
            sheet = f"{sheet}\n\nVoice hint:\n{char.voice_hint}".strip()
        speaker, _created = ensure_speaker(
            db, project.id,
            name=char.name, description=sheet or None, aliases=char.aliases,
            imported_from=standard.source, imported_id=char.id,
        )
        char_to_speaker_id[char.id] = speaker.id

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
            speaker_id = (
                char_to_speaker_id.get(line.character_id) if line.character_id else None
            )
            existing = by_ref.get(line.source_ref)
            if existing is None:
                db.add(
                    Block(
                        scene_id=scene.id, position=next_pos, text=line.text,
                        speaker_id=speaker_id,
                        metadata_json=json.dumps({"source_ref": line.source_ref}),
                    )
                )
                next_pos += 1
                summary["added"] += 1
            elif existing.text != line.text or existing.speaker_id != speaker_id:
                existing.text = line.text
                existing.speaker_id = speaker_id
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
    speaker: str | None
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
            speaker = (
                db.query(Speaker.name).filter(Speaker.id == b.speaker_id).first()
                if b.speaker_id
                else None
            )
            out.append(
                ProjectLineOut(
                    block_id=b.id, line_id=line_id,
                    scene_id=scene.id, scene_title=scene.title,
                    speaker=speaker[0] if speaker else None,
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
    materializer as a real import (CONCEPTS §13.7), so speakers, lexicon
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
    # §16: every AI response carries the run's usage (found violated 2026-08-08
    # by the AI-call-convention pass — the counts were in `resp` and dropped).
    usage: RunUsage | None = None


@router.post("/v1/projects/{project_id}/show-notes", response_model=ShowNotesResponse)
async def project_show_notes(
    project_id: str, db: Session = Depends(get_db)
) -> ShowNotesResponse:
    """LLM show notes from the project's segments (CONCEPTS §14.4).
    501 when no provider is configured, same contract as analyze."""
    from fastapi import HTTPException

    from llm_runner.llm import LLMNotConfiguredError

    from ..engines.llm.run import run_feature

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
            if b.speaker_id:
                s_row = db.query(Speaker.name).filter(Speaker.id == b.speaker_id).first()
                who = s_row[0] if s_row else None
            parts.append(f"{who or 'NARRATION'}: {b.text}")
    script = "\n".join(parts)
    if not script.strip():
        raise bad_request("project has no segments to summarize")

    # The template row owns the wording (user half = {{script}}); the cap on
    # the script sample stays code-side (a computed VALUE).
    try:
        resp = run_feature("show_notes", {"script": script[:24000]})
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    return ShowNotesResponse(
        project_id=project_id,
        markdown=resp.text.strip(),
        usage=RunUsage(
            prompt_tokens=resp.prompt_tokens,
            completion_tokens=resp.completion_tokens,
            model=resp.model,
        ),
    )

