# SPDX-License-Identifier: MIT
"""Seeded demo projects — one per kind (the Scrivener tutorial pattern,
CONCEPTS §13.7). A real project the user can poke at without breaking
their own work: import-shaped data run through the SAME adapters and
materializer as real files, so the demo exercises the production path.
"""

from __future__ import annotations

from .imports.standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)


def _book() -> StandardImport:
    return StandardImport(
        source="demo",
        project=StandardProject(
            name="Demo — Stillwater",
            kind="audiobook",
            description="by S. K. Holloway · seeded demo",
            language="en-US",
        ),
        characters=[
            StandardCharacter(id="narrator", name="Narrator", voice_hint="warm, unhurried"),
            StandardCharacter(id="mara", name="Mara Vance", voice_hint="clipped, noir"),
            StandardCharacter(id="edith", name="Edith Vance", voice_hint="elderly, steady"),
        ],
        scenes=[
            StandardScene(
                id="ch1", title="The Lake House", kind="chapter",
                lines=[
                    StandardLine(character_id="narrator", text="The lake had a way of holding the morning fog long after the sun should have burned it off."),
                    StandardLine(character_id="mara", text="“You knew. All these years, you knew and you let me think it was my fault.”"),
                    StandardLine(character_id="edith", text="“Sit down, child. Some things only make sense told in order.”"),
                ],
            ),
            StandardScene(
                id="ch2", title="Old Debts", kind="chapter",
                lines=[
                    StandardLine(character_id="narrator", text="Edith's hands didn't shake as she poured the tea. That was the first thing Mara noticed."),
                    StandardLine(character_id="edith", text="“Your grandfather swore his oath on the Hecate stone, same as his father did.”"),
                ],
            ),
        ],
    )


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
            description="seeded demo · 3 hosts", language="en-US",
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
                    StandardLine(character_id="sarah", text="Welcome back to Signal and Noise. I'm Sarah, that's Jin, and today we have Mave from the Open Audio Project. [warm]"),
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
