# SPDX-License-Identifier: GPL-3.0-or-later
"""POST /v1/llm/smart-assign — LLM voice→character matcher.

Phase 4 — pairs with the Studio Cast tab's 🪄 Smart-assign button.
Ports JustWrite's llm.js:139-172 prompt verbatim. Sends a one-shot
chat through the dispatch with feature='smart_assign'; returns the
proposed {character_id: voice_id} map.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..app_state import get_state
from ..engines.llm import LLMMessage
from ..engines.llm.dispatch import LLMNotConfiguredError, chat

log = logging.getLogger(__name__)

router = APIRouter(tags=["llm"])


class SmartAssignCharacter(BaseModel):
    id: str
    name: str
    bio: str | None = None
    personality: str | None = None
    gender: str | None = None
    pronouns: str | None = None
    aliases: list[str] = []
    role: str | None = None


class SmartAssignVoice(BaseModel):
    id: str
    name: str
    gender: str | None = None
    age: int | None = None
    accent: str | None = None
    tone: str | None = None
    language: str | None = None


class SmartAssignRequest(BaseModel):
    characters: list[SmartAssignCharacter]
    voices: list[SmartAssignVoice]


class SmartAssignResponse(BaseModel):
    assignments: dict[str, str]
    note: str | None = None


SYSTEM_PROMPT = """You are a casting director for an audiobook producer.

Given a list of characters with descriptions and a list of available voices
with descriptors, pick the best voice for each character. Return a JSON
object mapping characterId -> voiceId. Match on age, gender, tone, and
accent. Do not invent ids. If no voice fits, omit that character.

Return only the JSON object. No prose, no preamble.
"""


def _format_characters(chars: list[SmartAssignCharacter]) -> str:
    lines: list[str] = []
    for c in chars:
        bits = [f'id="{c.id}"', f'name="{c.name}"']
        if c.role: bits.append(f'role="{c.role}"')
        if c.gender: bits.append(f'gender="{c.gender}"')
        if c.pronouns: bits.append(f'pronouns="{c.pronouns}"')
        if c.aliases: bits.append(f'aliases="{", ".join(c.aliases)}"')
        if c.bio: bits.append(f'description="{c.bio[:200]}"')
        elif c.personality: bits.append(f'description="{c.personality[:200]}"')
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def _format_voices(voices: list[SmartAssignVoice]) -> str:
    lines: list[str] = []
    for v in voices:
        bits = [f'id="{v.id}"', f'name="{v.name}"']
        if v.gender: bits.append(f'gender="{v.gender}"')
        if v.age: bits.append(f'age={v.age}')
        if v.accent: bits.append(f'accent="{v.accent}"')
        if v.tone: bits.append(f'tone="{v.tone}"')
        if v.language: bits.append(f'language="{v.language}"')
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def _parse_assignment_object(text: str) -> dict[str, str]:
    """Pull the first JSON object from possibly-noisy model output."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return {}
    try:
        v = json.loads(m.group(0))
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(v, dict):
        return {}
    return {str(k): str(val) for k, val in v.items() if isinstance(val, (str, int))}


@router.post("/v1/llm/smart-assign", response_model=SmartAssignResponse)
async def smart_assign(body: SmartAssignRequest) -> SmartAssignResponse:
    if not body.characters or not body.voices:
        raise HTTPException(
            status_code=400,
            detail="smart-assign requires non-empty characters AND voices",
        )

    user_prompt = (
        "Characters:\n"
        + _format_characters(body.characters)
        + "\n\nAvailable voices:\n"
        + _format_voices(body.voices)
        + "\n\nReturn only the JSON object."
    )

    settings = get_state().settings.get()
    try:
        resp = chat(
            settings=settings,
            feature="smart_assign",
            messages=[LLMMessage(role="user", content=user_prompt)],
            system=SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=max(400, 80 * len(body.characters)),
        )
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        log.warning("smart_assign LLM call failed: %s", e)
        raise HTTPException(status_code=502, detail=f"smart-assign failed: {e}")

    raw = _parse_assignment_object(resp.text)
    char_ids = {c.id for c in body.characters}
    voice_ids = {v.id for v in body.voices}
    # Defensive filter: ignore ids the model invented or that no longer
    # appear in the catalog (e.g. the user deleted a voice mid-flight).
    assignments = {
        cid: vid for cid, vid in raw.items()
        if cid in char_ids and vid in voice_ids
    }

    note = None
    if not assignments and raw:
        note = "Model returned assignments, but none matched the current catalog."

    return SmartAssignResponse(assignments=assignments, note=note)
