# SPDX-License-Identifier: MIT
"""Tests for /v1/render_chapter scene_id mode.

Covers the 10 behaviors documented in the Affordance Table for scene
mode (added 2026-06-10 in render_chapter_api.py). Each test patches the
SessionLocal global to point at a fresh in-memory SQLite and constructs
the minimum scene/block/persona graph the function needs.

Calls `_resolve_scene_to_lines` directly — that's the load-bearing
internal function; testing it gives us coverage of the resolution
logic without spinning up the full FastAPI test client + engine pool.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from justvoice.api import render_chapter_api
from justvoice.database.models import Block, Project, RenderPreset, Scene
from justvoice.errors import ApiError
from justvoice.models import Persona

from tests.conftest_db import tmp_db  # noqa: F401 — pytest discovers via fixture name
from tests.speaker_fixtures import speaker_played_by


def _patch_session(monkeypatch, session_factory):
    """Point render_chapter_api at the test's SessionLocal."""
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)


def _fake_state(personas_by_id: dict[str, Persona]):
    """Construct a state object that satisfies the function's interface.

    `_resolve_scene_to_lines` only touches `st.personas.get(id)` — so a
    minimal SimpleNamespace with a dict-backed PersonaStore stand-in is
    enough. Lets us avoid the real PersonaStore's filesystem dependency.
    """
    class _Personas:
        def get(self, pid):
            return personas_by_id.get(pid)
    return SimpleNamespace(personas=_Personas())


def _make_persona(
    pid: str,
    voice_id: str | None = "voice-1",
    voice_instruct: str | None = None,
    default_delivery: dict | None = None,
    lexicon_id: str | None = None,
) -> Persona:
    """Build a minimum Persona for the resolver."""
    now = datetime.now(timezone.utc)
    return Persona(
        id=pid,
        name=f"Persona {pid}",
        voice_id=voice_id or "",
        voice_instruct=voice_instruct,
        default_delivery=default_delivery or {},
        lexicon_id=lexicon_id,
        created_at=now,
        updated_at=now,
    )


def _make_project_with_scene(db, scene_id: str = "scene-1"):
    """Insert a Project + Scene; returns the scene."""
    proj = Project(id="proj-1", name="Test Project", project_type="audiobook")
    db.add(proj)
    db.flush()
    scene = Scene(id=scene_id, project_id=proj.id, position=0, title="Scene 1")
    db.add(scene)
    db.flush()
    return scene


def _add_block(db, scene_id: str, position: int, text: str, persona_id: str | None):
    """A line said by a speaker that `persona_id` plays (None = no speaker)."""
    b = Block(
        scene_id=scene_id,
        position=position,
        text=text,
        speaker_id=speaker_played_by(db, scene_id, persona_id),
    )
    db.add(b)
    db.flush()
    return b


# ─── #10 Scene not found raises not_found ──────────────────────────────


def test_unknown_scene_raises_not_found(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="nonexistent",
            preset_id=None,
            st=_fake_state({}),
        )
    assert exc_info.value.status_code == 404


# ─── #8 Scene with no blocks raises bad_request ────────────────────────


def test_scene_with_no_blocks_raises_bad_request(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    _make_project_with_scene(db)
    db.commit()
    db.close()

    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="scene-1",
            preset_id=None,
            st=_fake_state({}),
        )
    assert exc_info.value.status_code == 400
    assert "no blocks" in str(exc_info.value.detail).lower()


# ─── #2 Scene mode resolves blocks → personas → ChapterLines ──────────


