# SPDX-License-Identifier: MIT
"""A line's takes — its own numbers, what its ★ take was made from, whether it
is stale, and the take's audio (Studio Slice 4, decided 2026-10-04;
docs/plans/2026-10-04-slice-4-render.md).

A take is a kept render of one line. Every render makes a new one and nothing
is overwritten; the ★ (default) take is what the chapter plays and the export
ships (D4). A take records its audio, the seed it was made with and its
inputs key (`render_core.line_inputs_key` — the render cache's key). The line
is STALE when the key of what it is made from now differs from the ★ take's:
its words, its direction or its own numbers, the persona (voice, delivery,
seed, effects), or a lexicon entry that respells its words.

"↻ New take" rolls the take its own seed (`Generation.source` "new_take") and
the take is judged against that seed. Any other take is judged against the
persona's seed now, so changing the persona's seed marks those lines stale
(G1). A take with no recorded key or no audio — one made before this slice —
reads stale (G10).

The line's own numbers (D3) live in the block's metadata beside the imported
`pause_after_ms`, so no data reset is needed; for this line they win over the
persona's, an imported pause included (G7).
"""

from __future__ import annotations

import json
import logging
import secrets
from typing import Any

from .database.models import Block, Generation, Project, Scene, Speaker, Take

log = logging.getLogger(__name__)

# Metadata key → delivery key. `pause_after_ms` is the field every import
# adapter already writes.
OVERRIDE_FIELDS = {"speed": "speed", "pitch": "pitch", "gain_db": "gain_db", "pause_after_ms": "pause_after"}
# The limits the hatch's fields keep to — the persona page's own ranges.
OVERRIDE_LIMITS = {"speed": (0.5, 2.0), "pitch": (-12.0, 12.0), "gain_db": (-12.0, 12.0), "pause_after_ms": (0, 10_000)}

CHAPTER_RENDER = "chapter_render"   # made with the persona's seed
NEW_TAKE = "new_take"               # ↻ New take: a seed of its own
TAKE_SOURCES = (CHAPTER_RENDER, NEW_TAKE)

# §8.16's words, the order Render shows them in.
STATES = ("needs a speaker", "needs a voice", "ready", "rendered", "stale")


# ── The line's own numbers (D3) ──────────────────────────────────────


def block_meta(block) -> dict:
    try:
        meta = json.loads(getattr(block, "metadata_json", None) or "{}")
    except ValueError:
        return {}
    return meta if isinstance(meta, dict) else {}


def is_marker(block) -> bool:
    """A podcast music/ad direction line — speaker-less by design, never heard."""
    return bool(block_meta(block).get("marker"))


def line_override(block) -> dict[str, Any]:
    """The numbers this line sets for itself: {speed, pitch, gain_db, pause_after_ms}, set ones only."""
    meta = block_meta(block)
    out: dict[str, Any] = {}
    for key in OVERRIDE_FIELDS:
        raw = meta.get(key)
        if raw is None:
            continue
        try:
            out[key] = max(0, int(raw)) if key == "pause_after_ms" else float(raw)
        except (TypeError, ValueError):
            continue
    return out


def override_delivery(block) -> dict[str, Any]:
    """The line's numbers, delivery-shaped — `plan_line`'s request, which wins over the persona."""
    return {OVERRIDE_FIELDS[k]: v for k, v in line_override(block).items()}


def merge_override(meta: dict, patch: dict) -> dict:
    """PATCH semantics for the hatch: a value sets, null clears, a key left out is kept.
    Raises ValueError naming the field when a value is out of range."""
    out = dict(meta)
    for key, value in patch.items():
        if key not in OVERRIDE_FIELDS:
            raise ValueError(f"unknown field {key!r} — a line can set {', '.join(OVERRIDE_FIELDS)}")
        if value is None:
            out.pop(key, None)
            continue
        lo, hi = OVERRIDE_LIMITS[key]
        try:
            num = int(value) if key == "pause_after_ms" else float(value)
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a number") from None
        if not lo <= num <= hi:
            raise ValueError(f"{key} must be between {lo} and {hi}")
        out[key] = num
    return out


# ── What a line is made from ─────────────────────────────────────────


def plan_block(state, persona, block, *, book_lexicon: str | None = None, seed: int | None = None):
    """The one plan for a line, for every door that renders or judges one:
    `persona_render.plan_line` with the line's own numbers as the request
    (they win over the persona's) and, for ↻ New take, its own seed."""
    from .persona_render import plan_line

    request = override_delivery(block)
    if seed is not None:
        request["seed"] = seed
    return plan_line(
        state, persona, text=block.text,
        direction=getattr(block, "direction", None),
        book_lexicon=book_lexicon, request_delivery=request,
    )


