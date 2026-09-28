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
import json
import logging
import re
from queue import SimpleQueue
from threading import Thread
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from llm_runner.llm import LLMNotConfiguredError

from ..app_state import get_state
from ..database import get_db
from ..database.models import Block, Persona, ProjectPersona, Scene, Take
from ..errors import conflict, not_found
from ..extraction import AnalyzeRequest, analyze_scene
from ..extraction.pipeline import AttributionModelError, auto_route

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


class AnalyzeSceneRequest(BaseModel):
    """Body for POST /v1/scenes/{id}/analyze.

    `text` is the raw scene prose to attribute. `characters` defaults to
    the project's cast (via ProjectPersona) when omitted. `corrections`
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
            "persona_id": r.persona_id or "unknown",
        }
        for r in rows
    ]


def _resolve_cast(scene_id: str, db: Session) -> list[dict]:
    """Look up the project's cast (via ProjectPersona) for `scene_id`."""
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        return []
    rows = (
        db.query(Persona)
        .join(ProjectPersona, ProjectPersona.persona_id == Persona.id)
        .filter(ProjectPersona.project_id == scene.project_id)
        .all()
    )
    return [
        {
            "id": p.id,
            "name": p.name,
            "role": None,
            "gender": None,  # Persona schema doesn't carry these fields
            "pronouns": None,  # today; Phase 4 / Slice 4 (Smart-assign)
            # Persona aliases (2026-09-27) — anchors.py and the attribution
            # prompt always read this key; until now it was always empty.
            "aliases": _persona_aliases(p),
            # One line of the character sheet — Discover's known list (fix 2).
            "description": p.personality,
        }
        for p in rows
    ]


def _persona_aliases(p) -> list[str]:
    try:
        out = json.loads(p.aliases) if getattr(p, "aliases", None) else []
    except (TypeError, ValueError):
        return []
    return [str(a) for a in out if str(a).strip()] if isinstance(out, list) else []


# ── Persistence — the analysis IS the chapter's blocks ───────────────────
#
# Decision 2 of the Script-tab restore: no new table, no new column, no
# renderer-side store. A block that carries a `source` was attributed; the
# Script tab rebuilds its table from `persona_id` + `extraction_confidence`
# + `source` every time you open the chapter.


def _narrator_persona_id(db: Session, project_id: str) -> str | None:
    """The project's Narrator persona — decision 4: narration rows bind to
    it instead of null.

    Every audiobook/podcast project gets one at creation
    (projects_api.create_project) and it sat in the cast unused: nothing
    ever bound it to a block, so every narration block had persona_id null
    and render_chapter_api dropped it silently. Matched by the cast's
    role_label first, then by name for projects whose Narrator was renamed
    in but re-linked without the label."""
    row = (
        db.query(ProjectPersona.persona_id)
        .filter(
            ProjectPersona.project_id == project_id,
            ProjectPersona.role_label == "narrator",
        )
        .first()
    )
    if row:
        return row[0]
    row = (
        db.query(Persona.id)
        .join(ProjectPersona, ProjectPersona.persona_id == Persona.id)
        .filter(ProjectPersona.project_id == project_id)
        .filter(Persona.name.ilike("narrator"))
        .first()
    )
    return row[0] if row else None


# The quote pairs segmentation.py recognizes, in its own order.
_QUOTE_PAIRS = (("“", "”"), ('"', '"'))


def _block_text(kind: str, text: str, source_text: str) -> str:
    """The text a row stores as its block — dialogue keeps its quote marks.

    The segmenter returns the INNER text of a quoted span, so writing that
    verbatim would strip the manuscript's quotes: the chapter would read
    wrong in Chapters, and re-segmenting the stored blocks would find zero
    dialogue (segmentation.py matches quote marks and nothing else).

    Restore the span the source ACTUALLY had — never a tidier one. The
    segmenter has a branch for dialogue that opens and runs to the end of a
    line without ever closing (`segmentation.py:22`); handing that back a
    closing quote would put punctuation in the manuscript that the author
    did not write."""
    if kind != "dialogue":
        return text
    for open_q, close_q in _QUOTE_PAIRS:
        if f"{open_q}{text}{close_q}" in source_text:
            return f"{open_q}{text}{close_q}"
    for open_q, _close_q in _QUOTE_PAIRS:
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


