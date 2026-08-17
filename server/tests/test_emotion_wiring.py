# SPDX-License-Identifier: MIT
"""`Delivery.emotion` reaches an engine, and `style_prompt` no longer exists.

Emotion was declared, merged, composed and **never written by anything** —
no writer in `src/`, and on the one-off `/v1/generate` path not even a
reader. It is also the only direction control with a cross-engine meaning:
prose can be folded into `instruct` for the one family that reads prose, but
a labelled enum can ALSO compile into a token for a family that has an
emotion vocabulary. Chatterbox Turbo is that family — nineteen reserved
tokens in its `added_tokens.json`, of which this repo declared four.

`style_prompt` went the other way. It was a second prose field meaning "the
consistent voice character" against `instruct`'s "this line", and Qwen has
exactly one upstream instruct slot, so the qwen3 adapter concatenated the
pair one line before the model saw them. The standing-vs-this-line axis it
reached for is persona-vs-line, which the app already has.
"""

from __future__ import annotations

import inspect
from pathlib import Path
from typing import get_args

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.database.seed import seed_workspace
from justvoice.delivery_merge import compose_instruct
from justvoice.engines.capability_details import CAPABILITY_DETAILS
from justvoice.models import EMOTION_VALUES, Delivery, Emotion, EngineCapabilityDetail
from justvoice.render_core import (
    _apply_emotion_tag,
    _emotion_tagset,
    probe_line_cached,
    render_line,
)


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    seed_workspace()
    return TestClient(app, raise_server_exceptions=False)


TURBO = CAPABILITY_DETAILS["chatterbox-turbo"]
TURBO_EMOTION = next(t for t in TURBO.inline_tags if t.category == "emotion")


# ── compose_instruct — one slot, most specific last ────────────────────

def test_hints_join_most_specific_last() -> None:
    assert compose_instruct("weary harbour-master", "angry", "shouting over wind") == (
        "weary harbour-master. angry. shouting over wind"
    )


def test_a_lone_hint_passes_through_verbatim() -> None:
    """Joining one item must not reformat a hand-written instruct — its
    trailing punctuation is the author's, not ours."""
    assert compose_instruct("Clipped, world-weary noir delivery.") == (
        "Clipped, world-weary noir delivery."
    )


def test_blanks_drop_out_rather_than_leaving_empty_clauses() -> None:
    assert compose_instruct(None, "angry", "") == "angry"
    assert compose_instruct(None, None, None) is None


def test_trailing_punctuation_is_not_doubled_when_joining() -> None:
    assert compose_instruct("weary.", "angry") == "weary. angry"


def test_both_render_paths_compose_with_the_same_function() -> None:
    """The chapter path composed and the one-off path did not, so the same
    persona sounded different depending on which button was pressed."""
    from justvoice.api import generate_api, render_chapter_api

    assert "compose_instruct" in inspect.getsource(render_chapter_api)
    assert "compose_instruct" in inspect.getsource(generate_api)


# ── The tag compilation ────────────────────────────────────────────────

def test_a_mapped_emotion_is_prefixed_as_this_engines_token() -> None:
    out = _apply_emotion_tag("You're late.", {"emotion": "angry"}, TURBO_EMOTION)
    assert out == "[angry] You're late."


def test_the_map_translates_rather_than_passing_the_enum_through() -> None:
    """Our value is `fearful`; Turbo's token is `[fear]`."""
    assert _apply_emotion_tag("Who's there?", {"emotion": "fearful"}, TURBO_EMOTION) == (
        "[fear] Who's there?"
    )
    assert _apply_emotion_tag("Quiet.", {"emotion": "whispered"}, TURBO_EMOTION) == (
        "[whispering] Quiet."
    )


def test_neutral_is_expressible_by_adding_nothing() -> None:
    assert "neutral" in TURBO_EMOTION.value_map
    assert _apply_emotion_tag("A line.", {"emotion": "neutral"}, TURBO_EMOTION) == "A line."


@pytest.mark.parametrize("value", ["sad", "shouted", "contemptuous"])
def test_an_unmapped_emotion_emits_nothing_rather_than_a_near_neighbour(value: str) -> None:
    """Turbo has no token for these. `[crying]` is a behaviour, not `sad`'s
    state — mapping it would put sobbing into a quietly sad line."""
    assert value in EMOTION_VALUES
    assert value not in TURBO_EMOTION.value_map
    assert _apply_emotion_tag("A line.", {"emotion": value}, TURBO_EMOTION) == "A line."


def test_no_emotion_and_no_tagset_are_both_no_ops() -> None:
    assert _apply_emotion_tag("A line.", {}, TURBO_EMOTION) == "A line."
    assert _apply_emotion_tag("A line.", {"emotion": "angry"}, None) == "A line."


# ── Variant precision — the whole reason this is not engine-level ──────

class _FakeManager:
    def __init__(self, variant: str) -> None:
        self._variant = variant

    def current_variant_id(self, engine_id: str) -> str:
        return self._variant

    def resolved_default_variant(self, engine_id: str) -> str:
        return self._variant


