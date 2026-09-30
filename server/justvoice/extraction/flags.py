# SPDX-License-Identifier: MIT
"""Where to read closely — Script's Check column (§8.24, 3a).

The model is right on nearly every line and sure even when wrong, so its
confidence is no warning. What it measurably gets wrong has a shape, and these
checks mark that shape (docs/plans/2026-08-15-voice-workflow-redesign.md §8.23,
§8.25 — each was measured on answer-keyed books before it was built):

* **run** — one speaker speaks three or more turns in a row: back-to-back
  spoken paragraphs, no narration-only paragraph between, all given to them.
  Its most common mistake is losing track of turns in a back-and-forth, and
  it shows up exactly like this. The WHOLE run is one group — the wrong line
  is as often the middle one as the last. A speech over several paragraphs
  (each opens a quote, only the last closes it) is one turn.
* **only** — a speaker's only line in the chapter.
* **disagree** — the book named one speaker and the model said another.

The narrator is an ordinary speaker in every check (2026-09-29): any speaker
can narrate — Watson narrates and speaks — so a "speech given to the
Narrator" check would mark a first-person narrator's every line. It was
dropped; it had caught nothing on the published test book.

("Not in the cast" went with the speakers/personas split, 2026-09-29: a line
points at one of the book's speakers, and removing a speaker takes its lines
back to No speaker, so no line can point outside the book.)

A line you set or confirmed (`corrected`) is never marked, and neither is one
nothing decided (`manual`, an import's own). Only what Analyze decided is.

One function for the app and the eval: `server/scripts/eval_attribution.py`
imports this, so every eval run measures what ships.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

# The sources an Analyze run writes for a spoken line.
DECIDED = frozenset({"tag", "propagated", "llm", "floored"})


@dataclass
class Line:
    """One line of a chapter, in reading order."""

    id: str
    speaker: str | None          # speaker id; None = no speaker
    text: str = ""
    spoken: bool = True
    source: str | None = None
    # The paragraph of the analyzed text it came from. None (an imported or
    # pasted line) = a paragraph of its own.
    paragraph: int | None = None
    # Set only where the book's words decided the line and the model had
    # said someone else.
    llm_speaker: str | None = None
    marker: bool = False


@dataclass
class FlagGroup:
    check: str                    # "run" | "only" | "disagree"
    speaker: str | None           # whose line(s) these are
    lines: list[str] = field(default_factory=list)   # the ids marked
    # run: how many turns the speaker took with no reply.
    turns: int = 0
    # disagree: who the model said.
    other: str | None = None


def quote_left_open(text: str) -> bool:
    """A paragraph that opens a quote and never closes it — a speech that
    carries on into the next paragraph."""
    return text.count("“") > text.count("”") or text.count('"') % 2 == 1


def _paragraphs(lines: list[Line]) -> list[list[Line]]:
    out: list[list[Line]] = []
    for ln in lines:
        if ln.marker:
            continue
        if out and ln.paragraph is not None and out[-1][0].paragraph == ln.paragraph:
            out[-1].append(ln)
        else:
            out.append([ln])
    return out


def _marked(lines: list[Line]) -> list[str]:
    return [ln.id for ln in lines if ln.source in DECIDED]


def flag_groups(
    lines: list[Line],
    cast_ids: set[str] | frozenset[str],
    *,
    open_paragraphs: set[int] | None = None,
) -> list[FlagGroup]:
    """The chapter's flag groups, in reading order of their first line.

    `cast_ids` is the project's cast now. `open_paragraphs` names the paragraphs whose quote is left open, for a
    caller whose lines have lost their quote marks (the eval reads the
    pipeline's rows); without it, the lines' own text is read — a stored
    dialogue block keeps its quote marks."""
    groups: list[FlagGroup] = []

    # ── Three in a row ──────────────────────────────────────────────────
    paras = _paragraphs(lines)
    run: list[list[Line]] = []      # turns; each turn is one or more paragraphs
    run_who: str | None = None
    open_last = False

    def close() -> None:
        if len(run) >= 3:
            marked = _marked([ln for turn in run for ln in turn if ln.spoken])
            if marked:
                groups.append(FlagGroup("run", run_who, marked, turns=len(run)))

    for para in paras:
        spoken = [ln for ln in para if ln.spoken]
        who = {ln.speaker for ln in spoken}
        if not spoken or len(who) != 1 or None in who:
            close()
            run, run_who, open_last = [], None, False
            continue
        (w,) = who
        if w == run_who and run and open_last:
            run[-1] = run[-1] + para          # the same speech carrying on
        elif w == run_who:
            run.append(list(para))
        else:
            close()
            run, run_who = [list(para)], w
        first = para[0].paragraph
        open_last = (
            first in open_paragraphs
            if open_paragraphs is not None and first is not None
            else quote_left_open(" ".join(ln.text for ln in para))
        )
    close()

    # ── One line at a time ──────────────────────────────────────────────
    spoken_all = [ln for ln in lines if ln.spoken and not ln.marker]
    count = Counter(ln.speaker for ln in spoken_all)
    for ln in spoken_all:
        if ln.source not in DECIDED:
            continue
        w = ln.speaker
        if w and w in cast_ids and count[w] == 1:
            groups.append(FlagGroup("only", w, [ln.id]))
        if ln.llm_speaker and ln.llm_speaker != w:
            groups.append(FlagGroup("disagree", w, [ln.id], other=ln.llm_speaker))

    order = {ln.id: i for i, ln in enumerate(lines)}
    groups.sort(key=lambda g: order.get(g.lines[0], 0))
    return groups


def model_disagreed(source: str | None, speaker: str | None, llm_speaker: str | None) -> str | None:
    """The model's pick worth keeping: only where the book's words decided
    the line and the model said someone else. None otherwise."""
    if source not in ("tag", "propagated") or not llm_speaker or llm_speaker == "unknown":
        return None
    return llm_speaker if llm_speaker != speaker else None


def lines_from_rows(rows: list[dict], *, narrator_ids=("narrator",)) -> list[Line]:
    """A pipeline result (AttributionRow dicts, as analyze-text returns them)
    as Lines — the eval's door. Dialogue ids are `D0, D1, …`, the answer
    key's numbering."""
    out: list[Line] = []
    d = 0
    for i, r in enumerate(rows):
        spoken = r.get("kind") == "dialogue"
        spk = r.get("speaker")
        spk = None if spk in (None, "", "unknown") else ("narrator" if spk in narrator_ids else spk)
        llm = r.get("llm_speaker")
        llm = "narrator" if llm in narrator_ids else llm
        out.append(Line(
            id=f"D{d}" if spoken else f"N{i}",
            speaker=spk,
            text=r.get("text") or "",
            spoken=spoken,
            source=r.get("source"),
            paragraph=r.get("paragraph_idx"),
            llm_speaker=model_disagreed(r.get("source"), spk, llm),
        ))
        d += spoken
    return out


def flagged_lines(groups: list[FlagGroup]) -> set[str]:
    return {i for g in groups for i in g.lines}


def spoken_block(source: str | None, text: str | None) -> bool:
    """Is a stored line speech? The segmenter decides and records it as the
    source; a line it didn't decide (yours, an import's) is speech when it
    opens with a quote mark — a stored dialogue line keeps its quotes."""
    if source == "narration":
        return False
    if source in DECIDED:
        return True
    return (text or "").lstrip().startswith(("“", '"'))
