# SPDX-License-Identifier: MIT
"""POST /v1/scenes/{id}/analyze — speaker attribution.

Phase 3 / Slice 1 of the Profile-kill plan. Runs the extraction
pipeline against scene text and returns attribution rows for the Studio
Script tab.

**The scene-scoped routes PERSIST** (the Script-tab restore, 2026-08-08 —
docs/plans/2026-08-08-script-tab-restore.md decision 2). Until then the
analysis lived in one renderer ref, so switching chapters threw it away and
a separate "Apply" button re-POSTed the rows as NEW blocks on top of the
ones the text came from — analyzing twice doubled the chapter. Now the run
writes itself onto the scene's blocks, "this chapter is analyzed" IS
`Block.source` being non-null, and Apply is gone. The Lab's text routes
(/v1/extraction/*) have no scene and still persist nothing.

When no LLM provider is registered, returns HTTP 501 with the
actionable message from LLMNotConfiguredError.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import time
from datetime import datetime, timezone
from queue import SimpleQueue
from threading import Event, Thread
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from llm_runner.llm import LLMNotConfiguredError

from ..app_state import get_state
from ..database import get_db
from ..database.models import Block, Project, Scene, Speaker, Take
from ..errors import conflict, not_found
from ..extraction import AnalyzeRequest, analyze_scene
from ..extraction.flags import model_disagreed
from ..models import ProjectScript, SceneScript, ScriptChapter, ScriptFlag, ScriptLine, ScriptSpeaker
from ..extraction.pipeline import AttributionModelError, auto_route
from ..extraction.segmentation import QUOTE_PAIRS, paragraphs_of, resolve_marks, segments_from_lines
from ._speaker_helpers import ensure_speaker, narrator_speaker_id, speaker_aliases

log = logging.getLogger(__name__)

router = APIRouter(tags=["extraction"])


class AttributionRowResponse(BaseModel):
    paragraph_idx: int
    kind: str
    text: str
    speaker: str
    confidence: float
    source: str
    floored_from: str | None = None
    llm_speaker: str | None = None
    llm_confidence: float | None = None
    anchor_words: str | None = None
    not_in_cast: str | None = None


class AnalyzeSceneRequest(BaseModel):
    """Body for POST /v1/scenes/{id}/analyze.

    `text` is the raw scene prose to attribute. `characters` defaults to
    the book's speakers when omitted. `corrections`
    defaults to the most-recent SpeakerCorrection rows for the project
    once Slice 2 lands.
    """

    text: str
    characters: list[dict] | None = None
    corrections: list[dict] | None = None
    # Per-run route force; None = Auto. Renamed from `tier` in the
    # tier-debris cleanup (2026-08-07); an unknown value 422s loudly.
    route: Literal["guided", "direct"] | None = None
    propagate: bool = True
    use_floor: bool = True


class RunUsage(BaseModel):
    """The run's usage numbers (§16 — every AI response carries them; the
    server always had them, the responses just didn't). 0 = unreported."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_ms: int = 0
    model: str = ""
    # Model calls the run took: 1 when the chapter fit, more when it was read in
    # pieces (chapter splitting, 2026-09-28).
    pieces: int = 1


class PersistInfo(BaseModel):
    """What the run wrote onto the scene's blocks. None on the Lab's
    text routes, which have no scene to write to."""

    # "in_place" — every row PATCHed the block it came from.
    # "resegmented" — the blocks were replaced (first analyze of an
    # imported chapter; the segmenter cuts paragraphs into spans).
    mode: str
    written: int = 0
    # Rows left alone because the user had already corrected them
    # (decision 3 — re-analyze never overwrites a human answer).
    kept_corrected: int = 0


class AnalyzeSceneResponse(BaseModel):
    scene_id: str
    rows: list[AttributionRowResponse]
    route_used: str
    # Why that route ran (the restore's no-silent-state rule): "forced"
    # (per-run override) | "auto".
    route_source: str = "auto"
    confidence_floor: float
    # Raw LLM reply text — Speaker Lab's "Raw" tab. None when the call
    # was anchors-only / no dialogue.
    raw_llm: str | None = None
    # None when no LLM call ran (anchors-only / no dialogue).
    usage: RunUsage | None = None
    # What landed in the database (scene routes only).
    persisted: PersistInfo | None = None


def _resolve_corrections(project_id: str, db: Session, *, limit: int = 12) -> list[dict]:
    """Look up the top-N most-recent SpeakerCorrection rows for the
    project. Phase 5 feedback loop — these inject into the LLM prompt
    via prompts.format_corrections as worked examples.
    """
    from ..database.models import SpeakerCorrection

    rows = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .order_by(SpeakerCorrection.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "text_snippet": r.text_snippet,
            "speaker_id": r.speaker_id or "unknown",
        }
        for r in rows
    ]


def _resolve_cast(scene_id: str, db: Session) -> list[dict]:
    """The book's speakers for `scene_id`, as attribution and Discover read
    them: name, the other names the text uses, and who they are."""
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        return []
    return [
        {
            "id": s.id,
            "name": s.name,
            "role": None,
            "gender": None,
            # Cast's Pronouns (persona build P9) — who "she said" can be.
            "pronouns": s.pronouns,
            # "Also called" — anchors.py and the attribution prompt read it.
            "aliases": speaker_aliases(s),
            # Who they are — one line of it is Discover's known list (fix 2).
            "description": s.description,
        }
        for s in db.query(Speaker).filter(Speaker.project_id == scene.project_id).all()
    ]


# ── Persistence — the analysis IS the chapter's blocks ───────────────────
#
# Decision 2 of the Script-tab restore: no new table, no new column, no
# renderer-side store. A block that carries a `source` was attributed; the
# Script tab rebuilds its table from `speaker_id` + `extraction_confidence`
# + `source` every time you open the chapter.


# The Block.source values an Analyze run writes (pipeline.AttributionRow).
# "corrected" and "manual" are the user's and the import's.
PIPELINE_SOURCES = frozenset({"narration", "tag", "propagated", "llm", "floored", "second_look"})

def _block_text(kind: str, text: str, source_text: str, marks: str = "double") -> str:
    """The text a row stores as its block — dialogue keeps its quote marks.

    The segmenter returns the INNER text of a quoted span, so writing that
    verbatim would strip the manuscript's quotes: the chapter would read
    wrong in Chapters, and re-segmenting the stored blocks would find zero
    dialogue (segmentation.py matches quote marks and nothing else).

    Restore the span the source ACTUALLY had — never a tidier one. The
    segmenter has a branch for dialogue that opens and runs to the end of a
    line without ever closing (`segmentation.py:22`); handing that back a
    closing quote would put punctuation in the manuscript that the author
    did not write.

    `marks` is the style the chapter was cut by; its pairs are tried first
    (`segmentation.QUOTE_PAIRS`), then every other style's."""
    if kind != "dialogue":
        return text
    pairs = [*QUOTE_PAIRS.get(marks, ()),
             *(p for style, ps in QUOTE_PAIRS.items() if style != marks for p in ps)]
    for open_q, close_q in pairs:
        if f"{open_q}{text}{close_q}" in source_text:
            return f"{open_q}{text}{close_q}"
    for open_q, _close_q in pairs:
        if f"{open_q}{text}" in source_text:
            return f"{open_q}{text}"
    return f'"{text}"'


def _json_meta(raw: str | None) -> dict:
    try:
        return json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}


def _scene_meta(scene: Scene) -> dict:
    return _json_meta(scene.metadata_json)


def _project_meta(db: Session, project_id: str) -> dict:
    """A project's settings kept in its metadata — among them Overview's
    Speech marks (`speech_marks`) and Leave out dialogue tags
    (`leave_out_tags`), 2026-09-30. The client merges the object before it
    PATCHes, so a key written here is never dropped by another's save."""
    p = db.query(Project).filter(Project.id == project_id).first()
    return _json_meta(p.metadata_json) if p else {}


