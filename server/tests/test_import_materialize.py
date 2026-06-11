# SPDX-License-Identifier: GPL-3.0-or-later
"""Import materialization — persona reuse linking + lexicon creation.

Covers the two silent-drop bugs found in the A0 audit:
  1. reused personas got no ProjectPersona row for the new project
  2. StandardImport.lexicon_entries were never materialized
"""

from __future__ import annotations

from justvoice.api.projects_api import _materialize_lexicon, _materialize_standard
from justvoice.database.models import ProjectPersona
from justvoice.imports.standard_schema import (
    StandardCharacter,
    StandardImport,
    StandardLexiconEntry,
    StandardLine,
    StandardProject,
    StandardScene,
)
from justvoice.storage.lexicons import LexiconStore

pytest_plugins = ["tests.conftest_db"]


def _standard(name: str, lexicon: bool = False) -> StandardImport:
    return StandardImport(
        source="justwrite",
        project=StandardProject(name=name, kind="audiobook"),
        characters=[StandardCharacter(id="mara", name="Mara Vance")],
        scenes=[
            StandardScene(
                id="ch1",
                title="Chapter 1",
                kind="chapter",
                lines=[StandardLine(character_id="mara", text="“Hello.”")],
            )
        ],
        lexicon_entries=(
            [StandardLexiconEntry(grapheme="Hecate", alias="HEH-kuh-tee")] if lexicon else []
        ),
    )


def test_reused_persona_is_linked_to_new_project(db_session):
    p1, *_ = _materialize_standard(_standard("Book one"), db_session)
    db_session.commit()
    p2, _sc, _bl, created, reused = _materialize_standard(_standard("Book two"), db_session)
    db_session.commit()

    assert created == [] and len(reused) == 1
    links = db_session.query(ProjectPersona).filter(ProjectPersona.persona_id == reused[0]).all()
    assert {link.project_id for link in links} == {p1.id, p2.id}


def test_lexicon_entries_materialize_and_set_default(db_session, tmp_path):
    store = LexiconStore(tmp_path)
    project, *_ = _materialize_standard(_standard("Stillwater", lexicon=True), db_session)

    lex_id = _materialize_lexicon(_standard("Stillwater", lexicon=True), project, store, db_session)
    db_session.commit()

    assert lex_id is not None
    assert project.default_lexicon_id == lex_id
    lex = store.get(lex_id)
    assert lex is not None
    assert lex.scope == "project"
    assert lex.project_id == project.id
    assert [e.grapheme for e in lex.entries] == ["Hecate"]
    assert lex.entries[0].alias == "HEH-kuh-tee"

    # FK target rows must exist in SQLite too (projects.default_lexicon_id
    # is a FOREIGN KEY — the live import 500'd before this dual-write).
    from justvoice.database.models import Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry
    row = db_session.query(DbLexicon).filter(DbLexicon.id == lex_id).one()
    assert row.project_id == project.id
    words = [e.word for e in db_session.query(DbLexiconEntry).filter(DbLexiconEntry.lexicon_id == lex_id)]
    assert words == ["Hecate"]


def test_no_lexicon_entries_is_a_noop(db_session, tmp_path):
    store = LexiconStore(tmp_path)
    project, *_ = _materialize_standard(_standard("Plain"), db_session)
    assert _materialize_lexicon(_standard("Plain"), project, store, db_session) is None
    assert project.default_lexicon_id is None
    assert store.list() == []
