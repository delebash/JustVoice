# SPDX-License-Identifier: MIT AND GPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors
#
# Deterministic dialogue-tag anchor propagation. Ported from JustWrite
# speakerAttribution.js:218-303 — the pre-LLM pass that catches
# "Sarah said" patterns and turn-taking before spending LLM cycles.

"""Anchor propagation — finds <Name> <said> patterns in narration,
attaches the nearest dialogue segment to that name, then sweeps forward
+ backward through unanchored dialogue segments to fill in pronoun-only
or bare turn-taking patterns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


# 40+ dialogue-tag verbs. Order doesn't matter — they're joined into one
# regex alternation. Past + present + third-person where relevant.
DIALOGUE_VERBS = [
    "said", "says", "asked", "asks", "replied", "replies", "answered", "answers",
    "responded", "responds", "shouted", "shouts", "yelled", "yells",
    "whispered", "whispers", "murmured", "murmurs", "muttered", "mutters",
    "growled", "growls", "snapped", "snaps", "snarled", "snarls",
    "barked", "barks", "called", "calls", "cried", "cries",
    "declared", "declares", "demanded", "demands", "exclaimed", "exclaims",
    "explained", "explains", "groaned", "groans", "hissed", "hisses",
    "insisted", "insists", "interrupted", "interrupts", "laughed", "laughs",
    "mumbled", "mumbles", "noted", "notes", "objected", "objects",
    "offered", "offers", "pleaded", "pleads", "remarked", "remarks",
    "repeated", "repeats", "retorted", "retorts", "sighed", "sighs",
    "smiled", "smiles", "sobbed", "sobs", "stammered", "stammers",
    "stuttered", "stutters", "thought", "thinks", "wailed", "wails",
    "warned", "warns", "wondered", "wonders",
]


@dataclass
class Anchor:
    """A single deterministic attribution from the pre-LLM pass."""

    speaker: str  # character id
    source: str   # "tag" (Name + verb adjacency) | "propagated" (forward/back fill)


def _build_name_regex(characters: list[dict]) -> re.Pattern:
    """Match any character's canonical name OR alias as a whole word.

    Sorted longest-first so "Mary Anne" wins over "Mary" when both appear.
    """
    fragments: list[str] = []
    for c in characters:
        for label in [c.get("name"), *(c.get("aliases") or [])]:
            if label:
                fragments.append(re.escape(label))
    if not fragments:
        # No characters at all — return a pattern that matches nothing.
        return re.compile(r"(?!x)x")
    fragments.sort(key=len, reverse=True)
    pattern = r"\b(" + "|".join(fragments) + r")\b"
    return re.compile(pattern, re.IGNORECASE)


def _build_verb_regex() -> re.Pattern:
    pattern = r"\b(" + "|".join(DIALOGUE_VERBS) + r")\b"
    return re.compile(pattern, re.IGNORECASE)


def _name_to_id(characters: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for c in characters:
        cid = c.get("id")
        if not cid:
            continue
        for label in [c.get("name"), *(c.get("aliases") or [])]:
            if label:
                out[label.lower()] = cid
    return out


def find_anchors(
    segments: list[dict],
    characters: list[dict],
) -> dict[int, Anchor]:
    """Given a list of segments (each {kind: "narration" | "dialogue",
    text, dialogue_id?}), return {dialogue_id → Anchor} for every
    dialogue segment we could deterministically attribute.

    Two passes:
      1. Tag pass — scan each narration for <Name> <verb> or <verb> <Name>;
         the adjacent dialogue segment (before or after) anchors to that
         name. Both adjacencies are eligible so "Mara said" before AND
         after both attach correctly.
      2. Propagation pass — forward sweep + backward sweep through
         dialogue segments. Unanchored dialogue inherits the nearest
         anchored speaker in the same paragraph. Source flips to
         "propagated".

    Per the JustWrite audit: anchors WIN over LLM on tie-break (the
    pipeline overrides any LLM call with the anchor for the segments
    this function returns).
    """
    name_re = _build_name_regex(characters)
    verb_re = _build_verb_regex()
    name_to_id = _name_to_id(characters)

    anchors: dict[int, Anchor] = {}

    # ── Pass 1: tag adjacency ────────────────────────────────────
    for i, seg in enumerate(segments):
        if seg.get("kind") != "narration":
            continue
        text = seg.get("text", "")
        if not text:
            continue
        # Need both a name AND a dialogue verb in the same narration to
        # treat it as a tag.
        names = list(name_re.finditer(text))
        verbs = list(verb_re.finditer(text))
        if not names or not verbs:
            continue
        # Use the name closest to a verb (within ~12 chars in either
        # direction) — defends against narration like "Mara stood up.
        # Sarah said, 'Where?'"
        best_name: str | None = None
        best_dist = 1_000_000
        for n in names:
            for v in verbs:
                dist = abs(n.start() - v.start())
                if dist < best_dist:
                    best_dist = dist
                    best_name = n.group(0)
        if best_name is None or best_dist > 18:
            continue
        speaker_id = name_to_id.get(best_name.lower())
        if not speaker_id:
            continue

        # Attach to the dialogue segment immediately before AND after,
        # but only when the neighbor is in the SAME paragraph. Cross-
        # paragraph anchoring (a tag in one paragraph reaching into the
        # next) produces too many false positives — turn-taking across
        # paragraphs is a per-paragraph speaker change, not a continuation.
        narration_para = seg.get("paragraph_idx")
        for j in (i - 1, i + 1):
            if 0 <= j < len(segments):
                neighbor = segments[j]
                if neighbor.get("kind") != "dialogue":
                    continue
                if neighbor.get("paragraph_idx") != narration_para:
                    continue
                did = neighbor.get("dialogue_id")
                if did is None or did in anchors:
                    continue
                anchors[did] = Anchor(speaker=speaker_id, source="tag")

    # ── Pass 2: forward + backward propagation (per paragraph) ───
    # Untagged dialogue inherits the most-recent tagged speaker WITHIN
    # THE SAME PARAGRAPH. Cross-paragraph propagation is too aggressive —
    # paragraph boundaries are speaker-change cues in most narrative
    # styles. Leave cross-paragraph attribution to the LLM.
    by_para: dict[int, list[dict]] = {}
    for s in segments:
        if s.get("kind") == "dialogue":
            by_para.setdefault(s.get("paragraph_idx", 0), []).append(s)

    for para_segs in by_para.values():
        # Forward sweep
        last_speaker: str | None = None
        for s in para_segs:
            did = s.get("dialogue_id")
            if did in anchors:
                last_speaker = anchors[did].speaker
            elif last_speaker is not None:
                anchors[did] = Anchor(speaker=last_speaker, source="propagated")
        # Backward sweep — covers an unanchored dialogue BEFORE the first
        # tag in the same paragraph.
        last_speaker = None
        for s in reversed(para_segs):
            did = s.get("dialogue_id")
            if did in anchors:
                last_speaker = anchors[did].speaker
            elif last_speaker is not None:
                anchors[did] = Anchor(speaker=last_speaker, source="propagated")

    return anchors