def plan_key(state, plan) -> str | None:
    """The inputs key of a plan — what a take made from it now would record."""
    from .render_core import line_inputs_key

    if not plan.voice:
        return None
    return line_inputs_key(
        state, plan.voice, plan.text, language=plan.language, delivery=plan.delivery,
        seed=plan.seed, lexicons=plan.lexicons, effects=plan.effects,
    )


def roll_seed() -> int:
    """A fresh seed for ↻ New take."""
    return secrets.randbelow(2**31 - 2) + 1


# ── A take's audio ───────────────────────────────────────────────────


def read_take_wav(audio_path: str | None) -> tuple[bytes, int, int] | None:
    """(pcm, sample_rate, channels) of a take's stored WAV, or None when there is none on disk."""
    from .audio.wav import parse_wav_header
    from .media_paths import media_file

    if not audio_path:
        return None
    try:
        raw = media_file(audio_path).read_bytes()
    except OSError:
        return None
    try:
        fmt, offset, size = parse_wav_header(raw)
    except Exception:
        log.warning("take audio unreadable: %s", audio_path)
        return None
    return raw[offset:offset + size], fmt.sample_rate, fmt.channels


def has_audio(gen) -> bool:
    from .media_paths import media_file

    return bool(gen is not None and gen.audio_path and media_file(gen.audio_path).is_file())


def live_takes(db, block_ids) -> dict[str, tuple[Take, Generation]]:
    """{block_id: (★ take, its generation)} for the blocks that have one."""
    ids = list(block_ids)
    if not ids:
        return {}
    takes = (
        db.query(Take)
        .filter(Take.block_id.in_(ids), Take.is_default == True)  # noqa: E712
        .order_by(Take.created_at)
        .all()
    )
    gens = {
        g.id: g for g in db.query(Generation).filter(Generation.id.in_([t.generation_id for t in takes]))
    } if takes else {}
    out: dict[str, tuple[Take, Generation]] = {}
    for t in takes:   # newest last, so a block left with two defaults reads its newest
        g = gens.get(t.generation_id)
        if g is not None:
            out[t.block_id] = (t, g)
    return out


def played_takes(db, block_ids) -> dict[str, Generation]:
    """{block_id: generation} for the lines whose ★ take the chapter plays — those with audio."""
    return {bid: g for bid, (_t, g) in live_takes(db, block_ids).items() if has_audio(g)}


# ── States ───────────────────────────────────────────────────────────


def take_is_current(state, persona, block, gen, *, book_lexicon: str | None) -> bool:
    """Was the ★ take made from what the line is made from now?"""
    if gen is None or not gen.cache_key or not has_audio(gen):
        return False
    seed = gen.seed if gen.source == NEW_TAKE else None
    try:
        key = plan_key(state, plan_block(state, persona, block, book_lexicon=book_lexicon, seed=seed))
    except Exception as e:   # an unresolvable voice, a lexicon gone — not current
        log.debug("block %s: inputs key failed: %s", block.id, e)
        return False
    return bool(key) and key == gen.cache_key


def heard_blocks(db, scene, project) -> list[tuple[int, Block]]:
    """(line number, block) for a chapter's lines that are heard — text, not a
    podcast marker, not a dialogue tag the book leaves out. The number is the
    block's place in the chapter, the one the render's refusal names."""
    from .extraction.tags import left_out_blocks

    blocks = db.query(Block).filter(Block.scene_id == scene.id).order_by(Block.position).all()
    try:
        leave_out = bool(json.loads(getattr(project, "metadata_json", None) or "{}").get("leave_out_tags"))
    except (TypeError, ValueError):
        leave_out = False
    left_out = left_out_blocks(blocks) if leave_out else set()
    return [
        (n, b) for n, b in enumerate(blocks, start=1)
        if (b.text or "").strip() and b.id not in left_out and not is_marker(b)
    ]


