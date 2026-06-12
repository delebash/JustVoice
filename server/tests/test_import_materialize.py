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
from justvoice.storage.personas import PersonaStore

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


def test_reused_persona_is_linked_to_new_project(db_session, tmp_path):
    p1, *_ = _materialize_standard(_standard("Book one"), db_session)
    db_session.commit()
    p2, _sc, _bl, created, reused = _materialize_standard(
        _standard("Book two"), db_session
    )
    db_session.commit()

    assert created == [] and len(reused) == 1
    links = db_session.query(ProjectPersona).filter(ProjectPersona.persona_id == reused[0]).all()
    assert {link.project_id for link in links} == {p1.id, p2.id}


def test_store_reads_materialized_personas(tmp_db, tmp_path):
    """Post-flip: PersonaStore reads the SAME rows the materializer
    writes — the dual-write (and its self-heal) is gone by design."""
    session_factory, _engine = tmp_db
    db = session_factory()
    try:
        _project, _sc, _bl, created, _re = _materialize_standard(
            _standard("Book one"), db
        )
        db.commit()
    finally:
        db.close()
    assert len(created) == 1
    pstore = PersonaStore(tmp_path, session_factory=session_factory)
    p = pstore.get(created[0])
    assert p is not None and p.name == "Mara Vance"
    assert not p.voice_id  # unassigned until Cast


def test_legacy_persona_files_import_once(tmp_db, tmp_path):
    """Pre-flip JSON files import into SQLite at store init, get renamed
    .migrated, and a later DELETE does not resurrect them."""
    import json as _json

    session_factory, _engine = tmp_db
    pdir = tmp_path / "personas"
    pdir.mkdir(parents=True)
    legacy = {
        "id": "persona_legacy1", "name": "Old Crow", "voice_id": "af_heart",
        "language": "en", "default_delivery": {"speed": 0.97}, "effects_chain": [],
        "created_at": "2026-06-01T00:00:00+00:00", "updated_at": "2026-06-01T00:00:00+00:00",
    }
    (pdir / "persona_legacy1.json").write_text(_json.dumps(legacy), encoding="utf-8")

    store = PersonaStore(tmp_path, session_factory=session_factory)
    p = store.get("persona_legacy1")
    assert p is not None and p.name == "Old Crow"
    assert p.default_delivery == {"speed": 0.97}
    assert not (pdir / "persona_legacy1.json").exists()
    assert (pdir / "persona_legacy1.json.migrated").exists()

    # Delete, then re-construct the store — the persona must stay gone.
    assert store.delete("persona_legacy1") is True
    store2 = PersonaStore(tmp_path, session_factory=session_factory)
    assert store2.get("persona_legacy1") is None


def test_store_crud_round_trip(tmp_db, tmp_path):
    session_factory, _engine = tmp_db
    store = PersonaStore(tmp_path, session_factory=session_factory)
    created = store.create("Mara", voice_id=None, bio="lake person")
    assert store.get(created.id).bio == "lake person"
    updated = store.update(created.id, personality="dry wit", voice_id="af_heart")
    assert updated.personality == "dry wit" and updated.voice_id == "af_heart"
    fetched = store.get(created.id)
    assert fetched.personality == "dry wit" and fetched.voice_id == "af_heart"
    assert [p.id for p in store.list()] == [created.id]
    assert store.delete(created.id) is True
    assert store.list() == []


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


def test_block_source_ref_persisted(db_session):
    from justvoice.database.models import Block

    std = _standard("Book one")
    std.scenes[0].lines[0].source_ref = "Q01_HALE_001"
    _materialize_standard(std, db_session)
    db_session.commit()
    import json as _json

    block = db_session.query(Block).first()
    assert _json.loads(block.metadata_json)["source_ref"] == "Q01_HALE_001"


def test_demo_projects_seed_through_the_real_materializer(db_session, tmp_path):
    from justvoice.demo_projects import demo_standard

    for kind in ("audiobook", "game_voicelines", "podcast"):
        std = demo_standard(kind)
        project, scene_count, block_count, created, _re = _materialize_standard(
            std, db_session
        )
        db_session.commit()
        assert project.project_type == kind
        assert scene_count >= 1 and block_count >= 3
        assert created  # personas land in SQLite
    # game demo carries stable line ids
    import json as _json

    from justvoice.database.models import Block, Project, Scene

    game = db_session.query(Project).filter(Project.project_type == "game_voicelines").first()
    scene = db_session.query(Scene).filter(Scene.project_id == game.id).first()
    block = db_session.query(Block).filter(Block.scene_id == scene.id).first()
    assert _json.loads(block.metadata_json)["source_ref"].startswith("Q0")