def _persist_attribution(db: Session, scene: Scene, rows: list, text: str) -> PersistInfo:
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
    depend on (both are same-paragraph only)."""
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
    narrator_id = _narrator_persona_id(db, scene.project_id)
    # The speakers the model was actually offered. It answers with ids from
    # the cast it was given, but nothing stops it inventing one — and
    # Block.persona_id is a foreign key, so an invented id would fail the
    # whole insert. An unrecognized name means the line is unplaced, which
    # is what the Script tab and the render blocker are there for.
    known = {
        pid
        for (pid,) in db.query(ProjectPersona.persona_id).filter(
            ProjectPersona.project_id == scene.project_id
        )
    }

    def persona_for(speaker: str) -> str | None:
        if speaker == "narrator":
            return narrator_id
        if not speaker or speaker == "unknown":
            return None
        return speaker if speaker in known else None

    texts = [_block_text(r.kind, r.text, text) for r in rows]
    in_place = len(blocks) == len(rows) and [b.text for b in blocks] == texts

    meta = _scene_meta(scene)
    meta["source_text"] = text
    scene.metadata_json = json.dumps(meta)

    def with_audit(existing: dict, row) -> str | None:
        """Keep the block's own metadata, and record the pre-floor pick.

        `floored_from` is the model's answer before the confidence floor
        discarded it — the single best "check this row" hint in the payload,
        and the only part of a run that had nowhere to live once the Script
        table started reading from blocks instead of the response."""
        meta = dict(existing)
        if row.source == "floored" and row.floored_from:
            meta["floored_from"] = row.floored_from
        else:
            meta.pop("floored_from", None)
        return json.dumps(meta) if meta else None

    if in_place:
        kept = 0
        for block, row in zip(blocks, rows, strict=True):
            if block.source == "corrected":
                kept += 1
                continue
            block.persona_id = persona_for(row.speaker)
            block.extraction_confidence = row.confidence
            block.source = row.source
            block.metadata_json = with_audit(_json_meta(block.metadata_json), row)
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
                persona_id=persona_for(row.speaker),
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
    # Route precedence lives in ONE place (pipeline.pick_route): the body's
    # explicit route (a per-run override) > Auto. The pipeline reports the
    # pick that RAN via raw_out — never re-derived here.
    req = AnalyzeRequest(
        text=body.text,
        characters=characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
    )

    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except AttributionModelError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        log.exception("extraction pipeline failed")
        raise HTTPException(status_code=502, detail=f"extraction failed: {e}")

    persisted = _persist_attribution(db, scene, rows, body.text)
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
    (`data:{"delta"}` · `data:{"progress"}` · a final `data:{"done":true,...}`
    carrying the usage names top-level PLUS everything AnalyzeSceneResponse
    carries · `data:[DONE]`; errors as `data:{"error"}` — the stream has
    started, so there is no HTTP status to send).

    The pipeline is sync + blocking (the kit's stream_action is), so it runs in
    a worker thread feeding a queue the generator drains.

    **The worker never writes.** It hands its rows back and the ASYNC layer
    persists, after checking the client is still there. Cancel has to mean
    cancel: this endpoint began writing the chapter on 2026-08-08, and a
    worker that persisted on its own turned the Cancel button into a lie —
    the toast said "Analyze cancelled" while the run rewrote the chapter
    seconds later, leaving the table on screen disagreeing with the rows in
    the database until you navigated away and back."""
    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")

    characters = body.characters if body.characters is not None else _resolve_cast(scene_id, db)
    corrections = body.corrections if body.corrections is not None else _resolve_corrections(scene.project_id, db)
    settings = get_state().settings.get()
    req = AnalyzeRequest(
        text=body.text,
        characters=characters,
        corrections=corrections,
        route=body.route,
        propagate=body.propagate,
        use_floor=body.use_floor,
    )

    q: SimpleQueue = SimpleQueue()

    def worker() -> None:
        raw_out: dict = {}
        try:
            rows = analyze_scene(
                settings=settings,
                request=req,
                raw_out=raw_out,
                on_delta=lambda t: q.put({"delta": t}),
                on_progress=lambda p: q.put({"progress": p}),
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
            info = _persist_attribution(wdb, wscene, rows, body.text)
            wdb.commit()
            return info.model_dump()
        finally:
            wdb.close()

    async def gen():
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
                    log.info("analyze stream: client gone — scene %s not written", scene_id)
                    break
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
    )
    try:
        raw_out: dict = {}
        rows = analyze_scene(settings=settings, request=req, raw_out=raw_out)
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


