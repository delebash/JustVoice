# SPDX-License-Identifier: MIT
"""The 2026-08-15 split: `voice_instruct` is audio, `personality` is prose.

One persona field used to feed both the synth (as `delivery.instruct`) and
the LLM prompts (Compose / Rewrite / casting), so editing a character's
description silently changed how they SOUNDED. The field split in two, and
these tests hold the line between them:

  * `voice_instruct` reaches `delivery.instruct` and nothing else;
  * `personality` (the character sheet) reaches the prompts and NEVER the
    delivery — not as a fallback, not when the instruct is empty;
  * an importer fills the sheet only. A casting hint ("female, age 34,
    protagonist") is not a delivery instruction, so the spoken box starts
    empty and stays the user's to write.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from justvoice.api import render_chapter_api
from justvoice.api.projects_api import _materialize_standard
from justvoice.api.smart_assign_api import SmartAssignCharacter, _format_characters
from justvoice.database.models import Block, Persona as PersonaRow, Project, RenderPreset, Scene
from justvoice.imports.standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLine,
    StandardProject,
    StandardScene,
)
from justvoice.models import Persona
from justvoice.storage.personas import PersonaStore

from tests.conftest_db import tmp_db  # noqa: F401 — pytest discovers via fixture name

SHEET = "Lead detective. Dry wit, hates the fog, protective of Sarah."
INSTRUCT = "Clipped, world-weary noir delivery. Never overshares."


def _persona(voice_instruct: str | None = None, personality: str | None = None) -> Persona:
    now = datetime.now(timezone.utc)
    return Persona(
        id="persona-mara",
        name="Mara",
        voice_id="voice-mara",
        voice_instruct=voice_instruct,
        personality=personality,
        created_at=now,
        updated_at=now,
    )


def _state(persona: Persona):
    class _Personas:
        def get(self, pid):
            return persona if pid == persona.id else None

    return SimpleNamespace(personas=_Personas())


def _scene_with_one_block(session_factory, *, seed_persona_row: bool = False):
    db = session_factory()
    db.add(Project(id="proj-1", name="Book", project_type="audiobook"))
    db.flush()
    db.add(Scene(id="scene-1", project_id="proj-1", position=0, title="Chapter 1"))
    db.flush()
    if seed_persona_row:
        # RenderPreset.voice_id is an FK onto personas.
        db.add(PersonaRow(id="persona-mara", name="Mara", voice_id="voice-mara"))
        db.flush()
    db.add(Block(scene_id="scene-1", position=0, text="The fog came in.", persona_id="persona-mara"))
    db.commit()
    db.close()


def _resolve(persona, preset_id=None):
    lines, _lexicons = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=preset_id, st=_state(persona)
    )
    return lines[0].delivery.model_dump(exclude_none=True) if lines[0].delivery else {}


# ─── 1. The instruct is the audio field ─────────────────────────────────


def test_voice_instruct_reaches_delivery_and_the_sheet_does_not(tmp_db, monkeypatch):  # noqa: F811
    """A persona carrying BOTH fields renders with the instruct only."""
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    _scene_with_one_block(session_factory)

    delivery = _resolve(_persona(voice_instruct=INSTRUCT, personality=SHEET))

    assert delivery.get("instruct") == INSTRUCT
    assert SHEET not in str(delivery)


# ─── 2. The sheet never becomes a fallback instruct ─────────────────────


def test_sheet_alone_leaves_the_instruct_unset(tmp_db, monkeypatch):  # noqa: F811
    """The bug this split fixes: describing a character used to direct them."""
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    _scene_with_one_block(session_factory)

    delivery = _resolve(_persona(voice_instruct=None, personality=SHEET))

    assert "instruct" not in delivery


# ─── 3. An explicit instruct still wins ─────────────────────────────────


def test_explicit_instruct_beats_the_personas(tmp_db, monkeypatch):  # noqa: F811
    import json

    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    _scene_with_one_block(session_factory, seed_persona_row=True)

    db = session_factory()
    db.add(
        RenderPreset(
            id="preset-acx",
            name="ACX",
            voice_id="persona-mara",
            delivery_json=json.dumps({"instruct": "From the preset."}),
            master="acx",
            lexicons_json="[]",
        )
    )
    db.commit()
    db.close()

    delivery = _resolve(
        _persona(voice_instruct=INSTRUCT, personality=SHEET), preset_id="preset-acx"
    )

    assert delivery.get("instruct") == "From the preset."


# ─── 4. An import fills the sheet, never the instruct ───────────────────


def test_import_fills_the_sheet_and_leaves_the_instruct_empty(tmp_db, tmp_path):  # noqa: F811
    """JustWrite hands over a one-liner + a casting hint. Both are sheet
    material; the spoken-delivery box is the user's to write."""
    session_factory, _engine = tmp_db
    standard = StandardImport(
        source="justwrite",
        project=StandardProject(name="Stillwater", kind="audiobook"),
        characters=[
            StandardCharacter(
                id="mara",
                name="Mara Vance",
                voice_hint="female, age 34, protagonist",
                notes="The archivist who reads the tide tables.",
            )
        ],
        scenes=[
            StandardScene(
                id="ch1",
                title="Chapter 1",
                kind="chapter",
                lines=[StandardLine(character_id="mara", text="“Hello.”")],
            )
        ],
    )

    db = session_factory()
    _materialize_standard(standard, db)
    db.commit()
    db.close()

    store = PersonaStore(tmp_path, session_factory=session_factory)
    mara = next(p for p in store.list() if p.name == "Mara Vance")

    assert "The archivist who reads the tide tables." in mara.personality
    assert "Voice hint:" in mara.personality
    assert "female, age 34, protagonist" in mara.personality
    assert mara.voice_instruct is None


# ─── 5. Casting reads the sheet ─────────────────────────────────────────


def test_smart_assign_description_comes_from_the_sheet():
    long_sheet = "x" * 500
    block = _format_characters(
        [
            SmartAssignCharacter(id="p1", name="Mara", personality=long_sheet),
            SmartAssignCharacter(id="p2", name="Renn"),
        ]
    )

    assert f'description="{"x" * 200}"' in block
    assert "x" * 201 not in block
    # A character with no sheet contributes no description at all.
    assert block.splitlines()[1] == '- id="p2", name="Renn"'