def _lines_to_keep(scene: Scene, blocks: list) -> list | None:
    """The lines to re-analyze as they stand, or None to cut the text again.

    An analyzed chapter whose lines were edited since — a line's words
    changed, a line added, removed, split or merged — no longer has the text
    it was cut from: the edit dropped it
    (`projects_api._drop_scene_source_text`). Joining the lines back up read
    every line as a paragraph of its own, so each "said Marius" sat alone,
    away from the speech it names: every anchor in the chapter was lost and
    every line went to the model (2026-09-30). Now the lines are kept, read
    by the paragraph they came from, and only their speakers are decided
    again. A chapter never analyzed, or that still has its text, is cut from
    the text as before."""
    meta = _scene_meta(scene)
    if meta.get("source_text"):
        return None
    if not (meta.get("analyzed_at") or any(b.source in PIPELINE_SOURCES for b in blocks)):
        return None
    kept = [b for b in blocks if (b.text or "").strip()]
    return kept or None


def _scene_text(db: Session, scene: Scene) -> str:
    """A chapter's text: the analyzed text it was cut from, else its lines."""
    stored = _scene_meta(scene).get("source_text")
    if stored:
        return stored
    blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    return "\n\n".join(b.text for b in blocks if (b.text or "").strip())


def _neighbour_texts(db: Session, scene: Scene) -> tuple[str | None, str | None]:
    """The chapters either side of `scene`, by position — the second look reads
    the end of the one before and the start of the one after (2026-10-05)."""
    scenes = (db.query(Scene).filter(Scene.project_id == scene.project_id)
              .order_by(Scene.position).all())
    at = next((i for i, s in enumerate(scenes) if s.id == scene.id), None)
    if at is None:
        return None, None
    before = _scene_text(db, scenes[at - 1]) if at > 0 else None
    after = _scene_text(db, scenes[at + 1]) if at + 1 < len(scenes) else None
    return before or None, after or None


def _set_by_you(db: Session, line_ids: list | None) -> list[int]:
    """Row indices of the lines you set, when the chapter is re-read as its
    lines stand — the second look never asks about them (they are never
    rewritten). A chapter cut afresh has none to skip."""
    if not line_ids:
        return []
    src = {b.id: b.source for b in db.query(Block).filter(Block.id.in_(line_ids))}
    return [i for i, lid in enumerate(line_ids) if src.get(lid) == "corrected"]


def _analysis_input(db: Session, scene: Scene, text: str):
    """What an Analyze of `scene` reads: (text, marks, the ids of the lines
    kept, their segments). The last two are None when the text is cut
    again — then `text` is the caller's."""
    from ..extraction.flags import spoken_block

    blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    kept = _lines_to_keep(scene, blocks)
    segments = None
    if kept:
        segments = segments_from_lines([
            {"text": b.text, "spoken": spoken_block(b.source, b.text),
             "paragraph": _json_meta(b.metadata_json).get("paragraph_idx")}
            for b in kept
        ])
        text = "\n\n".join(paragraphs_of(segments))
    marks = resolve_marks(_project_meta(db, scene.project_id).get("speech_marks"), text)
    return text, marks, ([b.id for b in kept] if kept else None), segments


def _inherited(blocks: list, text: str) -> list[tuple[dict, str | None]]:
    """Everything a paragraph's block carries that its segments must inherit.

    Re-cutting a chapter DELETES the blocks, and a block is not just text:

      * `metadata.source_ref` — the import's stable line id. Re-import
        merges on it (`projects_api._reimport_update`'s `by_ref`) and
        voiceline export names files from it. Lose it and a re-import brings
        every paragraph back as new, duplicating the chapter — the exact
        failure this whole change exists to end.
      * `metadata.marker` — a podcast music/ad line, speaker-less by design.
        Every attribution check has to skip those.
      * `direction` — the performance note. The import seeds it from the
        source's emotion/style, and ChapterView lets the user write it by
        hand. It is authored content; dropping it silently is not an option.

    Returns one entry per PARAGRAPH of `text`, so a row's `paragraph_idx`
    indexes it. Empty when `text` isn't the stored blocks joined back
    together, because then paragraph N and block N are unrelated.

    The join must match the renderer's `proseFromBlocks`
    (`src/services/attribution.js`) EXACTLY — it drops empty blocks and
    trims. Comparing against a raw join instead would let one blank block,
    or a trailing newline, silently skip the carry-over for a whole
    chapter."""
    from ..extraction.segmentation import split_into_paragraphs

    carried = [b for b in blocks if (b.text or "").strip()]
    if text.strip() != "\n\n".join(b.text for b in carried).strip():
        return []
    out: list[tuple[dict, str | None]] = []
    for b in carried:
        entry = (_json_meta(b.metadata_json), b.direction)
        # A block holding a blank line splits into more than one paragraph.
        out.extend([entry] * max(1, len(split_into_paragraphs(b.text))))
    return out


def _persist_attribution(
    db: Session,
    scene: Scene,
    rows: list,
    text: str,
    *,
    marks: str = "double",
    line_ids: list[str] | None = None,
) -> PersistInfo:
    """Write an analyze run onto the scene's blocks. Caller commits.

    Two paths:

    * **in place** — the split matches the blocks already stored, so each
      row updates the block it came from. This is every re-analyze: the run
      re-decides speakers against a fresh cast and fresh corrections without
      touching the text or the block count (decision 3). Blocks the user has
      corrected are skipped — a human answer outranks the model's.
    * **re-segment** — the split does NOT match. That is the first analyze
      of an imported chapter: import writes one block per paragraph, and the
      segmenter cuts each paragraph into narration/dialogue spans, so N
      blocks become M rows. The blocks are replaced.

    The re-segment path is REFUSED once the scene has takes: Take.block_id
    is ON DELETE CASCADE, so replacing blocks would destroy approved audio,
    labels and lineage with no warning.

    The text that produced these rows is stored on the scene, because the
    split is only reproducible from it — joining the stored blocks back
    together loses the paragraph structure that anchoring and propagation
    depend on (both are same-paragraph only).

    `line_ids` names the lines a run over an EDITED chapter read as they
    stood (`_lines_to_keep`): one row each, written in place, and the text is
    not stored — the chapter keeps being read as its lines, so a hand-made
    cut is never undone by a re-analyze."""
    blocks = (
        db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    )
    if not rows:
        # Nothing came back — an empty or whitespace-only text, or a pipeline
        # that produced no segments. Falling through would take the re-segment
        # path and delete every block without writing one back, wiping the
        # chapter on a run that decided nothing.
        raise conflict(
            "That run produced no lines to attribute, so nothing was saved. "
            "Check the chapter has text."
        )
    narrator_id = narrator_speaker_id(db, scene.project_id)
    # The speakers the model was actually offered. It answers with ids from
    # the cast it was given, but nothing stops it inventing one — and
    # Block.speaker_id is a foreign key, so an invented id would fail the
    # whole insert. An unrecognized name means the line is unplaced, which
    # is what the Script tab and the render blocker are there for.
    known = {
        sid for (sid,) in db.query(Speaker.id).filter(Speaker.project_id == scene.project_id)
    }

    def speaker_for(speaker: str) -> str | None:
        if speaker == "narrator":
            return narrator_id
        if not speaker or speaker == "unknown":
            return None
        return speaker if speaker in known else None

    meta = _scene_meta(scene)
    if line_ids is None:
        texts = [_block_text(r.kind, r.text, text, marks) for r in rows]
        in_place = len(blocks) == len(rows) and [b.text for b in blocks] == texts
        meta["source_text"] = text
    else:
        now = [b for b in blocks if (b.text or "").strip()]
        if [b.id for b in now] != line_ids or len(now) != len(rows):
            raise conflict(
                "This chapter's lines changed while it was being analyzed, so nothing "
                "was saved. Analyze it again."
            )
        blocks, texts, in_place = now, [], True
    # "Analyzed" is Analyze having run, never "a line has a speaker" — an
    # imported script arrives with speakers and was never analyzed. The cast
    # it could choose from is what "added since" compares against (§8.24).
    meta["analyzed_at"] = datetime.now(timezone.utc).isoformat()
    meta["analyzed_cast"] = sorted(known)
    scene.metadata_json = json.dumps(meta)

    _unchanged = object()

    def with_audit(existing: dict, row, prev=_unchanged) -> str | None:
        """Keep the block's own metadata, and record what Script's check
        column and "Decided by" read (§8.24, 3a):

        * `floored_from` — the model's answer before the confidence floor
          discarded it.
        * `paragraph_idx` — which paragraph of the analyzed text the line
          came from; "three in a row" counts paragraphs, not lines.
        * `anchor_words` — the book's own words that named the speaker.
        * `llm_speaker` — the model's pick, kept only where the book's words
          won and the model had said someone else.
        * `prev_speaker_id` — who the line was before this re-analyze
          changed it; the key's presence is the mark, its value may be null
          ("had no speaker")."""
        meta = dict(existing)
        if row.source == "floored" and row.floored_from:
            meta["floored_from"] = row.floored_from
        else:
            meta.pop("floored_from", None)
        meta["paragraph_idx"] = row.paragraph_idx
        anchored = row.source in ("tag", "propagated")
        if anchored and row.anchor_words:
            meta["anchor_words"] = row.anchor_words
        else:
            meta.pop("anchor_words", None)
        model_pick = speaker_for(model_disagreed(row.source, row.speaker, row.llm_speaker) or "")
        if model_pick:
            meta["llm_speaker"] = model_pick
        else:
            meta.pop("llm_speaker", None)
        if prev is _unchanged:
            meta.pop("prev_speaker_id", None)
        else:
            meta["prev_speaker_id"] = prev
        # The second look's "not in the cast" name (2026-10-05) — Script offers
        # to add them; set and cleared with every run, never left stale.
        if getattr(row, "not_in_cast", None):
            meta["not_in_cast"] = row.not_in_cast
        else:
            meta.pop("not_in_cast", None)
        # Asked by the second look, named no one (2026-10-06) — set and cleared
        # with every run, as the name above.
        if getattr(row, "second_look_asked", False):
            meta["second_look_asked"] = True
        else:
            meta.pop("second_look_asked", None)
        return json.dumps(meta) if meta else None

    if in_place:
        kept = 0
        for block, row in zip(blocks, rows, strict=True):
            if block.source == "corrected":
                kept += 1
                continue
            new_speaker = speaker_for(row.speaker)
            # Only a RE-analyze changes a line: the first run over imported
            # lines decides them, it doesn't change anyone's mind.
            reanalyzed = block.source in PIPELINE_SOURCES
            prev = (
                block.speaker_id
                if reanalyzed and block.speaker_id != new_speaker
                else _unchanged
            )
            block.speaker_id = new_speaker
            block.extraction_confidence = row.confidence
            block.source = row.source
            block.metadata_json = with_audit(_json_meta(block.metadata_json), row, prev)
        return PersistInfo(mode="in_place", written=len(rows) - kept, kept_corrected=kept)

    # Read the outgoing blocks BEFORE deleting them — attribute access on a
    # deleted instance after flush is not something to rely on.
    inherited = _inherited(blocks, text)

    if blocks:
        takes = (
            db.query(Take.id)
            .join(Block, Block.id == Take.block_id)
            .filter(Block.scene_id == scene.id)
            .count()
        )
        if takes:
            raise conflict(
                f"This chapter's text no longer matches its {len(blocks)} rendered "
                f"blocks, so analyzing would have to re-cut it — and that deletes "
                f"the {takes} take(s) already recorded against them. Delete the "
                f"takes (or re-render after) if you want the new split."
            )
        for block in blocks:
            db.delete(block)
        db.flush()

    for i, (row, block_text) in enumerate(zip(rows, texts, strict=True)):
        parent_meta, parent_direction = (
            inherited[row.paragraph_idx]
            if row.paragraph_idx < len(inherited)
            else ({}, None)
        )
        db.add(
            Block(
                scene_id=scene.id,
                position=i,
                text=block_text,
                speaker_id=speaker_for(row.speaker),
                direction=parent_direction,
                extraction_confidence=row.confidence,
                source=row.source,
                metadata_json=with_audit(parent_meta, row),
            )
        )
    return PersistInfo(mode="resegmented", written=len(rows))


