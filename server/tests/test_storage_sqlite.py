# SPDX-License-Identifier: GPL-3.0-or-later
"""Phase 2 storage unification — legacy JSON stores import into SQLite.

Builds a data dir containing old-format persona/lexicon/voice JSON files,
constructs AppState, and asserts the rows landed in the DB, survive a
second AppState (idempotent), and the JSON files were moved aside.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest


@pytest.fixture
def fresh_db(monkeypatch):
    """Reset the module-level engine so init_db binds to this test's dir."""
    from justvoice.database import session as dbs

    monkeypatch.setattr(dbs, "engine", None)
    monkeypatch.setattr(dbs, "SessionLocal", None)
    monkeypatch.setattr(dbs, "_db_path", None)
    yield


def _seed_legacy(data_dir):
    now = datetime.now(timezone.utc).isoformat()
    pdir = data_dir / "personas"
    pdir.mkdir(parents=True)
    (pdir / "persona_legacy1.json").write_text(json.dumps({
        "id": "persona_legacy1", "name": "Mara", "voice_id": "af_bella",
        "language": "en", "personality": "wry, deliberate",
        "default_delivery": {"speed": 0.95}, "effects_chain": [],
        "llm_rewrite_enabled": True, "llm_model": "claude-haiku-4-5",
        "created_at": now, "updated_at": now,
    }))

    ldir = data_dir / "lexicons"
    ldir.mkdir(parents=True)
    (ldir / "lex_legacy1.json").write_text(json.dumps({
        "id": "lex_legacy1", "name": "Fantasy names",
        "entries": [
            {"grapheme": "Beauchamp", "phoneme_ipa": "/ˈbiːtʃəm/"},
            {"grapheme": "Cthulhu", "alias": "kuh-THOO-loo"},
        ],
        "scope": "global", "created_at": now, "updated_at": now,
    }))

    vdir = data_dir / "voices" / "voice_legacy1"
    vdir.mkdir(parents=True)
    (vdir / "manifest.json").write_text(json.dumps({
        "id": "voice_legacy1", "engine": "chatterbox", "source": "cloned",
        "name": "Sarah", "language": "en-US", "sample_count": 2,
        "created_at": now, "updated_at": now,
    }))
    (vdir / "ref.wav").write_bytes(b"RIFF0000WAVE")


def test_legacy_json_imports_into_sqlite(tmp_path, fresh_db):
    from justvoice.app_state import AppState

    _seed_legacy(tmp_path)
    state = AppState(tmp_path)

    # Personas — full field round-trip, including the new llm columns.
    p = state.personas.get("persona_legacy1")
    assert p is not None and p.name == "Mara"
    assert p.default_delivery == {"speed": 0.95}
    assert p.llm_rewrite_enabled is True and p.llm_model == "claude-haiku-4-5"

    # Lexicons — entry notation mapping survives both directions.
    lex = state.lexicons.get("lex_legacy1")
    assert lex is not None and len(lex.entries) == 2
    by_word = {e.grapheme: e for e in lex.entries}
    assert by_word["Beauchamp"].phoneme_ipa == "/ˈbiːtʃəm/"
    assert by_word["Cthulhu"].alias == "kuh-THOO-loo"

    # Voices — metadata in DB, ref.wav untouched on disk.
    v = state.voices.get("voice_legacy1")
    assert v is not None and v.engine == "chatterbox" and v.sample_count == 2
    assert state.voices.ref_wav_path("voice_legacy1").exists()

    # JSON files moved aside, not deleted.
    assert not list((tmp_path / "personas").glob("*.json"))
    assert (tmp_path / "personas" / "_migrated_to_sqlite" / "persona_legacy1.json").exists()
    assert (tmp_path / "voices" / "voice_legacy1" / "manifest.json.migrated").exists()

    # Second AppState on the same dir — idempotent, no dupes.
    state2 = AppState(tmp_path)
    assert len([x for x in state2.personas.list() if x.id == "persona_legacy1"]) == 1


def test_sqlite_store_crud_round_trip(tmp_path, fresh_db):
    from justvoice.app_state import AppState
    from justvoice.models import LexiconEntry

    state = AppState(tmp_path)

    created = state.personas.create(name="Crow", voice_id="am_adam", personality="gravelly")
    assert state.personas.get(created.id).name == "Crow"
    updated = state.personas.update(created.id, bio="an old crow")
    assert updated.bio == "an old crow" and updated.personality == "gravelly"
    assert state.personas.delete(created.id) is True
    assert state.personas.get(created.id) is None

    lex = state.lexicons.create(name="Test", entries=[LexiconEntry(grapheme="a", alias="ay")])
    lex2 = state.lexicons.append_entry(lex.id, LexiconEntry(grapheme="b", phoneme_ipa="/b/"))
    assert len(lex2.entries) == 2
    assert state.lexicons.delete(lex.id) is True