def test_turbo_gets_its_tags(monkeypatch) -> None:
    from justvoice.engines import manager as manager_module

    monkeypatch.setattr(
        manager_module, "get_manager", lambda: _FakeManager("chatterbox-turbo-v1")
    )
    tagset = _emotion_tagset("chatterbox")
    assert tagset is not None
    assert tagset.value_map["angry"] == "angry"


def test_multilingual_shares_the_engine_id_but_gets_no_tags(monkeypatch) -> None:
    """One engine id, one adapter, two tokenizers. Multilingual would read
    `[angry]` aloud as a word, so its row must not inherit Turbo's."""
    from justvoice.engines import manager as manager_module

    monkeypatch.setattr(
        manager_module, "get_manager", lambda: _FakeManager("chatterbox-multilingual-v2")
    )
    assert _emotion_tagset("chatterbox") is None


def test_engines_with_no_emotion_vocabulary_get_none() -> None:
    for engine_id in ("kokoro", "luxtts", "tada", "qwen3"):
        assert _emotion_tagset(engine_id) is None, engine_id


# ── Declaration integrity ──────────────────────────────────────────────

def test_every_mapped_tag_is_one_this_engine_actually_declares() -> None:
    for cap_id, detail in CAPABILITY_DETAILS.items():
        for tagset in detail.inline_tags:
            for enum_value, tag in (tagset.value_map or {}).items():
                assert enum_value in EMOTION_VALUES, f"{cap_id}: {enum_value} is not an Emotion"
                assert tag == "" or tag in tagset.tags, (
                    f"{cap_id}: value_map sends {enum_value} to '{tag}', "
                    f"which is not in that set's tags"
                )


def test_a_value_map_only_ever_hangs_off_an_emotion_set() -> None:
    """`Delivery.emotion` is the only field with a cross-engine equivalent;
    a map on a speaker or pause set would have nothing to translate."""
    for cap_id, detail in CAPABILITY_DETAILS.items():
        for tagset in detail.inline_tags:
            if tagset.value_map:
                assert tagset.category == "emotion", f"{cap_id}/{tagset.category}"


def test_turbos_full_token_surface_is_declared() -> None:
    """All nineteen ids from the checkpoint's added_tokens.json. Four were
    declared before 2026-08-17, so fifteen were unreachable from any UI."""
    declared = {tag for ts in TURBO.inline_tags for tag in ts.tags}
    assert declared == {
        "angry", "fear", "happy", "sarcastic", "surprised", "crying", "whispering",
        "narration", "dramatic", "advertisement",
        "cough", "laugh", "chuckle", "sigh", "gasp", "groan", "sniff",
        "clear throat", "shush",
    }
    assert len(declared) == 19


def test_the_emotion_vocabulary_is_derived_from_the_enum() -> None:
    assert EMOTION_VALUES == list(get_args(Emotion))


def test_the_capabilities_endpoint_serves_the_vocabulary(client) -> None:
    """Served rather than duplicated in the renderer, so the picker cannot
    offer a value the server would reject."""
    body = client.get("/v1/engines/capabilities").json()
    assert body["emotion_values"] == EMOTION_VALUES


# ── The probe must keep lying-free parity with the render ──────────────

def test_the_cache_probe_applies_every_transform_the_render_does() -> None:
    """`probe_line_cached` claims to mirror `render_line`'s key derivation
    byte-for-byte. A transform added to one and not the other makes the
    probe report a hit that the render will miss."""
    probe = inspect.getsource(probe_line_cached)
    render = inspect.getsource(render_line)
    for transform in ("strip_tags", "_apply_lexicons", "_apply_emotion_tag"):
        assert transform in probe, f"{transform} missing from probe_line_cached"
        assert transform in render, f"{transform} missing from render_line"


# ── style_prompt is gone from the schema, not merely hidden ────────────

def test_delivery_has_no_style_prompt_field() -> None:
    assert "style_prompt" not in Delivery.model_fields
    assert "instruct" in Delivery.model_fields
    assert "emotion" in Delivery.model_fields


def test_no_engine_advertises_a_style_prompt() -> None:
    assert "supports_style_prompt" not in EngineCapabilityDetail.model_fields
    for cap_id, detail in CAPABILITY_DETAILS.items():
        assert not hasattr(detail, "supports_style_prompt"), cap_id


def test_a_style_prompt_in_a_request_is_rejected_not_silently_kept() -> None:
    """Pydantic drops unknown keys by default; what matters is that nothing
    downstream can resurrect it from a stored delivery."""
    d = Delivery(**{"instruct": "weary"})
    assert not hasattr(d, "style_prompt")
    assert "style_prompt" not in d.model_dump()


def test_the_qwen_adapter_no_longer_reads_one() -> None:
    """Guards the READ, not the word: the adapter keeps a comment saying why
    the field is absent, which is what stops it being reinvented.

    Read as text, not imported — engine adapters import `justvoice_plugin`,
    which only exists inside each engine's own venv. `test_engine_knob_wiring`
    reads them the same way.
    """
    adapter = (
        Path(__file__).resolve().parents[1]
        / "justvoice" / "engines" / "qwen3" / "engine.py"
    ).read_text(encoding="utf-8")
    assert 'get("style_prompt")' not in adapter
    assert "style_prompt =" not in adapter
    assert "{style_prompt}" not in adapter