@router.post(
    "/v1/scenes/{scene_id}/analyze",
    response_model=AnalyzeSceneResponse,
    summary="Run speaker attribution on a scene",
)
async def analyze_scene_endpoint(
    scene_id: str,
    body: AnalyzeSceneRequest,
    db: Session = Depends(get_db),
) -> AnalyzeSceneResponse:
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")

    characters = body.characters if body.characters is not None else _resolve_cast(scene_id, db)
    corrections = body.corrections if body.corrections is not None else _resolve_corrections(scene.project_id, db)

    settings = get_state().settings.get()
    text, marks, line_ids, segments = _analysis_input(db, scene, body.text)
    before_text, after_text = _neighbour_texts(db, scene)
    # Route precedence lives in ONE place (pipeline.pick_route): the body's
    # explicit route (a per-run override) > Auto. The pipeline reports the
    # pick that RAN via raw_out — never re-derived here.
    req = AnalyzeRequest(
        text=text,
        characters=characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
        before_text=before_text,
        after_text=after_text,
        second_look_skip=_set_by_you(db, line_ids),
    )

    try:
        raw_out: dict = {}
        # In a worker thread: the pipeline blocks for the whole model call, and
        # on the event loop it stalled every other request to the server —
        # health checks included — until it finished (2026-09-29).
        rows = await asyncio.to_thread(
            analyze_scene, settings=settings, request=req, raw_out=raw_out,
            marks=marks, segments=segments,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except AttributionModelError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    persisted = _persist_attribution(db, scene, rows, text, marks=marks, line_ids=line_ids)
    db.commit()

    return AnalyzeSceneResponse(
        scene_id=scene_id,
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        route_used=raw_out.get("route", "guided"),
        route_source=raw_out.get("route_source", "auto"),
        confidence_floor=raw_out.get("floor", 0.7),
        usage=raw_out.get("usage"),
        persisted=persisted,
    )


@router.post(
    "/v1/scenes/{scene_id}/analyze/stream",
    summary="Run speaker attribution on a scene, streaming the family SSE frames",
)
async def analyze_scene_stream_endpoint(
    scene_id: str,
    body: AnalyzeSceneRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Lane 2A of the AI-call convention (2026-08-08): the SAME pipeline as
    /analyze — same cast/corrections resolution, same route pick, same parsing
    and floor — but the LLM reply streams, so a minute-long chapter shows live
    tokens instead of a silent wait. Frames are the family contract
    (`data:{"delta"}` · `data:{"progress"}` · `data:{"step":{"name":"second_look",
    "done","total"}}` as the second look starts and after each line it asks
    about · a final `data:{"done":true,...}` carrying the usage names top-level
    PLUS everything AnalyzeSceneResponse carries · `data:[DONE]`; errors as
    `data:{"error"}` — the stream has started, so there is no HTTP status to
    send).

    The pipeline is sync + blocking (the kit's stream_action is), so it runs in
    a worker thread feeding a queue the generator drains.

    **The worker never writes.** It hands its rows back and the ASYNC layer
    persists, after checking the client is still there. Cancel has to mean
    cancel: this endpoint began writing the chapter on 2026-08-08, and a
    worker that persisted on its own turned the Cancel button into a lie —
    the toast said "Analyze cancelled" while the run rewrote the chapter
    seconds later, leaving the table on screen disagreeing with the rows in
    the database until you navigated away and back.

    **Except in the second look (decided 2026-10-06):** a cancel there keeps
    the main pass. The worker hands over a copy of the rows as the second look
    starts and after each line (`on_step`), and a cancel saves that copy — the
    main pass's speakers plus the lines the second look had named — and stops
    the look before its next line. A cancel during the main pass still writes
    nothing."""
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")

    characters = body.characters if body.characters is not None else _resolve_cast(scene_id, db)
    corrections = body.corrections if body.corrections is not None else _resolve_corrections(scene.project_id, db)
    settings = get_state().settings.get()
    text, marks, line_ids, segments = _analysis_input(db, scene, body.text)
    # Read here, not in the worker — the worker thread has no session.
    before_text, after_text = _neighbour_texts(db, scene)
    req = AnalyzeRequest(
        text=text,
        characters=characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
        before_text=before_text,
        after_text=after_text,
        second_look_skip=_set_by_you(db, line_ids),
    )

    q: SimpleQueue = SimpleQueue()
    stop = Event()
    # The chapter as the second look last left it whole — what a cancel during the
    # second look saves. None until the second look starts.
    kept: dict = {"rows": None}

    def on_step(done: int, total: int, rows: list) -> None:
        kept["rows"] = copy.deepcopy(rows)
        q.put({"step": {"name": "second_look", "done": done, "total": total}})

    def worker() -> None:
        raw_out: dict = {}
        try:
            rows = analyze_scene(
                settings=settings,
                request=req,
                raw_out=raw_out,
                on_delta=lambda t: q.put({"delta": t}),
                on_progress=lambda p: q.put({"progress": p}),
                marks=marks,
                segments=segments,
                on_step=on_step,
                stop=stop.is_set,
            )
            usage = raw_out.get("usage") or {}
            q.put({
                "done": True,
                # Handed to the async layer, which persists and replaces this
                # with the PersistInfo before the frame goes out.
                "__rows__": rows,
                # The family usage names, top level — the kit client normalizes
                # exactly these (ui/src/client.js requestStream).
                "promptTokens": usage.get("prompt_tokens", 0),
                "completionTokens": usage.get("completion_tokens", 0),
                "model": usage.get("model", ""),
                # The domain payload — the same fields AnalyzeSceneResponse
                # carries, same names, so the client's result handling is one
                # code path across both transports.
                "scene_id": scene_id,
                "rows": [row.__dict__ for row in rows],
                "route_used": raw_out.get("route", "guided"),
                "route_source": raw_out.get("route_source", "auto"),
                "confidence_floor": raw_out.get("floor", 0.7),
                "raw_llm": raw_out.get("llm_text"),
                "usage": usage or None,
            })
        except LLMNotConfiguredError as e:
            q.put({"error": str(e)})
        except AttributionModelError as e:
            q.put({"error": str(e)})   # written for the user; never cut
        except Exception as e:  # noqa: BLE001 — surface as an error frame, not a 500
            log.exception("extraction stream failed")
            q.put({"error": str(e)[:200]})
        finally:
            q.put(None)

    Thread(target=worker, daemon=True).start()

    def _persist(rows: list) -> dict:
        """The write, in a worker thread of the event loop's own pool. Its
        Session is opened and closed here — the request-scoped one belongs to
        the dependency and Sessions are not thread-safe."""
        from ..database.session import SessionLocal

        wdb = SessionLocal()
        try:
            wscene = wdb.query(Scene).filter(Scene.id == scene_id).first()
            if wscene is None:
                raise not_found(f"scene {scene_id}")   # deleted mid-run
            info = _persist_attribution(wdb, wscene, rows, text, marks=marks, line_ids=line_ids)
            wdb.commit()
            return info.model_dump()
        finally:
            wdb.close()

    def _save_on_cancel(rows: list) -> None:
        """Cancel during the second look keeps what the run had (decided
        2026-10-06). Synchronous on purpose: it runs while the stream is torn
        down, before the event loop serves the page's reload that follows the
        cancel."""
        try:
            _persist(rows)
            log.info("analyze stream: cancelled in the second look — scene %s saved as it stood", scene_id)
        except Exception:  # noqa: BLE001 — the run is gone; say so in the log
            log.exception("analyze stream: saving the main pass on cancel failed")

    async def gen():
        finished = False
        try:
            async for frame in frames():
                yield frame
            finished = True
        finally:
            stop.set()
            if not finished and kept["rows"] is not None:
                _save_on_cancel(kept["rows"])

    async def frames():
        while True:
            item = await asyncio.to_thread(q.get)
            if item is None:
                break
            if isinstance(item, dict) and "__rows__" in item:
                rows = item.pop("__rows__")
                # The one place the chapter is written. A cancelled run must
                # leave it exactly as it was, and on this stack that is
                # guaranteed twice over: uvicorn advertises ASGI spec 2.3, so
                # Starlette races this generator against listen_for_disconnect
                # and CANCELS it when the client goes — the write is never
                # reached. This check is the belt to that pair of braces, and
                # the only guard on a 2.4+ server, where Starlette drops the
                # listener and relies on send() raising instead. Best-effort
                # on its own (the disconnect frame has to have landed), which
                # is why it is second and not first.
                if await request.is_disconnected():
                    if kept["rows"] is not None:
                        # Gone after the second look ended: the run is whole.
                        _save_on_cancel(rows)
                        kept["rows"] = None
                    else:
                        log.info("analyze stream: client gone — scene %s not written", scene_id)
                    break
                # The whole run is being written now; a cancel from here on must
                # not write the kept copy over it.
                kept["rows"] = None
                try:
                    item["persisted"] = await asyncio.to_thread(_persist, rows)
                except HTTPException as e:
                    # Its refusals are already user-facing sentences (a re-cut
                    # that would destroy takes) — pass them whole.
                    item = {"error": str(e.detail)}
                except Exception as e:  # noqa: BLE001 — a frame, not a 500
                    log.exception("analyze stream: persist failed")
                    item = {"error": str(e)[:200]}
            yield f"data: {json.dumps(item)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ── Script's 🔎 Second look — the blank lines only (decided 2026-10-06) ─────
#
# TASKS "Script: a Second look button asks again about just the blank lines".
# The second look over the chapter AS IT STANDS: only its spoken lines with no
# speaker that you didn't set, nothing else re-decided — so after ＋ Add-ing a
# missing speaker, or for a speaker the book reveals in the next chapter, the
# blanks get asked about in seconds instead of re-deciding the whole chapter.
# The question is Analyze's own (second_look.look_at, the same context). Each
# answer is saved to its line as it comes, marked to check (source
# "second_look"), so a cancel keeps what was answered; an answer that lands
# after the cancel is dropped.


def _second_look_asks(db: Session, scene: Scene) -> list[Block]:
    """The chapter's spoken lines with no speaker that you didn't set, in order —
    what the 🔎 Second look asks about."""
    from ..extraction.flags import spoken_block
    from ..line_takes import is_marker

    blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    return [b for b in blocks
            if (b.text or "").strip() and not b.speaker_id and b.source != "corrected"
            and not is_marker(b) and spoken_block(b.source, b.text)]


def _paragraph_of(paragraphs: list[str], block: Block) -> int:
    """The paragraph a line came from: Analyze's `paragraph_idx`, else the first
    paragraph holding its words (a line typed in or split off has no index)."""
    idx = _json_meta(block.metadata_json).get("paragraph_idx")
    if isinstance(idx, int) and 0 <= idx < len(paragraphs):
        return idx
    words = (block.text or "").strip().strip("\"'“”‘’ ,.")
    return next((i for i, p in enumerate(paragraphs) if words and words in p), -1)


def _save_second_look(block_id: str, row, outcome: str) -> None:
    """One answer onto its line, in a session of its own (the worker thread's).
    A line given a speaker or set by you meanwhile is left alone, and so is a
    line whose question failed. Named: the speaker, marked to check; its
    "changed" mark says who it was before the last Analyze, dropped when that is
    who it is again. Not named: marked asked (Script's Check column says so),
    and the "not in the cast" name the answer gave, set or cleared."""
    from ..database.session import SessionLocal

    wdb = SessionLocal()
    try:
        b = wdb.query(Block).filter(Block.id == block_id).first()
        if b is None or b.speaker_id or b.source == "corrected" or outcome == "failed":
            return
        meta = _json_meta(b.metadata_json)
        if outcome == "named":
            b.speaker_id = row.speaker
            b.source = "second_look"
            b.extraction_confidence = row.confidence
            meta.pop("floored_from", None)
            meta.pop("not_in_cast", None)
            meta.pop("second_look_asked", None)
            if "prev_speaker_id" in meta:
                if meta["prev_speaker_id"] == row.speaker:
                    meta.pop("prev_speaker_id")
            else:
                meta["prev_speaker_id"] = None
        else:
            meta["second_look_asked"] = True
            if row.not_in_cast:
                meta["not_in_cast"] = row.not_in_cast
            else:
                meta.pop("not_in_cast", None)
        b.metadata_json = json.dumps(meta) if meta else None
        wdb.commit()
    finally:
        wdb.close()


@router.post(
    "/v1/scenes/{scene_id}/second-look/stream",
    summary="Ask again about the chapter's spoken lines with no speaker, streaming the family SSE frames",
)
async def second_look_stream_endpoint(
    scene_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Script's 🔎 Second look: `{"delta"}` as each question streams, `{"step":
    {"name": "second_look", "done", "total"}}` as it starts and after each line,
    then `{"done": true, asked, named, not_in_cast, failed, seconds}` with the
    usage names, then `[DONE]`; errors as `{"error"}`. Writes each answer to its
    line as it comes (`_save_second_look`); nothing else in the chapter."""
    from types import SimpleNamespace

    from ..extraction import second_look as sl
    from ..extraction.names import match
    from ..extraction.pipeline import pick_route, prompt_handles, resolve_speaker
    from ..extraction.segmentation import split_into_paragraphs
    from ..models import ExtractionSettings

    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    settings = get_state().settings.get()
    cfg = getattr(settings, "extraction", None) or ExtractionSettings()
    asks = _second_look_asks(db, scene)
    blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    stored = _scene_meta(scene).get("source_text")
    text, _marks, _line_ids, segments = _analysis_input(
        db, scene, stored or "\n\n".join(b.text for b in blocks if b.text))
    paragraphs = split_into_paragraphs(text) if segments is None else paragraphs_of(segments)
    prompt_cast, handle_to_id = prompt_handles(_resolve_cast(scene_id, db))
    cast_text = sl.cast_lines(prompt_cast)
    before, after = sl.context(*_neighbour_texts(db, scene), cfg)
    floor = pick_route(None, settings).floor
    rows = [(b.id, SimpleNamespace(paragraph_idx=_paragraph_of(paragraphs, b), text=b.text,
                                   speaker="unknown", confidence=0.0, source=b.source,
                                   floored_from=None, not_in_cast=None))
            for b in asks]

    q: SimpleQueue = SimpleQueue()
    stop = Event()

    def resolve(raw):
        h = resolve_speaker(raw, prompt_cast)
        return handle_to_id.get(h, h)

    def worker() -> None:
        report = {"asked": len(rows), "named": 0, "not_in_cast": [], "failed": 0, "seconds": 0.0}
        usage: dict = {"prompt_tokens": 0, "completion_tokens": 0}
        t0 = time.time()
        try:
            q.put({"step": {"name": "second_look", "done": 0, "total": len(rows)}})
            for k, (block_id, row) in enumerate(rows):
                if stop.is_set():
                    break
                outcome = sl.look_at(
                    row, paragraphs, cast_text=cast_text, before=before, after=after,
                    resolve=resolve, cast_names=lambda name: bool(match(name, prompt_cast)),
                    floor=floor, use_floor=True, cfg=cfg, report=report, usage=usage,
                    on_delta=lambda t: q.put({"delta": t}),
                )
                if stop.is_set():
                    break   # the answer landed after the cancel — dropped
                _save_second_look(block_id, row, outcome)
                q.put({"step": {"name": "second_look", "done": k + 1, "total": len(rows)}})
            report["seconds"] = round(time.time() - t0, 1)
            q.put({
                "done": True,
                "promptTokens": usage.get("prompt_tokens", 0),
                "completionTokens": usage.get("completion_tokens", 0),
                "model": "",
                "scene_id": scene_id,
                **report,
            })
        except LLMNotConfiguredError as e:
            q.put({"error": str(e)})
        except Exception as e:  # noqa: BLE001 — a frame, not a 500
            log.exception("second look stream failed")
            q.put({"error": str(e)[:200]})
        finally:
            q.put(None)

    Thread(target=worker, daemon=True).start()

    async def gen():
        try:
            while True:
                item = await asyncio.to_thread(q.get)
                if item is None:
                    break
                yield f"data: {json.dumps(item)}\n\n"
            yield "data: [DONE]\n\n"
        finally:
            stop.set()

    return StreamingResponse(gen(), media_type="text/event-stream")


class AnalyzeTextRequest(BaseModel):
    """Speaker-Lab body — analyze raw text without a scene id. Caller
    supplies the cast directly + the same tuning flags as the scene-
    scoped endpoint.

    Corrections (Part 5, 2026-08-06 — the typed box died: corrections only
    exist by fixing real results): pass `project_id` and the run uses that
    project's STORED corrections through the same resolver production uses;
    an explicit non-empty `corrections` list still wins (API compat)."""

    text: str
    characters: list[dict] = []
    corrections: list[dict] = []
    project_id: str | None = None
    # Per-run route force (a card's Lab run always sends its own); None =
    # Auto. Renamed from `tier` (2026-08-07); an unknown value 422s loudly.
    route: Literal["guided", "direct"] | None = None
    propagate: bool = True
    use_floor: bool = True
    # Lab per-column overrides (None = preset/route defaults). camelCase
    # to match the shared LLM-config contract the renderer sends.
    providerId: str | None = None
    model: str | None = None
    temperature: float | None = None
    systemPrompt: str | None = None
    userPrompt: str | None = None
    confidence_floor: float | None = None
    # The column's remaining tunables (Part 2, 2026-08-06 — the controls are
    # REAL): pass straight through to the shared run path, same as any
    # feature. None/[] = the resolved preset's values.
    think: bool | None = None
    reasoningEffort: str | None = None
    maxTokens: int | None = None
    topP: float | None = None
    samplers: list[dict] = []
    # Force chapter splitting by treating the model's context as this small (eval).
    max_context: int | None = None
    # The second look (2026-10-05): the neighbouring chapters' text, and an
    # on/off for this run (None = settings.extraction.second_look).
    before_text: str | None = None
    after_text: str | None = None
    second_look: bool | None = None


@router.post(
    "/v1/extraction/analyze-text",
    response_model=AnalyzeSceneResponse,
    summary="Run speaker attribution on free-form text (Speaker Lab)",
)
async def analyze_text_endpoint(
    body: AnalyzeTextRequest, db: Session = Depends(get_db)
) -> AnalyzeSceneResponse:
    """No scene id — for the Speaker Lab + ad-hoc analysis. Returns the
    same AnalyzeSceneResponse shape with scene_id="(adhoc)".
    """
    corrections = body.corrections
    if not corrections and body.project_id:
        # The open project's stored corrections, exactly like production
        # (Part 5 — same resolver, same top-12, zero drift).
        corrections = _resolve_corrections(body.project_id, db)
    settings = get_state().settings.get()
    req = AnalyzeRequest(
        text=body.text,
        characters=body.characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
        model=body.model,
        temperature=body.temperature,
        system_prompt=body.systemPrompt,
        user_prompt=body.userPrompt,
        confidence_floor=body.confidence_floor,
        provider_id=body.providerId,
        think=body.think,
        reasoning_effort=body.reasoningEffort,
        max_tokens=body.maxTokens,
        top_p=body.topP,
        samplers=body.samplers,
        max_context=body.max_context,
        before_text=body.before_text,
        after_text=body.after_text,
        second_look=body.second_look,
    )
    try:
        raw_out: dict = {}
        # In a worker thread: the pipeline blocks for the whole model call, and
        # on the event loop it stalled every other request to the server —
        # health checks included — until it finished (2026-09-29).
        rows = await asyncio.to_thread(
            analyze_scene, settings=settings, request=req, raw_out=raw_out,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except AttributionModelError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    return AnalyzeSceneResponse(
        scene_id="(adhoc)",
        raw_llm=raw_out.get("llm_text"),
        rows=[AttributionRowResponse(**row.__dict__) for row in rows],
        route_used=raw_out.get("route", "guided"),
        route_source=raw_out.get("route_source", "auto"),
        confidence_floor=raw_out.get("floor", 0.7),
        usage=raw_out.get("usage"),
    )


# ── Lab config — the truth the Speaker Lab displays ──────────────────────


class ExtractionRouteInfo(BaseModel):
    name: str
    label: str
    confidence_floor: float


class AutoCheckInfo(BaseModel):
    """One line of Auto's shown work: the rule, the model it judged (that
    card's OWN model — no hidden anchor), and whether it passed."""

    route: str
    model: str
    passed: bool
    rule: str


class ExtractionConfigResponse(BaseModel):
    """Everything the attribution Lab + the Auto row need to SHOW what the
    pipeline will actually do: the TWO routes (Guided · Direct — Reasoned
    died in the tier-debris cleanup 2026-08-07), their prompt bodies, the
    user-prompt template, the editable size rule, and Auto's current pick
    with its work (judged against that card's own model — the Lab and
    Studio report it; the Auto pane itself is plain words + the size line,
    per the Auto simplification 2026-08-06). The server is the single
    source of truth — the UI never duplicates prompt text or re-derives
    the pick. Production always runs Auto."""

    routes: list[ExtractionRouteInfo]
    # {"guided": <full body>, "direct": <full body>}
    system_prompts: dict[str, str]
    user_template: str
    # The editable size rule (settings.extraction.direct_min_b).
    direct_min_b: float = 14.0
    # Auto's pick right now + the readout lines that justify it.
    auto_picked: str = "guided"
    auto_checks: list[AutoCheckInfo] = []
    # The second look's on/off (settings.extraction.second_look, 2026-10-05).
    second_look: bool = True


@router.get(
    "/v1/extraction/config",
    response_model=ExtractionConfigResponse,
    summary="The two routes + prompt bodies + Auto's pick and its work (the attribution Lab + Auto row)",
)
async def extraction_config() -> ExtractionConfigResponse:
    from llm_runner.llm import stores

    from ..extraction.pipeline import ROUTE_FLOORS, ROUTES

    # Prompt truth = the SHARED template rows (the same rows the run renders).
    _store = stores.get_prompt_store()
    rows = {name: _store.get(f"speaker_attribution.{name}") for name in ROUTES}

    settings = get_state().settings.get()
    picked, checks = auto_route(settings.extraction.direct_min_b)

    return ExtractionConfigResponse(
        routes=[
            ExtractionRouteInfo(
                name=name,
                label=name.capitalize(),
                confidence_floor=ROUTE_FLOORS[name],
            )
            for name in ROUTES
        ],
        system_prompts={name: (r.system if r else "") for name, r in rows.items()},
        user_template=rows["guided"].user_template if rows["guided"] else "",
        direct_min_b=settings.extraction.direct_min_b,
        auto_picked=picked,
        auto_checks=[AutoCheckInfo(**c) for c in checks],
        second_look=settings.extraction.second_look,
    )


# ── Script — the chapter grid and the chapter page (Slice 3, §8.24) ─────
#
# Both screens read the chapter's blocks, as the Script table always has; the
# flags and the counts are computed here, in Python, by the same function the
# eval scores (`extraction/flags.py`), so what was measured is what ships.


def _name_pattern(names: list[str]) -> re.Pattern | None:
    names = sorted({n.strip() for n in names if n and n.strip()}, key=len, reverse=True)
    if not names:
        return None
    return re.compile(r"\b(" + "|".join(re.escape(n) for n in names) + r")\b", re.IGNORECASE)


def _chapter_script(
    scene: Scene,
    blocks: list,
    *,
    cast_ids: set[str],
    narrator_id: str | None,
    speakers: dict,
    project_meta: dict | None = None,
    take_counts: dict | None = None,
) -> tuple[ScriptChapter, list[ScriptLine], list]:
    """One chapter's Script state: its grid row, its lines and its flag groups.

    One rule decides "analyzed" everywhere (§8.24): Analyze has run
    (`analyzed_at`), or — older data, no migration — its lines carry a
    pipeline source. "From the import": never analyzed, and every line
    already has a speaker."""
    from ..extraction.flags import Line, flag_groups, flagged_lines, spoken_block
    from ..extraction.tags import left_out_blocks

    meta = _scene_meta(scene)
    pm = project_meta or {}
    tags_left_out = left_out_blocks(blocks) if pm.get("leave_out_tags") else set()
    rows = []
    for b in blocks:
        bm = _json_meta(b.metadata_json)
        marker = bool(bm.get("marker"))
        speakable = not marker and bool((b.text or "").strip())
        spoken = speakable and spoken_block(b.source, b.text)
        rows.append((b, bm, marker, speakable, spoken))

    analyzed_at = meta.get("analyzed_at")
    analyzed = bool(analyzed_at) or any(b.source in PIPELINE_SOURCES for b, *_ in rows)
    speakable_rows = [r for r in rows if r[3]]
    from_import = (
        not analyzed and bool(speakable_rows) and all(r[0].speaker_id for r in speakable_rows)
    )

    lines = [
        Line(
            id=b.id, speaker=b.speaker_id, text=b.text or "", spoken=spoken, source=b.source,
            paragraph=bm.get("paragraph_idx"), llm_speaker=bm.get("llm_speaker"), marker=marker,
        )
        for b, bm, marker, _speakable, spoken in rows
    ]
    # Flags run only on what Analyze decided, reading quotes in the chapter's
    # speech-mark style (a speech left open carries on into the next paragraph).
    marks = resolve_marks(pm.get("speech_marks"),
                          meta.get("source_text") or "\n\n".join(b.text or "" for b in blocks))
    groups = flag_groups(lines, cast_ids, marks=marks) if analyzed else []
    marked = flagged_lines(groups)
    # Narration (read, not spoken) with no speaker in a book with no narrator
    # waits for one — a book-level fix, ＋ Add Narrator, not a line to check
    # (decided 2026-10-05). Everything else with no speaker is "No speaker".
    waiting = (
        {r[0].id for r in speakable_rows if not r[0].speaker_id and not r[4]}
        if narrator_id is None else set()
    )
    no_speaker = {r[0].id for r in speakable_rows if not r[0].speaker_id} - waiting

    by_group: dict[str, list[int]] = {}
    for gi, g in enumerate(groups):
        for lid in g.lines:
            by_group.setdefault(lid, []).append(gi)

    out_lines = [
        ScriptLine(
            id=b.id, position=b.position, text=b.text or "", speaker_id=b.speaker_id,
            source=b.source, confidence=b.extraction_confidence,
            paragraph=bm.get("paragraph_idx"), spoken=spoken, marker=marker,
            speakable=speakable, anchor_words=bm.get("anchor_words"),
            llm_speaker=bm.get("llm_speaker"), floored_from=bm.get("floored_from"),
            changed="prev_speaker_id" in bm, prev_speaker_id=bm.get("prev_speaker_id"),
            flags=by_group.get(b.id, []), metadata=bm,
            left_out=b.id in tags_left_out, takes=(take_counts or {}).get(b.id, 0),
            waits_for_narrator=b.id in waiting,
        )
        for b, bm, marker, speakable, spoken in rows
    ]

    spoken_rows = [r for r in rows if r[4]]
    added: list[str] = []
    before = meta.get("analyzed_cast")
    if analyzed and isinstance(before, list):
        text = meta.get("source_text") or "\n\n".join(b.text or "" for b in blocks)
        for sid in sorted(cast_ids - set(before) - {narrator_id}):
            sp = speakers.get(sid)
            pat = _name_pattern([sp.name, *speaker_aliases(sp)]) if sp else None
            if pat and pat.search(text):
                added.append(sp.name)

    chapter = ScriptChapter(
        scene_id=scene.id, position=scene.position, title=scene.title,
        lines=len(speakable_rows), spoken=len(spoken_rows),
        analyzed_at=analyzed_at, analyzed=analyzed, from_import=from_import,
        # Book says + AI decided + by you + no speaker = spoken: a line left with
        # no speaker is counted there, never as decided.
        anchored=sum(1 for r in spoken_rows
                     if r[0].source in ("tag", "propagated") and r[0].speaker_id),
        guessed=sum(1 for r in spoken_rows
                    if r[0].source in ("llm", "second_look") and r[0].speaker_id),
        by_you=sum(1 for r in spoken_rows if r[0].source == "corrected" and r[0].speaker_id),
        no_speaker=len(no_speaker), flagged=len(marked), flag_groups=len(groups),
        # "To check" is for what Analyze (or the import) decided; a chapter
        # never analyzed needs Analyze, not checking.
        to_check=len(marked | no_speaker) if (analyzed or from_import) else 0,
        narration_waiting=len(waiting),
        changed=sum(1 for ln in out_lines if ln.changed),
        no_dialogue_found=analyzed and bool(speakable_rows) and not spoken_rows,
        added_since=added,
        edited_since=(sum(1 for r in speakable_rows if r[0].source in (None, "manual"))
                      if analyzed else 0),
    )
    return chapter, out_lines, groups


def _script_context(db: Session, project_id: str):
    """The book's speakers ({id: Speaker}), their ids, and the narrator's."""
    speakers = {s.id: s for s in db.query(Speaker).filter(Speaker.project_id == project_id)}
    return set(speakers), narrator_speaker_id(db, project_id), speakers


@router.get(
    "/v1/projects/{project_id}/script",
    response_model=ProjectScript,
    summary="Script's chapter grid — one row per chapter",
)
async def project_script(project_id: str, db: Session = Depends(get_db)) -> ProjectScript:
    from ..database.models import Project

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    scenes = (
        db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    )
    by_scene: dict[str, list] = {s.id: [] for s in scenes}
    if scenes:
        for b in (
            db.query(Block)
            .filter(Block.scene_id.in_(list(by_scene)))
            .order_by(Block.scene_id, Block.position)
        ):
            by_scene[b.scene_id].append(b)
    cast_ids, narrator_id, speakers = _script_context(db, project_id)
    pm = _project_meta(db, project_id)
    return ProjectScript(
        project_id=project_id,
        chapters=[
            _chapter_script(s, by_scene[s.id], cast_ids=cast_ids,
                            narrator_id=narrator_id, speakers=speakers, project_meta=pm)[0]
            for s in scenes
        ],
    )


@router.get(
    "/v1/scenes/{scene_id}/script",
    response_model=SceneScript,
    summary="Script's chapter page — the lines, their marks and the speakers",
)
async def scene_script(scene_id: str, db: Session = Depends(get_db)) -> SceneScript:
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    blocks = db.query(Block).filter(Block.scene_id == scene_id).order_by(Block.position).all()
    cast_ids, narrator_id, by_id = _script_context(db, scene.project_id)
    takes = dict(
        db.query(Take.block_id, func.count(Take.id))
        .filter(Take.block_id.in_([b.id for b in blocks]))
        .group_by(Take.block_id)
        .all()
    )
    chapter, lines, groups = _chapter_script(
        scene, blocks, cast_ids=cast_ids, narrator_id=narrator_id, speakers=by_id,
        project_meta=_project_meta(db, scene.project_id), take_counts=takes)
    # Every line a speaker reads — the narrator's narration included, as the
    # speaker filter shows it ("Narrator · 118").
    counts: dict[str, int] = {}
    for ln in lines:
        if ln.speakable and ln.speaker_id:
            counts[ln.speaker_id] = counts.get(ln.speaker_id, 0) + 1
    speakers = [
        ScriptSpeaker(speaker_id=sid, name=sp.name, lines=counts.get(sid, 0))
        for sid, sp in by_id.items()
    ]
    speakers.sort(key=lambda sp: (-sp.lines, sp.name.lower()))
    return SceneScript(
        chapter=chapter,
        project_id=scene.project_id,
        narrator_id=narrator_id,
        lines=lines,
        flag_groups=[
            ScriptFlag(check=g.check, speaker=g.speaker, lines=g.lines, turns=g.turns,
                       other=g.other)
            for g in groups
        ],
        speakers=speakers,
    )


# ── Speaker-correction management (Phase 5) ──────────────────────────────


class CorrectionsCountResponse(BaseModel):
    project_id: str
    count: int


@router.get(
    "/v1/projects/{project_id}/corrections/count",
    response_model=CorrectionsCountResponse,
)
async def count_corrections(project_id: str, db: Session = Depends(get_db)) -> CorrectionsCountResponse:
    from ..database.models import SpeakerCorrection

    n = db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == project_id).count()
    return CorrectionsCountResponse(project_id=project_id, count=n)


@router.delete("/v1/projects/{project_id}/corrections")
async def clear_corrections(project_id: str, db: Session = Depends(get_db)) -> dict:
    from ..database.models import SpeakerCorrection

    deleted = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .delete()
    )
    db.commit()
    return {"deleted": deleted}


@router.delete("/v1/projects/{project_id}/corrections/{fix_id}")
async def delete_correction(project_id: str, fix_id: str, db: Session = Depends(get_db)) -> dict:
    """Remove ONE saved fix — Script's Undo, taking back the fix the undone
    change saved. Without it a mis-click left two contradicting examples in
    the prompt (§8.25). A fix already gone (capped out) is not an error."""
    from ..database.models import SpeakerCorrection

    deleted = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id, SpeakerCorrection.id == fix_id)
        .delete()
    )
    db.commit()
    return {"deleted": deleted}


def record_correction(db: Session, project_id: str, text_snippet: str, speaker_id: str) -> str:
    """THE one correction writer (parity batch 2026-08-06): the Studio block-PATCH
    side effect and the Lab's reassign both call this — same row shape, same
    200-per-project cap (oldest dropped), so the two doors can't drift.
    Returns the new fix's id, so the change that saved it can be undone."""
    from ..database.models import SpeakerCorrection

    fix = SpeakerCorrection(
        project_id=project_id,
        text_snippet=(text_snippet or "")[:400],
        speaker_id=speaker_id,
    )
    db.add(fix)
    # SessionLocal runs autoflush=False — without this flush the overflow query
    # can't see the row just added and the cap drifts one past 200 forever.
    db.flush()
    overflow = (
        db.query(SpeakerCorrection)
        .filter(SpeakerCorrection.project_id == project_id)
        .order_by(SpeakerCorrection.created_at.desc())
        .offset(200)
        .all()
    )
    for row in overflow:
        db.delete(row)
    return fix.id


class CorrectionIn(BaseModel):
    text_snippet: str
    speaker_id: str


@router.post("/v1/projects/{project_id}/corrections")
async def add_correction(
    project_id: str, body: CorrectionIn, db: Session = Depends(get_db)
) -> dict:
    """The Lab's reassign door (parity batch 2026-08-06): a corrected speaker in
    the attribution Lab writes correction memory exactly as Studio's block
    reassign does — record_correction is the shared implementation.
    speaker_id must be a REAL speaker of this book (the FK the table carries) —
    the Lab's typed cast uses synthetic ids, which teach nothing and are
    refused here. (character_id until 2026-08-22, persona_id until 2026-09-29.)"""
    sp = db.get(Speaker, body.speaker_id)
    if sp is None or sp.project_id != project_id:
        raise HTTPException(
            status_code=404, detail=f"speaker {body.speaker_id} not found in this book"
        )
    record_correction(db, project_id, body.text_snippet, body.speaker_id)
    db.commit()
    n = _count_project_corrections(db, project_id)
    return {"ok": True, "count": n}


def _count_project_corrections(db: Session, project_id: str) -> int:
    from ..database.models import SpeakerCorrection

    return db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == project_id).count()

# ── Speaker identification — Studio's Discover step (CONCEPTS §3) ──
#
# A chapter's scan is SAVED on the chapter (decided 2026-09-27, "both"): the
# scene's `metadata.discover = {scanned_at, candidates, named_cast}`. It is what
# lets the Discover step survive a restart and what gives Overview and Discover
# real "scanned / last scanned" data. Nothing becomes a speaker until promote.
# Since 2026-09-29 the record is everyone the chapter names — the AI's new names
# (`candidates`) and the book's speakers found by name (`named_cast`) — and it is
# KEPT: Add and Ignore change a name's status on the page, they never delete it
# from the record, so a scan shows the same people every time. "In your library"
# (a persona of exactly that name) is worked out on the page, against the
# library as it is now; Add casts such a speaker with it (`ensure_speaker`).


class DiscoverSpeakersRequest(BaseModel):
    text: str


class SpeakerCandidateOut(BaseModel):
    name: str
    role_hint: str | None = None
    approx_lines: int | None = None
    # The quote that names them (Discover's "First appearance").
    evidence: str | None = None
    # Is that quote really in the chapter? False = the model made it up, which
    # is the tell of a made-up name (fix 3). None = no quote given.
    evidence_found: bool | None = None


class NamedCastMember(BaseModel):
    """A speaker of this book the chapter names — found by
    `names.cast_named_in`, no AI."""

    speaker_id: str
    name: str
    mentions: int = 0
    evidence: str | None = None


class DiscoverSpeakersResponse(BaseModel):
    scene_id: str
    # The names the AI found that are not speakers here (ignored ones
    # included — the page shows them as Ignored).
    candidates: list[SpeakerCandidateOut]
    # The book's speakers the chapter names (2026-09-29: a scan records everyone).
    named_cast: list[NamedCastMember] = []
    # The run's usage (§16) — None only if the call never ran.
    usage: RunUsage | None = None


@router.post(
    "/v1/scenes/{scene_id}/discover-speakers",
    response_model=DiscoverSpeakersResponse,
    summary="Find the people a chapter names who aren't speakers in the book yet",
)
async def discover_speakers_endpoint(
    scene_id: str,
    body: DiscoverSpeakersRequest,
    db: Session = Depends(get_db),
) -> DiscoverSpeakersResponse:
    """Identification, not attribution: proposes NEW speakers for Studio's
    Discover step. No speaker is created here — promotion is
    POST /v1/projects/{id}/speakers/promote. The scan itself IS saved, on the
    chapter (`metadata.discover`), replacing that chapter's previous scan.

    The model call runs in a worker thread (2026-09-29): it is blocking, and
    on the event loop it stalled every other request to the server — health
    checks included — for the length of each chapter's call."""
    from ..extraction.identify import identify_speakers

    from ..extraction import names

    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    cast = _resolve_cast(scene_id, db)
    settings = get_state().settings.get()
    try:
        raw_out: dict = {}
        marks = resolve_marks(_project_meta(db, scene.project_id).get("speech_marks"), body.text)
        candidates = await asyncio.to_thread(
            identify_speakers, body.text, cast, settings=settings, raw_out=raw_out, marks=marks,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("speaker identification failed")
        raise HTTPException(status_code=502, detail=f"identification failed: {e}")
    out = []
    for c in candidates:
        # Already a speaker under a name the model could not connect — a first
        # or last name alone ("Cael" for Cael Ferren): that person is recorded
        # below, as a speaker the chapter names. An IGNORED name stays in the
        # record; the page shows it as Ignored.
        if names.match(c.name, cast) is not None:
            continue
        out.append(SpeakerCandidateOut(
            name=c.name, role_hint=c.role_hint, approx_lines=c.approx_lines,
            evidence=c.evidence,
            evidence_found=names.quote_in_text(c.evidence, body.text) if c.evidence else None,
        ))
    # Every speaker of this book the chapter names, found by name in the text
    # (no AI — the same on every scan). The narrator is a speaker like any
    # other; prose rarely names it.
    named_cast = [NamedCastMember(**r) for r in names.cast_named_in(body.text, cast)]
    meta = _scene_meta(scene)
    meta["discover"] = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "candidates": [c.model_dump() for c in out],
        "named_cast": [r.model_dump() for r in named_cast],
    }
    scene.metadata_json = json.dumps(meta)
    db.commit()
    return DiscoverSpeakersResponse(scene_id=scene_id, candidates=out, named_cast=named_cast,
                                    usage=raw_out.get("usage"))


class IgnoreDiscoveredRequest(BaseModel):
    names: list[str]


class IgnoreDiscoveredResponse(BaseModel):
    # The project's whole ignore list after the change.
    ignored: list[str]


def project_ignored(project) -> list[str]:
    """The names Discover was told to ignore in this project."""
    raw = getattr(project, "discover_ignored", None) if project is not None else None
    try:
        out = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    return [str(n) for n in out if str(n).strip()] if isinstance(out, list) else []


def _set_ignored(project, names_: list[str]) -> None:
    project.discover_ignored = json.dumps(names_) if names_ else None


@router.post(
    "/v1/projects/{project_id}/discover/ignore",
    response_model=IgnoreDiscoveredResponse,
    summary="Drop names from the project's saved Discover results",
)
async def ignore_discovered_endpoint(
    project_id: str,
    body: IgnoreDiscoveredRequest,
    db: Session = Depends(get_db),
) -> IgnoreDiscoveredResponse:
    """Discover's Ignore: the name is remembered for the project, and every
    chapter that names it shows it as Ignored (fix 4; since 2026-09-29 the saved
    scans keep it). /discover/unignore takes it back off the list."""
    from ..database.models import Project
    from ..extraction.names import norm

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    current = project_ignored(project)
    have = {norm(n) for n in current}
    for n in body.names:
        if n.strip() and norm(n) not in have:
            current.append(n.strip())
            have.add(norm(n))
    _set_ignored(project, current)
    db.commit()
    return IgnoreDiscoveredResponse(ignored=current)


@router.post(
    "/v1/projects/{project_id}/discover/unignore",
    response_model=IgnoreDiscoveredResponse,
    summary="Let Discover propose these names again",
)
async def unignore_discovered_endpoint(
    project_id: str,
    body: IgnoreDiscoveredRequest,
    db: Session = Depends(get_db),
) -> IgnoreDiscoveredResponse:
    """Takes names off the project's ignore list; the chapters that name them
    show them as proposals again."""
    from ..database.models import Project
    from ..extraction.names import norm

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    drop = {norm(n) for n in body.names}
    current = [n for n in project_ignored(project) if norm(n) not in drop]
    _set_ignored(project, current)
    db.commit()
    return IgnoreDiscoveredResponse(ignored=current)


class DiscoverTextRequest(BaseModel):
    """The attribution Lab's discovery body — the identify twin of
    AnalyzeTextRequest (free-form text, no scene). The camelCase override
    fields are the Lab column's pins, same contract as analyze-text."""

    text: str
    known_characters: list[str] = []
    providerId: str | None = None
    model: str | None = None
    temperature: float | None = None
    systemPrompt: str | None = None
    userPrompt: str | None = None
    # The column's remaining tunables (Part 2, 2026-08-06) — same contract as
    # analyze-text.
    think: bool | None = None
    reasoningEffort: str | None = None
    maxTokens: int | None = None
    topP: float | None = None
    samplers: list[dict] = []


@router.post(
    "/v1/extraction/discover-speakers",
    response_model=DiscoverSpeakersResponse,
    summary="Find the people free-form text names (the attribution Lab)",
)
async def discover_text_endpoint(body: DiscoverTextRequest) -> DiscoverSpeakersResponse:
    """No scene id — the Lab's discovery door (parity batch 2026-08-06),
    beside /v1/extraction/analyze-text. Same identify pipeline as the Script
    banner; candidates are a review list, nothing is created."""
    from ..extraction.identify import identify_speakers

    overrides = {
        "providerId": body.providerId,
        "model": body.model,
        "temperature": body.temperature,
        "system": body.systemPrompt,
        "userTemplate": body.userPrompt,
        "think": body.think,
        "reasoningEffort": body.reasoningEffort,
        "maxTokens": body.maxTokens,
        "topP": body.topP,
        "samplers": body.samplers or None,
    }
    overrides = {k: v for k, v in overrides.items() if v is not None}

    def run_fn(action: str, variables: dict):
        from ..engines.llm.run import run_feature

        return run_feature(action, variables, **overrides)

    settings = get_state().settings.get()
    try:
        raw_out: dict = {}
        # In a worker thread, as the scene door's scan is: a blocking model call
        # on the event loop stalls every other request (2026-09-29).
        candidates = await asyncio.to_thread(
            identify_speakers, body.text, body.known_characters, settings=settings,
            run_fn=run_fn, raw_out=raw_out,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("speaker identification failed")
        raise HTTPException(status_code=502, detail=f"identification failed: {e}")
    return DiscoverSpeakersResponse(
        scene_id="(adhoc)",
        candidates=[
            SpeakerCandidateOut(
                name=c.name, role_hint=c.role_hint, approx_lines=c.approx_lines,
                evidence=c.evidence,
            )
            for c in candidates
        ],
        usage=raw_out.get("usage"),
    )


class PromoteCandidate(BaseModel):
    name: str
    # The discovery pass's role hint ("Mara's neighbour") — "Who they are".
    description: str | None = None
    # Other spellings the scan found for the same person ("Sedge" beside
    # "Old Sedge") — kept as "Also called".
    aliases: list[str] = []


class PromoteSpeakersRequest(BaseModel):
    candidates: list[PromoteCandidate]


class PromoteSpeakersResponse(BaseModel):
    created: list[str]
    reused: list[str]


@router.post(
    "/v1/projects/{project_id}/speakers/promote",
    response_model=PromoteSpeakersResponse,
    summary="Add discovered names to the book as speakers",
)
async def promote_speakers_endpoint(
    project_id: str,
    body: PromoteSpeakersRequest,
    db: Session = Depends(get_db),
) -> PromoteSpeakersResponse:
    """Discover's Add: each name becomes a speaker in this book, cast with the
    persona of exactly its name when the library has one ("Every new
    speaker", 2026-09-29). A name the book already has is refused (names are
    unique within a book) and nothing in the batch is saved."""
    from ..database.models import Project

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    created: list[str] = []
    reused: list[str] = []
    for cand in body.candidates:
        speaker, was_created = ensure_speaker(
            db, project_id, name=cand.name, description=cand.description,
            aliases=cand.aliases, unique=True,
        )
        (created if was_created else reused).append(speaker.id)
    db.commit()
    return PromoteSpeakersResponse(created=created, reused=reused)
