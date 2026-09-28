# SPDX-License-Identifier: MIT
"""The one name matcher behind Discover's cast filter, library match and
alias learning (2026-09-27)."""

from justvoice.extraction.names import is_variant, match, norm, quote_in_text, refers_to

BRICK = {"id": "b", "name": "Brick Halvorn", "aliases": []}
THRELL = {"id": "t", "name": "Haldane Threll", "aliases": []}
ODE = {"id": "o", "name": "Odeline Marran", "aliases": ["Ode"]}
MARA = {"id": "m", "name": "Mara Vance", "aliases": []}
EDITH = {"id": "e", "name": "Edith Vance", "aliases": []}


def test_norm_is_case_accent_and_punctuation_blind():
    assert norm("  BRICK   Halvorn! ") == "brick halvorn"
    assert norm("O’Brien") == norm("o'brien")


def test_first_last_name_and_alias_refer_to_the_persona():
    assert refers_to("Brick", BRICK)
    assert refers_to("Threll", THRELL)
    assert refers_to("ode", ODE)                       # a recorded alias
    assert not refers_to("Odeline Brick", BRICK)
    assert not refers_to("Hal", BRICK)                 # a prefix is not a name


def test_short_words_and_prefixes_never_match_loosely():
    assert not refers_to("Ode", {"name": "Odeline Marran", "aliases": []})
    # "Al" is Al Brandt's first name, but two letters is too short to trust.
    assert not refers_to("Al", {"name": "Al Brandt", "aliases": []})
    assert refers_to("Al Brandt", {"name": "Al Brandt", "aliases": []})
    assert refers_to("Al", {"name": "Al Brandt", "aliases": ["Al"]})   # unless recorded


def test_match_refuses_ambiguity_and_prefers_exact():
    assert match("Brick", [BRICK, THRELL])["id"] == "b"
    assert match("Vance", [MARA, EDITH]) is None       # two people fit — no guess
    assert match("Mara Vance", [MARA, EDITH])["id"] == "m"
    assert match("Nobody", [BRICK]) is None


def test_variants_are_whole_word_containment():
    assert is_variant("Sedge", "Old Sedge")
    assert is_variant("Old Sedge", "sedge")
    assert not is_variant("Ann", "Annabel")
    assert not is_variant("Brick", "Nettle")


def test_quote_check_ignores_marks_and_spacing():
    text = "Brick went first, because that was what Brick was for. “Board says brass,” Brick said."
    assert quote_in_text('"Board says brass," Brick said', text)
    assert quote_in_text("brick  WENT first", text)
    assert not quote_in_text("Brick sang", text)
    assert not quote_in_text("", text)
