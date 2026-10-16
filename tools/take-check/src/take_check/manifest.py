# SPDX-License-Identifier: MIT
"""Reads a take manifest: one entry per take, paths absolute or relative to the manifest."""

import json
from dataclasses import dataclass
from pathlib import Path

REQUIRED = ("id", "wav", "text", "reference_wav", "emotion_asked", "model", "seed", "told", "line")


@dataclass(frozen=True)
class Take:
    id: str
    wav: Path
    text: str
    reference_wav: Path
    emotion_asked: str | None
    model: str
    seed: int | str | None
    told: bool
    line: str


def _resolve(base: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (base / path).resolve()


def load_manifest(path: Path) -> list[Take]:
    """Return the manifest's takes; raise ValueError naming every problem found."""
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("takes") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"{path}: expected {{\"takes\": [ ... ]}} with at least one take")

    base = path.resolve().parent
    problems: list[str] = []
    takes: list[Take] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        where = f"takes[{index}]"
        missing = [key for key in REQUIRED if key not in entry]
        if missing:
            problems.append(f"{where}: missing {', '.join(missing)}")
            continue
        take_id = str(entry["id"])
        if take_id in seen:
            problems.append(f"{where}: duplicate id {take_id!r}")
        seen.add(take_id)
        if not isinstance(entry["told"], bool):
            problems.append(f"{where}: told must be true or false")
        emotion = entry["emotion_asked"]
        if emotion is not None and not isinstance(emotion, str):
            problems.append(f"{where}: emotion_asked must be a string or null")
        wav = _resolve(base, entry["wav"])
        reference = _resolve(base, entry["reference_wav"])
        for label, file in (("wav", wav), ("reference_wav", reference)):
            if not file.is_file():
                problems.append(f"{where}: {label} not found: {file}")
        takes.append(
            Take(
                id=take_id,
                wav=wav,
                text=str(entry["text"]),
                reference_wav=reference,
                emotion_asked=emotion if emotion else None,
                model=str(entry["model"]),
                seed=entry["seed"],
                told=bool(entry["told"]),
                line=str(entry["line"]),
            )
        )

    # A line names one emotion: every take of the line that names one must name the same.
    by_line: dict[str, set[str]] = {}
    for take in takes:
        if take.emotion_asked:
            by_line.setdefault(take.line, set()).add(take.emotion_asked)
    for line, emotions in by_line.items():
        if len(emotions) > 1:
            problems.append(f"line {line!r}: takes ask different emotions {sorted(emotions)}")

    if problems:
        raise ValueError(f"{path}:\n  " + "\n  ".join(problems))
    return takes


def line_emotions(takes: list[Take]) -> dict[str, str | None]:
    """The emotion each line asks for, read from whichever of its takes names it."""
    result: dict[str, str | None] = {take.line: None for take in takes}
    for take in takes:
        if take.emotion_asked:
            result[take.line] = take.emotion_asked
    return result