def record_correction(db: Session, project_id: str, text_snippet: str, persona_id: str) -> None:
    """THE one correction writer (parity batch 2026-08-06): the Studio block-PATCH
    side effect and the Lab's reassign both call this — same row shape, same
    200-per-project cap (oldest dropped), so the two doors can't drift."""
    from ..database.models import SpeakerCorrection

    db.add(SpeakerCorrection(
        project_id=project_id,
        text_snippet=(text_snippet or "")[:400],
        persona_id=persona_id,
    ))
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


class CorrectionIn(BaseModel):
    text_snippet: str
    persona_id: str


@router.post("/v1/projects/{project_id}/corrections")
async def add_correction(
    project_id: str, body: CorrectionIn, db: Session = Depends(get_db)
) -> dict:
    """The Lab's reassign door (parity batch 2026-08-06): a corrected speaker in
    the attribution Lab writes correction memory exactly as Studio's block
    reassign does — record_correction is the shared implementation.
    persona_id must be a REAL persona (the FK the table carries) — the Lab's
    typed cast uses synthetic ids, which teach nothing and are refused here.
    The field was named character_id until 2026-08-22."""
    if db.query(Persona).filter(Persona.id == body.persona_id).first() is None:
        raise HTTPException(
            status_code=404, detail=f"persona {body.persona_id} not found"
        )
    record_correction(db, project_id, body.text_snippet, body.persona_id)
    db.commit()
    n = _count_project_corrections(db, project_id)
    return {"ok": True, "count": n}


def _count_project_corrections(db: Session, project_id: str) -> int:
    from ..database.models import SpeakerCorrection

    return db.query(SpeakerCorrection).filter(SpeakerCorrection.project_id == project_id).count()

# ── Speaker identification — Studio's Discover step (CONCEPTS §3) ──
#
# A chapter's scan is SAVED on the chapter (decided 2026-09-27, "both"): the
# scene's `metadata.discover = {scanned_at, candidates}`. It is what lets the
# Discover step survive a restart and what gives Overview and Discover real
# "scanned / last scanned" data. Nothing becomes a persona until promote; a
# promoted or ignored name is pruned from every chapter's saved list, so the
# list only ever holds names still waiting on a decision.


def _discover_names(names) -> set[str]:
    return {(n or "").strip().lower() for n in names if (n or "").strip()}


def prune_discovered(db: Session, project_id: str, names) -> int:
    """Drop `names` (case-insensitive) from every chapter's saved scan in the
    project. Returns how many entries were removed. Caller commits."""
    drop = _discover_names(names)
    if not drop:
        return 0
    removed = 0
    for sc in db.query(Scene).filter(Scene.project_id == project_id).all():
        meta = _scene_meta(sc)
        saved = meta.get("discover")
        if not isinstance(saved, dict) or not saved.get("candidates"):
            continue
        keep = [c for c in saved["candidates"] if (c.get("name") or "").strip().lower() not in drop]
        if len(keep) != len(saved["candidates"]):
            removed += len(saved["candidates"]) - len(keep)
            saved["candidates"] = keep
            meta["discover"] = saved
            sc.metadata_json = json.dumps(meta)
    return removed


class DiscoverSpeakersRequest(BaseModel):
    text: str


class LibraryMatch(BaseModel):
    persona_id: str
    name: str


