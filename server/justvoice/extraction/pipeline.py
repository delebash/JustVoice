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
import time
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
    # The Lab column's remaining tunables (Part 2, 2026-08-06 — the controls
    # are REAL): forwarded to the shared run path like any feature's. None =
    # the resolved preset's value; max_tokens None = the code-computed budget.
    think: bool | None = None
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    top_p: float | None = None
    samplers: list[dict] = []


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


ROUTES = ("guided", "direct", "reasoned")


@dataclass(frozen=True)
class RoutePick:
    """Which attribution route runs, and why — echoed to the caller so the UI
    shows the SAME choice the pipeline made (never re-derived client-side)."""

    name: str    # "guided" | "direct" | "reasoned"
    floor: float
    source: str  # "forced" (per-run override) | "setting" (the force pills) | "auto"


def _provider_default_model(provider_id: str) -> str:
    """The default model of a registered provider — the same fall-through the
    run itself applies (resolve_route: a provider override with no model lands
    on that provider's default model). Empty when unknown."""
    if not provider_id:
        return ""
    try:
        from llm_runner.llm import get_llm_registry

        adapter = get_llm_registry().get(provider_id)
        return (adapter.default_model or "") if adapter is not None else ""
    except Exception:  # noqa: BLE001 — judging falls to "unknown", never breaks a run
        return ""


def route_model(route: str) -> str:
    """The model a route's run would ACTUALLY use (judge-what-runs, ruled
    2026-08-06: "it just defaults to default model"): the card's preset model
    when set, else that preset's provider default — the same resolution the
    run itself uses. Empty when neither is set (Auto then plays it safe)."""
    from llm_runner.llm.preset_resolve import resolve_feature_preset

    preset = resolve_feature_preset(
        f"speaker_attribution.{route}", feature="speaker_attribution"
    )
    if preset is None:
        return ""
    if (preset.model or "").strip():
        return preset.model
    return _provider_default_model(preset.providerId or "")


def model_size_b(model_id: str) -> float:
    """Billions of parameters for the Auto size rule: the catalog row's
    total_params when the model is cataloged ("26B", "E4B"), else the first
    size token in the id ("…-12b-…"). Unknown → 0 (reads as small → Guided)."""
    total = ""
    if model_id:
        try:
            from llm_runner.llm import db as llm_db

            s = llm_db.session()
            try:
                row = s.get(llm_db.ModelCatalog, model_id)
                total = (getattr(row, "total_params", "") or "") if row else ""
            finally:
                s.close()
        except Exception:  # noqa: BLE001 — any lookup failure falls to the id parse
            total = ""
    for source in (total, model_id or ""):
        m = re.search(r"(\d+(?:\.\d+)?)\s*b\b", source, flags=re.IGNORECASE)
        if m:
            try:
                return float(m.group(1))
            except (TypeError, ValueError):
                continue
    return 0.0


def auto_route(direct_min_b: float, model_override: str = "") -> tuple[str, list[dict]]:
    """The Auto pick + its shown work (the approved two visible rules):

      Reasoned — when the model can think (the catalog's Thinking flag,
                 name-heuristic fallback; unknown does NOT force Reasoned).
      Direct   — when the model is at least `direct_min_b` billion params.
      Guided   — otherwise.

    Production (no override): each rule judged against THAT CARD'S OWN model
    — no hidden anchor; the readout the API serves names every model it
    checked. A per-call MODEL override (a Lab column's pin) is the model that
    actually runs, so every rule judges IT — the old system's own documented
    behavior ("the model the run resolves to: request override, else the
    action's preset model")."""
    from llm_runner.llm.capability import model_thinks

    def m(route: str) -> str:
        return model_override or route_model(route)

    checks: list[dict] = []
    m_reason = m("reasoned")
    thinks = bool(m_reason) and model_thinks(m_reason) is True
    checks.append({"route": "reasoned", "model": m_reason, "passed": thinks,
                   "rule": "when the model can think"})
    if thinks:
        return "reasoned", checks
    m_direct = m("direct")
    size = model_size_b(m_direct)
    big = size >= float(direct_min_b or 0)
    checks.append({"route": "direct", "model": m_direct, "passed": big,
                   "rule": f"when the model is at least {direct_min_b:g} B"})
    if big:
        return "direct", checks
    checks.append({"route": "guided", "model": m("guided"),
                   "passed": True, "rule": "otherwise"})
    return "guided", checks


