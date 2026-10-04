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


def test_a_model_without_tags_loses_them_all():
    assert render_core.performable_text(None, "kokoro", "kokoro", "Hi. [laugh] [warm] Bye.")         == "Hi.   Bye."


def test_a_tag_model_keeps_exactly_what_it_lists():
    """Turbo's own vocabulary survives; a word it doesn't list goes."""
    out = render_core.performable_text(None, "chatterbox", "chatterbox-turbo", "[sigh] So. [warm] [laugh]")
    assert out == "[sigh] So.  [laugh]"


def test_a_tokenless_model_of_a_tag_engine_keeps_none():
    """Chatterbox Multilingual: the same engine as Turbo, a model with no
    tags — so none survive, whichever model happens to be loaded (the tags
    follow the VOICE's model since 2026-10-03)."""
    assert render_core.performable_text(None, "chatterbox", "chatterbox-multilingual", "[laugh] Ha.") == " Ha."


def test_without_a_capability_row_a_tag_engine_keeps_the_parsers_set(monkeypatch):
    monkeypatch.setattr(render_core, "_engine_takes_tags", lambda _s, _e: True)
    assert render_core.performable_text(None, "x", "x", "[laugh] [warm] ok") == "[laugh]  ok"


def test_without_a_capability_row_a_tagless_engine_keeps_none(monkeypatch):
    monkeypatch.setattr(render_core, "_engine_takes_tags", lambda _s, _e: False)
    assert render_core.performable_text(None, "x", "x", "[laugh] ok") == " ok"