class SpeakerCandidateOut(BaseModel):
    name: str
    role_hint: str | None = None
    approx_lines: int | None = None
    # The quote that names them (Discover's "First appearance").
    evidence: str | None = None
    # Is that quote really in the chapter? False = the model made it up, which
    # is the tell of a made-up name (fix 3). None = no quote given.
    evidence_found: bool | None = None
    # A persona already in the library (not in this cast) this name refers
    # to — "Brick" → Brick Halvorn. Add re-links it instead of making a
    # duplicate (fix A).
    library_match: LibraryMatch | None = None


class DiscoverSpeakersResponse(BaseModel):
    scene_id: str
    candidates: list[SpeakerCandidateOut]
    # The run's usage (§16) — None only if the call never ran.
    usage: RunUsage | None = None


@router.post(
    "/v1/scenes/{scene_id}/discover-speakers",
    response_model=DiscoverSpeakersResponse,
    summary="Find speaking characters not yet in the project cast",
)
async def discover_speakers_endpoint(
    scene_id: str,
    body: DiscoverSpeakersRequest,
    db: Session = Depends(get_db),
) -> DiscoverSpeakersResponse:
    """Identification, not attribution: proposes NEW speakers for Studio's
    Discover step. No persona is created here — promotion is
    POST /v1/projects/{id}/personas/promote. The scan itself IS saved, on the
    chapter (`metadata.discover`), replacing that chapter's previous scan."""
    from datetime import datetime, timezone

    from ..extraction.identify import identify_speakers

    from ..database.models import Project
    from ..extraction import names

    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    cast = _resolve_cast(scene_id, db)
    cast_ids = {c["id"] for c in cast}
    # The producer's other personas (rec C, 2026-09-28): the model is told who
    # they are, so a nickname that lives only in a description ("Answers to
    # Ode.") comes back as that persona instead of a duplicate proposal. Only
    # the ones this text could be naming ride — a library of hundreds would
    # otherwise spend the context on people the chapter never mentions.
    library = names.named_in(body.text, [
        {"id": p.id, "name": p.name, "aliases": _persona_aliases(p), "description": p.personality}
        for p in db.query(Persona).all() if p.id not in cast_ids
    ])
    settings = get_state().settings.get()
    try:
        raw_out: dict = {}
        candidates = identify_speakers(body.text, cast, settings=settings, library=library,
                                       raw_out=raw_out)
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("speaker identification failed")
        raise HTTPException(status_code=502, detail=f"identification failed: {e}")
    project = db.query(Project).filter(Project.id == scene.project_id).first()
    ignored = {names.norm(n) for n in project_ignored(project)}
    by_name = {names.norm(p["name"]): p for p in library}
    out = []
    for c in candidates:
        # Already cast under a name the model could not connect — a first or
        # last name alone ("Cael" for Cael Ferren). Not a proposal.
        if names.match(c.name, cast) is not None:
            continue
        if names.norm(c.name) in ignored:
            continue
        # The model's claim counts only when it names a real library persona.
        lib = by_name.get(names.norm(c.library_name or "")) or names.match(c.name, library)
        out.append(SpeakerCandidateOut(
            name=c.name, role_hint=c.role_hint, approx_lines=c.approx_lines,
            evidence=c.evidence,
            evidence_found=names.quote_in_text(c.evidence, body.text) if c.evidence else None,
            library_match=LibraryMatch(persona_id=lib["id"], name=lib["name"]) if lib else None,
        ))
    meta = _scene_meta(scene)
    meta["discover"] = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "candidates": [c.model_dump() for c in out],
    }
    scene.metadata_json = json.dumps(meta)
    db.commit()
    return DiscoverSpeakersResponse(scene_id=scene_id, candidates=out, usage=raw_out.get("usage"))


class IgnoreDiscoveredRequest(BaseModel):
    names: list[str]