def scene_lines(db, state, scene_id: str) -> dict:
    """Render's line page for one chapter: each heard line with its state, its
    ★ take and its number of takes, and the chapter's counts."""
    from .errors import not_found
    from .extraction.flags import spoken_block

    scene = db.query(Scene).filter(Scene.id == scene_id).first()
    if scene is None:
        raise not_found(f"scene {scene_id}")
    project = db.query(Project).filter(Project.id == scene.project_id).first()
    speakers = {s.id: s for s in db.query(Speaker).filter(Speaker.project_id == scene.project_id)}
    book_lexicon = getattr(project, "default_lexicon_id", None)
    heard = heard_blocks(db, scene, project)
    ids = [b.id for _n, b in heard]
    live = live_takes(db, ids)
    counts_by_block: dict[str, int] = {}
    if ids:
        for (bid,) in db.query(Take.block_id).filter(Take.block_id.in_(ids)):
            counts_by_block[bid] = counts_by_block.get(bid, 0) + 1

    rows = []
    counts = {s: 0 for s in STATES}
    for n, block in heard:
        speaker = speakers.get(block.speaker_id) if block.speaker_id else None
        persona = state.personas.get(speaker.persona_id) if speaker is not None and speaker.persona_id else None
        take, gen = live.get(block.id, (None, None))
        if speaker is None:
            st = "needs a speaker"
        elif persona is None or not persona.voice_id:
            st = "needs a voice"
        elif take is None:
            st = "ready"
        elif take_is_current(state, persona, block, gen, book_lexicon=book_lexicon):
            st = "rendered"
        else:
            st = "stale"
        counts[st] += 1
        rows.append({
            "block_id": block.id,
            "n": n,
            "text": block.text,
            "speaker_id": block.speaker_id,
            "spoken": spoken_block(block.source, block.text),
            "direction": block.direction or "",
            "override": line_override(block),
            "state": st,
            "takes": counts_by_block.get(block.id, 0),
            "live": _take_summary(take, gen) if take is not None else None,
        })
    return {
        "scene_id": scene.id,
        "title": scene.title or "",
        "position": scene.position,
        "lines": rows,
        "counts": _counts_out(counts),
    }


def project_render_state(db, state, project_id: str) -> dict:
    """Every chapter's counts in §8.16's words — Render's grid, Studio's step
    card, Overview and Home."""
    scenes = db.query(Scene).filter(Scene.project_id == project_id).order_by(Scene.position).all()
    chapters = []
    total = {s: 0 for s in STATES}
    for scene in scenes:
        c = scene_lines(db, state, scene.id)["counts"]
        chapters.append({"scene_id": scene.id, "title": scene.title or "", **c})
        for s, key in zip(STATES, ("needs_speaker", "needs_voice", "ready", "rendered", "stale")):
            total[s] += c[key]
    return {"project_id": project_id, "chapters": chapters, "totals": _counts_out(total)}


def _counts_out(c: dict) -> dict:
    return {
        "lines": sum(c.values()),
        "needs_speaker": c["needs a speaker"],
        "needs_voice": c["needs a voice"],
        "ready": c["ready"],
        "rendered": c["rendered"],
        "stale": c["stale"],
    }


def _take_summary(take, gen) -> dict:
    return {
        "take_id": take.id,
        "generation_id": take.generation_id,
        "seconds": gen.duration_sec if gen is not None else None,
        "audio_url": f"/v1/generations/{gen.id}/audio" if has_audio(gen) else None,
        "label": take.label,
        "new_seed": bool(gen is not None and gen.source == NEW_TAKE),
        "text": gen.text if gen is not None else None,
    }


# ── A take's audio goes with it ──────────────────────────────────────


def delete_generation(db, gen) -> None:
    """A take's generation row and its file."""
    from .media_paths import media_file

    if gen.audio_path:
        try:
            media_file(gen.audio_path).unlink(missing_ok=True)
        except OSError as e:
            log.warning("generation %s: could not delete %s: %s", gen.id, gen.audio_path, e)
    db.delete(gen)


def sweep_orphan_takes(db) -> int:
    """Generations a deleted take left behind — a take goes by FK cascade with
    its line, chapter or book, and its generation (SET NULL) stayed, file and
    all. Called after those deletes and at boot. Returns how many went."""
    referenced = db.query(Take.generation_id)
    orphans = (
        db.query(Generation)
        .filter(Generation.source.in_(TAKE_SOURCES), ~Generation.id.in_(referenced))
        .all()
    )
    for g in orphans:
        delete_generation(db, g)
    if orphans:
        db.commit()
    return len(orphans)


def sweep_orphan_takes_now() -> int:
    """`sweep_orphan_takes` in its own session — for callers holding none."""
    from .database import session as db_session

    if db_session.SessionLocal is None:
        return 0
    db = db_session.SessionLocal()
    try:
        return sweep_orphan_takes(db)
    except Exception as e:
        log.warning("take sweep failed: %s", e)
        db.rollback()
        return 0
    finally:
        db.close()
