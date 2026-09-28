# SPDX-License-Identifier: MIT
"""Cut a chapter too long for the model into pieces (2026-09-28).

The plan is `docs/plans/2026-09-28-chapter-splitting.md`. A piece is a range of
whole paragraphs — a paragraph is a speaking turn and its tag ("…," said Hale)
must stay with its line, so a cut never falls inside one. Each piece after the
first starts with a LEAD-IN: the last few paragraphs of the piece before, sent
for context (who spoke last, who "she" is). The lead-in's lines are answered
again by the model and thrown away — the earlier piece OWNS them.

Pure: the caller measures what each paragraph costs (its text plus the answer
it will need) and how much room one call has; this module only decides where
the cuts go.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A paragraph that is only a scene-break mark: "***", "* * *", "---", "#", "~".
_BREAK = re.compile(r"[\s*#~=_\-–—•·.]+")


@dataclass(frozen=True)
class Piece:
    lead: int    # first paragraph sent (the lead-in starts here)
    start: int   # first paragraph this piece owns
    end: int     # one past the last paragraph it owns


class ParagraphTooBig(ValueError):
    """One paragraph alone does not fit the room a call has."""

    def __init__(self, index: int):
        self.index = index
        super().__init__(f"paragraph {index} does not fit on its own")


def is_break(paragraph: str) -> bool:
    return bool(paragraph.strip()) and bool(_BREAK.fullmatch(paragraph))


def plan_pieces(costs: list[int], room: int, lead_in: int, breaks: set[int] | None = None) -> list[Piece]:
    """Cut paragraphs with these `costs` into pieces that each fit `room`.

    Greedy from the front: a piece takes as many paragraphs as fit alongside its
    lead-in. When a scene break falls in the last quarter of a piece, the cut moves
    to just after it — a scene change is the one place a reader loses nothing. A
    lead-in that leaves no room for even one paragraph is dropped; a paragraph that
    does not fit on its own raises ParagraphTooBig.
    """
    breaks = breaks or set()
    n = len(costs)
    pieces: list[Piece] = []
    start = 0
    while start < n:
        lead = max(start - lead_in, 0) if pieces else 0
        if sum(costs[lead:start]) + costs[start] > room:
            lead = start                       # the lead-in is a nicety, the paragraph is not
            if costs[start] > room:
                raise ParagraphTooBig(start)
        used = sum(costs[lead:start])
        end = start
        while end < n and used + costs[end] <= room:
            used += costs[end]
            end += 1
        if end < n:
            floor = start + max(1, (3 * (end - start)) // 4)
            cut = next((i + 1 for i in range(end - 1, floor - 1, -1) if i in breaks), None)
            if cut is not None:
                end = cut
        pieces.append(Piece(lead, start, end))
        start = end
    return pieces
