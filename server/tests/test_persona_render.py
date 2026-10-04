# SPDX-License-Identifier: MIT
"""The persona's data and the one resolver (persona redesign P3, 2026-10-03).

A persona is a finished spoken voice: a voice (with its model) plus how it
speaks. Its delivery is typed — pace, pitch, gain and pauses for every model,
and per model its emotion or tags, sampling knobs and seed — and ONE resolver
(`persona_render.plan_line`) turns a persona and a line into the request every
render path sends: the chapter, a line's re-render, the game export, the
editor's Listen, Cast's ▶ and Generate with a persona.

docs/plans/2026-10-03-persona-redesign.md §6.1–§6.3 (P3).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from justvoice import persona_render
from justvoice.app import create_app
from justvoice.app_state import get_state
from justvoice.models import PersonaDelivery, PersonaDraft
from justvoice.render_core import _apply_lead_tags


@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(data_dir=tmp_path), raise_server_exceptions=False)


def _draft(**kw) -> PersonaDraft:
    return PersonaDraft(**kw)


# ── What a persona sets for a model ───────────────────────────────────────

def test_shared_values_reach_every_model_and_a_models_own_stay_with_it():
    d = PersonaDelivery.model_validate({
        "speed": 1.05, "gain_db": -1.0, "pause_after": 250,
        "models": {
            "qwen3-cv": {"knobs": {"talker_temperature": 0.7}, "emotion": "angry", "seed": 42},
            "chatterbox-turbo": {"knobs": {"top_k": 500}, "emotion": "fear", "register_tag": "dramatic"},
        },
    })
    persona = _draft(default_delivery=d)
    qwen, qtags, qseed = persona_render.model_settings(persona, "qwen3-cv")
    assert qwen["speed"] == 1.05 and qwen["gain_db"] == -1.0 and qwen["pause_after"] == 250
    assert qwen["engine"] == {"talker_temperature": 0.7}
    assert qwen["emotion"] == "angry" and qtags == [] and qseed == 42
    # Turbo's emotion and register are TAGS for the line, not words.
    turbo, ttags, tseed = persona_render.model_settings(persona, "chatterbox-turbo")
    assert "emotion" not in turbo and ttags == ["fear", "dramatic"] and tseed is None
    assert turbo["engine"] == {"top_k": 500}
    # A model with no settings of its own gets the shared values only.
    kokoro, ktags, _ = persona_render.model_settings(persona, "kokoro")
    assert kokoro == {"speed": 1.05, "gain_db": -1.0, "pause_after": 250} and ktags == []


def test_a_value_a_model_would_not_understand_is_refused_by_name():
    bad = PersonaDelivery.model_validate({"models": {
        "qwen3-cv": {"knobs": {"exaggeration": 0.5, "talker_top_k": 500}, "emotion": "fear"},
        "kokoro": {"register_tag": "dramatic"},
        "nonsense": {},
    }})
    problems = " | ".join(persona_render.check_delivery(bad))
    assert "has no exaggeration setting" in problems
    assert "Top k runs 1–100" in problems
    assert "no emotion called 'fear'" in problems          # Qwen3 takes the app's nine
    assert "no register called 'dramatic'" in problems     # Kokoro takes no tags
    assert "nonsense is not a speech model" in problems


def test_pace_is_one_range_on_every_model():
    with pytest.raises(ValueError):
        PersonaDelivery(speed=2.5)
    with pytest.raises(ValueError):
        PersonaDelivery(pitch=-13)


# ── One line, planned ─────────────────────────────────────────────────────

def test_the_direction_is_composed_most_specific_last(client):
    st = get_state()
    persona = _draft(
        voice_id="Sohee", voice_instruct="Clipped, world-weary",
        default_delivery=PersonaDelivery.model_validate({"models": {"qwen3-cv": {"emotion": "angry"}}}),
    )
    plan = persona_render.plan_line(st, persona, text="You're late.", direction="edge of irritation")
    assert plan.model == "qwen3-cv"
    assert plan.delivery["instruct"] == "Clipped, world-weary. angry. edge of irritation"


def test_a_kokoro_persona_speaks_its_voices_language_whatever_it_was_set_to(client):
    st = get_state()
    plan = persona_render.plan_line(st, _draft(voice_id="af_heart", language="ja"), text="Hi.")
    assert plan.language == "en-US"


def test_a_qwen3_persona_speaks_its_own_choice_and_falls_back_to_the_voice(client):
    st = get_state()
    assert persona_render.plan_line(st, _draft(voice_id="Ono_Anna", language="en"), text=".").language == "en"
    # A language the model can't speak falls back to the voice's own.
    assert persona_render.plan_line(st, _draft(voice_id="Ono_Anna", language="tlh"), text=".").language == "ja"


def test_the_plan_carries_effects_lexicons_and_seed(client):
    st = get_state()
    persona = _draft(
        voice_id="Sohee", lexicon_id="lex-p",
        effects_chain=[{"type": "gain", "params": {"gain_db": 1}}],
        default_delivery=PersonaDelivery.model_validate({"models": {"qwen3-cv": {"seed": 7}}}),
    )
    plan = persona_render.plan_line(st, persona, text=".", book_lexicon="lex-book")
    assert plan.lexicons == ["lex-book", "lex-p"]
    assert plan.effects == [{"type": "gain", "params": {"gain_db": 1}}]
    assert plan.seed == 7
    # A request's seed wins, and leaves the delivery.
    plan = persona_render.plan_line(st, persona, text=".", request_delivery={"seed": 9, "speed": 1.2})
    assert plan.seed == 9 and "seed" not in plan.delivery and plan.delivery["speed"] == 1.2


def test_a_tag_models_tags_lead_the_line_once():
    out = _apply_lead_tags("The tide turned.", {"tags": ["fear", "dramatic", "warm"]}, "chatterbox-turbo")
    assert out == "[fear] [dramatic] The tide turned."
    assert _apply_lead_tags("[fear] Run.", {"tags": ["fear"]}, "chatterbox-turbo") == "[fear] Run."
    # A model with no tags adds none.
    assert _apply_lead_tags("Run.", {"tags": ["fear"]}, "chatterbox-multilingual") == "Run."


# ── The persona API ───────────────────────────────────────────────────────

def test_a_new_persona_takes_its_voices_language_and_refuses_one_it_cant_speak(client):
    r = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee"})
    assert r.status_code == 201, r.text
    assert r.json()["language"] == "ko"
    r = client.post("/v1/personas", json={"name": "Warm", "voice_id": "af_heart", "language": "ja"})
    assert r.status_code == 400 and "can't speak ja" in r.json()["detail"]
    r = client.post("/v1/personas", json={"name": "Ghost", "voice_id": "no-such-voice"})
    assert r.status_code == 400 and "doesn't exist" in r.json()["detail"]


def test_patch_changes_what_was_sent_and_null_clears(client):
    pid = client.post("/v1/personas", json={
        "name": "June", "voice_id": "Sohee", "voice_instruct": "Dry wit", "note": "low",
        "default_delivery": {"speed": 1.1},
    }).json()["id"]
    r = client.patch(f"/v1/personas/{pid}", json={"voice_instruct": None, "note": "  "})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["voice_instruct"] is None and p["note"] is None
    # Left out = unchanged.
    assert p["name"] == "June" and p["default_delivery"]["speed"] == 1.1
    r = client.patch(f"/v1/personas/{pid}", json={"default_delivery": None})
    assert r.json()["default_delivery"] == {
        "speed": None, "pitch": None, "gain_db": None,
        "pause_before": None, "pause_after": None, "models": {},
    }


def test_patch_refuses_a_setting_the_model_does_not_have(client):
    pid = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee"}).json()["id"]
    r = client.patch(f"/v1/personas/{pid}", json={
        "default_delivery": {"models": {"qwen3-cv": {"knobs": {"cfg_value": 2}}}}})
    assert r.status_code == 400 and "no cfg_value setting" in r.json()["detail"]
    r = client.patch(f"/v1/personas/{pid}", json={"engine_override": "kokoro"})
    assert r.status_code == 422      # the field is gone, not ignored


def test_changing_the_voice_keeps_a_language_it_still_speaks(client):
    pid = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee", "language": "en"}).json()["id"]
    assert client.patch(f"/v1/personas/{pid}", json={"voice_id": "Ono_Anna"}).json()["language"] == "en"
    # Kokoro's Heart speaks only American English.
    assert client.patch(f"/v1/personas/{pid}", json={"voice_id": "af_heart"}).json()["language"] == "en-US"


def test_merge_moves_the_speakers_and_removes_the_persona(client):
    a = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee"}).json()["id"]
    b = client.post("/v1/personas", json={"name": "Mara", "voice_id": "Ono_Anna"}).json()["id"]
    pid = client.post("/v1/projects", json={"name": "Book", "project_type": "audiobook"}).json()["id"]
    sid = client.post(f"/v1/projects/{pid}/speakers", json={"name": "June", "persona_id": a}).json()["id"]
    r = client.post(f"/v1/personas/{a}/merge", json={"into": b})
    assert r.status_code == 200, r.text
    assert r.json()["speakers"] == 1
    assert client.get(f"/v1/personas/{a}").status_code == 404
    speakers = client.get(f"/v1/projects/{pid}/speakers").json()["speakers"]
    assert next(s for s in speakers if s["id"] == sid)["persona_id"] == b
    assert client.post(f"/v1/personas/{b}/merge", json={"into": b}).status_code == 400


# ── Listen ────────────────────────────────────────────────────────────────

def _capture_render(monkeypatch):
    from justvoice import render_core

    seen: list[dict] = []

    def fake_render_line(st, **kw):
        seen.append(kw)
        return render_core.RenderedLine(pcm=b"\x00\x00" * 10, sample_rate=24000, channels=1,
                                        effective_delivery={})

    monkeypatch.setattr(render_core, "render_line", fake_render_line)
    return seen


def test_listen_renders_the_unsaved_draft_through_the_resolver(client, monkeypatch):
    seen = _capture_render(monkeypatch)
    r = client.post("/v1/personas/preview", json={
        "persona": {"voice_id": "Sohee", "language": "en", "voice_instruct": "Dry wit",
                    "default_delivery": {"speed": 1.2}},
        "text": "You're late.", "direction": "sharp",
    })
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"RIFF")
    kw = seen[-1]
    assert kw["voice"] == "Sohee" and kw["language"] == "en" and kw["text"] == "You're late."
    assert kw["delivery"]["speed"] == 1.2 and kw["delivery"]["instruct"] == "Dry wit. sharp"


def test_an_empty_line_speaks_the_stock_line_in_the_personas_language(client, monkeypatch):
    seen = _capture_render(monkeypatch)
    pid = client.post("/v1/personas", json={"name": "Mara", "voice_id": "Ono_Anna"}).json()["id"]
    assert client.post("/v1/personas/preview", json={"persona_id": pid}).status_code == 200
    assert seen[-1]["text"] == persona_render.STOCK_LINES["ja"]


def test_a_list_play_asks_before_loading_the_model(client, monkeypatch):
    from justvoice import voice_model

    seen = _capture_render(monkeypatch)
    monkeypatch.setattr(voice_model, "is_model_loaded", lambda engine_id, model: False)
    pid = client.post("/v1/personas", json={"name": "Warm", "voice_id": "af_heart"}).json()["id"]
    r = client.post("/v1/personas/preview", json={"persona_id": pid, "auto_load": False})
    assert r.status_code == 409 and "engine_not_loaded:kokoro" in r.json()["detail"]
    assert not seen
    monkeypatch.setattr(voice_model, "is_model_loaded", lambda engine_id, model: True)
    assert client.post("/v1/personas/preview", json={"persona_id": pid, "auto_load": False}).status_code == 200


def test_listen_needs_a_voice(client):
    r = client.post("/v1/personas/preview", json={"persona": {"name": "Blank"}, "text": "Hi"})
    assert r.status_code == 400 and "Pick a voice first" in r.json()["detail"]


def test_a_persona_read_carries_its_voices_model_and_what_it_speaks(client):
    # One answer for the Personas list, Cast and the persona's page.
    a = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee", "language": "en"}).json()
    assert a["model"] == "qwen3-cv" and a["directed_by"] == "words" and a["speaks"] == "en"
    assert "CustomVoice" in a["model_name"]
    b = client.post("/v1/personas", json={"name": "Warm", "voice_id": "af_heart"}).json()["id"]
    listed = {p["id"]: p for p in client.get("/v1/personas").json()["personas"]}
    assert listed[b]["model"] == "kokoro" and listed[b]["directed_by"] == "sliders"
    assert listed[b]["speaks"].startswith("en")
    blank = client.post("/v1/personas", json={"name": "Blank"}).json()
    assert blank["model"] is None and blank["speaks"] is None
    assert client.patch(f"/v1/personas/{a['id']}", json={"note": "Dry"}).json()["model"] == "qwen3-cv"


def test_the_stock_line_is_in_the_asked_language_else_english(client):
    r = client.get("/v1/personas/stock-line", params={"language": "ja"})
    assert r.status_code == 200 and r.json()["text"] == persona_render.STOCK_LINES["ja"]
    assert client.get("/v1/personas/stock-line", params={"language": "xx"}).json()["text"] == persona_render.STOCK_LINES["en"]
    assert client.get("/v1/personas/stock-line").json()["text"] == persona_render.STOCK_LINES["en"]


def test_usage_counts_the_lines_that_carry_their_own_direction(client):
    # The editor's warning when a new voice's model can't perform written
    # direction: "18 carry a written direction — Chatterbox Turbo won't perform them."
    a = client.post("/v1/personas", json={"name": "June", "voice_id": "Sohee"}).json()["id"]
    pid = client.post("/v1/projects", json={"name": "Book", "project_type": "audiobook"}).json()["id"]
    sid = client.post(f"/v1/projects/{pid}/speakers", json={"name": "June", "persona_id": a}).json()["id"]
    scene = client.post(f"/v1/projects/{pid}/scenes", json={"title": "One"}).json()["id"]
    for i, direction in enumerate(["sharp", None, "", "whispered"]):
        r = client.post(f"/v1/scenes/{scene}/blocks", json={
            "position": i, "text": f"Line {i}.", "speaker_id": sid, "direction": direction})
        assert r.status_code == 201, r.text
    client.post(f"/v1/scenes/{scene}/blocks", json={"position": 9, "text": "Someone else.", "direction": "loud"})
    r = client.get(f"/v1/personas/{a}/usage-detail")
    assert r.status_code == 200, r.text
    assert r.json()["total_lines"] == 4 and r.json()["directed_lines"] == 2


# ── The book's language ───────────────────────────────────────────────────

def test_a_book_keeps_its_language_and_can_clear_it(client):
    r = client.post("/v1/projects", json={"name": "Book", "project_type": "audiobook", "language": "ja"})
    pid = r.json()["id"]
    assert r.json()["language"] == "ja"
    assert client.patch(f"/v1/projects/{pid}", json={"language": "en"}).json()["language"] == "en"
    r = client.patch(f"/v1/projects/{pid}", json={"language": None})
    assert r.json()["language"] is None and "language" not in r.json()["metadata"]


# ── The single-line door uses the same plan ───────────────────────────────

def test_a_lines_rerender_carries_the_direction_and_language(monkeypatch, client):
    from justvoice import export_voicelines, render_core

    seen = _capture_render(monkeypatch)
    monkeypatch.setattr(export_voicelines, "_book_lexicon_id", lambda scene_id: None)
    st = get_state()
    persona = st.personas.create("June", "Sohee", {"speed": 1.1}, voice_instruct="Dry wit", language="en")
    block = SimpleNamespace(id="b1", scene_id="s1", text="You're late.", direction="sharp")
    export_voicelines._render_block_production(st, SimpleNamespace(id=persona.id, name="June"), block)
    kw = seen[-1]
    assert kw["language"] == "en"
    assert kw["delivery"]["instruct"] == "Dry wit. sharp" and kw["delivery"]["speed"] == 1.1
    assert render_core.render_line is not None
