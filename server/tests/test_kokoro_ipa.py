# SPDX-License-Identifier: MIT
"""A lexicon's IPA reaches Kokoro again (gap 3): canonical IPA becomes Kokoro's symbols, the
words of a line are marked "[word](/phonemes/)" for our audio.cpp, by the host's own rule, and
only when the installed runtime splices."""

from __future__ import annotations

import re

import pytest

from justvoice import render_core
from justvoice.engines.audiocpp import release, runtime
from justvoice.engines.audiocpp.slot import to_speech_request
from justvoice.engines.kokoro.ipa import splice, to_kokoro


@pytest.mark.parametrize("ipa, kokoro", [
    ("/ˈbiːtʃəm/", "ˈbiːʧəm"),      # affricate → one symbol
    ("/laɪk/", "lIk"),               # a diphthong → one symbol, so "like" keeps its off-glide
    ("[ˈwʊs.tər]", "ˈwʊstər"),       # brackets and syllable dots go
    ("d͡ʒɔɪ", "ʤY"),                 # tie bar
    ("/ɡoʊ/", "ɡO"),
    ("go", "ɡo"),                    # ASCII g is ɡ to Kokoro
    ("/ˈhaʊs/", "ˈhWs"),
    ("/ˈboʊt/ /ˈbəʊt/", "ˈbOt/ /ˈbQt"),  # only the outer slashes are a wrapper
])
def test_canonical_ipa_becomes_kokoros_symbols(ipa, kokoro):
    assert to_kokoro(ipa) == kokoro


def _marked(text: str) -> list[str]:
    return sorted(re.findall(r"\[([^\]]+)\]\(/", text))


def test_the_splice_marks_exactly_the_words_the_host_keeps():
    """The table test_project_lexicon recorded from the pre-switch splice: the words spoken
    from IPA for each text. The new splice must mark the same ones."""
    full = {"Worcester": "W", "Mara Vance": "MV", "Mara": "M", "Dr.": "D", "A.": "AA"}
    spoken = {
        "To Worcester.": ["Worcester"],
        "worcester and Mara Vance": ["Mara Vance", "worcester"],
        "Mara came. Mara Vance left.": ["Mara", "Mara Vance"],
        "Worcestershire": [],
        "Nobody here.": [],
        "Marathon Dr.A.": ["A.", "Dr."],
        "Worcester Dr. Worcester": ["Worcester", "Worcester"],
        "Dr.": [],
        "   ": [],
    }
    for text, words in spoken.items():
        assert _marked(splice(text, full)) == sorted(words), text


def test_kokoro_gets_the_spliced_line():
    from justvoice.engines.manager import discover_engines

    row = next(r for r in discover_engines()["kokoro"].module.VARIANTS if r["id"] == "kokoro-82m-q8")
    req = to_speech_request(row, {"voice_id": "af_heart", "text": "Beauchamp came home.", "language": "en-US",
                                  "delivery": {"ipa_map": {"Beauchamp": "/ˈbiːtʃəm/"}}})
    assert req["input"] == "[Beauchamp](/ˈbiːʧəm/) came home."


def test_ipa_is_used_only_when_the_installed_runtime_splices(monkeypatch):
    from justvoice.engines.capability_details import CAPABILITY_DETAILS

    monkeypatch.setattr(CAPABILITY_DETAILS["kokoro"], "supports_phoneme_input", True)
    monkeypatch.setattr(runtime, "has_feature", lambda name, backend=None: name == "inline_ipa")
    assert render_core._supports_phoneme_input("kokoro") is True
    monkeypatch.setattr(runtime, "has_feature", lambda name, backend=None: False)
    assert render_core._supports_phoneme_input("kokoro") is False   # its respelling is used
    monkeypatch.setattr(CAPABILITY_DETAILS["kokoro"], "supports_phoneme_input", False)
    monkeypatch.setattr(runtime, "has_feature", lambda name, backend=None: True)
    assert render_core._supports_phoneme_input("kokoro") is False


def test_the_capability_follows_the_pin(monkeypatch):
    monkeypatch.setattr(release, "TAG", "v0.9.0")
    assert release.pinned_has("inline_ipa") is False
    monkeypatch.setattr(release, "TAG", "v0.9.0-jv.2")
    assert release.pinned_has("inline_ipa") is True
