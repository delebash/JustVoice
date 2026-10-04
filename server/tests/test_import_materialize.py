# SPDX-License-Identifier: MIT
"""Import materialization — the book's speakers + lexicon creation.

Covers the silent-drop bug found in the A0 audit (StandardImport.lexicon_entries
were never materialized), and — since the 2026-09-29 split — that a book's
characters arrive as that book's speakers, cast with the persona of exactly
their name when the library has one.
"""

from __future__ import annotations

from justvoice.api.projects_api import _materialize_lexicon, _materialize_standard
from justvoice.database.models import Persona, Speaker
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


def test_each_book_gets_its_own_speakers_played_by_the_named_persona(db_session, tmp_path):
    """The same character in two books is a speaker in each; a persona of
    exactly that name plays both ("Every new speaker", 2026-09-29)."""
    voice = Persona(name="mara vance ")
    db_session.add(voice)
    db_session.commit()
    p1, _sc, _bl, created1, _ = _materialize_standard(_standard("Book one"), db_session)
    db_session.commit()
    p2, _sc, _bl, created2, _ = _materialize_standard(_standard("Book two"), db_session)
    db_session.commit()

    assert len(created1) == 1 and len(created2) == 1 and created1 != created2
    rows = db_session.query(Speaker).filter(Speaker.name == "Mara Vance").all()
    assert {s.project_id for s in rows} == {p1.id, p2.id}
    assert {s.persona_id for s in rows} == {voice.id}


def test_a_reimport_reuses_the_books_speaker(db_session, tmp_path):
    """A second materialize of the same character INTO the same book (the
    re-import path) finds the speaker by its import id — never a duplicate."""
    from justvoice.api._speaker_helpers import ensure_speaker

    p1, *_ = _materialize_standard(_standard("Book one"), db_session)
    db_session.commit()
    again, created = ensure_speaker(db_session, p1.id, name="Mara Vance",
                                    imported_from="justwrite", imported_id="mara")
    assert created is False
    assert db_session.query(Speaker).filter(Speaker.project_id == p1.id).count() == 1


def test_an_import_makes_speakers_and_no_persona(tmp_db, tmp_path):
    """Since 2026-09-29 a book's characters are its speakers; the library of
    personas (the voices) is untouched by an import."""
    session_factory, _engine = tmp_db
    db = session_factory()
    try:
        _project, _sc, _bl, created, _re = _materialize_standard(
            _standard("Book one"), db
        )
        db.commit()
        assert [s.name for s in db.query(Speaker).filter(Speaker.id.in_(created))] == ["Mara Vance"]
    finally:
        db.close()
    assert PersonaStore(tmp_path, session_factory=session_factory).list() == []


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
    assert p.default_delivery.speed == 0.97
    assert not (pdir / "persona_legacy1.json").exists()
    assert (pdir / "persona_legacy1.json.migrated").exists()

    # Delete, then re-construct the store — the persona must stay gone.
    assert store.delete("persona_legacy1") is True
    store2 = PersonaStore(tmp_path, session_factory=session_factory)
    assert store2.get("persona_legacy1") is None


def test_store_crud_round_trip(tmp_db, tmp_path):
    session_factory, _engine = tmp_db
    store = PersonaStore(tmp_path, session_factory=session_factory)
    created = store.create("Mara", voice_id=None, note="warm, low, unhurried")
    assert store.get(created.id).note == "warm, low, unhurried"
    updated = store.update(created.id, voice_instruct="dry wit", voice_id="af_heart")
    assert updated.voice_instruct == "dry wit" and updated.voice_id == "af_heart"
    fetched = store.get(created.id)
    assert fetched.voice_instruct == "dry wit" and fetched.voice_id == "af_heart"
    assert [p.id for p in store.list()] == [created.id]
    assert store.delete(created.id) is True
    assert store.list() == []


def test_lexicon_entries_materialize_and_set_default(tmp_db, tmp_path):
    session_factory, _engine = tmp_db
    db = session_factory()
    try:
        project, *_ = _materialize_standard(_standard("Stillwater", lexicon=True), db)
        lex_id = _materialize_lexicon(_standard("Stillwater", lexicon=True), project, db)
        db.commit()
        assert lex_id is not None
        assert project.default_lexicon_id == lex_id
        project_id = project.id

        # FK target rows live in SQLite (one transaction with the project).
        from justvoice.database.models import Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry
        row = db.query(DbLexicon).filter(DbLexicon.id == lex_id).one()
        assert row.project_id == project_id
        rows = list(db.query(DbLexiconEntry).filter(DbLexiconEntry.lexicon_id == lex_id))
        # Since 2026-08-21 the book's character names seed the lexicon as
        # BLANK worklist rows beside the explicit entries (the decided
        # seed item; empty pronunciation is inert at render). The explicit
        # entry keeps its pronunciation; the seeded name arrives blank.
        by_word = {e.word: e for e in rows}
        assert set(by_word) == {"Hecate", "Mara Vance"}
        assert by_word["Hecate"].pronunciation == "HEH-kuh-tee"
        assert by_word["Mara Vance"].pronunciation == ""
    finally:
        db.close()

    # Post-flip: the store reads the SAME rows.
    store = LexiconStore(tmp_path, session_factory=session_factory)
    lex = store.get(lex_id)
    assert lex is not None
    assert lex.scope == "project"
    assert lex.project_id == project_id
    by_grapheme = {e.grapheme: e for e in lex.entries}
    assert set(by_grapheme) == {"Hecate", "Mara Vance"}
    assert by_grapheme["Hecate"].alias == "HEH-kuh-tee"
    # The seeded name round-trips as a blank worklist row (no alias, no
    # IPA) — inert at render until someone fills it in.
    assert by_grapheme["Mara Vance"].alias in (None, "")
    assert by_grapheme["Mara Vance"].phoneme_ipa in (None, "")


