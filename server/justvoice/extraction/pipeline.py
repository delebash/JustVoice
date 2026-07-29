# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors

"""End-to-end speaker-attribution pipeline.

Orchestrates: segmentation → anchor propagation → LLM call (via the
Phase 2 dispatch + tier system) → confidence-floor demotion →
AttributionRow assembly.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from llm_runner.llm import LLMMessage
from llm_runner.llm import LLMNotConfiguredError
from llm_runner.llm.dispatch import chat, resolve_tier
from ..engines.llm.config import llm_config
from .anchors import find_anchors
from .prompts import (
    format_characters,
    format_corrections,
    format_paragraphs,
)
from ..engines.llm.prompt_store import get_prompt_store
from .segmentation import segment_paragraphs, split_into_paragraphs

log = logging.getLogger(__name__)


@dataclass
class AttributionRow:
    """Result row for one segment.

    Block columns set by POST /v1/scenes/{id}/analyze on persist:
      persona_id           ← speaker (when not "unknown" or "narrator")
      extraction_confidence ← confidence
      source               ← source
    """

    paragraph_idx: int
    kind: str  # "narration" | "dialogue"
    text: str
    speaker: str  # character_id | "narrator" | "unknown"
    confidence: float
    # "tag" | "propagated" | "llm" | "floored" | "narration" | "auto"
    source: str
    # When source is "floored", carries the LLM's pre-floor speaker so
    # the Speaker Lab UI can display "floored from <speaker>" audit info.
    floored_from: str | None = None
    # When an anchor wins over the LLM, stash the LLM's pick so the
    # Speaker Lab can render disagreement badges.
    llm_speaker: str | None = None
    llm_confidence: float | None = None


class AnalyzeRequest(BaseModel):
    """Pydantic request shape for POST /v1/scenes/{id}/analyze."""

    text: str
    characters: list[dict] = []
    corrections: list[dict] = []
    # Override tier auto-classification per call (Speaker Lab uses this).
    tier: str | None = None
    propagate: bool = True  # apply anchor propagation pass
    use_floor: bool = True  # demote below-floor LLM picks to "unknown"
    # Speaker Lab per-column overrides — None means "use the feature pin /
    # tier defaults". Prompts let the lab tune wording before promoting a
    # preset to production.
    model: str | None = None
    temperature: float | None = None
    system_prompt: str | None = None
    # Custom user-prompt template ({characters}/{corrections}/{paragraphs}
    # tokens are substituted) and a per-call floor that beats the tier's
    # default — both surfaced in the Lab for full parity with the
    # JustWrite original.
    user_prompt: str | None = None
    confidence_floor: float | None = None
    # Route this call through a specific registered LLM provider instead
    # of the feature's resolved route (Speaker Lab provider dropdown).
    provider_id: str | None = None


def _strip_thinking(text: str) -> str:
    """Drop <think>…</think> blocks from Ollama reasoning models so the
    JSON parse below doesn't choke on them."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_first_json_array(text: str) -> list:
    """Pull the first JSON array from possibly-noisy model output."""
    text = _strip_thinking(text)
    m = re.search(r"\[.*\]", text, flags=re.DOTALL)
    if not m:
        return []
    try:
        v = json.loads(m.group(0))
    except (json.JSONDecodeError, TypeError):
        return []
    return v if isinstance(v, list) else []


