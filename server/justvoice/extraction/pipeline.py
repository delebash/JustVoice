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

from llm_runner.llm import LLMNotConfiguredError

from ..engines.llm.run import run_feature
from .anchors import find_anchors
from .prompts import (
    format_characters,
    format_corrections,
    format_paragraphs,
)
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


def pick_tier(tier_override: str | None, model_override: str | None):
    """The READING-STYLE choice (approved 2026-08-06 — "Reasoned" collapsed):
    the caller's override (a Lab column / the production dial injected at the
    API layer) wins; otherwise auto-classify the model the run resolves to —
    small → guided (examples, floor 0.7), bigger → direct (rules only, floor
    0.5). Only TWO styles exist now: the old "reasoned" was direct's text plus
    a forced think flag, and thinking belongs to the preset + the runner's
    capability gate like every feature (a stale "reasoned" override or a
    reasoning-family classification coerces to direct — same text, same
    floor). Shared by analyze_scene and the API's response metadata so the
    echoed style can never drift from the one that ran."""
    from llm_runner.llm import TIERS, spec_for
    from llm_runner.llm.preset_resolve import resolve_feature_preset

    override = tier_override if tier_override in {"guided", "direct"} else (
        "direct" if tier_override == "reasoned" else None
    )
    preset = resolve_feature_preset(
        f"speaker_attribution.{override or 'guided'}", feature="speaker_attribution"
    )
    spec = spec_for(model_override or (preset.model if preset else ""), override)
    # The collapse: a reasoning-family classification means "direct text" —
    # think is NOT this layer's business anymore.
    return TIERS["direct"] if spec.name == "reasoned" else spec


def analyze_scene(
    *,
    settings,
    request: AnalyzeRequest,
    raw_out: dict | None = None,
) -> list[AttributionRow]:
    """Run the full pipeline.

    Returns the AttributionRow list in the same order as the segments
    appear in the scene. Narration rows have speaker="narrator" with
    confidence=1.0 + source="narration". `settings` is unused since the
    pin-era config died (routing is preset-resolved); kept for the callers'
    signature until the settings tree sheds its LLM residue.
    """
    del settings  # pin-era argument
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

    # ── 3. Pick the tier + run through the shared path ───────────
    tier = pick_tier(request.tier, request.model)

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
            # The style's template row owns the wording; code passes the
            # formatted blocks as variables (ruling 9). Thinking is NOT forced
            # here anymore (the 2026-08-06 collapse): the preset's think + the
            # runner's capability gate govern, like every feature. The Lab's
            # system/user candidates ride the explicit-prompt door.
            resp = run_feature(
                f"speaker_attribution.{tier.system_key}",
                {
                    "characters": format_characters(request.characters),
                    "corrections": format_corrections(request.corrections),
                    "paragraphs": format_paragraphs(segments),
                },
                system=request.system_prompt or None,
                userTemplate=request.user_prompt or None,
                temperature=request.temperature,
                maxTokens=max(800, 12 * n_dialogue),
                model=request.model or "",
                providerId=request.provider_id or "",
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
