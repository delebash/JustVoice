# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the takes table — per-block take versioning invariants."""

from __future__ import annotations

from justtts.database.models import Block, Generation, Scene, Project, Take, VoiceProfile

pytest_plugins = ["tests.conftest_db"]


def _seed(db_session):
    v = VoiceProfile(name="V", voice_type="cloned")
    db_session.add(v)
    p = Project(name="Book", project_type="audiobook")
    db_session.add(p)
    db_session.flush()
    s = Scene(project_id=p.id, position=0)
    db_session.add(s)
    db_session.flush()
    b = Block(scene_id=s.id, position=0, text="Hello.")
    db_session.add(b)
    db_session.flush()
    return v, b


def _gen(db_session, voice, block):
    g = Generation(text=block.text, engine="kokoro", profile_id=voice.id, block_id=block.id)
    db_session.add(g)
    db_session.flush()
    return g


def test_default_take_is_at_most_one_per_block_in_application_layer(db_session):
    """Application code (takes_api.set_default_take) clears prior defaults
    before marking the new one. This test sets two takes, marks first as
    default, then second — and verifies that we see exactly one default.
    """
    v, b = _seed(db_session)
    g1 = _gen(db_session, v, b)
    g2 = _gen(db_session, v, b)
    t1 = Take(block_id=b.id, generation_id=g1.id, is_default=True, label="Take 1")
    t2 = Take(block_id=b.id, generation_id=g2.id, is_default=False, label="Take 2")
    db_session.add_all([t1, t2])
    db_session.commit()

    # Simulate the set-default flow.
    db_session.query(Take).filter(Take.block_id == b.id, Take.is_default == True).update(  # noqa: E712
        {"is_default": False}
    )
    t2.is_default = True
    db_session.commit()

    defaults = db_session.query(Take).filter(Take.block_id == b.id, Take.is_default == True).all()  # noqa: E712
    assert len(defaults) == 1
    assert defaults[0].id == t2.id


def test_take_lineage(db_session):
    """source_take_id chains so retakes-of-retakes are traceable."""
    v, b = _seed(db_session)
    g_orig = _gen(db_session, v, b)
    g_retake = _gen(db_session, v, b)
    t_orig = Take(block_id=b.id, generation_id=g_orig.id, is_default=True, label="Original")
    db_session.add(t_orig)
    db_session.flush()
    t_retake = Take(
        block_id=b.id,
        generation_id=g_retake.id,
        source_take_id=t_orig.id,
        label="Retake",
    )
    db_session.add(t_retake)
    db_session.commit()
    assert t_retake.source_take_id == t_orig.id
