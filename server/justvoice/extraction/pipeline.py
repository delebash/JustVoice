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
from typing import Any, Literal

from pydantic import BaseModel

from llm_runner.llm import LLMNotConfiguredError

from ..engines.llm.run import run_feature, stream_feature
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
    speaker: str  # persona_id | "narrator" | "unknown"
    confidence: float
    # What the PIPELINE can decide — exactly these five, all assigned below.
    # ("auto" was never one of them; it belongs to RoutePick.source, a
    #  different field on a different object.) Two more reach Block.source
    #  once a run is persisted and never come from here: "corrected" (the
    #  user fixed the row) and "manual" (a block nobody has attributed).
    #  models.py Block.source is the full list.
    source: str  # "narration" | "tag" | "propagated" | "llm" | "floored"
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
    # Per-run route force (a route card's Lab run / the API). None = Auto.
    # Renamed from `tier` in the tier-debris cleanup (2026-08-07): route
    # words, never tier; an unknown value (e.g. the dead "reasoned") 422s.
    route: Literal["guided", "direct"] | None = None
    propagate: bool = True  # apply anchor propagation pass
    use_floor: bool = True  # demote below-floor LLM picks to "unknown"
    # Lab per-column overrides — None means "use the resolved preset /
    # route defaults". Prompts let the Lab tune wording before promoting a
    # preset to production.
    model: str | None = None
    temperature: float | None = None
    system_prompt: str | None = None
    # Custom user-prompt template ({characters}/{corrections}/{paragraphs}
    # tokens are substituted) and a per-call floor that beats the route's
    # default — both surfaced in the Lab for full parity with the
    # JustWrite original.
    user_prompt: str | None = None
    confidence_floor: float | None = None
    # Route this call through a specific registered LLM provider instead
    # of the feature's resolved route (Speaker Lab provider dropdown).
    provider_id: str | None = None
    # The Lab column's remaining tunables (Part 2, 2026-08-06 — the controls
    # are REAL): forwarded to the shared run path like any feature's. None =
    # the resolved preset's value (empty preset = uncapped; caps ruling
    # 2026-08-07 — no code-computed budget anymore).
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
    """Pull the answer array out of possibly-noisy model output.

    Measured 2026-09-28 (Qwen3.6-35B-A3B, reasoning on): on some runs whole
    chapters came back blank — the reply carried prose around the JSON, and
    the old greedy `[.*]` spanned from a bracket in that prose ("[D5]") to the
    array's end, so nothing parsed. Now: every place an array of objects can
    start is tried, and the longest one that parses wins. Failing that, the
    individual answer objects are salvaged one by one — safe because each
    answer names its own [D#] (align_picks), so a salvaged set cannot shift.
    """
    text = _strip_thinking(text)
    decoder = json.JSONDecoder()
    best: list = []
    for m in re.finditer(r"\[\s*\{", text):
        try:
            value, _end = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(value, list) and len(value) > len(best):
            best = value
    if best:
        return best
    salvaged = []
    for m in re.finditer(r"\{[^{}]*\}", text):
        try:
            obj = json.loads(m.group(0))
        except ValueError:
            continue
        if isinstance(obj, dict) and "speaker" in obj:
            salvaged.append(obj)
    return salvaged


class AttributionModelError(RuntimeError):
    """The model call behind Script failed; the message is for the user."""


_CTX = re.compile(r'"n_prompt_tokens"\s*:\s*(\d+).*?"n_ctx"\s*:\s*(\d+)', re.DOTALL)


def model_failure_message(e: Exception) -> str:
    """The provider's reason, in words a user can act on. A chapter too big for
    the model's context names both sizes; anything else is the provider's own text."""
    text = str(e)
    m = _CTX.search(text)
    if m or "exceed_context_size" in text:
        sizes = (f" This chapter is {int(m.group(1)):,} tokens and the model holds {int(m.group(2)):,}."
                 if m else "")
        return ("The chapter is too long for the model to read in one go." + sizes
                + " Split it into smaller chapters, or use a model with a larger context.")
    return f"The model call failed: {text}"


_DID = re.compile(r"D?\s*(\d+)", re.IGNORECASE)


def align_picks(picks: list, dialogue_segments: list[dict]) -> list[dict]:
    """One pick per dialogue segment, in segment order.

    Matched by the answer's own `id` ("D12") when the model gives one — the
    measured failure it fixes (2026-09-28, The Ninth Facet): with a plain
    positional array, one merged or skipped answer early in a chapter shifted
    EVERY later answer onto the next line, each still at confidence 1.00 — 15
    of 35 lines wrong in "Brass Rank" and all of them confidently. A segment
    whose id is missing from the reply gets the unknown pad, so a gap stays a
    gap instead of pulling its neighbours out of place.

    A reply with no ids at all (an older prompt) falls back to position.
    """
    pad = {"speaker": "unknown", "confidence": 0.4}
    by_id: dict[int, dict] = {}
    for p in picks or []:
        if not isinstance(p, dict) or p.get("id") is None:
            continue
        m = _DID.search(str(p.get("id")))
        if m:
            by_id.setdefault(int(m.group(1)), p)
    if by_id:
        return [by_id.get(s["dialogue_id"], pad) for s in dialogue_segments]
    picks = [p if isinstance(p, dict) else pad for p in (picks or [])]
    n = len(dialogue_segments)
    return (picks + [pad] * n)[:n]


