# SPDX-License-Identifier: GPL-3.0-or-later
"""/v1/ai/prompts — read + edit the per-feature prompts in the DB (the Lab's
prompt editor). Mirrors JustWrite's api/ai_prompts.py.

Prompts are seeded by database/seed.py; this router lets the user view them,
override the text/settings, and reset a built-in back to its seeded default. The
DB is the source of truth (no hardcoded prompt text read at request time).
camelCase wire shape, like the provider router. See
docs/plans/2026-06-21-feature-prompts-db-seed.md.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..database.seed import DEFAULT_FEATURE_PROMPTS
from ..engines.llm.prompt_store import FeaturePromptRow, get_prompt_store

router = APIRouter(tags=["ai"], prefix="/v1/ai")

_DEFAULTS = {d["key"]: d for d in DEFAULT_FEATURE_PROMPTS}


class PromptOut(BaseModel):
    key: str
    feature: str
    system: str
    userTemplate: str
    temperature: float
    think: bool
    builtIn: bool


class PromptList(BaseModel):
    prompts: list[PromptOut]


class PromptUpdate(BaseModel):
    feature: str = ""
    system: str = ""
    userTemplate: str = ""
    temperature: float = 0.7
    think: bool = False


def _out(r: FeaturePromptRow) -> PromptOut:
    return PromptOut(
        key=r.key,
        feature=r.feature,
        system=r.system,
        userTemplate=r.user_template,
        temperature=r.temperature,
        think=r.think,
        builtIn=r.built_in,
    )


@router.get("/prompts", response_model=PromptList)
async def list_prompts() -> PromptList:
    return PromptList(prompts=[_out(r) for r in get_prompt_store().list()])


@router.get("/prompts/{key}", response_model=PromptOut)
async def get_prompt(key: str) -> PromptOut:
    row = get_prompt_store().get(key)
    if row is None:
        raise HTTPException(status_code=404, detail=f"unknown prompt {key!r}")
    return _out(row)


@router.put("/prompts/{key}", response_model=PromptOut)
async def upsert_prompt(key: str, body: PromptUpdate) -> PromptOut:
    default = _DEFAULTS.get(key)
    built_in = default is not None
    feature = body.feature or (str(default.get("feature")) if default else key) or key
    get_prompt_store().upsert(FeaturePromptRow(
        key=key,
        feature=feature,
        system=body.system,
        user_template=body.userTemplate,
        temperature=body.temperature,
        think=body.think,
        built_in=built_in,
    ))
    return _out(get_prompt_store().get(key))


@router.post("/prompts/{key}/reset", response_model=PromptOut)
async def reset_prompt(key: str) -> PromptOut:
    default = _DEFAULTS.get(key)
    if default is None:
        raise HTTPException(status_code=400, detail=f"no seeded default for {key!r} to reset to")
    get_prompt_store().upsert(FeaturePromptRow(
        key=key,
        feature=str(default.get("feature") or key),
        system=str(default.get("system") or ""),
        user_template=str(default.get("user_template") or ""),
        temperature=float(default.get("temperature", 0.7)),
        think=bool(default.get("think", False)),
        built_in=True,
    ))
    return _out(get_prompt_store().get(key))