def pick_route(tier_override: str | None, settings, model_override: str = "") -> RoutePick:
    """The route choice (the Auto simplification, 2026-08-06): the caller's
    per-run route override (a route card's Lab run / the API `tier` field —
    the CLI has no analyze command, verified 2026-08-06) wins; otherwise
    Auto — the two visible rules, judging the per-call model override when
    one rides the request. Production is always Auto: the stored force died
    with the pills. Floors come from the shared route registry (guided 0.7 ·
    direct/reasoned 0.5)."""
    from llm_runner.llm import TIERS

    if tier_override in ROUTES:
        return RoutePick(tier_override, TIERS[tier_override].confidence_floor, "forced")
    name, _checks = auto_route(
        getattr(getattr(settings, "extraction", None), "direct_min_b", 14.0),
        model_override or "",
    )
    return RoutePick(name, TIERS[name].confidence_floor, "auto")


def analyze_scene(
    *,
    settings,
    request: AnalyzeRequest,
    raw_out: dict | None = None,
) -> list[AttributionRow]:
    """Run the full pipeline.

    Returns the AttributionRow list in the same order as the segments
    appear in the scene. Narration rows have speaker="narrator" with
    confidence=1.0 + source="narration". `settings` carries the route force
    pills + the Auto size rule (settings.extraction — the attribution
    restore); engine routing itself stays preset-resolved.
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

    # ── 3. Pick the route + run through the shared path ──────────
    pick = pick_route(request.tier, settings, request.model or "")

    floor = (
        request.confidence_floor
        if request.confidence_floor is not None
        else pick.floor
    )
    if raw_out is not None:
        # The pick that RAN, for the response meta — one source, no re-derive.
        raw_out["route"] = pick.name
        raw_out["route_source"] = pick.source
        raw_out["floor"] = floor

    dialogue_segments = [s for s in segments if s["kind"] == "dialogue"]
    n_dialogue = len(dialogue_segments)

    # The code-computed answer budget. Reasoned's think tokens count INSIDE
    # the completion (measured live 2026-08-06, gemma-4-26b-a4b: ~1030
    # think+answer for a 5-line passage against the runner's 1024 reasoning
    # budget — the bare 800 cap truncated the JSON array mid-answer and the
    # tail rows fell to the unknown pad). The route gets thinking headroom;
    # an explicit per-call budget always wins.
    budget = max(800, 12 * n_dialogue)

    llm_picks: list[dict[str, Any]] = []
    if n_dialogue > 0:
        try:
            # The route's OWN template row + OWN preset run (per-route routing,
            # the attribution restore — Reasoned has its own row and a
            # think-ON preset; the runner's capability gate governs models
            # that can't think). The Lab's system/user candidates ride the
            # explicit-prompt door.
            t0 = time.monotonic()
            resp = run_feature(
                f"speaker_attribution.{pick.name}",
                {
                    "characters": format_characters(request.characters),
                    "corrections": format_corrections(request.corrections),
                    "paragraphs": format_paragraphs(segments),
                },
                system=request.system_prompt or None,
                userTemplate=request.user_prompt or None,
                temperature=request.temperature,
                # A caller's explicit budget wins; else the code-computed one
                # (+ thinking headroom on the reasoned route).
                maxTokens=request.max_tokens
                or (budget + 1536 if pick.name == "reasoned" else budget),
                model=request.model or "",
                providerId=request.provider_id or "",
                think=request.think,
                reasoningEffort=request.reasoning_effort,
                topP=request.top_p,
                samplers=request.samplers or [],
            )
            if raw_out is not None:
                raw_out["llm_text"] = resp.text
                # §16: the run's usage rides the response (the server always
                # had the numbers — LLMResponse carries them; 0 = unreported).
                raw_out["usage"] = {
                    "prompt_tokens": int(getattr(resp, "prompt_tokens", 0) or 0),
                    "completion_tokens": int(getattr(resp, "completion_tokens", 0) or 0),
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "model": getattr(resp, "model", "") or "",
                }
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
