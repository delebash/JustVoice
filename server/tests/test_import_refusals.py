# SPDX-License-Identifier: MIT
"""A malformed upload is refused with a 400 that says what is wrong — never a 500.

Each case below was a 500 until 2026-10-08, when the JavaScript port's comparison found them:
a zip named .epub that isn't one, a damaged zip, a CSV with old-Mac line ends, a JustWrite
file whose fields have the wrong type (docs/dev/TASKS.md, the step-5 FINDING). The JS twin is
tests/import_refusals.test.js.
"""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from justvoice.errors import ApiError
from justvoice.imports import run_adapter
from tests.jw_fixtures import book_json, book_zip

CONTAINER = (
    '<?xml version="1.0"?><container version="1.0" '
    'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
    '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'
    "</rootfiles></container>"
)


def _zip(members: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in members.items():
            zf.writestr(name, text)
    return buf.getvalue()


def _bad_crc(raw: bytes) -> bytes:
    """The (first) member's CRC in the archive's directory changed: the reader finds the
    mismatch after reading the member."""
    at = raw.index(b"PK\x01\x02") + 16
    crc = int.from_bytes(raw[at : at + 4], "little") ^ 0xFFFFFFFF
    return raw[:at] + crc.to_bytes(4, "little") + raw[at + 4 :]


def _bad_deflate(raw: bytes) -> bytes:
    """The first member's deflate stream overwritten with 0xFF bytes — a block of the
    reserved type, which zlib refuses."""
    size = int.from_bytes(raw[raw.index(b"PK\x01\x02") + 20 :][:4], "little")
    start = 30 + int.from_bytes(raw[26:28], "little") + int.from_bytes(raw[28:30], "little")
    return raw[:start] + b"\xff" * size + raw[start + size :]


def _refused(adapter: str, raw: bytes, filename: str) -> str:
    with pytest.raises(ApiError) as excinfo:
        run_adapter(adapter, raw, filename=filename)
    assert excinfo.value.status_code == 400
    return excinfo.value.detail


# ── book_prose: EPUB / DOCX ──────────────────────────────────────────


def test_a_zip_named_epub_without_a_container_is_refused():
    raw = _zip({"notes.txt": "not a book"})
    detail = _refused("book_prose", raw, "book.epub")
    assert detail == "book_prose import: EPUB has no META-INF/container.xml"


def test_an_epub_whose_package_file_is_missing_is_refused():
    raw = _zip({"META-INF/container.xml": CONTAINER})
    detail = _refused("book_prose", raw, "book.epub")
    assert detail == "book_prose import: EPUB has no OEBPS/content.opf"


@pytest.mark.parametrize(
    "raw",
    [
        b"PK\x03\x04 this is not really a zip",
        _bad_crc(_zip({"META-INF/container.xml": CONTAINER})),
        _bad_deflate(_zip({"META-INF/container.xml": CONTAINER})),
    ],
    ids=["not-a-zip", "bad-crc", "bad-deflate"],
)
@pytest.mark.parametrize("filename", ["book.epub", "book.docx"])
def test_a_damaged_zip_is_refused(raw, filename):
    assert _refused("book_prose", raw, filename) == "book_prose import: zip file is damaged"


# ── csv_lines ────────────────────────────────────────────────────────


def test_old_mac_line_ends_are_rows():
    raw = b"scene,character,text\rq1,Hale,Halt.\rq1,Mara,Go on.\r"
    result = run_adapter("csv_lines", raw, filename="lines.csv")
    assert [line.text for line in result.scenes[0].lines] == ["Halt.", "Go on."]


def test_an_over_long_field_is_refused():
    raw = b"text\n" + b"x" * 131073 + b"\n"
    detail = _refused("csv_lines", raw, "lines.csv")
    assert detail == (
        "csv_lines import: not a readable CSV file — a field is longer than 131,072 characters"
    )


# ── justwrite ────────────────────────────────────────────────────────


def _book(**changes) -> bytes:
    doc = book_json()
    for path, value in changes.items():
        target = doc
        *parents, last = path.split("__")
        for key in parents:
            target = target[int(key)] if key.isdigit() else target[key]
        target[int(last) if last.isdigit() else last] = value
    return json.dumps(doc).encode("utf-8")


@pytest.mark.parametrize(
    ("changes", "says"),
    [
        ({"project": ["not", "an", "object"]}, "'project' must be an object"),
        ({"characters": 7}, "'characters' must be a list"),
        ({"characters__0__aliases": 5}, "'aliases' of character 'mara' must be a list"),
        ({"scenes": [{"id": "scn1"}]}, "'scenes' must be an object"),
        ({"parts": 3}, "'parts' must be a list"),
        ({"parts__0__chapters": 7}, "'chapters' of a part must be a list"),
        ({"scenes__ch1": 9}, "'scenes' for chapter 'ch1' must be a list"),
        ({"scenes__ch1__0__body": 42}, "'body' of scene 'scn1' must be text"),
    ],
)
def test_a_book_with_a_wrong_type_is_refused_by_name(changes, says):
    detail = _refused("justwrite", _book(**changes), "book.json")
    assert detail == f"justwrite import: book.json is malformed — {says}"


def test_a_damaged_book_zip_is_refused():
    detail = _refused("justwrite", _bad_deflate(book_zip()), "book.zip")
    assert detail == "justwrite import: zip file is damaged"
