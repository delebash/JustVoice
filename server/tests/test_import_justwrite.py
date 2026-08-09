# SPDX-License-Identifier: MIT
"""justwrite adapter — the book zip JustWrite really exports.

The other half of this contract lives in JustWrite: a test there asserting
`book_io.assemble()` still emits the key paths read here. It is recorded in
docs/dev/TASKS.md and not built, so these fixtures are JustVoice's only guard
against the shape drifting.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from justvoice.errors import ApiError
from justvoice.imports import list_adapters, run_adapter
from tests.jw_fixtures import book_json, book_zip, scene

pytest_plugins = ["tests.conftest_db"]


def test_zip_maps_chapters_in_order_with_prose_and_cast():
    raw = book_zip(
        book_json(
            title="Stillwater",
            premise="A river town keeps its secrets.",
            characters=[
                {
                    "id": "mara", "name": "Mara Vance", "age": 34,
                    "gender": "female", "pronouns": "she/her",
                    "role": "protagonist", "oneLiner": "Runs the ferry.",
                    "aliases": ["Em", "the ferrywoman"],
                }
            ],
            chapters=[
                ("ch1", "Departure", [
                    scene("s1", "It began at dawn."),
                    scene("s2", "The dock was empty."),
                ]),
                ("ch2", "Arrival", [scene("s3", "She counted the lights.")]),
            ],
        )
    )

    result = run_adapter("justwrite", raw, filename="Stillwater.zip")

    assert result.source == "justwrite"
    assert result.project.name == "Stillwater"
    assert result.project.kind == "audiobook"
    assert result.project.description == "A river town keeps its secrets."

    # One JustVoice scene per JustWrite CHAPTER, in the book's order.
    assert [s.id for s in result.scenes] == ["ch1", "ch2"]
    assert [s.title for s in result.scenes] == ["Departure", "Arrival"]
    # Both of chapter one's scenes land inside it, in order...
    assert [ln.text for ln in result.scenes[0].lines] == [
        "It began at dawn.",
        "The dock was empty.",
    ]
    # ...with the scene boundary preserved in source_ref.
    assert [ln.source_ref for ln in result.scenes[0].lines] == [
        "chapter:ch1#scene:s1#block:0",
        "chapter:ch1#scene:s2#block:0",
    ]
    # JustWrite does not attribute dialogue, so every line is speakerless. That
    # is the expected result, NOT something to warn about: attribution is a
    # separate step the operator runs from Script, and import must not nudge.
    assert all(ln.character_id is None for s in result.scenes for ln in s.lines)
    assert not [w for w in result.warnings if "speaker" in w.lower()]

    (mara,) = result.characters
    assert (mara.id, mara.name) == ("mara", "Mara Vance")
    assert mara.voice_hint == "female, age 34, protagonist"
    assert mara.notes == "Runs the ferry. · Also known as: Em, the ferrywoman"
    # A JustWrite book carries no pronunciation data.
    assert result.lexicon_entries == []


def test_separators_scene_titles_and_markup_are_not_narrated():
    """The three things that must never reach a voice engine: JustWrite's own
    scene separator, the planning label on a scene, and inline markup."""
    body = (
        "<p>She waited.</p>"
        '<p class="scene-mark">* * *</p>'
        "<p>He said <strong>no</strong>.</p>"
        "<hr>"
    )
    raw = book_zip(
        book_json(
            chapters=[
                ("ch1", "One", [{"id": "s1", "title": "Mara confronts him", "body": body}])
            ]
        )
    )

    (chapter,) = run_adapter("justwrite", raw, filename="b.zip").scenes

    assert [ln.text for ln in chapter.lines] == ["She waited.", "He said no."]


def test_empty_chapters_are_skipped_and_named_in_a_warning():
    raw = book_zip(
        book_json(
            chapters=[
                ("ch1", "Written", [scene("s1", "Real prose.")]),
                ("ch2", "Outlined", [scene("s2")]),
                ("ch3", "Also outlined", []),
            ]
        )
    )

    result = run_adapter("justwrite", raw, filename="b.zip")

    assert [s.id for s in result.scenes] == ["ch1"]
    (skipped,) = [w for w in result.warnings if "skipped" in w]
    assert "Outlined" in skipped and "Also outlined" in skipped


def test_a_book_with_nothing_written_is_rejected():
    raw = book_zip(book_json(chapters=[("ch1", "Outlined", [])]))

    with pytest.raises(ApiError) as excinfo:
        run_adapter("justwrite", raw, filename="b.zip")

    assert "no readable text" in excinfo.value.detail


def test_images_are_ignored_but_counted():
    raw = book_zip(
        book_json(), images={"cover.png": b"not-really-a-png", "face.jpg": b"jpeg"}
    )

    result = run_adapter("justwrite", raw, filename="b.zip")

    (note,) = [w for w in result.warnings if "image" in w]
    assert "2 image file(s)" in note


def test_a_bare_book_json_also_parses():
    raw = json.dumps(book_json()).encode("utf-8")

    result = run_adapter("justwrite", raw, filename="book.json")

    assert [s.title for s in result.scenes] == ["One"]
    assert not [w for w in result.warnings if "image" in w]


def test_a_non_justwrite_json_is_rejected_and_names_the_right_adapter():
    raw = json.dumps(
        {"schema_version": "1.0", "source": "justvoice_standard", "project": {"name": "x"}}
    ).encode("utf-8")

    with pytest.raises(ApiError) as excinfo:
        run_adapter("justwrite", raw, filename="payload.json")

    assert "justvoice_standard" in excinfo.value.detail


def test_a_zip_without_book_json_is_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("Stillwater/notes.txt", "nope")

    with pytest.raises(ApiError) as excinfo:
        run_adapter("justwrite", buf.getvalue(), filename="x.zip")

    assert "book.json" in excinfo.value.detail


def test_the_format_picker_offers_the_zip():
    """The renderer's file dialog filters on these extensions
    (ImportModal.vue), so a missing .zip would make the export unpickable."""
    (info,) = [a for a in list_adapters() if a.id == "justwrite"]

    assert ".zip" in info.file_extensions
    assert info.implemented is True
