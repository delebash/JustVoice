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
import math
import re
import time
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from llm_runner.llm import LLMNotConfiguredError

from ..engines.llm.run import measure_feature, run_feature, stream_feature
from ..models import ExtractionSettings
from .anchors import find_anchors
from .prompts import (
    format_characters,
    format_corrections,
    format_paragraphs,
)
from .pieces import ParagraphTooBig, Piece, is_break, plan_pieces
from .segmentation import paragraphs_of, segment_paragraphs, split_into_paragraphs

log = logging.getLogger(__name__)


@dataclass
class AttributionRow:
    """Result row for one segment.

    Block columns set by POST /v1/scenes/{id}/analyze on persist:
      speaker_id           ← speaker (when not "unknown" or "narrator")
      extraction_confidence ← confidence
      source               ← source
    """

    paragraph_idx: int
    kind: str  # "narration" | "dialogue"
    text: str
    speaker: str  # speaker_id | "narrator" | "unknown"
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
    # When an anchor decided the row: the book's own words that named the
    # speaker ("said Marius"); a propagated row carries its tag's words.
    anchor_words: str | None = None


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
    # Treat the model's context as at most this many tokens (the Lab/eval door that
    # forces chapter splitting on a short chapter). None = the model's real context.
    max_context: int | None = None


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
    """The provider's reason, in words a user can act on. An overflow reaches here
    only once splitting has run out — one paragraph alone too big — and names both
    sizes when the provider gave them; anything else is the provider's own text."""
    text = str(e)
    if _is_overflow(e):
        m = _CTX.search(text)
        return _one_paragraph_too_big(int(m.group(1)) if m else None, int(m.group(2)) if m else None)
    return f"The model call failed: {text}"


# The whole id must be a line number ("D12", "d 3", "[D4]", 7) — a handle that
# happens to hold a digit ("nettle_2") is not line 2.
_DID = re.compile(r"\s*\[?\s*D?\s*(\d+)\s*\]?\s*", re.IGNORECASE)


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
        m = _DID.fullmatch(str(p.get("id")))
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


_OVERFLOW_WORDS = ("exceed_context_size", "context_length_exceeded", "maximum context length",
                   "prompt is too long")


def _is_overflow(e: Exception) -> bool:
    """The provider refused the request as bigger than the model's context."""
    text = str(e)
    return bool(_CTX.search(text)) or any(w in text for w in _OVERFLOW_WORDS)


def _pick_did(p) -> int | None:
    """The [D#] an answer names, read the way align_picks reads it."""
    if not isinstance(p, dict) or p.get("id") is None:
        return None
    m = _DID.fullmatch(str(p.get("id")))
    return int(m.group(1)) if m else None


def _place_piece_answers(got: list, piece_ids: list[int]) -> list | None:
    """A piece's answers, each carrying the [D#] it answers — or None when the reply
    cannot be placed. Answers that name their line are kept as they are. A reply
    that names NO line but gives exactly one answer per line of the piece is placed
    by order, as align_picks does for a whole chapter; any other id-less reply
    cannot be trusted to line up and is None."""
    if any(_pick_did(p) is not None for p in got):
        return got
    if got and len(got) == len(piece_ids):
        return [{**p, "id": f"D{did}"} for p, did in zip(got, piece_ids) if isinstance(p, dict)]
    return None


def _one_paragraph_too_big(tokens: int | None, context: int | None) -> str:
    sizes = (f" It needs about {tokens:,} tokens and the model holds {context:,}."
             if tokens and context else "")
    return ("A paragraph of this chapter is too long for the model to read, even on its own." + sizes
            + " Use a model with a larger context.")


