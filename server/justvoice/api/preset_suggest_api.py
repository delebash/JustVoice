# SPDX-License-Identifier: MIT
"""POST /v1/llm/preset-suggest — LLM-driven render-preset classifier.

Phase 6. Pairs with the Studio Render tab's 💡 Suggest button. Ports
JustWrite's llm.js:229-275 prompt verbatim. Samples chapter text
(first 2000 + last 1500 chars) and asks the LLM to pick the best-fit
render preset by exact name from the provided list.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..app_state import get_state
from ..database import get_db
from ..database.models import Block, RenderPreset, Scene
from llm_runner.llm import LLMMessage, LLMNotConfiguredError
from llm_runner.llm.dispatch import chat
from ..engines.llm.config import llm_config
from ..engines.llm.prompt_store import get_prompt_store
from ..errors import not_found

log = logging.getLogger(__name__)

router = APIRouter(tags=["llm"])


class PresetSuggestRequest(BaseModel):
    scene_id: str


class PresetSuggestResponse(BaseModel):
    preset_id: str | None
    preset_name: str | None
    reason: str = ""
    note: str | None = None


def _sample_chapter_text(scene_id: str, db: Session) -> str:
    """Pull the scene's blocks, join their text, and sample first 2000
    + last 1500 chars for the LLM. Matches JustWrite's sampling rule —
    middle filler doesn't shift tone much.
    """
    blocks = (
        db.query(Block).filter(Block.scene_id == scene_id).order_by(Block.position).all()
    )
    joined = "\n\n".join(b.text for b in blocks)
    if len(joined) <= 3500:
        return joined
    return joined[:2000] + "\n\n[...]\n\n" + joined[-1500:]


def _parse_response(text: str) -> tuple[str, str]:
    """Pull the first JSON object from possibly-noisy model output.
    Returns (preset_name, reason). Both empty on parse failure.
    """
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return "", ""
    try:
        v = json.loads(m.group(0))
    except (json.JSONDecodeError, TypeError):
        return "", ""
    if not isinstance(v, dict):
        return "", ""
    return str(v.get("preset") or ""), str(v.get("reason") or "")


@router.post("/v1/llm/preset-suggest", response_model=PresetSuggestResponse)
async def suggest_preset(
    body: PresetSuggestRequest, db: Session = Depends(get_db)
) -> PresetSuggestResponse:
    scene = db.query(Scene).filter(Scene.id == body.scene_id).first()
    if scene is None:
        raise not_found(f"scene {body.scene_id}")

    # Available presets — project-scoped + global (project_id is null).
    presets = (
        db.query(RenderPreset)
        .filter(
            (RenderPreset.project_id == scene.project_id)
            | (RenderPreset.project_id.is_(None))
        )
        .order_by(RenderPreset.name)
        .all()
    )
    if not presets:
        raise HTTPException(
            status_code=400,
            detail="No render presets defined. Create some on the Render Presets tab first.",
        )

    chapter_text = _sample_chapter_text(body.scene_id, db)
    if not chapter_text.strip():
        raise HTTPException(
            status_code=400,
            detail="Scene has no blocks to classify — analyze + apply first.",
        )

    user_prompt = (
        "Available presets:\n"
        + "\n".join(f"  - {p.name}" + (f" — {p.description}" if p.description else "") for p in presets)
        + "\n\nChapter text:\n"
        + chapter_text
        + "\n\nReturn only the JSON object."
    )

    prompt = get_prompt_store().get("render_preset_suggest")
    if prompt is None:
        raise HTTPException(status_code=500, detail="render_preset_suggest prompt not seeded")
    settings = get_state().settings.get()
    try:
        resp = chat(
            config=llm_config(settings),
            feature="render_preset_suggest",
            messages=[LLMMessage(role="user", content=user_prompt)],
            system=prompt.system,
            temperature=prompt.temperature,
            max_tokens=200,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.warning("preset_suggest LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"suggest failed: {e}")

    preset_name, reason = _parse_response(resp.text)
    if not preset_name:
        return PresetSuggestResponse(
            preset_id=None,
            preset_name=None,
            reason=reason,
            note="model returned no preset; check the response in the Speaker Lab if this repeats",
        )

    # Match by exact name (case-insensitive).
    match = next((p for p in presets if p.name.lower() == preset_name.lower()), None)
    if match is None:
        return PresetSuggestResponse(
            preset_id=None,
            preset_name=preset_name,
            reason=reason,
            note=f"model picked {preset_name!r} but no preset by that name exists",
        )
    return PresetSuggestResponse(
        preset_id=match.id,
        preset_name=match.name,
        reason=reason,
    )