def test_resolves_blocks_to_chapter_lines(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Hello world.", "persona-mara")
    _add_block(db, scene.id, 1, "Reply text.", "persona-jane")
    db.commit()
    db.close()

    personas = {
        "persona-mara": _make_persona("persona-mara", voice_id="voice-mara"),
        "persona-jane": _make_persona("persona-jane", voice_id="voice-jane"),
    }
    lines, lexicons = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    assert len(lines) == 2
    assert lines[0].voice == "voice-mara"
    assert lines[0].text == "Hello world."
    assert lines[1].voice == "voice-jane"
    assert lines[1].text == "Reply text."
    assert lexicons == []


# ─── #3 Persona.default_delivery merges via merge_delivery ────────────


def test_persona_default_delivery_flows_into_chapter_line(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Test.", "persona-mara")
    db.commit()
    db.close()

    personas = {
        "persona-mara": _make_persona(
            "persona-mara",
            voice_id="voice-mara",
            default_delivery={"speed": 1.2, "gain_db": -3.0},
        ),
    }
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    assert len(lines) == 1
    delivery_dict = lines[0].delivery.model_dump(exclude_none=True) if lines[0].delivery else {}
    assert delivery_dict.get("speed") == 1.2
    assert delivery_dict.get("gain_db") == -3.0


# ─── #4 Persona.voice_instruct → delivery.instruct (no explicit instruct) ─


def test_persona_voice_instruct_becomes_delivery_instruct(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Test.", "persona-mara")
    db.commit()
    db.close()

    personas = {
        "persona-mara": _make_persona(
            "persona-mara",
            voice_id="voice-mara",
            voice_instruct="Clipped, world-weary noir delivery.",
        ),
    }
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    delivery_dict = lines[0].delivery.model_dump(exclude_none=True) if lines[0].delivery else {}
    assert delivery_dict.get("instruct") == "Clipped, world-weary noir delivery."


def test_explicit_preset_instruct_wins_over_persona_instruct(tmp_db, monkeypatch):  # noqa: F811
    """Preset.delivery.instruct (tier-3) must override persona.voice_instruct (tier-2)."""
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Test.", "persona-mara")
    # Need a Persona row in DB for the RenderPreset.voice_id FK to satisfy.
    from justvoice.database.models import Persona as PersonaModel
    db.add(PersonaModel(id="persona-mara", name="Mara", voice_id="voice-mara"))
    db.flush()
    import json
    db.add(RenderPreset(
        id="preset-acx",
        name="ACX",
        voice_id="persona-mara",
        delivery_json=json.dumps({"instruct": "From preset — explicit override"}),
        master="acx",
        lexicons_json="[]",
    ))
    db.commit()
    db.close()

    personas = {
        "persona-mara": _make_persona(
            "persona-mara",
            voice_id="voice-mara",
            voice_instruct="Should not win.",
        ),
    }
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id="preset-acx",
        st=_fake_state(personas),
    )
    delivery_dict = lines[0].delivery.model_dump(exclude_none=True) if lines[0].delivery else {}
    assert delivery_dict.get("instruct") == "From preset — explicit override"


# ─── #5 Persona.lexicon_id collected ────────────────────────────────────


def test_persona_lexicon_ids_collected_and_deduped(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Hello.", "persona-a")
    _add_block(db, scene.id, 1, "Reply.", "persona-b")
    _add_block(db, scene.id, 2, "Hello again.", "persona-a")  # same lex as 0
    db.commit()
    db.close()

    personas = {
        "persona-a": _make_persona("persona-a", voice_id="voice-a", lexicon_id="lex-narrator"),
        "persona-b": _make_persona("persona-b", voice_id="voice-b", lexicon_id="lex-character"),
    }
    _lines, lexicons = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    # Order isn't guaranteed (set-based dedup); compare as sets.
    assert set(lexicons) == {"lex-narrator", "lex-character"}


# ─── #6 Block with no persona is skipped ────────────────────────────────


def test_block_with_no_persona_is_skipped(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Narrator.", None)  # no persona_id
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {
        "persona-mara": _make_persona("persona-mara", voice_id="voice-mara"),
    }
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    assert len(lines) == 1
    assert lines[0].text == "Voiced."


# ─── #7 Block with persona but no voice is skipped ──────────────────────


def test_block_with_persona_but_no_voice_is_skipped(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Skipped — voiceless persona.", "persona-noisy")
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {
        "persona-noisy": _make_persona("persona-noisy", voice_id=""),  # empty voice
        "persona-mara": _make_persona("persona-mara", voice_id="voice-mara"),
    }
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    assert len(lines) == 1
    assert lines[0].voice == "voice-mara"


# ─── #9 Empty resolved-lines raises bad_request ─────────────────────────


def test_all_blocks_skipped_raises_bad_request(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Has text but no persona.", None)
    db.commit()
    db.close()

    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="scene-1",
            preset_id=None,
            st=_fake_state({}),
        )
    assert exc_info.value.status_code == 400
    assert "no speaker, persona or voice" in str(exc_info.value.detail).lower()


# ─── Edge: empty-text blocks are skipped ────────────────────────────────


def test_empty_text_blocks_skipped(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "   ", "persona-mara")  # whitespace only
    _add_block(db, scene.id, 1, "Real text.", "persona-mara")
    db.commit()
    db.close()

    personas = {"persona-mara": _make_persona("persona-mara", voice_id="voice-mara")}
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1",
        preset_id=None,
        st=_fake_state(personas),
    )
    assert len(lines) == 1
    assert lines[0].text == "Real text."


# ─── strict= — a real render refuses instead of dropping lines ──────────
#
# The skips above are the READ-ONLY probe's behavior (cache-stats runs on
# every Home/Studio visit and only asks how much is cached). A render passes
# strict=True: a line the attribution pipeline couldn't place used to vanish
# from the audiobook in silence (Script-tab restore 2026-08-08, decision 5).


def test_strict_refuses_and_names_the_unplaced_lines(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Nobody speaks this.", None)
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {"persona-mara": _make_persona("persona-mara", voice_id="voice-mara")}
    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="scene-1", preset_id=None, st=_fake_state(personas), strict=True,
        )
    assert exc_info.value.status_code == 400
    detail = str(exc_info.value.detail)
    assert "line 1" in detail                    # 1-based position, not an index
    assert "Nobody speaks this." in detail


def test_strict_names_a_persona_cast_without_a_voice(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "Said by a voiceless persona.", "persona-noisy")
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {
        "persona-noisy": _make_persona("persona-noisy", voice_id=""),
        "persona-mara": _make_persona("persona-mara", voice_id="voice-mara"),
    }
    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="scene-1", preset_id=None, st=_fake_state(personas), strict=True,
        )
    assert "The persona Persona persona-noisy has no voice" in str(exc_info.value.detail)


def test_strict_names_a_speaker_no_persona_plays(tmp_db, monkeypatch):  # noqa: F811
    """Since 2026-09-29: a line's speaker is there, but no persona plays them."""
    from justvoice.database.models import Speaker

    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    harbek = Speaker(project_id=scene.project_id, name="Harbek")
    db.add(harbek)
    db.flush()
    db.add(Block(scene_id=scene.id, position=0, text="Halt.", speaker_id=harbek.id))
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {"persona-mara": _make_persona("persona-mara", voice_id="voice-mara")}
    with pytest.raises(ApiError) as exc_info:
        render_chapter_api._resolve_scene_to_lines(
            scene_id="scene-1", preset_id=None, st=_fake_state(personas), strict=True,
        )
    assert "Nobody plays Harbek yet" in str(exc_info.value.detail)


def test_strict_ignores_markers(tmp_db, monkeypatch):  # noqa: F811
    """Podcast music/ad direction lines are speaker-less BY DESIGN
    (projects_api._materialize_standard). Counting them as unplaced would
    refuse every marked episode forever — the bug ChapterView.vue:586
    already had to fix once on the attribution badge."""
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    marker = _add_block(db, scene.id, 0, "— Mid-roll —", None)
    marker.metadata_json = '{"marker": true}'
    _add_block(db, scene.id, 1, "Voiced.", "persona-mara")
    db.commit()
    db.close()

    personas = {"persona-mara": _make_persona("persona-mara", voice_id="voice-mara")}
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=None, st=_fake_state(personas), strict=True,
    )
    assert len(lines) == 1
    assert lines[0].text == "Voiced."


def test_strict_passes_when_every_line_has_a_voice(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)

    db = session_factory()
    scene = _make_project_with_scene(db)
    _add_block(db, scene.id, 0, "One.", "persona-mara")
    _add_block(db, scene.id, 1, "Two.", "persona-mara")
    db.commit()
    db.close()

    personas = {"persona-mara": _make_persona("persona-mara", voice_id="voice-mara")}
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=None, st=_fake_state(personas), strict=True,
    )
    assert len(lines) == 2


# ─── Leave out dialogue tags (2026-09-30, extraction/tags.py) ─────────────


def _tagged_chapter(db, *, leave_out: bool, narrator: str | None = "persona-narr"):
    """“Come here,” said Mara, “now.” — then a paragraph of narration."""
    import json

    scene = _make_project_with_scene(db)
    if leave_out:
        db.query(Project).filter(Project.id == scene.project_id).one().metadata_json = json.dumps(
            {"leave_out_tags": True})
    rows = [
        ("“Come here,”", "persona-mara", "tag", 0),
        ("said Mara,", narrator, "narration", 0),
        ("“now.”", "persona-mara", "tag", 0),
        ("She sat down.", narrator, "narration", 1),
    ]
    for pos, (text, persona, source, para) in enumerate(rows):
        b = _add_block(db, scene.id, pos, text, persona)
        b.source = source
        b.metadata_json = json.dumps({"paragraph_idx": para})
    db.commit()


_VOICED = {
    "persona-mara": _make_persona("persona-mara", voice_id="voice-mara"),
    "persona-narr": _make_persona("persona-narr", voice_id="voice-narr"),
}


def test_a_tag_only_line_is_left_out_when_the_project_says_so(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)
    db = session_factory()
    _tagged_chapter(db, leave_out=True)
    db.close()
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=None, st=_fake_state(_VOICED), strict=True)
    assert [ln.text for ln in lines] == ["“Come here,”", "“now.”", "She sat down."]


def test_tags_are_read_when_the_switch_is_off(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)
    db = session_factory()
    _tagged_chapter(db, leave_out=False)
    db.close()
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=None, st=_fake_state(_VOICED), strict=True)
    assert [ln.text for ln in lines] == ["“Come here,”", "said Mara,", "“now.”", "She sat down."]


def test_a_left_out_tag_never_blocks_the_render(tmp_db, monkeypatch):  # noqa: F811
    # A tag with no speaker would refuse the chapter — but it isn't read.
    session_factory, _engine = tmp_db
    _patch_session(monkeypatch, session_factory)
    db = session_factory()
    _tagged_chapter(db, leave_out=True)
    blk = db.query(Block).filter(Block.text == "said Mara,").one()
    blk.speaker_id = None
    db.commit()
    db.close()
    lines, _ = render_chapter_api._resolve_scene_to_lines(
        scene_id="scene-1", preset_id=None, st=_fake_state(_VOICED), strict=True)
    assert "said Mara," not in [ln.text for ln in lines]
