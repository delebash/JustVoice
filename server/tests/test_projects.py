# SPDX-License-Identifier: MIT
"""Tests for the use-case-generalized Project → Scene → Block model +
the JustWrite import path."""

from __future__ import annotations

import json

from justvoice.database.models import Block, Persona, Project, ProjectPersona, Scene

pytest_plugins = ["tests.conftest_db"]


def test_project_types_are_first_class(db_session):
    """Audiobook + game_voicelines + podcast + custom all coexist."""
    types = ["audiobook", "game_voicelines", "podcast", "custom"]
    for t in types:
        db_session.add(Project(name=f"P-{t}", project_type=t))
    db_session.commit()
    for t in types:
        rows = db_session.query(Project).filter(Project.project_type == t).all()
        assert len(rows) == 1


def test_scene_block_ordering(db_session):
    """Scenes + blocks maintain position ordering."""
    p = Project(name="Book", project_type="audiobook")
    db_session.add(p)
    db_session.flush()
    for i in range(3):
        s = Scene(project_id=p.id, position=i, title=f"Chapter {i+1}")
        db_session.add(s)
        db_session.flush()
        for j in range(2):
            b = Block(scene_id=s.id, position=j, text=f"Paragraph {j+1}")
            db_session.add(b)
    db_session.commit()

    scenes = db_session.query(Scene).filter(Scene.project_id == p.id).order_by(Scene.position).all()
    assert [s.position for s in scenes] == [0, 1, 2]
    for s in scenes:
        blocks = db_session.query(Block).filter(Block.scene_id == s.id).order_by(Block.position).all()
        assert [b.position for b in blocks] == [0, 1]


def test_cast_assignment(db_session):
    """ProjectPersona is a many-to-many with role_label."""
    p = Project(name="Game", project_type="game_voicelines")
    persona = Persona(name="Mara", personality="Lead detective")
    db_session.add_all([p, persona])
    db_session.flush()
    db_session.add(ProjectPersona(project_id=p.id, persona_id=persona.id, role_label="protagonist"))
    db_session.commit()
    row = db_session.query(ProjectPersona).filter(ProjectPersona.project_id == p.id).first()
    assert row.role_label == "protagonist"
    assert row.persona_id == persona.id


def test_project_metadata_json_round_trip(db_session):
    """Per-type metadata (author/title for audiobook) survives a round-trip."""
    p = Project(
        name="The Stillwater Heist",
        project_type="audiobook",
        metadata_json=json.dumps({"author": "D. Nash", "isbn": "978-..."}),
        mastering_preset="acx",
    )
    db_session.add(p)
    db_session.commit()
    fetched = db_session.query(Project).filter(Project.id == p.id).one()
    md = json.loads(fetched.metadata_json)
    assert md["author"] == "D. Nash"
    assert fetched.mastering_preset == "acx"
