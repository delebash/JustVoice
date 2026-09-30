# SPDX-License-Identifier: MIT
"""Every [tag] the rendering engine can't perform is dropped (decided
2026-09-29: "drop every [word] tag the chosen engine doesn't list, not only
the ones the app recognises").

Found on the walkthrough: the podcast demo's "[warm]" — a tag no engine
declares — survived `inline_tags.strip`, which removed only the tags the
parser knew, and Kokoro said the word "warm" aloud (Whisper heard "Welcome
back to the show. Warm, it is good to have you here.").
"""

from __future__ import annotations

from types import SimpleNamespace

from justvoice import render_core
from justvoice.inline_tags import strip


def test_strip_drops_every_tag_by_default():
    assert strip("Welcome back. [warm] Good to see you.") == "Welcome back.  Good to see you."
    assert strip("He sighed. [sigh] Fine.") == "He sighed.  Fine."
    assert strip("[whisper]quiet[/whisper] [pause:0.5s]done") == "quiet done"
    # Bracketed text is a tag by this shape — decided with the rule.
    assert strip("It was their [sic] house.") == "It was their  house."


def test_a_tag_of_several_words_is_one_tag():
    """Turbo's `[clear throat]` — kept where it is performed, gone where not."""
    assert strip("Well. [clear throat] Right.") == "Well.  Right."
    assert strip("Well. [clear throat] Right.", keep={"clear throat"}) == "Well. [clear throat] Right."


def test_strip_keeps_only_the_listed_tags():
    assert strip("[laugh] ha [warm] there", keep={"laugh"}) == "[laugh] ha  there"
    assert strip("[LAUGH] ha", keep={"laugh"}) == "[LAUGH] ha"


def _row(*tagsets):
    return SimpleNamespace(inline_tags=[SimpleNamespace(**t) for t in tagsets])


def test_an_engine_without_tags_loses_them_all(monkeypatch):
    monkeypatch.setattr(render_core, "_capability_row", lambda _e: _row(
        {"syntax": "[{value}]", "tags": ["laugh"]}))
    assert render_core.performable_text(None, "kokoro", "Hi. [laugh] [warm] Bye.", tags_supported=False) \
        == "Hi.   Bye."


def test_a_tag_engine_keeps_exactly_what_its_variant_lists(monkeypatch):
    monkeypatch.setattr(render_core, "_capability_row", lambda _e: _row(
        {"syntax": "[{value}]", "tags": ["laugh", "sigh"]},
        {"syntax": "<|emotion:{value}|>", "tags": ["warm"]},   # not bracket syntax
    ))
    out = render_core.performable_text(None, "chatterbox", "[sigh] So. [warm] [laugh]", tags_supported=True)
    assert out == "[sigh] So.  [laugh]"


def test_a_tokenless_variant_of_a_tag_engine_keeps_none(monkeypatch):
    """Chatterbox Multilingual: the engine declares tags (Turbo's), the
    variant that renders has none — so none survive."""
    monkeypatch.setattr(render_core, "_capability_row", lambda _e: _row())
    assert render_core.performable_text(None, "chatterbox", "[laugh] Ha.", tags_supported=True) == " Ha."


def test_without_a_capability_row_a_tag_engine_keeps_the_parsers_set(monkeypatch):
    monkeypatch.setattr(render_core, "_capability_row", lambda _e: None)
    assert render_core.performable_text(None, "x", "[laugh] [warm] ok", tags_supported=True) == "[laugh]  ok"