def prompt_handles(characters: list[dict]) -> tuple[list[dict], dict[str, str]]:
    """The cast as the model sees it — each persona under a short readable
    handle made from its name ("cael_ferren"), not its real id — and the map
    back to the real ids.

    Measured 2026-09-28 (The Ninth Facet, "The Same Hour", reasoning on): with
    the app's UUID persona ids in the prompt the model gave three of Cael's
    lines to Nettle in 7 of 7 runs (and one run went to 18/42); with readable
    ids it was right 2 of 2, and 4 of 4 before. A 36-character opaque code is
    noise the model has to carry through its reasoning; a name-shaped handle is
    something it can reason with. Anchors and persistence keep the real ids —
    only the prompt and the answer mapping use handles.
    """
    out: list[dict] = []
    to_id: dict[str, str] = {}
    for c in characters:
        real = c.get("id")
        base = re.sub(r"[^a-z0-9]+", "_", str(c.get("name") or "").lower()).strip("_") or "speaker"
        handle, n = base, 2
        while handle in to_id:
            handle, n = f"{base}_{n}", n + 1
        to_id[handle] = real
        out.append({**c, "id": handle})
    return out, to_id


_ID_PREFIX = re.compile(r"^(?:c|p|id|char|character|persona)[_\-]", re.IGNORECASE)


def resolve_speaker(raw, characters: list[dict]) -> str:
    """The model's speaker answer as a real cast id, "narrator" or "unknown".

    Measured 2026-09-28: on the guided route the model copied the worked
    examples' id SHAPE ("c_mara") and answered "c_iven_sarraz" for a cast id
    it had been given — the right person, an id that exists nowhere, so the
    line failed. An answer that is not a cast id is matched back to the cast
    by name (extraction/names.py: exact name or alias, first/last name,
    ambiguity refused) after dropping an id-looking prefix and underscores.
    Anything still unmatched becomes "unknown", never a phantom id.
    """
    from .names import match

    s = str(raw or "").strip()
    if not s:
        return "unknown"
    if s.lower() in ("unknown", "narrator"):
        return s.lower()
    ids = {c.get("id") for c in characters if c.get("id")}
    if s in ids:
        return s
    name = _ID_PREFIX.sub("", s).replace("_", " ").strip()
    hit = match(name, characters) or match(s, characters)
    return hit["id"] if hit and hit.get("id") else "unknown"


ROUTES = ("guided", "direct")

# The per-route confidence floors — JV-local since the tier-debris cleanup
# (2026-08-07; the kit's tier registry died). Guided filters stricter because
# small models spread confidence wider. Route data, not a request param: the
# floor demotes below-floor picks to "unknown" AFTER the model answers.
ROUTE_FLOORS = {"guided": 0.7, "direct": 0.5}


@dataclass(frozen=True)
class RoutePick:
    """Which attribution route runs, and why — echoed to the caller so the UI
    shows the SAME choice the pipeline made (never re-derived client-side)."""

    name: str    # "guided" | "direct"
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
    """The Auto pick + its shown work — SIZE ONLY (the tier-debris cleanup,
    2026-08-07: the thinking rule died with the Reasoned route):

      Direct — when the model is at least `direct_min_b` billion params
               (a MoE counts TOTAL params — the size pattern reads the
               catalog's total_params, e.g. 26B for the Gemma MoE).
      Guided — otherwise, including when the size is unknown (worked
               examples never hurt a big model; missing them hurts a
               small one).

    Production (no override): judged against THAT CARD'S OWN model — no
    hidden anchor; the readout the API serves names the model it checked. A
    per-call MODEL override (a Lab column's pin) is the model that actually
    runs, so the rule judges IT."""

    def m(route: str) -> str:
        return model_override or route_model(route)

    checks: list[dict] = []
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


def pick_route(route_override: str | None, settings, model_override: str = "") -> RoutePick:
    """The route choice (the Auto simplification, 2026-08-06): the caller's
    per-run route override (a route card's Lab run / the API `route` field —
    the CLI has no analyze command, verified 2026-08-06) wins; otherwise
    Auto — the size rule, judging the per-call model override when one rides
    the request. Production is always Auto: the stored force died with the
    pills. Floors come from ROUTE_FLOORS (JV-local since the tier-debris
    cleanup 2026-08-07)."""
    if route_override in ROUTES:
        return RoutePick(route_override, ROUTE_FLOORS[route_override], "forced")
    name, _checks = auto_route(
        getattr(getattr(settings, "extraction", None), "direct_min_b", 14.0),
        model_override or "",
    )
    return RoutePick(name, ROUTE_FLOORS[name], "auto")