def _attribute_in_pieces(request, settings, pick, paragraphs, segments, prompt_cast, prompt_corrections,
                         *, on_delta, on_progress, raw_out) -> list[dict]:
    """The model's answers for every dialogue line, read in as many calls as the
    model's context needs — usually one (2026-09-28, the chapter-splitting plan).

    The prompt is measured first (the kit's measure_action: the model's own
    tokenizer against its real context). When the chapter plus the room its answer
    needs does not fit, it is cut into pieces of whole paragraphs, each with a
    lead-in from the piece before (pieces.py). Every piece is sent with the same
    cast, corrections and prompt; its answers for the lines it OWNS are kept.

    Two backstops, for what measuring cannot see (another provider, a wrong
    estimate): a refusal as too big, or a reply cut off at the context
    (finish_reason "length" — llama.cpp sends no error for that), halves the piece
    and runs both halves. Only a single paragraph that still does not fit fails."""
    t0 = time.monotonic()
    ext = getattr(settings, "extraction", None) or ExtractionSettings()
    lead_in = ext.split_lead_in_paragraphs
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
    # The route's OWN template row + OWN preset run (per-route routing, the
    # attribution restore). The Lab's system/user candidates ride the
    # explicit-prompt door.
    action = f"speaker_attribution.{pick.name}"
    base_vars = {
        "speakers": format_characters(prompt_cast),
        "corrections": format_corrections(prompt_corrections),
    }
    n_para = len(paragraphs)

    def segs_in(lo: int, hi: int) -> list[dict]:
        return [s for s in segments if lo <= s["paragraph_idx"] < hi]

    def vars_for(segs: list[dict]) -> dict:
        return {**base_vars, "paragraphs": format_paragraphs(segs)}

    plan = [Piece(0, 0, n_para)]
    try:
        fit = measure_feature(action, vars_for(segments), **call_kwargs)
        empty = measure_feature(action, vars_for([]), **call_kwargs) if fit is not None else None
    except Exception as e:  # noqa: BLE001 — measuring only sizes pieces; the call itself reports failures
        log.info("speaker_attribution: could not measure the prompt (%s) - running unmeasured", e)
        fit = empty = None
    if fit is not None and empty is not None:
        context = min(fit.context, request.max_context or fit.context)
        overhead = empty.prompt_tokens
        text_tokens = max(fit.prompt_tokens - overhead, 0)
        rendered = [format_paragraphs(segs_in(i, i + 1)) for i in range(n_para)]
        total_chars = sum(len(r) for r in rendered) or 1
        lines = [sum(1 for s in segs_in(i, i + 1) if s["kind"] == "dialogue") for i in range(n_para)]
        costs = [math.ceil(len(rendered[i]) * text_tokens / total_chars) + ext.answer_tokens_per_line * lines[i]
                 for i in range(n_para)]
        room = context - overhead
        if sum(costs) > room:
            breaks = {i for i, para in enumerate(paragraphs) if is_break(para)}
            try:
                plan = plan_pieces(costs, room, lead_in, breaks)
            except ParagraphTooBig as e:
                raise AttributionModelError(_one_paragraph_too_big(costs[e.index] + overhead, context)) from e

    state = {"done": 0, "total": len(plan)}
    texts: list[str] = []
    picks: list[dict] = []
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "model": ""}

    def call(variables: dict) -> tuple[str, str]:
        """One model call -> (reply text, finish_reason)."""
        if on_delta is None:
            resp = run_feature(action, variables, **call_kwargs)
            usage["prompt_tokens"] += int(getattr(resp, "prompt_tokens", 0) or 0)
            usage["completion_tokens"] += int(getattr(resp, "completion_tokens", 0) or 0)
            usage["model"] = getattr(resp, "model", "") or usage["model"]
            return resp.text, getattr(resp, "finish_reason", "") or ""
        # Lane 2A: same route, same template row, same preset — the reply just
        # STREAMS. The final delta carries the usage and why it ended.
        parts: list[str] = []
        finish = ""
        for delta in stream_feature(action, variables, **call_kwargs):
            if delta.done:
                usage["prompt_tokens"] += int(delta.prompt_tokens or 0)
                usage["completion_tokens"] += int(delta.completion_tokens or 0)
                usage["model"] = delta.model or usage["model"]
                finish = getattr(delta, "finish_reason", "") or ""
            elif delta.progress is not None:
                if on_progress is not None:
                    # One bar across every piece.
                    on_progress(min(1.0, (state["done"] + delta.progress) / state["total"]))
            elif delta.text:
                parts.append(delta.text)
                on_delta(delta.text)
        return "".join(parts), finish

    queue = list(plan)
    retried: set[Piece] = set()
    while queue:
        pc = queue.pop(0)
        segs = segs_in(pc.lead, pc.end)
        owned = {s["dialogue_id"] for s in segs if s["kind"] == "dialogue" and s["paragraph_idx"] >= pc.start}
        if not owned:
            state["done"] += 1
            continue
        refused = None
        try:
            text, finish = call(vars_for(segs))
            cut_off = finish == "length"
        except Exception as e:
            if not _is_overflow(e):
                raise
            cut_off, text, refused = True, "", e
        if cut_off:
            if pc.end - pc.start < 2:
                raise AttributionModelError(
                    model_failure_message(refused) if refused else _one_paragraph_too_big(None, None))
            mid = (pc.start + pc.end) // 2
            queue[0:0] = [Piece(pc.lead, pc.start, mid), Piece(max(mid - lead_in, 0), mid, pc.end)]
            state["total"] += 1
            log.info("speaker_attribution: paragraphs %d-%d did not fit - halved", pc.start, pc.end - 1)
            continue
        got = _extract_first_json_array(text)
        whole = pc.lead == 0 and pc.start == 0 and pc.end == n_para
        if not whole:
            got = _place_piece_answers(got, [s["dialogue_id"] for s in segs if s["kind"] == "dialogue"])
            if got is None and pc not in retried:
                # Measured 2026-09-28 (Gemma, forced 5k context, 1 run in 3): a piece's
                # reply put the speaker in the id field — nothing to place it by. Once
                # more, then the lines stay unknown like any unanswered line.
                retried.add(pc)
                queue.insert(0, pc)
                log.info("speaker_attribution: paragraphs %d-%d answered without line numbers - retrying",
                         pc.start, pc.end - 1)
                continue
            got = [p for p in got or [] if _pick_did(p) in owned]
        texts.append(text)
        # The whole chapter in one call keeps every answer (an id-less reply from an
        # older prompt still aligns by position in align_picks); a piece keeps the
        # lines it owns.
        picks.extend(got)
        state["done"] += 1

    if raw_out is not None:
        raw_out["llm_text"] = "\n\n".join(texts)
        # §16: the run's usage rides the response (0 = unreported); `pieces` is how
        # many model calls it took (1 = the chapter fit).
        raw_out["usage"] = {**usage, "duration_ms": int((time.monotonic() - t0) * 1000),
                            "pieces": len(texts)}
    return picks


