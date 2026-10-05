# SPDX-License-Identifier: MIT
"""Analyze's second look at the spoken lines it leaves with no speaker.

Decided 2026-10-05 — TASKS "Analyze takes a second look at lines it leaves
with no speaker, and offers to add who it finds"; the design and blast radius
are docs/plans/2026-10-05-second-look-build.md, the test it rests on
docs/plans/2026-10-05-second-look-test.md (30 lines, 30 right, 0 wrong).

The main call reads one chapter, so a speaker who is unseen in it stays
unknown even when the next chapter names them (The Ninth Facet's voice in the
dark, Bigger Inside's last line, is Ode — revealed in The Same Hour). After
the main call, each spoken line left with no speaker gets ONE more call: the
line marked in the text around it, the end of the chapter before and the start
of the chapter after. A cast member it names is saved marked to check (source
"second_look" — Script's "Found in a nearby chapter" mark). A speaker the text
names who is not in the cast is kept on the row (`not_in_cast`) so Script can
offer to add them. Only blank lines are asked about, so a chapter with none
costs nothing; a failed call leaves its line as it was.
"""

from __future__ import annotations

import json
import logging
import re
import time

from ..engines.llm.run import run_feature

log = logging.getLogger(__name__)

# The seeded prompt row (seed_feature_prompts.py) and its feature card.
ACTION = "speaker_second_look"

SYSTEM = (
    "You attribute ONE line of dialogue in a novel to the person who speaks it. "
    "The line is marked ⟦like this⟧ in the text around it. You also get the end of the "
    "chapter before and the start of the chapter after — a speaker who is unseen or unnamed "
    "here may be revealed there. Name a cast member only when the text makes it clear who "
    "speaks the marked line. If the speaker is not in the cast, or the text never makes it "
    'clear, answer "unknown" — a wrong name is worse than unknown. When the text does name '
    "who speaks it but they are not in the cast, put that name in \"not_in_cast\"; otherwise "
    "leave it empty. Answer with JSON only: "
    '{"reason": "<one sentence>", "speaker": "<a cast id, or unknown>", '
    '"confidence": <0 to 1>, "not_in_cast": "<a name, or empty>"}'
)

USER_TEMPLATE = """Cast:
{{cast}}

The end of the chapter before:
{{before}}

The text around the line:
{{chapter}}

The start of the chapter after:
{{after}}

Who speaks the marked line ⟦{{line}}⟧? Return only the JSON object."""


def cast_lines(characters: list[dict]) -> str:
    """The cast as the second look reads it: id, name, other names AND who they
    are. The main call's list (`prompts.format_characters`) leaves the
    description out; the second look needs it — "Answers to Ode." is the only
    link from Odeline Marran to the "Ode" the next chapter names (live
    2026-10-05: without it the voice in the dark stayed blank; the test that
    passed 30/30 had the descriptions)."""
    out = []
    for c in characters:
        bits = [f'id="{c.get("id")}"', f'name="{c.get("name")}"']
        if c.get("pronouns"):
            bits.append(f'pronouns="{c.get("pronouns")}"')
        if c.get("aliases"):
            bits.append(f'also called="{", ".join(c["aliases"])}"')
        who = " ".join(str(c.get("description") or "").split())
        if who:
            bits.append(f'who="{who[:200]}"')
        out.append("- " + ", ".join(bits))
    return "\n".join(out)


def _tail(text: str, words: int) -> str:
    w = (text or "").split()
    return " ".join(w[-words:]) if len(w) > words else (text or "")


def _head(text: str, words: int) -> str:
    w = (text or "").split()
    return " ".join(w[:words]) if len(w) > words else (text or "")


def mark(paragraph: str, line: str) -> str:
    """The paragraph with the line marked ⟦…⟧ (its quote marks may be outside
    the segment's text, so a second try drops them)."""
    s = (line or "").strip()
    i = paragraph.find(s)
    if i < 0:
        s = s.strip("\"'“”‘’ ,.")
        i = paragraph.find(s) if s else -1
    if i < 0:
        return f"{paragraph}\n⟦{line.strip()}⟧"
    return paragraph[:i] + "⟦" + s + "⟧" + paragraph[i + len(s):]


def around(paragraphs: list[str], idx: int, line: str, words: int) -> str:
    """The paragraphs around `idx` — about `words` words either side — with the
    line marked in its own paragraph."""
    before: list[str] = []
    n = 0
    for p in reversed(paragraphs[:idx]):
        if n >= words:
            break
        before.insert(0, p)
        n += len(p.split())
    after: list[str] = []
    n = 0
    for p in paragraphs[idx + 1:]:
        if n >= words:
            break
        after.append(p)
        n += len(p.split())
    here = paragraphs[idx] if 0 <= idx < len(paragraphs) else ""
    return "\n\n".join([*before, mark(here, line), *after])


def parse(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return {}
    try:
        out = json.loads(m.group(0))
    except ValueError:
        return {}
    return out if isinstance(out, dict) else {}


def second_look(
    rows: list,
    paragraphs: list[str],
    *,
    cast_text: str,
    resolve,
    cast_names,
    floor: float,
    use_floor: bool,
    before_text: str | None,
    after_text: str | None,
    cfg,
    skip: set[int] | frozenset[int] = frozenset(),
    raw_out: dict | None = None,
) -> None:
    """Ask once more about each spoken row with no speaker; changes `rows` in
    place. `resolve(raw)` maps the model's answer to a real cast id or
    "unknown"; `cast_names(name)` says whether a name is a cast member's (a
    cast member is never offered as someone to add). `skip` = row indices not
    to ask about (lines the user set — their rows are never written)."""
    asks = [i for i, r in enumerate(rows)
            if r.kind == "dialogue" and r.speaker == "unknown" and i not in skip]
    report = {"asked": len(asks), "named": 0, "not_in_cast": [], "failed": 0, "seconds": 0.0}
    if raw_out is not None:
        raw_out["second_look"] = report
    if not asks:
        return
    before = _tail(before_text, cfg.second_look_before) if before_text else "(none — this is the first chapter)"
    after = _head(after_text, cfg.second_look_after) if after_text else "(none — this is the last chapter)"
    t0 = time.time()
    for i in asks:
        row = rows[i]
        variables = {
            "cast": cast_text,
            "before": before,
            "chapter": around(paragraphs, row.paragraph_idx, row.text, cfg.second_look_words),
            "after": after,
            "line": row.text.strip(),
        }
        try:
            resp = run_feature(ACTION, variables)
        except Exception as e:  # noqa: BLE001 — an extra: a failure leaves the line as it was
            report["failed"] += 1
            log.warning("second look failed on %r: %s", row.text[:60], e)
            continue
        ans = parse(getattr(resp, "text", "") or "")
        who = resolve(ans.get("speaker"))
        try:
            conf = float(ans.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        if who not in ("unknown", "narrator", None, "") and not (use_floor and conf < floor):
            row.speaker = who
            row.confidence = conf
            row.source = "second_look"
            row.floored_from = None
            row.not_in_cast = None
            report["named"] += 1
            continue
        name = str(ans.get("not_in_cast") or "").strip().strip("\"'“”")
        if name and len(name) <= 60 and name.lower() not in ("unknown", "narrator", "none") \
                and not cast_names(name):
            row.not_in_cast = name
            if name not in report["not_in_cast"]:
                report["not_in_cast"].append(name)
    report["seconds"] = round(time.time() - t0, 1)
