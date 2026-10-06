# SPDX-License-Identifier: MIT
"""A line's own settings for its model — emotion, a tag model's register, the
model's own knobs (decided 2026-10-06: Render works like the persona page;
docs/plans/2026-10-06-batch-pick-and-findings.md §6).

Pins: the line keeps them per model, merged the hatch's way (a value sets,
null clears, a key left out is kept); the render reads the line's over the
persona's, in the model's own vocabulary (words or a tag); "" is none on the
line; a setting makes the line stale.
"""

from __future__ import annotations

from types import SimpleNamespace

from justvoice.line_takes import LINE_MODELS, merge_override
from justvoice.persona_render import model_settings
from tests.test_line_takes import _book, _lines, _render, _states, client, fake_speech  # noqa: F401


def _persona(models):
    return SimpleNamespace(default_delivery={"models": models})


def _find(d, key):
    """A knob's value wherever nest_engine_keys put it."""
    if key in d:
        return d[key]
    for v in d.values():
        if isinstance(v, dict):
            found = _find(v, key)
            if found is not None:
                return found
    return None


# ── Merging ──────────────────────────────────────────────────────────────


def test_models_merge_like_the_hatch():
    meta = merge_override({}, {"models": {"chatterbox": {"knobs": {"exaggeration": 0.8}, "emotion": "sad"}}})
    meta = merge_override(meta, {"models": {"chatterbox": {"knobs": {"cfg_weight": 0.3}}}})
    assert meta[LINE_MODELS] == {"chatterbox": {"knobs": {"exaggeration": 0.8, "cfg_weight": 0.3}, "emotion": "sad"}}
    meta = merge_override(meta, {"models": {"chatterbox": {"knobs": {"exaggeration": None}, "emotion": None}}})
    assert meta[LINE_MODELS] == {"chatterbox": {"knobs": {"cfg_weight": 0.3}}}
    meta = merge_override(meta, {"models": {"chatterbox": None}})
    assert LINE_MODELS not in meta
    meta = merge_override({"speed": 1.2}, {"models": {"kokoro": {"emotion": ""}}})
    assert merge_override(meta, {"models": None}) == {"speed": 1.2}


def test_a_bad_setting_is_refused():
    for bad in ({"chatterbox": {"knobs": {"exaggeration": "loud"}}}, {"chatterbox": {"volume": 2}}, "x"):
        try:
            merge_override({}, {"models": bad})
        except ValueError:
            continue
        raise AssertionError(bad)


# ── The render reads the line's over the persona's ───────────────────────


def test_a_words_models_emotion_and_knobs():
    persona = _persona({"qwen3-base": {"emotion": "happy", "knobs": {"talker_temperature": 0.7}}})
    d, tags, _ = model_settings(persona, "qwen3-base")
    assert d["emotion"] == "happy" and _find(d, "talker_temperature") == 0.7
    d, _, _ = model_settings(persona, "qwen3-base", {"emotion": "sad", "knobs": {"talker_temperature": 0.4}})
    assert d["emotion"] == "sad" and _find(d, "talker_temperature") == 0.4
    d, _, _ = model_settings(persona, "qwen3-base", {"emotion": ""})
    assert "emotion" not in d and tags == []


def test_a_tag_models_emotion_and_register_are_tags():
    persona = _persona({"chatterbox-turbo": {"emotion": "laugh", "register_tag": "narration"}})
    _, tags, _ = model_settings(persona, "chatterbox-turbo")
    assert sorted(tags) == ["laugh", "narration"]
    d, tags, _ = model_settings(persona, "chatterbox-turbo", {"emotion": "sigh", "register_tag": ""})
    assert tags == ["sigh"] and "emotion" not in d


def test_another_models_line_settings_never_reach_this_model(client, fake_speech):  # noqa: F811
    _pid, sid, (b0,), _ = _book(client, ["One."])
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"models": {"chatterbox": {"knobs": {"exaggeration": 1.5}}}}})
    _render(client, b0)
    assert _find(fake_speech[-1].get("delivery") or {}, "exaggeration") is None   # the persona is on Kokoro


# ── Through the line's own endpoint ──────────────────────────────────────


def test_a_line_setting_is_shown_and_makes_the_line_stale(client, fake_speech):  # noqa: F811
    _pid, sid, (b0,), _ = _book(client, ["One."])
    _render(client, b0)
    assert _states(client, sid) == ["rendered"]
    r = client.patch(f"/v1/blocks/{b0}", json={"line_override": {"models": {"kokoro": {"emotion": "sad"}}}})
    assert r.status_code == 200, r.text
    assert _lines(client, sid)["lines"][0]["override"] == {"models": {"kokoro": {"emotion": "sad"}}}
    assert _states(client, sid) == ["stale"]
    client.patch(f"/v1/blocks/{b0}", json={"line_override": {"models": None}})
    assert _states(client, sid) == ["rendered"]
    assert client.patch(f"/v1/blocks/{b0}", json={"line_override": {"models": {"kokoro": {"top_k": 1}}}}).status_code == 400
