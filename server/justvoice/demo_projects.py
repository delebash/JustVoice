# SPDX-License-Identifier: MIT
"""Seeded demo projects — one per kind (the Scrivener tutorial pattern,
CONCEPTS §13.7). A real project the user can poke at without breaking
their own work: import-shaped data run through the SAME adapters and
materializer as real files, so the demo exercises the production path.

The audiobook demo is a real book from `samples/` (The Ninth Facet — JustWrite's
sample), imported by the JustWrite adapter. Game and podcast stay built here.
"""

from __future__ import annotations

import os
from pathlib import Path

from .imports import run_adapter
from .imports.standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)


def _bundled_samples_dir() -> Path:
    """The samples SHIPPED with the app, mirroring JustWrite's `demo_seed`:
    `JUSTVOICE_SAMPLES_SRC` when set (a packaged build points it at the bundled
    resource — that wiring is deferred, as it is in JustWrite), else the repo-root
    `samples/` (`parents[2]` from this file — it sits in `server/justvoice/`, and
    samples live outside the Python package)."""
    env = os.environ.get("JUSTVOICE_SAMPLES_SRC")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / "samples"


# The audiobook demo is JustWrite's own sample book (decided 2026-09-27: "the
# load demo just imports the project per existing code remove silwater") — the
# same `samples/<name>/book.json` layout JustWrite ships, imported by the SAME
# JustWrite adapter a user's own export goes through.
BOOK_SAMPLE = "the-ninth-facet"


def _book() -> StandardImport:
    path = _bundled_samples_dir() / BOOK_SAMPLE / "book.json"
    return run_adapter("justwrite", path.read_bytes(), filename=path.name)


def _game() -> StandardImport:
    lines = [
        ("Q01_HALE_001", "hale", "Halt. Ashfall's closed to outsiders since the burning. State your business."),
        ("Q01_HALE_002", "hale", "Refugees, eh? The well's dry and the granary's worse. But we don't turn folk away."),
        ("Q01_VYRA_001", "vyra", "I saw you in the smoke, traveler. You and the gate that should not open."),
        ("Q02_KEEPER_001", "keeper", "Three seals were placed. Three seals must answer. What do you carry?"),
        ("Q02_BRANN_001", "brann", "That gate ate my whole crew in '04. You want it open, you dig alone."),
    ]
    scenes: dict[str, StandardScene] = {}
    for lid, who, text in lines:
        group = "Ashfall Village" if lid.startswith("Q01") else "The Ember Gate"
        sc = scenes.setdefault(
            group, StandardScene(id=group.lower().replace(" ", "-"), title=group, kind="cue", lines=[])
        )
        sc.lines.append(StandardLine(character_id=who, text=text, source_ref=lid))
    return StandardImport(
        source="demo",
        project=StandardProject(
            name="Demo — Emberfall VO", kind="game_voicelines",
            description="seeded demo · stable line ids", language="en-US",
        ),
        characters=[
            StandardCharacter(id="hale", name="Guard Captain Hale", voice_hint="gruff male"),
            StandardCharacter(id="vyra", name="Vyra the Seer", voice_hint="low female, deliberate"),
            StandardCharacter(id="keeper", name="The Gatekeeper", voice_hint="hollow, doubled"),
            StandardCharacter(id="brann", name="Brann Ironhand", voice_hint="weathered male"),
        ],
        scenes=list(scenes.values()),
    )


def _podcast() -> StandardImport:
    return StandardImport(
        source="demo",
        project=StandardProject(
            name="Demo — Signal & Noise ep. 42", kind="podcast",
            description="seeded demo · 3 speakers", language="en-US",
        ),
        characters=[
            StandardCharacter(id="sarah", name="Sarah", voice_hint="bright host"),
            StandardCharacter(id="jin", name="Jin", voice_hint="dry co-host"),
            StandardCharacter(id="mave", name="Mave", voice_hint="guest, thoughtful"),
        ],
        scenes=[
            StandardScene(
                id="intro", title="Ep. 42 — The codec episode", kind="segment",
                lines=[
                    StandardLine(character_id="sarah", text="Welcome back to Signal and Noise. I'm Sarah, that's Jin, and today we have Mave from the Open Audio Project."),
                    StandardLine(character_id="jin", text="Mave, your team just shipped a codec that's half the bitrate of anything else out there. [curious]"),
                    StandardLine(character_id="mave", text="[laughs] Half on a good day. The trick is we stopped trying to preserve the waveform."),
                ],
            ),
        ],
    )


DEMOS = {
    "audiobook": _book,
    "game_voicelines": _game,
    "podcast": _podcast,
}


def demo_standard(kind: str) -> StandardImport:
    builder = DEMOS.get(kind)
    if builder is None:
        raise KeyError(kind)
    return builder()