def analyze_scene(
    *,
    settings,
    request: AnalyzeRequest,
    raw_out: dict | None = None,
    on_delta=None,
    on_progress=None,
    marks: str | None = None,
    segments: list[dict] | None = None,
) -> list[AttributionRow]:
    """Run the full pipeline.

    Returns the AttributionRow list in the same order as the segments
    appear in the scene. Narration rows have speaker="narrator" with
    confidence=1.0 + source="narration". `settings` carries the route force
    pills + the Auto size rule (settings.extraction — the attribution
    restore); engine routing itself stays preset-resolved.

    `marks` is the chapter's speech-mark style (segmentation.SPEECH_MARKS);
    None reads it from the text. `segments` skips segmenting altogether: an
    analyzed chapter whose lines were edited since is re-read as its lines
    stand (`extraction_api._segments_from_lines`), one row per segment, in
    order — `request.text` is then only what the rows are reported against.

    `on_delta` (lane 2A, 2026-08-08): when set, the LLM call STREAMS — each raw
    text chunk is passed to `on_delta(text)` as it arrives (the SSE endpoint
    forwards them so the strip shows live tok/s on a minute-long chapter), and
    `on_progress(0..1)` gets the builtin engine's prompt-eval frames. The
    pipeline's inputs, outputs, parsing, floor and raw_out are IDENTICAL either
    way — streaming changes how the reply travels, never what runs.
    """
    # ── 1. Segment ───────────────────────────────────────────────
    if segments is None:
        paragraphs = split_into_paragraphs(request.text)
        segments = segment_paragraphs(paragraphs, marks=marks)
    else:
        paragraphs = paragraphs_of(segments)
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
        {**c, "speaker_id": id_to_handle.get(c.get("speaker_id"), c.get("speaker_id"))}
        for c in (request.corrections or [])
    ]

    llm_picks: list[dict[str, Any]] = []
    if n_dialogue > 0:
        try:
            llm_picks = _attribute_in_pieces(
                request, settings, pick, paragraphs, segments, prompt_cast, prompt_corrections,
                on_delta=on_delta, on_progress=on_progress, raw_out=raw_out,
            )
        except (LLMNotConfiguredError, AttributionModelError):
            # Not configured -> the API layer's 501 with the actionable message.
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
                    anchor_words=anchor.words or None,
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
