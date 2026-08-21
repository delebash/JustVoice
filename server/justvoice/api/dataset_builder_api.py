# SPDX-License-Identifier: MIT
"""/v1/train/builder — generate a LoRA training set line by line.

Alexandria's Dataset tab, host-side. The workflow: describe a voice once,
write rows of emotion + text, generate each row into a clip, listen,
regenerate the ones that came out wrong, then save the survivors as a
training dataset that feeds the Training tab.

Why generated sets are worth having at all: the transcript is KNOWN. A
recorded set has to be transcribed, and a wrong transcript teaches the
voice wrong sounds — the whole reason the Preparer gates on transcript
confidence. A generated row's text is exactly what was spoken.

Seeds are the load-bearing detail. The same seed with the same description
yields the same speaker, so a set generated across many rows is ONE voice
rather than thirty similar ones. Per-row seed wins, then the project's
global seed, then random (`_resolve_seed`).
"""

from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..app_state import get_state
from ..errors import bad_request, not_found
from ..models import TrainingDataset

router = APIRouter(tags=["training"])


class BuilderProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class BuilderRow(BaseModel):
    emotion: str = ""
    text: str = ""
    seed: Optional[int] = None
    status: str = "pending"


class BuilderPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    engine: Optional[str] = None
    language: Optional[str] = None
    global_seed: Optional[int] = None
    rows: Optional[list[BuilderRow]] = None


class GenerateRowRequest(BaseModel):
    row_index: int = Field(..., ge=0)


class SaveDatasetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    # Which generated row anchors the voice — becomes ref.wav. Row index,
    # not sample index: the two differ once ungenerated rows are skipped,
    # and the operator picked a ROW.
    ref_row_index: Optional[int] = None


@router.get("/v1/train/builder")
async def list_builder_projects() -> dict:
    from ..storage import dataset_builder

    return {"projects": dataset_builder.list_projects(get_state().data_dir)}


@router.post("/v1/train/builder", status_code=201)
async def create_builder_project(req: BuilderProjectRequest) -> dict:
    from ..storage import dataset_builder

    return dataset_builder.create_project(get_state().data_dir, req.name.strip())


@router.get("/v1/train/builder/{project_id}")
async def get_builder_project(project_id: str) -> dict:
    from ..storage import dataset_builder

    rec = dataset_builder.get_project(get_state().data_dir, project_id)
    if rec is None:
        raise not_found(f"dataset project '{project_id}' not found")
    return rec


@router.patch("/v1/train/builder/{project_id}")
async def patch_builder_project(project_id: str, req: BuilderPatch) -> dict:
    from ..storage import dataset_builder

    st = get_state()
    patch = req.model_dump(exclude_unset=True)
    if patch.get("rows") is not None:
        # Rows shrank — drop the orphaned clips, or row N's old audio would
        # silently become the audio of whatever row lands at index N next.
        dataset_builder.drop_samples_from(st.data_dir, project_id, len(patch["rows"]))
    rec = dataset_builder.save_project(st.data_dir, project_id, patch)
    if rec is None:
        raise not_found(f"dataset project '{project_id}' not found")
    return rec


@router.delete("/v1/train/builder/{project_id}", status_code=204)
async def delete_builder_project(project_id: str) -> None:
    from ..storage import dataset_builder

    if not dataset_builder.delete_project(get_state().data_dir, project_id):
        raise not_found(f"dataset project '{project_id}' not found")


@router.get("/v1/train/builder/{project_id}/sample/{index}")
async def get_builder_sample(project_id: str, index: int):
    """The generated clip for one row, as audio the player can stream."""
    from ..storage import dataset_builder

    p = dataset_builder.sample_path(get_state().data_dir, project_id, index)
    if not p.is_file():
        raise not_found(f"row {index + 1} has not been generated yet")
    return Response(content=p.read_bytes(), media_type="audio/wav")


def _resolve_seed(row: dict, project: dict) -> int | None:
    """Per-row seed wins, then the project's global seed, then random.

    A negative seed means "random" (Alexandria's own convention — its seed
    fields use -1 for random), so it resolves to None rather than being
    passed down as a literal negative value the engine would reject."""
    for candidate in (row.get("seed"), project.get("global_seed")):
        if candidate is None:
            continue
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        return None if value < 0 else value
    return None


@router.post("/v1/train/builder/{project_id}/generate")
async def generate_builder_row(project_id: str, req: GenerateRowRequest) -> dict:
    """Generate (or regenerate) one row's clip.

    Rides the same door an audition does — POST /v1/voices/preview with
    source="designed" — so a generated training clip is produced by exactly
    the path that renders a designed voice. A second synth route here would
    be a second thing to keep in step.
    """
    from ..storage import dataset_builder
    from .voice_preview_api import VoicePreviewRequest, preview_voice

    st = get_state()
    project = dataset_builder.get_project(st.data_dir, project_id)
    if project is None:
        raise not_found(f"dataset project '{project_id}' not found")

    rows = project.get("rows") or []
    if not (0 <= req.row_index < len(rows)):
        raise bad_request(f"row {req.row_index + 1} does not exist")
    row = rows[req.row_index]

    text = (row.get("text") or "").strip()
    if not text:
        raise bad_request(f"row {req.row_index + 1} has no text to speak")
    description = (project.get("description") or "").strip()
    if not description:
        raise bad_request(
            "describe the voice first — every row is generated from that one "
            "description, which is what keeps the set a single speaker"
        )
    engine = project.get("engine")
    if not engine:
        raise bad_request("pick the model that designs this voice first")

    # Emotion refines the shared description for this row only, exactly as
    # a line's own direction appends to a designed voice at render time.
    emotion = (row.get("emotion") or "").strip()
    prompt = f"{description}, {emotion}" if emotion else description

    seed = _resolve_seed(row, project)
    result = await preview_voice(
        VoicePreviewRequest(
            engine=engine,
            source="designed",
            prompt=prompt,
            preview_text=text,
            language=project.get("language") or "en-US",
            seed=seed,
        )
    )
    wav = base64.b64decode(result.wav_b64)
    dataset_builder.write_sample(st.data_dir, project_id, req.row_index, wav)
    return {
        "row_index": req.row_index,
        "seconds": round(result.duration_sec, 2),
        "seed": seed,
    }


@router.post(
    "/v1/train/builder/{project_id}/dataset",
    response_model=TrainingDataset,
    status_code=201,
)
async def save_builder_dataset(project_id: str, req: SaveDatasetRequest) -> TrainingDataset:
    """Freeze the generated rows into a training dataset."""
    from ..storage import dataset_builder, training_datasets

    st = get_state()
    project = dataset_builder.get_project(st.data_dir, project_id)
    if project is None:
        raise not_found(f"dataset project '{project_id}' not found")

    samples = dataset_builder.generated_samples(st.data_dir, project_id)
    if not samples:
        raise bad_request("generate at least one row before saving")

    # The operator picked a ROW; ungenerated rows are skipped on the way to
    # the dataset, so the sample index is only the same number by accident.
    ref_index = None
    if req.ref_row_index is not None:
        for i, s in enumerate(samples):
            if s["row_index"] == req.ref_row_index:
                ref_index = i
                break
        if ref_index is None:
            raise bad_request(
                f"row {req.ref_row_index + 1} has no generated clip — "
                f"generate it, or choose another reference row"
            )

    return training_datasets.create_dataset(
        st.data_dir,
        req.name.strip(),
        [{"wav_b64": s["wav_b64"], "transcript": s["transcript"]} for s in samples],
        language=project.get("language"),
        ref_index=ref_index,
        origin="generated",
    )
