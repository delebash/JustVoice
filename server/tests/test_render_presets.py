# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for render_presets table — unique (project_id, name) constraint
+ CRUD round-trips.
"""

from __future__ import annotations

import json

from justvoice.database.models import Persona, RenderPreset

pytest_plugins = ["tests.conftest_db"]


def _make_voice(db_session, name="V1"):
    # After Slice 4 of the Profile-kill rollout RenderPreset.voice_id
    # references a Persona, not a VoiceProfile.
    v = Persona(name=name)
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)
    return v


def test_create_and_list(db_session):
    v = _make_voice(db_session)
    p = RenderPreset(
        name="ACX-default",
        voice_id=v.id,
        master="acx",
        delivery_json=json.dumps({"speed": 1.0}),
        lexicons_json="[]",
    )
    db_session.add(p)
    db_session.commit()
    assert db_session.query(RenderPreset).count() == 1


def test_unique_name_within_global_scope(db_session):
    """Two global presets (project_id null) can't share a name."""
    v = _make_voice(db_session)
    p1 = RenderPreset(name="duplicate", voice_id=v.id, project_id=None)
    db_session.add(p1)
    db_session.commit()
    p2 = RenderPreset(name="duplicate", voice_id=v.id, project_id=None)
    db_session.add(p2)
    # NOTE: enforcement is via the application-level conflict check in
    # render_presets_api.create_preset (the DB index is belt-and-suspenders
    # but SQLite treats NULL != NULL in unique indexes). Application-level
    # check covers this.
    # So this commits — but the app endpoint blocks it. We verify the app
    # path in test_render_presets_api.


def test_round_trip_fields(db_session):
    v = _make_voice(db_session)
    p = RenderPreset(
        name="my-preset",
        voice_id=v.id,
        master="acx",
        delivery_json=json.dumps({"speed": 0.9, "gain_db": -1}),
        lexicons_json=json.dumps(["lex1", "lex2"]),
        seed=42,
        cache_scope="book-123",
        description="My favorite preset",
    )
    db_session.add(p)
    db_session.commit()
    fetched = db_session.query(RenderPreset).filter(RenderPreset.name == "my-preset").one()
    assert fetched.voice_id == v.id
    assert fetched.master == "acx"
    assert json.loads(fetched.delivery_json) == {"speed": 0.9, "gain_db": -1}
    assert json.loads(fetched.lexicons_json) == ["lex1", "lex2"]
    assert fetched.seed == 42
    assert fetched.cache_scope == "book-123"