def analyze_scene(
    *,
    settings,
    request: AnalyzeRequest,
    raw_out: dict | None = None,
) -> list[AttributionRow]:
    """Run the full pipeline.

    Returns the AttributionRow list in the same order as the segments
    appear in the scene. Narration rows have speaker="narrator" with
    confidence=1.0 + source="narration".
    """
    # ── 1. Segment ───────────────────────────────────────────────
    paragraphs = split_into_paragraphs(request.text)
    segments = segment_paragraphs(paragraphs)
    if not segments:
        return []

    # ── 2. Deterministic anchors (pre-LLM) ───────────────────────
    anchors = (
        find_anchors(segments, request.characters)
        if request.propagate
        else {}
    )

    # ── 3. Resolve tier + LLM call (single shot, scene-scoped) ───
    tier = resolve_tier(llm_config(settings), "speaker_attribution")
    if request.tier and request.tier in {"guided", "direct", "reasoned"}:
        # Override forced by the caller (Speaker Lab column setting).
        from llm_runner.llm import TIERS

        tier = TIERS[request.tier]

    # Tier-specific prompt comes from the DB (Lab-editable), keyed
    # speaker_attribution.<guided|direct>; the request can override per-call.
    attr = get_prompt_store().get(f"speaker_attribution.{tier.system_key}")
    system = request.system_prompt or (attr.system if attr else "")
    # Token replacement instead of str.format so a user-edited template
    # with stray braces can't raise KeyError mid-pipeline.
    user = (
        (request.user_prompt or (attr.user_template if attr else ""))
        .replace("{characters}", format_characters(request.characters))
        .replace("{corrections}", format_corrections(request.corrections))
        .replace("{paragraphs}", format_paragraphs(segments))
    )
    floor = (
        request.confidence_floor
        if request.confidence_floor is not None
        else tier.confidence_floor
    )

    dialogue_segments = [s for s in segments if s["kind"] == "dialogue"]
    n_dialogue = len(dialogue_segments)

    llm_picks: list[dict[str, Any]] = []
    if n_dialogue > 0:
        try:
            resp = chat(
                config=llm_config(settings),
                feature="speaker_attribution",
                messages=[LLMMessage(role="user", content=user)],
                system=system,
                temperature=request.temperature if request.temperature is not None else 0.2,
                max_tokens=max(800, 12 * n_dialogue),
                think=tier.think,
                model_override=request.model,
                provider_override=request.provider_id,
            )
            if raw_out is not None:
                raw_out["llm_text"] = resp.text
            llm_picks = _extract_first_json_array(resp.text)
        except LLMNotConfiguredError:
            # Caller (the API layer) catches this separately to return
            # 501 with the actionable message. Bubble it up.
            raise
        except Exception as e:
            log.warning("speaker_attribution LLM call failed: %s", e)
            llm_picks = []

    # Pad / slice to match dialogue count.
    if len(llm_picks) < n_dialogue:
        llm_picks = list(llm_picks) + [
            {"speaker": "unknown", "confidence": 0.4}
            for _ in range(n_dialogue - len(llm_picks))
        ]
    else:
        llm_picks = llm_picks[:n_dialogue]

    # ── 4. Assemble rows ─────────────────────────────────────────
    rows: list[AttributionRow] = []
    dialogue_iter = iter(zip(dialogue_segments, llm_picks))
    for seg in segments:
        if seg["kind"] == "narration":
            rows.append(
                AttributionRow(
                    paragraph_idx=seg["paragraph_idx"],
                    kind="narration",
                    text=seg["text"],
                    speaker="narrator",
                    confidence=1.0,
                    source="narration",
                )
            )
            continue
        # Dialogue
        ds, pick = next(dialogue_iter)
        did = ds["dialogue_id"]
        llm_speaker = str(pick.get("speaker") or "unknown")
        try:
            llm_conf = float(pick.get("confidence") or 0.4)
        except (TypeError, ValueError):
            llm_conf = 0.4

        anchor = anchors.get(did)
        if anchor is not None:
            # Anchor wins on tie-break.
            rows.append(
                AttributionRow(
                    paragraph_idx=seg["paragraph_idx"],
                    kind="dialogue",
                    text=seg["text"],
                    speaker=anchor.speaker,
                    confidence=1.0,
                    source=anchor.source,  # "tag" or "propagated"
                    llm_speaker=llm_speaker,
                    llm_confidence=llm_conf,
                )
            )
            continue

        # No anchor — defer to LLM but apply confidence floor.
        if request.use_floor and llm_conf < floor:
            rows.append(
                AttributionRow(
                    paragraph_idx=seg["paragraph_idx"],
                    kind="dialogue",
                    text=seg["text"],
                    speaker="unknown",
                    confidence=llm_conf,
                    source="floored",
                    floored_from=llm_speaker,
                    llm_speaker=llm_speaker,
                    llm_confidence=llm_conf,
                )
            )
        else:
            rows.append(
                AttributionRow(
                    paragraph_idx=seg["paragraph_idx"],
                    kind="dialogue",
                    text=seg["text"],
                    speaker=llm_speaker,
                    confidence=llm_conf,
                    source="llm",
                )
            )

    return rows