def test_characters_alone_seed_a_blank_worklist(tmp_db, tmp_path):
    """Renamed from test_no_lexicon_entries_is_a_noop 2026-08-21: an import
    with characters is NOT a no-op any more — the names seed a lexicon of
    blank rows (the decided seed item). A true no-op now needs an import
    with neither entries nor characters."""
    session_factory, _engine = tmp_db
    db = session_factory()
    try:
        project, *_ = _materialize_standard(_standard("Plain"), db)
        lex_id = _materialize_lexicon(_standard("Plain"), project, db)
        assert lex_id is not None
        assert project.default_lexicon_id == lex_id
        db.commit()

        from justvoice.database.models import LexiconEntry as DbLexiconEntry
        rows = list(db.query(DbLexiconEntry).filter(DbLexiconEntry.lexicon_id == lex_id))
        assert [(e.word, e.pronunciation) for e in rows] == [("Mara Vance", "")]

        # And the true no-op: nothing to seed → no lexicon.
        bare = _standard("Empty")
        bare.characters = []
        project2, *_ = _materialize_standard(bare, db)
        assert _materialize_lexicon(bare, project2, db) is None
        assert project2.default_lexicon_id is None
        db.commit()
    finally:
        db.close()


def test_lexicon_store_crud_round_trip(tmp_db, tmp_path):
    from justvoice.models import LexiconEntry

    session_factory, _engine = tmp_db
    store = LexiconStore(tmp_path, session_factory=session_factory)
    lex = store.create("Names", entries=[LexiconEntry(grapheme="Beauchamp", alias="bee-chum")])
    got = store.get(lex.id)
    assert [e.grapheme for e in got.entries] == ["Beauchamp"]
    store.append_entry(lex.id, LexiconEntry(grapheme="Hecate", phoneme_ipa="/ˈhɛkəti/"))
    got = store.get(lex.id)
    assert [e.grapheme for e in got.entries] == ["Beauchamp", "Hecate"]
    assert got.entries[1].phoneme_ipa == "/ˈhɛkəti/"
    replaced = store.update(lex.id, [LexiconEntry(grapheme="Worcestershire", alias="WUSS-ter-sher")])
    assert [e.grapheme for e in replaced.entries] == ["Worcestershire"]
    assert store.delete(lex.id) is True
    assert store.list() == []


def test_legacy_lexicon_files_import_once(tmp_db, tmp_path):
    import json as _json

    session_factory, _engine = tmp_db
    ldir = tmp_path / "lexicons"
    ldir.mkdir(parents=True)
    legacy = {
        "id": "lex_legacy1", "name": "Old names", "scope": "global",
        "entries": [{"grapheme": "Beauchamp", "alias": "bee-chum"}],
        "created_at": "2026-06-01T00:00:00+00:00", "updated_at": "2026-06-01T00:00:00+00:00",
    }
    (ldir / "lex_legacy1.json").write_text(_json.dumps(legacy), encoding="utf-8")

    store = LexiconStore(tmp_path, session_factory=session_factory)
    lex = store.get("lex_legacy1")
    assert lex is not None and [e.grapheme for e in lex.entries] == ["Beauchamp"]
    assert not (ldir / "lex_legacy1.json").exists()
    assert (ldir / "lex_legacy1.json.migrated").exists()

    assert store.delete("lex_legacy1") is True
    store2 = LexiconStore(tmp_path, session_factory=session_factory)
    assert store2.get("lex_legacy1") is None


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
        assert created  # speakers land in SQLite
    # game demo carries stable line ids
    import json as _json

    from justvoice.database.models import Block, Project, Scene

    game = db_session.query(Project).filter(Project.project_type == "game_voicelines").first()
    scene = db_session.query(Scene).filter(Scene.project_id == game.id).first()
    block = db_session.query(Block).filter(Block.scene_id == scene.id).first()
    assert _json.loads(block.metadata_json)["source_ref"].startswith("Q0")


def test_the_audiobook_demo_is_the_ninth_facet_through_the_justwrite_adapter(tmp_path):
    """Decided 2026-09-27: the audiobook demo imports samples/the-ninth-facet —
    JustWrite's sample book — by the same adapter a user's export uses."""
    from fastapi.testclient import TestClient

    from justvoice.app import create_app
    from justvoice.database.seed import seed_workspace

    client = TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)
    seed_workspace()
    r = client.post("/v1/projects/demo", json={"kind": "audiobook"})
    assert r.status_code == 200, r.text
    pid = r.json()["project_id"]
    assert r.json()["standard"]["source"] == "justwrite"
    project = client.get(f"/v1/projects/{pid}").json()
    assert project["name"] == "The Ninth Facet" and project["project_type"] == "audiobook"
    assert len(client.get(f"/v1/projects/{pid}/scenes").json()) == 4
    cast = {s["name"] for s in client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]}
    assert {"Cael Ferren", "Haldane Threll"} <= cast