class IgnoreDiscoveredResponse(BaseModel):
    removed: int
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
    """Discover's Ignore: the name leaves every chapter's saved scan AND is
    remembered for the project, so a re-scan does not propose it again
    (fix 4). /discover/unignore takes it back off the list."""
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
    removed = prune_discovered(db, project_id, body.names)
    db.commit()
    return IgnoreDiscoveredResponse(removed=removed, ignored=current)


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
    """Takes names off the project's ignore list. Nothing comes back by itself —
    the next scan of a chapter that names them proposes them again."""
    from ..database.models import Project
    from ..extraction.names import norm

    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None:
        raise not_found(f"project {project_id}")
    drop = {norm(n) for n in body.names}
    current = [n for n in project_ignored(project) if norm(n) not in drop]
    _set_ignored(project, current)
    db.commit()
    return IgnoreDiscoveredResponse(removed=0, ignored=current)


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
    summary="Find speaking characters in free-form text (the attribution Lab)",
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
        candidates = identify_speakers(
            body.text, body.known_characters, settings=settings, run_fn=run_fn,
            raw_out=raw_out,
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
    # The discovery pass's role hint ("Mara's neighbour") — sheet material.
    personality: str | None = None
    # An existing library persona this name refers to (Discover's library
    # match). Given → that persona joins the cast and, if the text called them
    # something new, learns it as an alias; no new persona is made.
    persona_id: str | None = None
    # Other spellings the scan found for the same person ("Sedge" beside
    # "Old Sedge") — kept as aliases on the new or re-linked persona.
    aliases: list[str] = []


def _link_library_persona(db: Session, project_id: str, persona_id: str, found_as: list[str]) -> str:
    """Put an existing persona in this project's cast, and remember the name the
    text used for them as an alias when it is new ("Brick" on Brick Halvorn) —
    Discover fixes A + 1. The same name is then known to every later scan and
    to Analyze's anchors."""
    from ..extraction.names import norm
    from ..storage.personas import clean_aliases

    persona = db.query(Persona).filter(Persona.id == persona_id).first()
    if persona is None:
        raise not_found(f"persona {persona_id}")
    link = (
        db.query(ProjectPersona)
        .filter(ProjectPersona.project_id == project_id, ProjectPersona.persona_id == persona_id)
        .first()
    )
    if link is None:
        db.add(ProjectPersona(project_id=project_id, persona_id=persona_id))
    aliases = _persona_aliases(persona)
    known = {norm(persona.name), *(norm(a) for a in aliases)}
    new = [n.strip() for n in found_as if n and n.strip() and norm(n) not in known]
    if new:
        kept = clean_aliases([*aliases, *new], persona.name)
        persona.aliases = json.dumps(kept) if kept else None
    return persona_id


class PromoteSpeakersRequest(BaseModel):
    candidates: list[PromoteCandidate]


class PromoteSpeakersResponse(BaseModel):
    created: list[str]
    reused: list[str]


@router.post(
    "/v1/projects/{project_id}/personas/promote",
    response_model=PromoteSpeakersResponse,
    summary="Promote discovered speakers to personas in this project's cast",
)
async def promote_speakers_endpoint(
    project_id: str,
    body: PromoteSpeakersRequest,
    db: Session = Depends(get_db),
) -> PromoteSpeakersResponse:
    from ..database.models import Project
    from ._persona_helpers import ensure_project_persona

    if db.query(Project).filter(Project.id == project_id).first() is None:
        raise not_found(f"project {project_id}")
    created: list[str] = []
    reused: list[str] = []
    for cand in body.candidates:
        if cand.persona_id:
            pid = _link_library_persona(db, project_id, cand.persona_id, [cand.name, *cand.aliases])
            reused.append(pid)
            continue
        slug = re.sub(r"[^a-z0-9]+", "_", cand.name.lower()).strip("_") or "speaker"
        pid, was_created = ensure_project_persona(
            db,
            project_id,
            name=cand.name,
            personality=cand.personality,
            imported_from="discovered",
            imported_id=slug,
            aliases=cand.aliases,
        )
        (created if was_created else reused).append(pid)
    # A promoted name is in the cast now — it is no longer a proposal.
    prune_discovered(db, project_id, [n for c in body.candidates for n in (c.name, *c.aliases)])
    db.commit()
    return PromoteSpeakersResponse(created=created, reused=reused)
