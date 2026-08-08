# SPDX-License-Identifier: MIT
"""The dictation-cleanup Lab doors.

POST /v1/ai/prompt-preview — the family prompt-preview contract, surviving
solely as the COMPOSED-CALL door (the 2026-08-08 carve-out): for the `refine`
feature it returns the REAL composed call — the base template rendered with
the sections the user's Capture toggles enable — so what the sectioned pane
shows and tunes is exactly what a dictation run sends. Any other feature 404s
(fail-loud; the kit shows the error line, never a fallback picker).

POST /v1/refine/lab-run — the refine Lab's run door: the SAME path production
takes (explicit composed system + the few-shot REFINEMENT_EXAMPLES history —
the Lab used to send none, task #22's recorded gap), with the column's
overrides riding like any feature's.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, HTTPException
from llm_runner.llm import LLMNotConfiguredError
from pydantic import BaseModel

from ..app_state import get_state
from ..refinement import (
    REFINEMENT_EXAMPLES,
    RefinementFlags,
    compose_refinement_system,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["refine-lab"])


class PromptPreviewRequest(BaseModel):
    feature: str


class PromptPreviewResponse(BaseModel):
    system: str
    user: str
    sample: str = ""


# The seeded refine.base Lab sample's transcript (seed_presets.py) — the
# preview's user half shows a real dictation, not a placeholder.
_PREVIEW_TRANSCRIPT = "um can you check if the uh export finished before we send it"


def _current_flags() -> RefinementFlags:
    s = get_state().settings.get()
    return RefinementFlags(
        smart_cleanup=s.captures.smart_cleanup,
        self_correction=s.captures.self_correction,
        preserve_technical=s.captures.preserve_technical,
    )


@router.post("/v1/ai/prompt-preview", response_model=PromptPreviewResponse)
async def prompt_preview(body: PromptPreviewRequest) -> PromptPreviewResponse:
    if body.feature != "refine":
        raise HTTPException(
            status_code=404, detail=f"no prompt preview for {body.feature!r}"
        )
    flags = _current_flags()
    on = [k.replace("_", " ") for k, v in flags.to_dict().items() if v]
    return PromptPreviewResponse(
        system=compose_refinement_system(flags),
        user=_PREVIEW_TRANSCRIPT,
        sample=("sections on: " + ", ".join(on)) if on else "ground rules only",
    )


class RefineLabRunRequest(BaseModel):
    """The refine Lab column's run body — camelCase like the shared
    LLM-config contract the renderer sends."""

    transcript: str = ""
    systemPrompt: str | None = None
    userPrompt: str | None = None
    providerId: str | None = None
    model: str | None = None
    temperature: float | None = None
    think: bool | None = None
    reasoningEffort: str | None = None
    maxTokens: int | None = None
    topP: float | None = None
    samplers: list[dict] = []


class RefineLabRunResponse(BaseModel):
    text: str
    model: str = ""
    usage: dict = {}


@router.post("/v1/refine/lab-run", response_model=RefineLabRunResponse)
async def refine_lab_run(body: RefineLabRunRequest) -> RefineLabRunResponse:
    from ..engines.llm.run import run_feature

    overrides = {
        "providerId": body.providerId,
        "model": body.model,
        "temperature": body.temperature,
        "think": body.think,
        "reasoningEffort": body.reasoningEffort,
        "maxTokens": body.maxTokens,
        "topP": body.topP,
        "samplers": body.samplers or None,
        "system": body.systemPrompt,
        "userTemplate": body.userPrompt,
    }
    overrides = {k: v for k, v in overrides.items() if v is not None}
    # The column's own system wins when it sent one (what you see is what
    # runs); else the CURRENT toggles' composition — exactly production's
    # call (the sectioned redesign, 2026-08-08).
    overrides.setdefault("system", compose_refinement_system(_current_flags()))
    t0 = time.monotonic()
    try:
        resp = run_feature(
            "refine.base",
            {"transcript": body.transcript or ""},
            history=[
                m
                for user_text, assistant_text in REFINEMENT_EXAMPLES
                for m in (
                    {"role": "user", "content": user_text},
                    {"role": "assistant", "content": assistant_text},
                )
            ],
            **overrides,
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.exception("refine lab run failed")
        raise HTTPException(status_code=502, detail=f"refine failed: {e}")
    return RefineLabRunResponse(
        text=resp.text,
        model=resp.model,
        usage={
            "prompt_tokens": int(getattr(resp, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(resp, "completion_tokens", 0) or 0),
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "model": getattr(resp, "model", "") or "",
        },
    )