def analyze_scene(
    *,
    settings,
    request: AnalyzeRequest,
    raw_out: dict | None = None,
    on_delta=None,
    on_progress=None,
) -> list[AttributionRow]:
    """Run the full pipeline.

    Returns the AttributionRow list in the same order as the segments
    appear in the scene. Narration rows have speaker="narrator" with
    confidence=1.0 + source="narration". `settings` carries the route force
    pills + the Auto size rule (settings.extraction — the attribution
    restore); engine routing itself stays preset-resolved.

    `on_delta` (lane 2A, 2026-08-08): when set, the LLM call STREAMS — each raw
    text chunk is passed to `on_delta(text)` as it arrives (the SSE endpoint
    forwards them so the strip shows live tok/s on a minute-long chapter), and
    `on_progress(0..1)` gets the builtin engine's prompt-eval frames. The
    pipeline's inputs, outputs, parsing, floor and raw_out are IDENTICAL either
    way — streaming changes how the reply travels, never what runs.
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
    pick = pick_route(request.route, settings, request.model or "")

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
    prompt_cast, handle_to_id = prompt_handles(request.characters)
    id_to_handle = {v: k for k, v in handle_to_id.items()}
    prompt_corrections = [
        {**c, "persona_id": id_to_handle.get(c.get("persona_id"), c.get("persona_id"))}
        for c in (request.corrections or [])
    ]

    llm_picks: list[dict[str, Any]] = []
    if n_dialogue > 0:
        try:
            # The route's OWN template row + OWN preset run (per-route
            # routing, the attribution restore). The Lab's system/user
            # candidates ride the explicit-prompt door.
            t0 = time.monotonic()
            call_kwargs = dict(
                system=request.system_prompt or None,
                userTemplate=request.user_prompt or None,
                temperature=request.temperature,
                # Caps ruling 2026-08-07: no code-computed budget. An explicit
                # per-call value rides; None falls to the preset (empty =
                # uncapped, nothing sent).
                maxTokens=request.max_tokens,
                model=request.model or "",
                providerId=request.provider_id or "",
                think=request.think,
                reasoningEffort=request.reasoning_effort,
                topP=request.top_p,
                samplers=request.samplers or [],
            )
            variables = {
                "characters": format_characters(prompt_cast),
                "corrections": format_corrections(prompt_corrections),
                "paragraphs": format_paragraphs(segments),
            }
            action = f"speaker_attribution.{pick.name}"
            if on_delta is None:
                resp = run_feature(action, variables, **call_kwargs)
                text = resp.text
                ptok = int(getattr(resp, "prompt_tokens", 0) or 0)
                ctok = int(getattr(resp, "completion_tokens", 0) or 0)
                model_used = getattr(resp, "model", "") or ""
            else:
                # Lane 2A: same route, same template row, same preset — the
                # reply just STREAMS. The final delta carries the usage.
                parts: list[str] = []
                ptok = ctok = 0
                model_used = ""
                for delta in stream_feature(action, variables, **call_kwargs):
                    if delta.done:
                        ptok = int(delta.prompt_tokens or 0)
                        ctok = int(delta.completion_tokens or 0)
                        model_used = delta.model or ""
                    elif delta.progress is not None:
                        if on_progress is not None:
                            on_progress(delta.progress)
                    elif delta.text:
                        parts.append(delta.text)
                        on_delta(delta.text)
                text = "".join(parts)
            if raw_out is not None:
                raw_out["llm_text"] = text
                # §16: the run's usage rides the response (the server always
                # had the numbers — LLMResponse carries them; 0 = unreported).
                raw_out["usage"] = {
                    "prompt_tokens": ptok,
                    "completion_tokens": ctok,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                    "model": model_used,
                }
            llm_picks = _extract_first_json_array(text)
        except LLMNotConfiguredError:
            # Caller (the API layer) catches this separately to return
            # 501 with the actionable message. Bubble it up.
            raise
        except Exception as e:
            # A failed call stops the run with the provider's reason. Swallowing it
            # turned every failure (context overflow, timeout, a model that would not
            # load) into a chapter of "unknown" lines with no message (pass 10).
            log.warning("speaker_attribution LLM call failed: %s", e)
            raise AttributionModelError(model_failure_message(e)) from e

    llm_picks = align_picks(llm_picks, dialogue_segments)

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
        # The model sees name handles; a real id echoed back still counts.
        raw_speaker = pick.get("speaker")
        if raw_speaker in id_to_handle:
            llm_speaker = raw_speaker
        else:
            llm_speaker = handle_to_id.get(
                h := resolve_speaker(raw_speaker, prompt_cast), h)
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
